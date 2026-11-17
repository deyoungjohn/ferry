import { describe, expect, it } from 'vitest';
import { RealSolverClient } from '../lib/solver/real';

// Bodies copied from what the live solver returns (docs/API.md).
const LIVE: Record<string, unknown> = {
  '/v1/orders/recent': { orders: [], asOf: 1 },
  '/v1/stats': {
    completedSwaps: 0,
    totalVolumeUsd: '0.00',
    medianFastSeconds: 0,
    asOf: 1,
  },
  '/v1/pegs': {
    tokens: [
      {
        asset: 'PUSD',
        currentUsdPrice: '1.00',
        points: [{ at: 1, usdPrice: '1.00' }],
      },
    ],
    asOf: 1,
  },
  '/v1/liquidity': { routes: [], asOf: 1 },
};

const calls: string[] = [];
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'https://solver.example.org');
  calls.push(url.pathname);
  if (url.pathname === '/v1/quotes') {
    return new Response(
      JSON.stringify({
        reason: 'INSUFFICIENT_LIQUIDITY',
        asset: 'PUSD',
        maxAmount: '4200',
        message: 'Only 42 PUSD available; try 42 or less',
      }),
      { status: 422 },
    );
  }
  const body = LIVE[url.pathname];
  if (body) return new Response(JSON.stringify(body), { status: 200 });
  return new Response(
    JSON.stringify({ message: `Route ${url.pathname} not found` }),
    { status: 404 },
  );
}) as typeof fetch;

const client = new RealSolverClient({
  baseUrl: 'https://solver.example.org',
  fetch: fakeFetch,
});

describe('RealSolverClient against the live response shapes', () => {
  it('reads recent swaps from { orders } without crashing the table', async () => {
    const page = await client.getRecentSwaps(1, 10);
    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(1);
  });

  it('reads stats, pegs and liquidity', async () => {
    expect((await client.getStats()).isHonestEmpty).toBe(true);
    const pegs = await client.getPegPrices();
    expect(pegs[0]?.symbol).toBe('PUSD');
    expect((await client.getLiquidity()).routes).toEqual([]);
  });

  it('asks for quotes at /v1/quotes, never /v1/quote', async () => {
    calls.length = 0;
    await client.getQuote({
      fromToken: 'USDC',
      toToken: 'PUSD',
      fromChain: 'Base',
      toChain: 'Bitcoin Cash',
      fromAmount: 1,
      lane: 'safe',
    });
    expect(calls).not.toContain('/v1/quote');
  });

  it('refuses to build a live swap before execution is switched on', async () => {
    // Read the message by hand: under the shared-worker runner the thrown Error can come from
    // another realm, and toThrow then sees an empty message.
    const thrown = await client.createOrder().then(
      () => null,
      (error: unknown) => error,
    );
    expect(String((thrown as { message?: unknown } | null)?.message)).toMatch(
      /not switched on/,
    );
  });
});
