import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_TIMING_CONFIG,
  MAX_SEND_LINK_WINDOW_SECONDS,
  SEND_LINK_WINDOWS_SECONDS,
  deriveSendLinkTag,
  invariantR,
  parseSendLink,
  planSendLinkWindow,
} from '../src/index.js';
import { runs } from './support/runs.js';

const ORDER_ID = `0x${'ab'.repeat(32)}` as const;
const EVM_TOKEN = `0x${'11'.repeat(20)}` as const;
const RECIPIENT = `0x${'22'.repeat(20)}` as const;

describe('SendLink schema and window planner', () => {
  it('validates SendLink schema and rejects secret or oversized windows', () => {
    const link = parseSendLink({
      id: ORDER_ID,
      destinationChainId: 8453,
      token: EVM_TOKEN,
      recipientAddress: RECIPIENT,
      amount: 25_000_000n,
      windowSeconds: SEND_LINK_WINDOWS_SECONDS['3d'],
      status: 'quoted',
      createdAt: 1_799_900_000,
    });
    expect(link.windowSeconds).toBe(259_200);

    expect(() =>
      parseSendLink({
        ...link,
        windowSeconds: MAX_SEND_LINK_WINDOW_SECONDS + 1,
      }),
    ).toThrow();

    expect(() =>
      parseSendLink({
        ...link,
        secret: `0x${'ff'.repeat(32)}`,
      }),
    ).toThrow();

    expect(() =>
      parseSendLink({
        ...link,
        createdAt: 1_799_900_000_000, // ms rejected
      }),
    ).toThrow();
  });

  it('plans 24h, 3d, and 7d windows satisfying invariant R', () => {
    const start = { unixSeconds: 1_799_900_000, bchTipHeight: 500_000 };
    for (const windowSeconds of [
      SEND_LINK_WINDOWS_SECONDS['24h'],
      SEND_LINK_WINDOWS_SECONDS['3d'],
      SEND_LINK_WINDOWS_SECONDS['7d'],
    ]) {
      const plan = planSendLinkWindow({ windowSeconds, start });
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      expect(plan.evmDeadlineSeconds).toBe(start.unixSeconds + windowSeconds);
      expect(plan.decision.allowed).toBe(true);
      expect(
        invariantR(
          {
            evmDeadlineSeconds: plan.evmDeadlineSeconds,
            bchRefundHeight: plan.bchRefundHeight,
          },
          start,
          DEFAULT_TIMING_CONFIG,
        ).allowed,
      ).toBe(true);
    }
  });

  it('returns typed failures for invalid windows, unfeasible configs, or height overflow', () => {
    const start = { unixSeconds: 1_799_900_000, bchTipHeight: 500_000 };
    expect(planSendLinkWindow({ windowSeconds: 0, start })).toMatchObject({
      ok: false,
      reason: 'invalid-window',
    });
    expect(
      planSendLinkWindow({
        windowSeconds: MAX_SEND_LINK_WINDOW_SECONDS + 1,
        start,
      }),
    ).toMatchObject({ ok: false, reason: 'window-too-long' });
    expect(
      planSendLinkWindow({
        windowSeconds: SEND_LINK_WINDOWS_SECONDS['24h'],
        start: { unixSeconds: 1_799_900_000_000, bchTipHeight: 500_000 },
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-start' });
    expect(
      planSendLinkWindow({
        windowSeconds: SEND_LINK_WINDOWS_SECONDS['7d'],
        start: { unixSeconds: 1_799_900_000, bchTipHeight: 499_999_900 },
      }),
    ).toMatchObject({ ok: false, reason: 'height-out-of-range' });
    expect(
      planSendLinkWindow({
        windowSeconds: SEND_LINK_WINDOWS_SECONDS['7d'],
        start,
        config: {
          ...DEFAULT_TIMING_CONFIG,
          blockMeanSeconds: 10, // 10,000 blocks too short for 7 days
        },
      }),
    ).toMatchObject({ ok: false, reason: 'unfeasible-window' });
    expect(
      planSendLinkWindow({
        windowSeconds: SEND_LINK_WINDOWS_SECONDS['24h'],
        start: { unixSeconds: 99_999_999_000, bchTipHeight: 500_000 },
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-start' });
    expect(
      planSendLinkWindow({
        windowSeconds: SEND_LINK_WINDOWS_SECONDS['24h'],
        start,
        config: {
          ...DEFAULT_TIMING_CONFIG,
          minReverseRemainingBlocks: 10_001,
        },
      }),
    ).toMatchObject({ ok: false, reason: 'unfeasible-window' });
  });

  it('property (SL-04): planned windows satisfy invariant R for 24h, 3d, 7d under fast and slow block cases', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          SEND_LINK_WINDOWS_SECONDS['24h'],
          SEND_LINK_WINDOWS_SECONDS['3d'],
          SEND_LINK_WINDOWS_SECONDS['7d'],
        ),
        fc.integer({ min: 1_700_000_000, max: 2_000_000_000 }),
        fc.integer({ min: 100_000, max: 10_000_000 }),
        // Fast blocks (e.g. 300s mean) through normal (600s) to slow blocks (1200s mean)
        fc.integer({ min: 300, max: 1200 }),
        (windowSeconds, unixSeconds, bchTipHeight, blockMeanSeconds) => {
          const start = { unixSeconds, bchTipHeight };
          const config = {
            ...DEFAULT_TIMING_CONFIG,
            blockMeanSeconds,
          };
          const plan = planSendLinkWindow({ windowSeconds, start, config });
          expect(plan.ok).toBe(true);
          if (!plan.ok) return;

          expect(plan.evmDeadlineSeconds).toBe(unixSeconds + windowSeconds);
          expect(plan.bchRefundHeight).toBeGreaterThan(bchTipHeight);
          expect(plan.decision.allowed).toBe(true);

          // One block fewer must either violate invariantR or hit minReverseRemainingBlocks
          if (plan.remainingBlocks > config.minReverseRemainingBlocks) {
            const tighter = invariantR(
              {
                evmDeadlineSeconds: plan.evmDeadlineSeconds,
                bchRefundHeight: plan.bchRefundHeight - 1,
              },
              start,
              config,
            );
            expect(tighter.allowed).toBe(false);
          }
        },
      ),
      { numRuns: runs(25) },
    );
  }, 30_000);

  it('derives blinded send link tags with HMAC-SHA-256(viewKey, "ferry:send-links:v1:" + n)', async () => {
    const viewKey = '0x' + '42'.repeat(32);
    const tag0 = await deriveSendLinkTag(viewKey, 0);
    const tag1 = await deriveSendLinkTag(viewKey, 1);
    const tag0Again = await deriveSendLinkTag(viewKey, 0);

    expect(tag0).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tag1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tag0).toBe(tag0Again);
    expect(tag0).not.toBe(tag1);

    // Verify raw Uint8Array key acceptance and without 0x prefix
    const keyBytes = new Uint8Array(32).fill(0x42);
    const tagBytes0 = await deriveSendLinkTag(keyBytes, 0);
    expect(tagBytes0).toBe(tag0);
    const tagNoPrefix0 = await deriveSendLinkTag('42'.repeat(32), 0);
    expect(tagNoPrefix0).toBe(tag0);

    // Error handling on invalid inputs
    await expect(deriveSendLinkTag(viewKey, -1)).rejects.toThrow(RangeError);
    await expect(deriveSendLinkTag(viewKey, 1.5)).rejects.toThrow(RangeError);
    await expect(deriveSendLinkTag('0x1234', 0)).rejects.toThrow(RangeError);
  });
});
