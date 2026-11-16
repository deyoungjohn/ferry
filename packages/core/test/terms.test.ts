import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex, hexToBytes } from 'viem';
import {
  OrderTermsSchema,
  PricingEvidenceSchema,
  canonicalCBOR,
  orderId,
  parseOrderTerms,
  signOrderId,
  unixTimestampSeconds,
  verifyOrderSignature,
  type OrderTerms,
} from '../src/index.js';
import { CROSS_CHECK_VECTORS } from '../src/vectors.js';

const BASE_TERMS: OrderTerms = {
  version: 1,
  direction: 'EVM_TO_BCH',
  bchToken: 'PUSD',
  bchTokenCategory:
    '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
  bchTokenAmount: 10000n,
  evmAmount: 100500000n,
  evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  evmChainId: 8453,
  evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
  userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
  userBchLockingBytecode:
    '0x76a914111111111111111111111111111111111111111188ac',
  solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
  solverBchLockingBytecode:
    '0x76a914222222222222222222222222222222222222222288ac',
  hashLock:
    '0x72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
  evmDeadline: 1794850000,
  bchRefundHeight: 974380,
  bchCarrySats: 3000n,
  bchMaxFee: 1500n,
  quoteId: 'q-golden-001',
  quoteExpiry: 1794764200,
  pricing: {
    refs: [
      {
        asset: 'PUSD',
        usdPrice: '0.998',
        source: 'cauldron',
        asOf: 1794764140,
      },
      {
        asset: 'USDC',
        usdPrice: '1.000',
        source: 'chainlink:base:usdc-usd',
        asOf: 1794764140,
      },
    ],
    spreadBps: 40,
    fixedFeeBase: 50n,
    rounding: 'floor',
  },
};

describe('unixTimestampSeconds', () => {
  it('accepts valid unix second timestamps', () => {
    expect(unixTimestampSeconds.parse(1794764200)).toBe(1794764200);
    expect(unixTimestampSeconds.parse(1)).toBe(1);
    expect(unixTimestampSeconds.parse(99_999_999_999)).toBe(99_999_999_999);
  });

  it('rejects 0, negative, float, and millisecond timestamps (>= 1e11)', () => {
    expect(() => unixTimestampSeconds.parse(0)).toThrow();
    expect(() => unixTimestampSeconds.parse(-1)).toThrow();
    expect(() => unixTimestampSeconds.parse(1.5)).toThrow();
    expect(() => unixTimestampSeconds.parse(100_000_000_000)).toThrow();
    expect(() => unixTimestampSeconds.parse(1794764200000)).toThrow();
  });
});

describe('OrderTerms and canonicalCBOR', () => {
  it('parses valid OrderTerms and normalizes EVM addresses to lowercase', () => {
    const parsed = parseOrderTerms(BASE_TERMS);
    expect(parsed.evmToken).toBe(BASE_TERMS.evmToken.toLowerCase());
    expect(parsed.evmHtlc).toBe(BASE_TERMS.evmHtlc.toLowerCase());
    expect(parsed.userEvmAddress).toBe(BASE_TERMS.userEvmAddress.toLowerCase());
    expect(parsed.solverEvmAddress).toBe(
      BASE_TERMS.solverEvmAddress.toLowerCase(),
    );
  });

  it('rejects unknown extra fields (strict schema)', () => {
    expect(() =>
      OrderTermsSchema.parse({ ...BASE_TERMS, extraField: 'nope' }),
    ).toThrow();
  });

  it('rejects bchMaxFee > bchCarrySats', () => {
    expect(() =>
      parseOrderTerms({ ...BASE_TERMS, bchMaxFee: 3001n }),
    ).toThrow();
  });

  it('rejects millisecond deadlines', () => {
    expect(() =>
      parseOrderTerms({ ...BASE_TERMS, evmDeadline: 1794850000000 }),
    ).toThrow();
    expect(() =>
      parseOrderTerms({ ...BASE_TERMS, quoteExpiry: 100_000_000_000 }),
    ).toThrow();
  });

  it('produces identical canonicalCBOR and orderId regardless of key insertion order', () => {
    const reversedEntries = Object.entries(BASE_TERMS).reverse();
    const reordered = Object.fromEntries(reversedEntries);
    const cborA = canonicalCBOR(BASE_TERMS);
    const cborB = canonicalCBOR(reordered);
    expect(bytesToHex(cborA)).toBe(bytesToHex(cborB));
    expect(orderId(BASE_TERMS)).toBe(orderId(reordered));
  });

  it('encodes byte fields as CBOR byte strings and matches golden orderId', () => {
    const cbor = canonicalCBOR(BASE_TERMS);
    const hex = bytesToHex(cbor);
    // hashLock is 32 bytes -> CBOR major type 2 (0x58 0x20) + 32 bytes
    const hashBytesHex = BASE_TERMS.hashLock.slice(2);
    expect(hex).toContain(`5820${hashBytesHex}`);
    // Golden orderId for BASE_TERMS (with PricingEvidence)
    expect(orderId(BASE_TERMS)).toBe(
      '0x232563e8cf27ec40c60f3b1586f86240bc803b7157edd18e990e44c44d6312d4',
    );
  });

  it('supports 18-decimal evmAmount (> 2^64) via tag-2 bignum', () => {
    const bnbTerms: OrderTerms = {
      ...BASE_TERMS,
      evmChainId: 56,
      evmAmount: 100_000_000_000_000_000_000n, // 100 * 10^18
    };
    const cbor = canonicalCBOR(bnbTerms);
    expect(cbor.length).toBeGreaterThan(0);
    expect(orderId(bnbTerms)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('order signing and verification', () => {
  it('signs raw orderId bytes with EIP-191 and verifies against solver address', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const id = orderId(BASE_TERMS);
    const sig = await signOrderId(id, account);
    expect(await verifyOrderSignature(id, sig, account.address)).toBe(true);

    // Wrong address fails
    expect(await verifyOrderSignature(id, sig, BASE_TERMS.userEvmAddress)).toBe(
      false,
    );

    // Signing UTF-8 text instead of raw bytes fails verification
    const textSig = await account.signMessage({ message: id });
    expect(await verifyOrderSignature(id, textSig, account.address)).toBe(
      false,
    );

    // Malformed address or signature returns false
    expect(await verifyOrderSignature(id, sig, 'not-an-address')).toBe(false);
    expect(await verifyOrderSignature(id, '0x1234', account.address)).toBe(
      false,
    );
    expect(hexToBytes(id).length).toBe(32);
  });

  it('validates PricingEvidenceSchema and includes pricing in canonicalCBOR and orderId', () => {
    expect(() =>
      PricingEvidenceSchema.parse({
        ...BASE_TERMS.pricing,
        refs: [
          {
            asset: 'PUSD',
            usdPrice: 'not-a-decimal',
            source: 'cauldron',
            asOf: 1794764140,
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      PricingEvidenceSchema.parse({
        ...BASE_TERMS.pricing,
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.00',
            source: 'cauldron',
            asOf: 1794764140000, // ms rejected
          },
        ],
      }),
    ).toThrow();

    const altered = {
      ...BASE_TERMS,
      pricing: {
        ...BASE_TERMS.pricing!,
        spreadBps: 45,
      },
    };
    expect(orderId(altered)).not.toBe(orderId(BASE_TERMS));
    expect(orderId(BASE_TERMS)).toBe(
      CROSS_CHECK_VECTORS.goldenOrder.expectedOrderId,
    );
  });
});
