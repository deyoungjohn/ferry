import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  checkLimits,
  convertCeil,
  convertFloor,
  effectiveSpreadBps,
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
