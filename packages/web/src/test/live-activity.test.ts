import { describe, expect, it } from 'vitest';
import { loadLiveActivity, loadLiveActivityByBch } from '../lib/activity/live';

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

describe('loadLiveActivityByBch', () => {
  it('asks for every wallet address once, lowercased, and maps the rows', async () => {
    const urls: string[] = [];
    const rows = await loadLiveActivityByBch(
      'https://s.example/',
      [
        '0x76A914' + 'AB'.repeat(20) + '88AC',
        '76a914' + 'ab'.repeat(20) + '88ac',
        '0xaa20' + 'cd'.repeat(32) + '87',
      ],
      (async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            orders: [
              {
                orderId: '0x' + 'cd'.repeat(32),
                direction: 'BCH_TO_EVM',
                status: 'DONE',
                createdAt: 1_795_000_000,
                evmAmount: '4980000',
                bchToken: 'PUSD',
                bchTokenAmount: '500',
              },
            ],
          }),
        );
      }) as unknown as typeof fetch,
    );
    expect(urls).toEqual([
      'https://s.example/v1/orders?bch=0x76a914' +
        'ab'.repeat(20) +
        '88ac,0xaa20' +
        'cd'.repeat(32) +
        '87',
    ]);
    expect(rows[0]).toMatchObject({
      amountDisplay: '5.00 PUSD → 4.98 USDC',
      direction: 'BCH_TO_COUNTER',
    });
  });
});
