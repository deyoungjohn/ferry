import { describe, expect, it } from 'vitest';
import { payLinkSteps } from '../lib/paylink/order-steps';

const snapshot = (chainId: number) => ({
  state: 'USER_LOCK_FINAL',
  txids: { evmLock: '0x' + '11'.repeat(32) },
  summary: {
    bchToken: 'PUSD',
    bchTokenAmount: '100',
    evmAmount: '1000000',
    evmChainId: chainId,
  },
});

describe('the finality wait note on a pay link', () => {
  const noteOf = (chainId: number) =>
    payLinkSteps('PUSD', snapshot(chainId), false).find(
      (step) => step.id === 'solver',
    )?.note;

  it('is shown only when the payer paid on Robinhood Chain', () => {
    expect(noteOf(4663)).toMatch(/Robinhood Chain must finalize/);
    for (const other of [8453, 1, 42161, 56, 5042]) {
      expect(noteOf(other)).not.toMatch(/Robinhood/);
    }
  });
});
