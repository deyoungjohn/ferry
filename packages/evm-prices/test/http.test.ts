import { describe, expect, it } from 'vitest';
import { HttpPriceSource, PriceUnavailableError } from '../src/index.js';

const NOW = 1_800_000_000;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function source(
  payload: { priceMicros: string; asOf: number; heartbeatSeconds?: number },
  status = 200,
): HttpPriceSource {
  const fetchImpl = (async () => response(payload, status)) as typeof fetch;
  return new HttpPriceSource({
    url: 'https://prices.example.com/{asset}',
    source: 'independent-http',
    fetchImpl,
    nowSeconds: () => NOW,
    parse: (body) => {
      const value = body as { priceMicros: string; asOf: number };
      return {
        usdPrice: BigInt(value.priceMicros),
        asOf: value.asOf,
        ...(payload.heartbeatSeconds !== undefined
          ? { heartbeatSeconds: payload.heartbeatSeconds }
          : {}),
      };
    },
  });
}

describe('HttpPriceSource', () => {
  it('returns an independent reading and fills the asset placeholder', async () => {
    let requested = '';
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      requested = String(input);
      return response({ priceMicros: '1000200', asOf: NOW - 5 });
    }) as typeof fetch;
    const http = new HttpPriceSource({
      url: 'https://prices.example.com/{asset}',
      source: 'independent-http',
      fetchImpl,
      nowSeconds: () => NOW,
      parse: (body) => ({
        usdPrice: BigInt((body as { priceMicros: string }).priceMicros),
        asOf: (body as { asOf: number }).asOf,
      }),
    });

    await expect(http.getPrice('USDC')).resolves.toEqual({
      usdPrice: 1_000_200n,
      source: 'independent-http',
      asOf: NOW - 5,
    });
    expect(requested).toBe('https://prices.example.com/USDC');
  });

  it('accepts a fresh heartbeat-sized reading', async () => {
    await expect(
      source({
        priceMicros: '1000000',
        asOf: NOW - 59,
        heartbeatSeconds: 60,
      }).getPrice('USDC'),
    ).resolves.toMatchObject({ usdPrice: 1_000_000n });
  });

  it('rejects a stale reading', async () => {
    await expect(
      source({ priceMicros: '1000000', asOf: NOW - 31 }).getPrice('USDC'),
    ).rejects.toThrow(/stale/);
  });

  it('rejects a non-positive price', async () => {
    await expect(
      source({ priceMicros: '0', asOf: NOW - 1 }).getPrice('USDC'),
    ).rejects.toThrow(/Invalid price/);
  });

  it('rejects an HTTP error without leaking the URL', async () => {
    try {
      await source({ priceMicros: '1000000', asOf: NOW }, 500).getPrice('USDC');
    } catch (error) {
      expect(error).toBeInstanceOf(PriceUnavailableError);
      expect(String(error)).not.toContain('prices.example.com');
      return;
    }
    throw new Error('expected HttpPriceSource to throw');
  });
});
