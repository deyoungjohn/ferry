import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMING_CONFIG,
  erlangQuantile,
  invariantF,
  invariantR,
  type TimingConfig,
} from '../src/index.js';

const config: TimingConfig = {
  solverReactionSeconds: 60,
  safetySeconds: 100,
  blockMeanSeconds: 600,
  minReverseRemainingBlocks: 5,
};
// With a one-block window the 99.99% Erlang quantile is -ln(0.0001) * mean.
const oneBlockP9999 = -Math.log(1 - 0.9999) * 600;
const oneBlockP0001 = -Math.log(1 - 0.0001) * 600;

describe('erlangQuantile edges', () => {
  it('matches the closed form for one block and scales with the mean', () => {
    expect(erlangQuantile(1, 0.5)).toBeCloseTo(Math.LN2 * 600, 6);
    expect(erlangQuantile(1, 0.5, 300)).toBeCloseTo(Math.LN2 * 300, 6);
    expect(erlangQuantile(1, 0.9999, 600)).toBeCloseTo(oneBlockP9999, 6);
  });

  it('matches the closed form for two blocks', () => {
    // CDF(x) = 1 - e^-x (1 + x); the median is about 1.67835 unit means.
    expect(erlangQuantile(2, 0.5, 1)).toBeCloseTo(1.678347, 5);
  });

  it('is zero for zero blocks, and accepts the largest allowed block count', () => {
    expect(erlangQuantile(0, 0.5)).toBe(0);
    expect(erlangQuantile(10_000, 0.5, 1)).toBeGreaterThan(9_900);
    expect(() => erlangQuantile(10_001, 0.5)).toThrow(
      'Invalid Erlang parameters',
    );
  });

  it('rejects every invalid parameter', () => {
    for (const args of [
      [-1, 0.5, 600],
      [1.5, 0.5, 600],
      [1, 0, 600],
      [1, 1, 600],
      [1, 0.5, 0],
      [1, 0.5, -1],
      [1, 0.5, Number.POSITIVE_INFINITY],
      [1, 0.5, Number.NaN],
      [1, Number.NaN, 600],
    ] as const) {
      expect(() => erlangQuantile(args[0], args[1], args[2])).toThrow(
        RangeError,
      );
    }
  });

  it('returns the same value on repeated calls (cache) and distinguishes keys', () => {
    const a = erlangQuantile(7, 0.9);
    expect(erlangQuantile(7, 0.9)).toBe(a);
    expect(erlangQuantile(7, 0.8)).toBeLessThan(a);
    expect(erlangQuantile(8, 0.9)).toBeGreaterThan(a);
  });
});

describe('invariant F decision', () => {
  const terms = (secondsAhead: number, blocks: number) => ({
    evmDeadlineSeconds: 10_000 + secondsAhead,
    bchRefundHeight: 1_000 + blocks,
  });
  const start = { unixSeconds: 10_000, bchTipHeight: 1_000 };
  const required = oneBlockP9999 + 60 + 100;

  it('reports exact fields and is allowed at zero margin', () => {
    const exact = invariantF(terms(required, 1), start, config);
    expect(exact).toMatchObject({
      allowed: true,
      reason: 'ok',
      remainingBlocks: 1,
    });
    expect(exact.requiredSeconds).toBeCloseTo(required, 6);
    expect(exact.availableSeconds).toBeCloseTo(required, 6);
    expect(Math.abs(exact.marginSeconds)).toBeLessThan(1e-6);
  });

  it('refuses a tiny shortfall as insufficient margin and a surplus is ok', () => {
    expect(invariantF(terms(required - 1, 1), start, config)).toMatchObject({
      allowed: false,
      reason: 'insufficient-margin',
    });
    expect(invariantF(terms(required + 1, 1), start, config).reason).toBe('ok');
  });

  it('expires at zero available seconds or zero remaining blocks', () => {
    expect(invariantF(terms(0, 5), start, config).reason).toBe('expired');
    expect(invariantF(terms(-1, 5), start, config).reason).toBe('expired');
    expect(invariantF(terms(1, 0), start, config).reason).toBe('expired');
    expect(invariantF(terms(1_000_000, -1), start, config).reason).toBe(
      'expired',
    );
    expect(invariantF(terms(1, 0), start, config).requiredSeconds).toBe(160);
    expect(invariantF(terms(1_000_000, 1), start, config).reason).toBe('ok');
  });

  it('uses default config when none is passed', () => {
    const decision = invariantF(terms(1_000_000, 1), start);
    expect(decision.requiredSeconds).toBeCloseTo(
      erlangQuantile(1, 0.9999, DEFAULT_TIMING_CONFIG.blockMeanSeconds) +
        DEFAULT_TIMING_CONFIG.solverReactionSeconds +
        DEFAULT_TIMING_CONFIG.safetySeconds,
      6,
    );
  });
});

