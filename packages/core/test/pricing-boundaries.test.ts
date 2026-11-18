import { describe, expect, it } from 'vitest';
import {
  checkLimits,
  convertCeil,
  convertFloor,
  effectiveSendLinkSpreadBps,
  effectiveSpreadBps,
  holdFeeBps,
  pegGuard,
  quoteExactIn,
  quoteExactOut,
  quoteInForExactOut,
  quoteOut,
  verifyPricing,
  type OrderTerms,
  type PricingEvidence,
} from '../src/index.js';

const policy = { spreadBps: 40, fixedFeeUsdMicros: 200_000n };

describe('decimals, amounts and spread validation', () => {
  it('accepts decimals 0 and 36, rejects -1, 37 and fractions, with a named message', () => {
    expect(convertFloor(5n, 0, 0)).toBe(5n);
    expect(convertFloor(1n, 36, 36)).toBe(1n);
    for (const bad of [-1, 37, 1.5, Number.NaN]) {
      expect(() => convertFloor(1n, bad, 6)).toThrow(
        'Decimals must be an integer from 0 to 36',
      );
      expect(() => convertCeil(1n, 6, bad)).toThrow(RangeError);
    }
  });

  it('rejects negative amounts with a named message and accepts zero', () => {
    expect(() => convertFloor(-1n, 6, 6)).toThrow('Negative amount');
    expect(convertFloor(0n, 6, 6)).toBe(0n);
    expect(() => quoteExactIn(-1n, 6, 6, policy)).toThrow('Negative amount');
    expect(() => quoteExactOut(-1n, 6, 6, policy)).toThrow('Negative amount');
    expect(() =>
      quoteExactIn(1n, 6, 6, { ...policy, fixedFeeUsdMicros: -1n }),
    ).toThrow('Negative amount');
  });

  it('accepts spread 0 and 9999, rejects -1, 10000 and fractions', () => {
    expect(() =>
      quoteExactIn(1n, 6, 6, { ...policy, spreadBps: 0 }),
    ).not.toThrow();
    expect(() =>
      quoteExactIn(1n, 6, 6, { ...policy, spreadBps: 9999 }),
    ).not.toThrow();
    for (const bad of [-1, 10_000, 0.5, Number.NaN]) {
      expect(() =>
        quoteExactIn(1n, 6, 6, { ...policy, spreadBps: bad }),
      ).toThrow('Invalid spreadBps');
    }
  });

  it('converts with floor and ceil rounding', () => {
    expect(convertFloor(1999n, 6, 2)).toBe(0n);
    expect(convertCeil(1n, 6, 2)).toBe(1n);
    expect(convertCeil(10_000n, 6, 2)).toBe(1n);
    expect(convertCeil(10_001n, 6, 2)).toBe(2n);
  });
});

describe('exact-in and exact-out quotes', () => {
  it('quotes zero when the fee consumes the input and one unit above it', () => {
    // 0.20 USD fee at 6 decimals = 200000 units; spread 0 for clarity.
    const flat = { spreadBps: 0, fixedFeeUsdMicros: 200_000n };
    expect(quoteExactIn(200_000n, 6, 6, flat)).toBe(0n);
    expect(quoteExactIn(200_001n, 6, 6, flat)).toBe(1n);
    expect(quoteExactIn(0n, 6, 6, flat)).toBe(0n);
  });

  it('matches known values and round-trips (payer covers the output)', () => {
    expect(quoteExactIn(100_000_000n, 6, 2, policy)).toBe(9_940n);
    for (const out of [1n, 2n, 99n, 9_940n]) {
      const input = quoteExactOut(out, 6, 2, policy);
      expect(quoteExactIn(input, 6, 2, policy)).toBeGreaterThanOrEqual(out);
      expect(quoteExactIn(input - 1n, 6, 2, policy)).toBeLessThan(out);
    }
    expect(quoteExactOut(0n, 6, 2, policy)).toBe(0n);
  });
});

describe('limits', () => {
  const limits = { minUsdMicros: 1_000_000n, maxUsdMicros: 5_000_000n };
  it('includes both bounds and excludes one unit outside', () => {
    expect(checkLimits(1_000_000n, 6, limits)).toBe(true);
    expect(checkLimits(999_999n, 6, limits)).toBe(false);
    expect(checkLimits(5_000_000n, 6, limits)).toBe(true);
    expect(checkLimits(5_000_001n, 6, limits)).toBe(false);
  });
  it('allows min equal to max, rejects min above max and negative bounds', () => {
    const same = { minUsdMicros: 7n, maxUsdMicros: 7n };
    expect(checkLimits(7n, 6, same)).toBe(true);
    expect(() =>
      checkLimits(1n, 6, { minUsdMicros: 8n, maxUsdMicros: 7n }),
    ).toThrow('Invalid limits');
    expect(() =>
      checkLimits(1n, 6, { minUsdMicros: -1n, maxUsdMicros: 7n }),
    ).toThrow('Negative amount');
    expect(() =>
      checkLimits(1n, 6, { minUsdMicros: 0n, maxUsdMicros: -1n }),
    ).toThrow('Negative amount');
    expect(() => checkLimits(-1n, 6, limits)).toThrow('Negative amount');
  });
});

