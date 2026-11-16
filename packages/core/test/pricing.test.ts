import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_HOLD_FEE_BPS_PER_DAY,
  MAX_SEND_LINK_WINDOW_SECONDS,
  checkLimits,
  convertCeil,
  convertFloor,
  effectiveSendLinkSpreadBps,
  effectiveSpreadBps,
  holdFeeBps,
  pegGuard,
  quoteExactIn,
  quoteExactOut,
  type PricingPolicy,
} from '../src/index.js';

describe('pricing and decimal conversion', () => {
  const policy: PricingPolicy = {
    spreadBps: 50, // 0.50%
    fixedFeeUsdMicros: 100_000n, // $0.10
  };

  it('converts 6 <-> 2 and 18 <-> 2 with floor rounding', () => {
    expect(convertFloor(1_999_999n, 6, 2)).toBe(199n);
    expect(convertCeil(1_990_001n, 6, 2)).toBe(200n);
    expect(convertFloor(1_999_999_999_999_999_999n, 18, 2)).toBe(199n);
    expect(convertFloor(199n, 2, 18)).toBe(1_990_000_000_000_000_000n);
  });

  it('quotes exact-in and exact-out accurately', () => {
    // 100.000000 USDC -> 100 * 0.995 - 0.10 = 99.40 PUSD (9940 base units)
    expect(quoteExactIn(100_000_000n, 6, 2, policy)).toBe(9940n);
    // 100 * 10^18 -> 9940 base units
    expect(quoteExactIn(100_000_000_000_000_000_000n, 18, 2, policy)).toBe(
      9940n,
    );
    expect(quoteExactIn(50_000n, 6, 2, policy)).toBe(0n);

    const neededIn = quoteExactOut(9940n, 6, 2, policy);
    expect(quoteExactIn(neededIn, 6, 2, policy)).toBeGreaterThanOrEqual(9940n);
    expect(quoteExactOut(0n, 6, 2, policy)).toBe(0n);
  });

  it('property: floor rounding never creates value across 6<->2 and 18<->2', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000_000_000_000_000n }),
        fc.constantFrom([6, 2], [2, 6], [18, 2], [2, 18]),
        (amountIn, [fromDec, toDec]) => {
          const outZeroFee = quoteExactIn(amountIn, fromDec!, toDec!, {
            spreadBps: 0,
            fixedFeeUsdMicros: 0n,
          });
          // Converting back cannot exceed input
          const roundTrip = convertFloor(outZeroFee, toDec!, fromDec!);
          expect(roundTrip).toBeLessThanOrEqual(amountIn);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('property: quoteExactOut is the minimal input covering amountOut across 6<->2 and 18<->2', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100_000_000n }),
        fc.constantFrom([6, 2], [2, 6], [18, 2], [2, 18]),
        fc.integer({ min: 0, max: 500 }),
        fc.bigInt({ min: 0n, max: 500_000n }),
        (amountOut, [fromDec, toDec], spreadBps, fixedFeeUsdMicros) => {
          const p = { spreadBps, fixedFeeUsdMicros };
          const requiredIn = quoteExactOut(amountOut, fromDec!, toDec!, p);
          expect(
            quoteExactIn(requiredIn, fromDec!, toDec!, p),
          ).toBeGreaterThanOrEqual(amountOut);
          if (requiredIn > 0n) {
            expect(
              quoteExactIn(requiredIn - 1n, fromDec!, toDec!, p),
            ).toBeLessThan(amountOut);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('validates limits, pegGuard, and effectiveSpreadBps', () => {
    const limits = { minUsdMicros: 1_000_000n, maxUsdMicros: 250_000_000n };
    expect(checkLimits(1_000_000n, 6, limits)).toBe(true);
    expect(checkLimits(999_999n, 6, limits)).toBe(false);
    expect(checkLimits(250_000_000_000_000_000_000n, 18, limits)).toBe(true);

    expect(pegGuard([], 10_000n)).toBe(false);
    expect(pegGuard([1_000_000n, 1_005_000n], 10_000n)).toBe(true);
    expect(pegGuard([992_000n, 1_005_000n], 10_000n)).toBe(false); // inter-source > 0.01
    expect(pegGuard([1_020_000n], 10_000n)).toBe(false);

    expect(effectiveSpreadBps(50, 20, 'EVM_TO_BCH', 30)).toBe(70);
    expect(effectiveSpreadBps(50, 20, 'BCH_TO_EVM', 30)).toBe(30);

    expect(() => convertFloor(-1n, 6, 2)).toThrow(RangeError);
    expect(() => convertFloor(1n, -1, 2)).toThrow(RangeError);
    expect(() =>
      quoteExactIn(100n, 6, 2, { spreadBps: 10_000, fixedFeeUsdMicros: 0n }),
    ).toThrow(RangeError);
    expect(() =>
      checkLimits(100n, 6, { minUsdMicros: 10n, maxUsdMicros: 5n }),
    ).toThrow(RangeError);
    expect(() => pegGuard([1_000_000n], -1n)).toThrow(RangeError);
    expect(() => effectiveSpreadBps(50, 10, 'EVM_TO_BCH', -1)).toThrow(
      RangeError,
    );
  });
});

describe('send-link hold fee pricing', () => {
  it('computes holdFeeBps = HOLD_FEE_BPS_PER_DAY * days for 24h, 3d, 7d', () => {
    expect(DEFAULT_HOLD_FEE_BPS_PER_DAY).toBe(10);
    expect(holdFeeBps(0)).toBe(0);
    expect(holdFeeBps(86_400)).toBe(10);
    expect(holdFeeBps(3 * 86_400)).toBe(30);
    expect(holdFeeBps(MAX_SEND_LINK_WINDOW_SECONDS)).toBe(70);
    expect(holdFeeBps(86_401)).toBe(20); // partial day rounds up
    expect(effectiveSendLinkSpreadBps(30, 3 * 86_400)).toBe(60);
  });

  it('rejects negative, oversized, or invalid hold fee inputs', () => {
    expect(() => holdFeeBps(-1)).toThrow(RangeError);
    expect(() => holdFeeBps(MAX_SEND_LINK_WINDOW_SECONDS + 1)).toThrow(
      RangeError,
    );
    expect(() => holdFeeBps(86_400, -1)).toThrow(RangeError);
    expect(() => effectiveSendLinkSpreadBps(10_000, 86_400)).toThrow(
      RangeError,
    );
  });
});

import {
  quoteInForExactOut,
  quoteOut,
  verifyPricing,
  type OrderTerms,
  type PricingEvidence,
} from '../src/index.js';

describe('PricingEvidence quoteOut, quoteInForExactOut, and verifyPricing', () => {
  const evidence: PricingEvidence = {
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
    fixedFeeBase: 20n, // 0.20 PUSD
    rounding: 'floor',
  };

  it('computes quoteOut and exact-output inverse across 6, 2, and 18 decimals', () => {
    // 100.000000 USDC -> floor(100 * 0.996 * 100) - 20 = 9960 - 20 = 9940 (99.40 PUSD)
    expect(quoteOut(100_000_000n, 6, 2, evidence)).toBe(9940n);
    // 100 * 10^18 -> 9940
    expect(quoteOut(100_000_000_000_000_000_000n, 18, 2, evidence)).toBe(9940n);
    // Exact inverse covers desired output
    const needed = quoteInForExactOut(9940n, 6, 2, evidence);
    expect(quoteOut(needed, 6, 2, evidence)).toBeGreaterThanOrEqual(9940n);
    expect(quoteOut(needed - 1n, 6, 2, evidence)).toBeLessThan(9940n);
    expect(quoteInForExactOut(0n, 6, 2, evidence)).toBe(0n);
  });

  it('property: quoteInForExactOut is minimal payer input covering amountOut across 6/2/18', () => {
    const decimals = fc.constantFrom(2, 6, 18);
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        decimals,
        decimals,
        fc.integer({ min: 0, max: 5000 }),
        fc.bigInt({ min: 0n, max: 500n }),
        (amountOut, fromDec, toDec, spreadBps, fixedFeeBase) => {
          const ev: PricingEvidence = {
            ...evidence,
            spreadBps,
            fixedFeeBase,
          };
          const reqIn = quoteInForExactOut(amountOut, fromDec, toDec, ev);
          expect(quoteOut(reqIn, fromDec, toDec, ev)).toBeGreaterThanOrEqual(
            amountOut,
          );
          if (reqIn > 0n) {
            expect(quoteOut(reqIn - 1n, fromDec, toDec, ev)).toBeLessThan(
              amountOut,
            );
          }
        },
      ),
    );
  });

  it('verifyPricing returns ok within tolerance and warn when PUSD diverges or evidence is missing', () => {
    const baseTerms: OrderTerms = {
      version: 1,
      direction: 'EVM_TO_BCH',
      bchToken: 'PUSD',
      bchTokenCategory: `0x${'ec'.repeat(32)}`,
      bchTokenAmount: 9940n,
      evmAmount: 100_000_000n,
      evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      evmChainId: 8453,
      evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
      userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
      userBchLockingBytecode: `0x76a914${'11'.repeat(20)}88ac`,
      solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
      solverBchLockingBytecode: `0x76a914${'22'.repeat(20)}88ac`,
      hashLock: `0x${'33'.repeat(32)}`,
      evmDeadline: 1794850000,
      bchRefundHeight: 974380,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-verify-001',
      quoteExpiry: 1794764200,
      pricing: evidence,
    };

    const okRes = verifyPricing(baseTerms, '1.000', '0.005');
    expect(okRes.status).toBe('ok');
    expect(okRes.difference).toBe('0.002');

    const warnRes = verifyPricing(baseTerms, '1.010', '0.005');
    expect(warnRes.status).toBe('warn');
    expect(warnRes.difference).toBe('0.012');

    const missingRes = verifyPricing(
      { ...baseTerms, pricing: undefined },
      '1.000',
      '0.005',
    );
    expect(missingRes.status).toBe('warn');
    expect(missingRes.difference).toBeNull();
  });
});
