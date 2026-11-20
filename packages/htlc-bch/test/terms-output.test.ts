import { describe, expect, it } from 'vitest';
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import {
  encodeTermsOutput,
  encodeTermsPayload,
  parseTermsOutput,
  rebuildCovenantFromTerms,
  TERMS_OUTPUT_MAGIC,
} from '../src/terms-output.js';
import { deriveHtlcAddresses, encodeHtlcParameters } from '../src/contract.js';
import type { OrderTerms } from '../src/types.js';

describe('terms-output', () => {
  const p2pkhRecipient = hexToBin(
    '76a914111111111111111111111111111111111111111188ac',
  );
  const p2pkhRefund = hexToBin(
    '76a914222222222222222222222222222222222222222288ac',
  );
  const p2sh32Refund = hexToBin(
    'aa20333333333333333333333333333333333333333333333333333333333333333387',
  );
  const sampleTag = '0x0102030405060708' as const;

  it('encodes and parses round-trip with P2PKH refund locking bytecode', () => {
    const lockingBytecode = encodeTermsOutput({
      tag: sampleTag,
      token: 'PUSD',
      tokenAmount: 10_000n,
      refundHeight: 850_000,
      maxFee: 1500,
      recipientLockingBytecode: p2pkhRecipient,
      refundLockingBytecode: p2pkhRefund,
    });

    expect(lockingBytecode[0]).toBe(0x6a); // OP_RETURN
    const parsed = parseTermsOutput(lockingBytecode);

    expect(parsed.version).toBe(1);
    expect(parsed.tag).toBe(sampleTag);
    expect(parsed.token).toBe('PUSD');
    expect(parsed.tokenAmount).toBe(10_000n);
    expect(parsed.refundHeight).toBe(850_000);
    expect(parsed.maxFee).toBe(1500);
    expect(binToHex(parsed.recipientLockingBytecode)).toBe(
      binToHex(p2pkhRecipient),
    );
    expect(binToHex(parsed.refundLockingBytecode)).toBe(binToHex(p2pkhRefund));
  });

  it('encodes and parses round-trip with P2SH32 refund locking bytecode', () => {
    const lockingBytecode = encodeTermsOutput({
      tag: sampleTag,
      token: 'MUSD',
      tokenAmount: 500_000n,
      refundHeight: 900_000,
      maxFee: 2000,
      recipientLockingBytecode: p2pkhRecipient,
      refundLockingBytecode: p2sh32Refund,
    });

    const parsed = parseTermsOutput(lockingBytecode);

    expect(parsed.version).toBe(1);
    expect(parsed.tag).toBe(sampleTag);
    expect(parsed.token).toBe('MUSD');
    expect(parsed.tokenAmount).toBe(500_000n);
    expect(parsed.refundHeight).toBe(900_000);
    expect(parsed.maxFee).toBe(2000);
    expect(binToHex(parsed.recipientLockingBytecode)).toBe(
      binToHex(p2pkhRecipient),
    );
    expect(binToHex(parsed.refundLockingBytecode)).toBe(binToHex(p2sh32Refund));
  });

  it('defaults to 8 zero bytes when tag is omitted', () => {
    const lockingBytecode = encodeTermsOutput({
      token: 'PUSD',
      tokenAmount: 1000n,
      refundHeight: 800_000,
      maxFee: 1000,
      recipientLockingBytecode: p2pkhRecipient,
      refundLockingBytecode: p2pkhRefund,
    });

    const parsed = parseTermsOutput(lockingBytecode);
    expect(parsed.tag).toBe('0x0000000000000000');
  });

  it('encodes directly from OrderTerms (reverse swap)', () => {
    const terms: OrderTerms = {
      version: 1,
      direction: 'BCH_TO_EVM',
      bchToken: 'PUSD',
      bchTokenCategory:
        '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
      bchTokenAmount: 25000n,
      bchRefundHeight: 888_000,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-terms-001',
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.0',
            source: 'test',
            asOf: 1794764140,
          },
        ],
        spreadBps: 40,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
      userBchLockingBytecode: `0x${binToHex(p2pkhRefund)}`,
      solverBchLockingBytecode: `0x${binToHex(p2pkhRecipient)}`,
      hashLock: `0x${'aa'.repeat(32)}`,
      evmAmount: 25000000n,
      evmChainId: 8453,
      evmHtlc: `0x${'bb'.repeat(20)}`,
      evmToken: `0x${'cc'.repeat(20)}`,
      userEvmAddress: `0x${'dd'.repeat(20)}`,
      solverEvmAddress: `0x${'ee'.repeat(20)}`,
      evmDeadline: 1794900000,
      quoteExpiry: 1794850000,
    };

    const lockingBytecode = encodeTermsOutput({
      params: terms,
      tag: sampleTag,
    });
    const parsed = parseTermsOutput(lockingBytecode);

    expect(parsed.token).toBe('PUSD');
    expect(parsed.tokenAmount).toBe(terms.bchTokenAmount);
    expect(parsed.refundHeight).toBe(terms.bchRefundHeight);
    expect(parsed.maxFee).toBe(Number(terms.bchMaxFee));
    // In reverse swaps, recipient is solver and refund is user
    expect(parsed.recipientLockingBytecodeHex).toBe(
      terms.solverBchLockingBytecode.toLowerCase(),
    );
    expect(parsed.refundLockingBytecodeHex).toBe(
      terms.userBchLockingBytecode.toLowerCase(),
    );
  });

  it('parses unpushed raw payload bytes as well as full locking bytecode', () => {
    const payload = encodeTermsPayload({
      tag: sampleTag,
      token: 'PUSD',
      tokenAmount: 10_000n,
      refundHeight: 850_000,
      maxFee: 1500,
      recipientLockingBytecode: p2pkhRecipient,
      refundLockingBytecode: p2pkhRefund,
    });

    const parsed = parseTermsOutput(payload);
    expect(parsed.version).toBe(1);
    expect(parsed.token).toBe('PUSD');
    expect(parsed.tokenAmount).toBe(10_000n);
  });

  it('rebuildCovenantFromTerms derives exactly the same address as the real swap covenant', () => {
    const hashLock = sha256.hash(hexToBin('deadbeef'.repeat(8)));
    const tokenCategoryHex =
      'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';
    const terms: OrderTerms = {
      version: 1,
      direction: 'BCH_TO_EVM',
      bchToken: 'PUSD',
      bchTokenCategory: `0x${tokenCategoryHex}`,
      bchTokenAmount: 50_000n,
      bchRefundHeight: 876_543,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-terms-002',
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.0',
            source: 'test',
            asOf: 1794764140,
          },
        ],
        spreadBps: 40,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
      userBchLockingBytecode: `0x${binToHex(p2pkhRefund)}`,
      solverBchLockingBytecode: `0x${binToHex(p2pkhRecipient)}`,
      hashLock: `0x${binToHex(hashLock)}`,
      evmAmount: 50_000_000n,
      evmChainId: 8453,
      evmHtlc: `0x${'11'.repeat(20)}`,
      evmToken: `0x${'22'.repeat(20)}`,
      userEvmAddress: `0x${'33'.repeat(20)}`,
      solverEvmAddress: `0x${'44'.repeat(20)}`,
      evmDeadline: 1794900000,
      quoteExpiry: 1794850000,
    };

    // Standard covenant derivation used by swap
    const realParams = encodeHtlcParameters(terms);
    const realAddresses = deriveHtlcAddresses(realParams, 'chipnet');

    // Encode terms output, parse it, and rebuild covenant
    const lockingBytecode = encodeTermsOutput({
      params: terms,
      tag: sampleTag,
    });
    const parsed = parseTermsOutput(lockingBytecode);
    const rebuilt = rebuildCovenantFromTerms(parsed, terms.hashLock, {
      network: 'chipnet',
    });

    expect(rebuilt.p2sh32Address).toBe(realAddresses.p2sh32Address);
    expect(rebuilt.tokenAddress).toBe(realAddresses.tokenAddress);
    expect(binToHex(rebuilt.lockingBytecode)).toBe(
      binToHex(realAddresses.lockingBytecode),
    );
    expect(binToHex(rebuilt.redeemScript)).toBe(
      binToHex(realAddresses.redeemScript),
    );
  });

  describe('boundary and error handling', () => {
    it('throws RangeError if payload exceeds 220-byte limit', () => {
      // 30 fixed + 1 + 25 + 1 + 170 = 227 bytes > 220
      const largeBytecode = new Uint8Array(170).fill(0x55);
      expect(() =>
        encodeTermsOutput({
          token: 'PUSD',
          tokenAmount: 100n,
          refundHeight: 800_000,
          maxFee: 1000,
          recipientLockingBytecode: p2pkhRecipient,
          refundLockingBytecode: largeBytecode,
        }),
      ).toThrow(RangeError);
    });

    it('rejects payload exceeding 220 bytes during parse', () => {
      const oversized = new Uint8Array(221).fill(0x00);
      oversized.set(TERMS_OUTPUT_MAGIC, 0);
      oversized[4] = 0x01;
      expect(() => parseTermsOutput(oversized)).toThrow(RangeError);
    });

    it('rejects wrong magic bytes', () => {
      const payload = encodeTermsPayload({
        token: 'PUSD',
        tokenAmount: 100n,
        refundHeight: 800_000,
        maxFee: 1000,
        recipientLockingBytecode: p2pkhRecipient,
        refundLockingBytecode: p2pkhRefund,
      });
      payload[0] = 0x58; // 'X' instead of 'F'
      expect(() => parseTermsOutput(payload)).toThrow(/Invalid magic bytes/);
    });

    it('rejects wrong version', () => {
      const payload = encodeTermsPayload({
        token: 'PUSD',
        tokenAmount: 100n,
        refundHeight: 800_000,
        maxFee: 1000,
        recipientLockingBytecode: p2pkhRecipient,
        refundLockingBytecode: p2pkhRefund,
      });
      payload[4] = 0x02; // version 2
      expect(() => parseTermsOutput(payload)).toThrow(
        /Unsupported terms output version/,
      );
    });

    it('rejects truncated data (shorter than minimum header)', () => {
      const truncated = new Uint8Array(20).fill(0x00);
      truncated.set(TERMS_OUTPUT_MAGIC, 0);
      truncated[4] = 0x01;
      expect(() => parseTermsOutput(truncated)).toThrow(/truncated/i);
    });

    it('rejects truncated recipient locking bytecode', () => {
      const payload = encodeTermsPayload({
        token: 'PUSD',
        tokenAmount: 100n,
        refundHeight: 800_000,
        maxFee: 1000,
        recipientLockingBytecode: p2pkhRecipient,
        refundLockingBytecode: p2pkhRefund,
      });
      // Truncate recipient bytes
      const chopped = payload.slice(0, 35);
      expect(() => parseTermsOutput(chopped)).toThrow(/truncated/i);
    });

    it('rejects truncated refund locking bytecode', () => {
      const payload = encodeTermsPayload({
        token: 'PUSD',
        tokenAmount: 100n,
        refundHeight: 800_000,
        maxFee: 1000,
        recipientLockingBytecode: p2pkhRecipient,
        refundLockingBytecode: p2pkhRefund,
      });
      // Cut off last 5 bytes of refund bytecode
      const chopped = payload.slice(0, payload.length - 5);
      expect(() => parseTermsOutput(chopped)).toThrow(/truncated/i);
    });

    it('rejects unexpected trailing bytes', () => {
      const payload = encodeTermsPayload({
        token: 'PUSD',
        tokenAmount: 100n,
        refundHeight: 800_000,
        maxFee: 1000,
        recipientLockingBytecode: p2pkhRecipient,
        refundLockingBytecode: p2pkhRefund,
      });
      const padded = new Uint8Array(payload.length + 4);
      padded.set(payload, 0);
      padded.set([1, 2, 3, 4], payload.length);
      expect(() => parseTermsOutput(padded)).toThrow(
        /Unexpected trailing bytes/,
      );
    });

    it('rejects invalid tag length', () => {
      expect(() =>
        encodeTermsOutput({
          tag: '0x1234', // Only 2 bytes instead of 8
          token: 'PUSD',
          tokenAmount: 100n,
          refundHeight: 800_000,
          maxFee: 1000,
          recipientLockingBytecode: p2pkhRecipient,
          refundLockingBytecode: p2pkhRefund,
        }),
      ).toThrow(RangeError);
    });

    it('rebuildCovenantFromTerms rejects invalid hashLock length', () => {
      const payload = encodeTermsPayload({
        token: 'PUSD',
        tokenAmount: 100n,
        refundHeight: 800_000,
        maxFee: 1000,
        recipientLockingBytecode: p2pkhRecipient,
        refundLockingBytecode: p2pkhRefund,
      });
      const parsed = parseTermsOutput(payload);
      expect(() => rebuildCovenantFromTerms(parsed, '0xdeadbeef')).toThrow(
        RangeError,
      );
    });
  });
});
