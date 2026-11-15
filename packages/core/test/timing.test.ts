import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_TIMING_CONFIG,
  erlangQuantile,
  invariantF,
  invariantR,
} from '../src/index.js';

describe('timing invariants F and R', () => {
  const t0 = 1_794_764_200;
  const tip = 974_345;

  it('passes Invariant F for default 24h EVM deadline and 36 BCH blocks', () => {
    const decision = invariantF(
      { evmDeadlineSeconds: t0 + 24 * 3600, bchRefundHeight: tip + 36 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ok');
    expect(decision.marginSeconds).toBeGreaterThan(0);
  });

  it('passes Invariant F for 7-day send-link window', () => {
    const decision = invariantF(
      { evmDeadlineSeconds: t0 + 7 * 86400, bchRefundHeight: tip + 36 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ok');
  });

  it('rejects Invariant F with typed reason when margin is insufficient or expired', () => {
    const short = invariantF(
      { evmDeadlineSeconds: t0 + 12 * 3600, bchRefundHeight: tip + 36 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(short.allowed).toBe(false);
    expect(short.reason).toBe('insufficient-margin');

    const expired = invariantF(
      { evmDeadlineSeconds: t0 - 1, bchRefundHeight: tip + 36 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(expired.allowed).toBe(false);
    expect(expired.reason).toBe('expired');

    const noBlocks = invariantF(
      { evmDeadlineSeconds: t0 + 24 * 3600, bchRefundHeight: tip },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(noBlocks.allowed).toBe(false);
    expect(noBlocks.reason).toBe('expired');
  });

  it('passes Invariant R for 6h EVM deadline and 108+ remaining BCH blocks', () => {
    const decision = invariantR(
      { evmDeadlineSeconds: t0 + 6 * 3600, bchRefundHeight: tip + 108 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ok');
  });

  it('rejects Invariant R when remaining blocks < 108 or margin insufficient', () => {
    const lowBlocks = invariantR(
      { evmDeadlineSeconds: t0 + 6 * 3600, bchRefundHeight: tip + 107 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(lowBlocks.allowed).toBe(false);
    expect(lowBlocks.reason).toBe('remaining-blocks');

    const tooLongEvm = invariantR(
      { evmDeadlineSeconds: t0 + 15 * 3600, bchRefundHeight: tip + 108 },
      { unixSeconds: t0, bchTipHeight: tip },
    );
    expect(tooLongEvm.allowed).toBe(false);
    expect(tooLongEvm.reason).toBe('insufficient-margin');
  });

  it('property: increasing evmDeadlineSeconds never turns an allowed Invariant F into disallowed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 3600, max: 7 * 86400 }),
        fc.integer({ min: 0, max: 86400 }),
        (blocks, windowSec, extraSec) => {
          const a = invariantF(
            {
              evmDeadlineSeconds: t0 + windowSec,
              bchRefundHeight: tip + blocks,
            },
            { unixSeconds: t0, bchTipHeight: tip },
            DEFAULT_TIMING_CONFIG,
          );
          const b = invariantF(
            {
              evmDeadlineSeconds: t0 + windowSec + extraSec,
              bchRefundHeight: tip + blocks,
            },
            { unixSeconds: t0, bchTipHeight: tip },
            DEFAULT_TIMING_CONFIG,
          );
          if (a.allowed) expect(b.allowed).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('validates erlangQuantile and timing parameter bounds', () => {
    expect(erlangQuantile(0, 0.5)).toBe(0);
    expect(() => erlangQuantile(-1, 0.5)).toThrow(RangeError);
    expect(() => erlangQuantile(10, 1)).toThrow(RangeError);
    expect(() =>
      invariantF(
        { evmDeadlineSeconds: -1, bchRefundHeight: tip + 36 },
        { unixSeconds: t0, bchTipHeight: tip },
      ),
    ).toThrow(RangeError);
    expect(() =>
      invariantF(
        { evmDeadlineSeconds: t0 + 86400, bchRefundHeight: -1 },
        { unixSeconds: t0, bchTipHeight: tip },
      ),
    ).toThrow(RangeError);
    expect(() =>
      invariantF(
        { evmDeadlineSeconds: t0 + 86400, bchRefundHeight: tip + 36 },
        { unixSeconds: t0, bchTipHeight: tip },
        { ...DEFAULT_TIMING_CONFIG, blockMeanSeconds: 0 },
      ),
    ).toThrow(RangeError);
  });
});
