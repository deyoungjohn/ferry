import { describe, expect, it } from 'vitest';
import { loadLiveActivity } from '../lib/activity/live';

describe('loadLiveActivity', () => {
  it('turns the solver list into activity rows with amounts and tone', async () => {
    const rows = await loadLiveActivity(
      'https://s.example',
      '0x1111111111111111111111111111111111111111',
      (async () =>
        new Response(
          JSON.stringify({
            orders: [
              {
                orderId: '0x' + 'ab'.repeat(32),
                direction: 'EVM_TO_BCH',
                status: 'DONE',
                createdAt: 1_795_000_000,
                evmAmount: '1239999',
                bchToken: 'PUSD',
                bchTokenAmount: '99',
              },
            ],
          }),
        )) as typeof fetch,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountDisplay: '1.23 USDC → 0.99 PUSD',
      statusLabel: 'Completed',
      tone: 'ok',
      direction: 'COUNTER_TO_BCH',
    });
  });
});