describe('peg guard', () => {
  const tol = 5_000n;
  it('accepts prices exactly on the tolerance edge and rejects one micro beyond', () => {
    expect(pegGuard([1_000_000n], tol)).toBe(true);
    expect(pegGuard([995_000n], tol)).toBe(true);
    expect(pegGuard([994_999n], tol)).toBe(false);
    expect(pegGuard([1_005_000n], tol)).toBe(true);
    expect(pegGuard([1_005_001n], tol)).toBe(false);
  });
  it('rejects zero or negative prices even when tolerance spans the peg', () => {
    expect(pegGuard([0n], 1_000_000n)).toBe(false);
    expect(pegGuard([-1n], 1_000_000n)).toBe(false);
    expect(pegGuard([1n], 1_000_000n)).toBe(true);
  });
  it('limits the spread between sources to the tolerance, in either order', () => {
    expect(pegGuard([995_000n, 1_000_000n], tol)).toBe(true);
    expect(pegGuard([1_000_000n, 995_000n], tol)).toBe(true);
    expect(pegGuard([995_000n, 1_005_000n], tol)).toBe(false);
    expect(pegGuard([1_005_000n, 995_000n], tol)).toBe(false);
    expect(pegGuard([1_002_000n, 998_000n, 1_001_000n], 4_000n)).toBe(true);
    expect(pegGuard([1_002_000n, 998_000n, 1_001_000n], 3_999n)).toBe(false);
  });
  it('fails closed on an empty list and validates tolerance bounds', () => {
    expect(pegGuard([], tol)).toBe(false);
    expect(() => pegGuard([1_000_000n], -1n)).toThrow('Invalid tolerance');
    expect(() => pegGuard([1_000_000n], 1_000_001n)).toThrow(
      'Invalid tolerance',
    );
    expect(pegGuard([1_000_000n], 0n)).toBe(true);
    expect(pegGuard([1_000_000n], 1_000_000n)).toBe(true);
  });
});

describe('inventory skew and hold fee', () => {
  it('applies the skew by direction, clamped to the cap, floor 0 and ceiling 9999', () => {
    expect(effectiveSpreadBps(40, 10, 'EVM_TO_BCH', 25)).toBe(50);
    expect(effectiveSpreadBps(40, 10, 'BCH_TO_EVM', 25)).toBe(30);
    expect(effectiveSpreadBps(40, 100, 'EVM_TO_BCH', 25)).toBe(65);
    expect(effectiveSpreadBps(40, -100, 'EVM_TO_BCH', 25)).toBe(15);
    expect(effectiveSpreadBps(40, 25, 'EVM_TO_BCH', 25)).toBe(65);
    expect(effectiveSpreadBps(10, -100, 'EVM_TO_BCH', 50)).toBe(0);
    expect(effectiveSpreadBps(9990, 100, 'EVM_TO_BCH', 50)).toBe(9999);
    expect(effectiveSpreadBps(40, 0, 'EVM_TO_BCH', 0)).toBe(40);
  });
  it('rejects fractional or negative skew inputs', () => {
    expect(() => effectiveSpreadBps(40, 1.5, 'EVM_TO_BCH', 25)).toThrow(
      'Invalid inventory skew',
    );
    expect(() => effectiveSpreadBps(40, 1, 'EVM_TO_BCH', 2.5)).toThrow(
      'Invalid inventory skew',
    );
    expect(() => effectiveSpreadBps(40, 1, 'EVM_TO_BCH', -1)).toThrow(
      'Invalid inventory skew',
    );
  });

  it('charges whole days rounded up, zero for no window, and validates', () => {
    expect(holdFeeBps(0)).toBe(0);
    expect(holdFeeBps(1)).toBe(10);
    expect(holdFeeBps(86_400)).toBe(10);
    expect(holdFeeBps(86_401)).toBe(20);
    expect(holdFeeBps(604_800)).toBe(70);
    expect(holdFeeBps(86_400, 0)).toBe(0);
    expect(holdFeeBps(86_400, 3)).toBe(3);
    expect(() => holdFeeBps(604_801)).toThrow(
      'Invalid send-link windowSeconds',
    );
    expect(() => holdFeeBps(-1)).toThrow('0..604800');
    expect(() => holdFeeBps(Number.NaN)).toThrow(RangeError);
    expect(() => holdFeeBps(1, -1)).toThrow('Invalid holdFeeBpsPerDay');
    expect(() => holdFeeBps(1, 1.5)).toThrow('Invalid holdFeeBpsPerDay');
  });

  it('adds the hold fee to the spread with a 9999 ceiling', () => {
    expect(effectiveSendLinkSpreadBps(40, 86_400)).toBe(50);
    expect(effectiveSendLinkSpreadBps(9995, 86_400)).toBe(9999);
    expect(() => effectiveSendLinkSpreadBps(10_000, 1)).toThrow(
      'Invalid spreadBps',
    );
  });
});

