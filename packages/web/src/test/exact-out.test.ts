import { describe, expect, it } from 'vitest';
import { amountInForExactOut } from '../lib/live/exact-out';

// A solver that keeps a fixed 3 cents plus 0.4 percent: send 6 decimals, receive cents.
const fakeSolver = async (_deps: unknown, input: { amountIn: bigint }) => {
  const sentCents = Number(input.amountIn) / 10_000;
  const received = Math.floor((sentCents - 3) * 0.996);
  return { terms: { bchTokenAmount: BigInt(Math.max(0, received)) } };
};

const base = {
  direction: 'EVM_TO_BCH' as const,
  token: 'PUSD' as const,
  chainId: 8453,
  evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  evmTokenDecimals: 6,
  bchTokenDecimals: 2,
};

describe('amountInForExactOut', () => {
  it('finds what to send so the recipient gets at least the exact amount, within two cents', async () => {
    for (const target of [200n, 20_000n, 200_000n]) {
      const { amountIn, receivedCents } = await amountInForExactOut(
        {} as never,
        base,
        target,
        fakeSolver as never,
      );
      expect(receivedCents).toBeGreaterThanOrEqual(target);
      expect(receivedCents - target).toBeLessThanOrEqual(2n);
      expect(amountIn).toBeGreaterThan(target * 10_000n);
    }
  });
});