describe('invariant R decision', () => {
  const start = { unixSeconds: 10_000, bchTipHeight: 1_000 };
  const terms = (evmWindow: number, blocks: number) => ({
    evmDeadlineSeconds: 10_000 + evmWindow,
    bchRefundHeight: 1_000 + blocks,
  });

  it('reports available as the low quantile and required as window plus margins', () => {
    const d = invariantR(terms(300, 5), start, config);
    expect(d.availableSeconds).toBeCloseTo(erlangQuantile(5, 0.0001, 600), 6);
    expect(d.requiredSeconds).toBe(300 + 60 + 100);
    expect(d.remainingBlocks).toBe(5);
    expect(d.marginSeconds).toBeCloseTo(d.availableSeconds - 460, 6);
  });

  it('allows a window just inside the margin and refuses just outside', () => {
    const available = erlangQuantile(5, 0.0001, 600);
    const edge = available - 160;
    expect(invariantR(terms(edge - 1, 5), start, config).reason).toBe('ok');
    expect(invariantR(terms(edge + 1, 5), start, config)).toMatchObject({
      allowed: false,
      reason: 'insufficient-margin',
    });
  });

  it('refuses below the minimum remaining blocks, accepts exactly the minimum', () => {
    expect(invariantR(terms(1, 4), start, config).reason).toBe(
      'remaining-blocks',
    );
    expect(invariantR(terms(1, 5), start, config).reason).toBe('ok');
  });

  it('expires when the EVM window is zero or negative, or no blocks remain', () => {
    expect(invariantR(terms(0, 100), start, config).reason).toBe('expired');
    expect(invariantR(terms(-5, 100), start, config).reason).toBe('expired');
    expect(invariantR(terms(1, 0), start, config).reason).toBe('expired');
    expect(invariantR(terms(1, -3), start, config).reason).toBe('expired');
    expect(invariantR(terms(-5, 100), start, config).requiredSeconds).toBe(160);
    expect(oneBlockP0001).toBeGreaterThan(0);
  });
});

describe('timing input validation', () => {
  const ok = {
    terms: { evmDeadlineSeconds: 2_000, bchRefundHeight: 110 },
    start: { unixSeconds: 1_000, bchTipHeight: 100 },
  };

  it('rejects bad time values, naming the problem', () => {
    const bad = [
      { ...ok.terms, evmDeadlineSeconds: -1 },
      { ...ok.terms, evmDeadlineSeconds: Number.NaN },
      { ...ok.terms, evmDeadlineSeconds: Number.POSITIVE_INFINITY },
    ];
    for (const terms of bad) {
      expect(() => invariantF(terms, ok.start, config)).toThrow(
        'Invalid time value',
      );
    }
    expect(() =>
      invariantF(ok.terms, { ...ok.start, unixSeconds: -1 }, config),
    ).toThrow('Invalid time value');
    expect(() =>
      invariantF(ok.terms, ok.start, { ...config, safetySeconds: -1 }),
    ).toThrow('Invalid time value');
    expect(() =>
      invariantF(ok.terms, ok.start, { ...config, solverReactionSeconds: -1 }),
    ).toThrow('Invalid time value');
  });

  it('accepts zero for every time and height field', () => {
    expect(() =>
      invariantF(
        { evmDeadlineSeconds: 0, bchRefundHeight: 0 },
        { unixSeconds: 0, bchTipHeight: 0 },
        {
          ...config,
          safetySeconds: 0,
          solverReactionSeconds: 0,
          minReverseRemainingBlocks: 0,
        },
      ),
    ).not.toThrow();
  });

  it('rejects bad heights', () => {
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 60]) {
      expect(() =>
        invariantF({ ...ok.terms, bchRefundHeight: bad }, ok.start, config),
      ).toThrow('Invalid block height');
      expect(() =>
        invariantF(ok.terms, { ...ok.start, bchTipHeight: bad }, config),
      ).toThrow('Invalid block height');
      expect(() =>
        invariantF(ok.terms, ok.start, {
          ...config,
          minReverseRemainingBlocks: bad,
        }),
      ).toThrow('Invalid block height');
    }
  });

  it('rejects a non-positive or non-finite block mean', () => {
    for (const bad of [0, -600, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        invariantR(ok.terms, ok.start, { ...config, blockMeanSeconds: bad }),
      ).toThrow('Invalid block mean seconds');
    }
  });
});