describe('evidence quotes', () => {
  const evidence: PricingEvidence = {
    refs: [{ asset: 'PUSD', usdPrice: '1', source: 's', asOf: 1 }],
    spreadBps: 40,
    fixedFeeBase: 20n,
    rounding: 'floor',
  };
  it('returns zero when the gross output equals the fee, one above it otherwise', () => {
    const flat = { ...evidence, spreadBps: 0, fixedFeeBase: 100n };
    expect(quoteOut(1_000_000n, 6, 2, flat)).toBe(0n);
    expect(quoteOut(1_010_000n, 6, 2, flat)).toBe(1n);
    expect(quoteOut(0n, 6, 2, flat)).toBe(0n);
  });
  it('rejects bad evidence and negative amounts, and zero output needs zero input', () => {
    expect(() => quoteOut(-1n, 6, 2, evidence)).toThrow('Negative amount');
    expect(() =>
      quoteOut(1n, 6, 2, { ...evidence, spreadBps: 10_000 }),
    ).toThrow('Invalid spreadBps');
    expect(() =>
      quoteOut(1n, 6, 2, { ...evidence, fixedFeeBase: -1n }),
    ).toThrow('Negative amount');
    expect(() =>
      quoteOut(1n, 6, 2, { ...evidence, rounding: 'ceil' as 'floor' }),
    ).toThrow('Only floor rounding is supported');
    expect(() => quoteInForExactOut(-1n, 6, 2, evidence)).toThrow(
      'Negative amount',
    );
    expect(quoteInForExactOut(0n, 6, 2, evidence)).toBe(0n);
  });
  it('inverse is minimal: input covers the output and one unit less does not', () => {
    for (const out of [1n, 50n, 9_940n]) {
      const input = quoteInForExactOut(out, 6, 2, evidence);
      expect(quoteOut(input, 6, 2, evidence)).toBeGreaterThanOrEqual(out);
      expect(quoteOut(input - 1n, 6, 2, evidence)).toBeLessThan(out);
    }
  });
});

describe('verifyPricing parsing and outcomes', () => {
  const terms = (
    usdPrice: string,
    asset = 'PUSD',
    bchToken: 'PUSD' | 'MUSD' = 'PUSD',
  ): OrderTerms =>
    ({
      bchToken,
      pricing: {
        refs: [{ asset, usdPrice, source: 's', asOf: 1 }],
        spreadBps: 0,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
    }) as unknown as OrderTerms;

  it('is ok when the difference equals the tolerance and warns one step above', () => {
    expect(verifyPricing(terms('1.000'), '1.005', '0.005')).toMatchObject({
      status: 'ok',
      difference: '0.005',
      quotedPrice: '1.000',
      ownPrice: '1.005',
    });
    expect(
      verifyPricing(terms('1.000'), '1.005000000001', '0.005').status,
    ).toBe('warn');
    expect(verifyPricing(terms('1.010'), '1.000', '0.005').difference).toBe(
      '0.01',
    );
    expect(verifyPricing(terms('1'), '1', '0').difference).toBe('0');
  });

  it('parses numbers and strings, ignores surrounding whitespace, truncates past 12 places', () => {
    expect(verifyPricing(terms('1'), 1, 0.01)).toMatchObject({
      status: 'ok',
      ownPrice: '1',
    });
    expect(verifyPricing(terms('1'), ' 1.0 ', '0.01').status).toBe('ok');
    expect(verifyPricing(terms('1.0000000000009'), '1', '0').difference).toBe(
      '0',
    );
    expect(verifyPricing(terms('12'), '2', '100').difference).toBe('10');
  });

  it('warns with a specific reason for each malformed input', () => {
    for (const bad of ['abc', '', '-1', '1.', '.5', '1.2.3', '0', '0.0']) {
      expect(verifyPricing(terms('1'), bad, '0.01')).toMatchObject({
        status: 'warn',
        reason: 'Invalid live reference price',
        difference: null,
        quotedPrice: null,
      });
    }
    for (const bad of ['abc', '-0.1', '']) {
      expect(verifyPricing(terms('1'), '1', bad)).toMatchObject({
        status: 'warn',
        reason: 'Invalid tolerance',
      });
    }
    expect(verifyPricing(terms('xyz'), '1', '0.01')).toMatchObject({
      status: 'warn',
      reason: 'Malformed PUSD reference price',
      quotedPrice: 'xyz',
    });
    expect(verifyPricing(terms('0'), '1', '0.01').reason).toBe(
      'Malformed PUSD reference price',
    );
  });

  it('matches the reference asset case-insensitively and warns when it is missing', () => {
    expect(verifyPricing(terms('1', 'pusd'), '1', '0.01').status).toBe('ok');
    expect(
      verifyPricing(terms('1', 'MUSD', 'PUSD'), '1', '0.01'),
    ).toMatchObject({
      status: 'warn',
      reason: 'Missing PUSD pricing reference in terms',
    });
    expect(verifyPricing(terms('1', 'MUSD', 'MUSD'), '1', '0.01').status).toBe(
      'ok',
    );
  });

  it('names the difference in the divergence reason', () => {
    expect(verifyPricing(terms('1.010'), '1.000', '0.005').reason).toBe(
      'PUSD quote price differs from live reference by 0.01',
    );
  });
});
