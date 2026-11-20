import { describe, expect, it } from 'vitest';
import * as libauth from '@bitauth/libauth';
import { compileCashAssemblyString, parseTemplate } from '@xo-cash/utils';
import {
  ferryHtlcTemplate,
  getParsedFerryHtlcTemplate,
  serializeFerryHtlcTemplate,
} from '../xo/index.js';
import {
  artifact,
  displayHexToInternalHex,
  encodeHtlcParameters,
  getHtlcContract,
} from '../src/index.js';

describe('XO Template: ferry-htlc (BCH-E-01)', () => {
  it('parses and serializes cleanly with serializeTemplate', () => {
    const parsed = getParsedFerryHtlcTemplate();
    expect(parsed.name).toBe('Ferry HTLC');
    expect(parsed.actions.lock).toBeDefined();
    expect(parsed.actions.claim).toBeDefined();
    expect(parsed.actions.refund).toBeDefined();
    expect(parsed.actions.release).toBeDefined();

    const serialized = serializeFerryHtlcTemplate();
    expect(typeof serialized).toBe('string');
    const reparsed = parseTemplate(serialized);
    expect(reparsed.name).toBe('Ferry HTLC');
  });

  it('BCH-E-01: XO locking bytecode is byte-identical to CashScript artifact locking bytecode', () => {
    const secret = new Uint8Array(32).fill(0x01);
    const hashLock = libauth.sha256.hash(secret);
    const recipientBytecode = new Uint8Array([
      0x76,
      0xa9,
      0x14,
      ...new Uint8Array(20).fill(0x11),
      0x88,
      0xac,
    ]);
    const refundBytecode = new Uint8Array([
      0x76,
      0xa9,
      0x14,
      ...new Uint8Array(20).fill(0x22),
      0x88,
      0xac,
    ]);
    const displayCatHex =
      'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';
    const internalCatHex = displayHexToInternalHex(displayCatHex);

    const params = encodeHtlcParameters({
      hashLock,
      recipientLockingBytecode: recipientBytecode,
      refundLockingBytecode: refundBytecode,
      tokenCategory: displayCatHex,
      tokenAmount: 1000n,
      refundHeight: 500_000,
      maxFee: 1500n,
    });

    const cashScriptContract = getHtlcContract(params);
    const cashScriptRedeemHex = cashScriptContract.bytecode;

    const fixedBytecode = artifact.bytecode
      .replace('20 OP_NUMEQUALVERIFY', '<32> OP_NUMEQUALVERIFY')
      .replace('76a914', '<0x76a914>')
      .replace('88ac', '<0x88ac>');
    const xoScript =
      `<1500> <500000> <1000> <0x${internalCatHex}> <0x${libauth.binToHex(refundBytecode)}> <0x${libauth.binToHex(recipientBytecode)}> <0x${libauth.binToHex(hashLock)}> ` +
      fixedBytecode;

    const xoRedeemHex = compileCashAssemblyString({
      cashAssemblyText: xoScript,
      variables: {},
      evaluationDecodeMode: 'hex',
    });

    expect(xoRedeemHex).toBe(cashScriptRedeemHex);

    const xoRedeemBytes = libauth.hexToBin(xoRedeemHex);
    const xoHash256 = libauth.sha256.hash(libauth.sha256.hash(xoRedeemBytes));
    const xoLockingHex = libauth.binToHex(
      new Uint8Array([0xaa, 0x20, ...xoHash256, 0x87]),
    );
    expect(xoLockingHex).toBe(cashScriptContract.lockingBytecode);

    // Also verify the template's own htlcLockingBytecode script matches
    const tplRedeemHex = compileCashAssemblyString({
      cashAssemblyText: 'htlcLockingBytecode',
      templateScripts: ferryHtlcTemplate.scripts,
      variables: {
        hashLock,
        recipientLockingBytecode: recipientBytecode,
        refundLockingBytecode: refundBytecode,
        tokenCategory: libauth.hexToBin(internalCatHex),
        tokenAmount: 1000,
        refundHeight: 500000,
        maxFee: 1500,
      },
      evaluationDecodeMode: 'hex',
    });
    expect(tplRedeemHex).toBe(cashScriptRedeemHex);
  });

  it('produces byte-identical locking bytecode and valid XO invitation for forward and reverse OrderTerms', async () => {
    const { buildXoLockInvitation, deriveXoHtlcLockingBytecode } =
      await import('../xo/index.js');
    const { deriveHtlcAddresses } = await import('../src/index.js');

    const baseTerms = {
      version: 1 as const,
      bchToken: 'PUSD' as const,
      bchTokenCategory:
        '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac' as const,
      bchTokenAmount: 1000n,
      evmAmount: 10_050_000n,
      evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
      evmChainId: 8453,
      evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641' as const,
      userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd' as const,
      userBchLockingBytecode: `0x76a914${'11'.repeat(20)}88ac` as const,
      solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70' as const,
      solverBchLockingBytecode: `0x76a914${'22'.repeat(20)}88ac` as const,
      hashLock: `0x${'33'.repeat(32)}` as const,
      evmDeadline: 1794850000,
      bchRefundHeight: 500_000,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-xo-001',
      quoteExpiry: 1794764200,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.000',
            source: 'cauldron',
            asOf: 1794763900,
          },
        ],
        spreadBps: 50,
        fixedFeeBase: 0n,
        rounding: 'floor' as const,
      },
    };

    for (const direction of ['EVM_TO_BCH', 'BCH_TO_EVM'] as const) {
      const terms = { ...baseTerms, direction };
      const params = encodeHtlcParameters(terms);
      const csAddrs = deriveHtlcAddresses(params, 'chipnet');
      const xoLockingHex = deriveXoHtlcLockingBytecode(params);
      expect(xoLockingHex).toBe(libauth.binToHex(csAddrs.lockingBytecode));

      const invitation = buildXoLockInvitation(params, 'chipnet');
      expect(invitation.action).toBe('lock');
      expect(invitation.lockAddress).toBe(csAddrs.p2sh32Address);
      expect(invitation.tokenAddress).toBe(csAddrs.tokenAddress);
      expect(invitation.lockingBytecode).toBe(xoLockingHex);
      expect(invitation.template.name).toBe('Ferry HTLC');
    }
  });
});
