import { describe, expect, it, vi } from 'vitest';
import {
  SolverClient,
  SolverHttpError,
  SolverNetworkError,
  SolverRefusalError,
  SolverSchemaError,
  SolverTimeoutError,
} from '../src/index.js';
import {
  BCH_LOCKING_VALID,
  makeSignedQuoteWithJson,
} from './client-helpers.js';
import { EVM_TOKEN, HASH_LOCK, NOW_SECONDS, USER_EVM } from './fixtures.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SolverClient', () => {
  it('calls every blueprint API route and validates responses with @ferry/core/api', async () => {
    const quotePayload = await makeSignedQuoteWithJson();
    const calls: Array<{ url: string; method: string; auth?: string }> = [];

    const client = new SolverClient({
      baseUrl: 'https://solver.example.com/',
      bearerToken: 'op-secret-token',
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const headers = init?.headers as Record<string, string> | undefined;
        calls.push({
          url,
          method,
          ...(headers?.['authorization'] !== undefined
            ? { auth: headers['authorization'] }
            : {}),
        });

        if (url.endsWith('/v1/quotes')) return jsonResponse(quotePayload);
        if (url.endsWith(`/v1/orders/${quotePayload.orderId}`)) {
          return jsonResponse({
            orderId: quotePayload.orderId,
            state: 'QUOTED',
            direction: 'EVM_TO_BCH',
            txids: {},
            quoteExpiry: NOW_SECONDS + 300,
            counterDeadline: NOW_SECONDS + 28_800,
            bchRefundHeight: 500_012,
            updatedAt: NOW_SECONDS,
          });
        }
        if (url.endsWith(`/v1/orders/${quotePayload.orderId}/secret`)) {
          return jsonResponse({ ok: true, orderId: quotePayload.orderId });
        }
        if (url.endsWith(`/v1/orders/${quotePayload.orderId}/relay-lock`)) {
          return jsonResponse({
            ok: true,
            orderId: quotePayload.orderId,
            txHash: HASH_LOCK,
          });
        }
        if (url.endsWith(`/v1/orders/${quotePayload.orderId}/relay-claim`)) {
          return jsonResponse({
            ok: true,
            orderId: quotePayload.orderId,
            txHash: HASH_LOCK,
          });
        }
        if (url.endsWith('/v1/health')) {
          return jsonResponse({
            ok: true,
            quotingEnabled: true,
            timestamp: NOW_SECONDS,
          });
        }
        if (url.endsWith('/v1/liquidity')) {
          return jsonResponse({ routes: [], asOf: NOW_SECONDS });
        }
        if (url.endsWith('/v1/chains')) {
          return jsonResponse({ chains: [] });
        }
        if (url.endsWith('/v1/stats')) {
          return jsonResponse({
            completedSwaps: 5,
            totalVolumeUsd: '100.00',
            medianFastSeconds: 12,
            asOf: NOW_SECONDS,
          });
        }
        if (url.endsWith('/v1/orders/recent')) {
          return jsonResponse({ orders: [] });
        }
        if (url.endsWith('/v1/pegs')) {
          return jsonResponse({ tokens: [], asOf: NOW_SECONDS });
        }
        if (url.endsWith('/v1/metrics')) {
          return jsonResponse({
            openExposureUsd: '0',
            unfundedQuotes: 0,
            tipAges: { bchSeconds: 10, evmSeconds: {} },
            errorCounts: {},
            lastConfirmedAt: null,
            timestamp: NOW_SECONDS,
          });
        }
        if (url.endsWith('/v1/operator/needs-attention')) {
          return jsonResponse({
            alerts: [],
            orders: [],
            timestamp: NOW_SECONDS,
          });
        }
        if (url.endsWith('/v1/links') && method === 'POST') {
          return jsonResponse({
            id: 'pl-1',
            kind: 'invoice',
            status: 'open',
            token: 'PUSD',
            recipientAddress:
              'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
            recipientLockingBytecode: BCH_LOCKING_VALID,
            amountOut: '500',
            createdAt: NOW_SECONDS,
          });
        }
        if (url.endsWith('/v1/links/pl-1') && method === 'GET') {
          return jsonResponse({
            id: 'pl-1',
            kind: 'invoice',
            status: 'open',
            token: 'PUSD',
            recipientAddress:
              'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
            recipientLockingBytecode: BCH_LOCKING_VALID,
            amountOut: '500',
            createdAt: NOW_SECONDS,
          });
        }
        if (url.endsWith('/v1/links/pl-1/quotes')) {
          return jsonResponse(quotePayload);
        }
        if (url.includes('/v1/links?owner=')) {
          return jsonResponse({
            owner: 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
            links: [],
          });
        }
        if (url.endsWith('/v1/links/pl-1/cancel')) {
          return jsonResponse({ ok: true, id: 'pl-1', status: 'cancelled' });
        }
        if (url.endsWith('/v1/send-quotes')) {
          return jsonResponse(quotePayload);
        }
        if (url.endsWith('/v1/send-links/sl-1')) {
          return jsonResponse({
            id: 'sl-1',
            status: 'locked',
            token: 'PUSD',
            chainId: 84532,
            evmToken: EVM_TOKEN,
            recipientEvmAddress: USER_EVM,
            hashLock: HASH_LOCK,
            evmDeadline: NOW_SECONDS + 86400,
            bchRefundHeight: 500_144,
            createdAt: NOW_SECONDS,
            updatedAt: NOW_SECONDS,
          });
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: '404' } },
          404,
        );
      },
    });

    const quote = await client.quote({
      direction: 'EVM_TO_BCH',
      token: 'PUSD',
      chainId: 84532,
      evmToken: EVM_TOKEN,
      amountIn: 10_000_000n,
      userEvmAddress: USER_EVM,
      userBchLockingBytecode: BCH_LOCKING_VALID,
      hashLock: HASH_LOCK,
      lane: 'fast',
    });
    expect(quote.terms.evmAmount).toBe(10_000_000n);

    expect((await client.getOrder(quote.orderId)).state).toBe('QUOTED');
    expect((await client.revealSecret(quote.orderId, HASH_LOCK)).ok).toBe(true);
    expect(
      (
        await client.relayLock(quote.orderId, {
          intent: { orderId: quote.orderId, deadline: NOW_SECONDS + 300 },
          signature: '0x1234',
        })
      ).ok,
    ).toBe(true);
    expect(
      (await client.relayClaim(quote.orderId, { secret: HASH_LOCK })).ok,
    ).toBe(true);
    expect((await client.health()).ok).toBe(true);
    expect((await client.liquidity()).asOf).toBe(NOW_SECONDS);
    expect((await client.chains()).chains).toEqual([]);
    expect((await client.stats()).completedSwaps).toBe(5);
    expect((await client.recentOrders()).orders).toEqual([]);
    expect((await client.pegs()).tokens).toEqual([]);
    expect((await client.metrics()).unfundedQuotes).toBe(0);
    expect((await client.operatorNeedsAttention()).alerts).toEqual([]);
    expect(
      (
        await client.createPayLink({
          token: 'PUSD',
          recipientAddress:
            'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
          amountOut: 500n,
        })
      ).id,
    ).toBe('pl-1');
    expect((await client.getPayLink('pl-1')).status).toBe('open');
    expect(
      (
        await client.quotePayLink('pl-1', {
          chainId: 84532,
          evmToken: EVM_TOKEN,
          userEvmAddress: USER_EVM,
          hashLock: HASH_LOCK,
          lane: 'fast',
        })
      ).orderId,
    ).toBe(quote.orderId);
    expect(
      (
        await client.listOwnerPayLinks(
          'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
          'sig',
        )
      ).links,
    ).toEqual([]);
    expect(
      (
        await client.cancelPayLink('pl-1', {
          owner: 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
          sig: 'sig',
        })
      ).status,
    ).toBe('cancelled');
    expect(
      (
        await client.quoteSendLink({
          token: 'PUSD',
          chainId: 84532,
          evmToken: EVM_TOKEN,
          amountIn: 1000n,
          recipientEvmAddress: USER_EVM,
          userEvmAddress: USER_EVM,
          userBchLockingBytecode: BCH_LOCKING_VALID,
          hashLock: HASH_LOCK,
          windowSeconds: 86400,
          lane: 'safe',
        })
      ).orderId,
    ).toBe(quote.orderId);
    expect((await client.getSendLink('sl-1')).status).toBe('locked');
    expect(calls.some((c) => c.auth === 'Bearer op-secret-token')).toBe(true);
  });

  it('throws typed errors for network, timeout, refusal, HTTP, and schema mismatch', async () => {
    const refusalClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      fetch: async () =>
        jsonResponse(
          { reason: 'INSUFFICIENT_LIQUIDITY', maxAmount: '42', asset: 'PUSD' },
          422,
        ),
    });
    await expect(refusalClient.health()).rejects.toThrow(SolverRefusalError);

    const httpErrorClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      fetch: async () =>
        jsonResponse(
          { error: { code: 'QUOTE_EXPIRED', message: 'Expired' } },
          410,
        ),
    });
    await expect(httpErrorClient.health()).rejects.toThrow(SolverHttpError);

    const rawHttpClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      fetch: async () => new Response('Bad Gateway', { status: 502 }),
    });
    await expect(rawHttpClient.health()).rejects.toThrow(SolverHttpError);

    const badJsonClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      fetch: async () => new Response('not-json', { status: 200 }),
    });
    await expect(badJsonClient.health()).rejects.toThrow(SolverSchemaError);

    const msTimestampClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      fetch: async () =>
        jsonResponse({
          ok: true,
          quotingEnabled: true,
          timestamp: 1_794_764_200_000,
        }),
    });
    await expect(msTimestampClient.health()).rejects.toThrow(SolverSchemaError);

    const networkClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(networkClient.health()).rejects.toThrow(SolverNetworkError);

    const timeoutClient = new SolverClient({
      baseUrl: 'https://solver.example.com',
      timeoutMs: 25,
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    await expect(timeoutClient.health()).rejects.toThrow(SolverTimeoutError);
  });
});

describe('relay calls wait for the chain', () => {
  it('gives the relay endpoints a 90 second limit, not the 10 second default', async () => {
    const seen: number[] = [];
    const client = new SolverClient({
      baseUrl: 'https://solver.test',
      fetch: ((_url: string, init?: { signal?: AbortSignal }) => {
        // The abort signal exists; what matters is the limit the client applied.
        void init;
        return Promise.reject(new Error('stop'));
      }) as never,
    });
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      _fn: () => void,
      ms?: number,
    ) => {
      seen.push(ms ?? 0);
      return 0 as never;
    }) as never);
    await client
      .relayClaim(
        `0x${'11'.repeat(32)}` as never,
        {
          secret: `0x${'22'.repeat(32)}`,
        } as never,
      )
      .catch(() => undefined);
    timers.mockRestore();
    expect(seen).toContain(90_000);
  });
});
