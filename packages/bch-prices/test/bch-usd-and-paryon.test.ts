import { describe, expect, it } from 'vitest';
import {
  BCH_MAINNET_TOKEN_CATEGORIES,
  BchPriceUnavailableError,
  ParyonStatsClient,
  createBchUsdSource,
  createParyonPriceSource,
  decimalUsdToMicros,
  fetchCauldronActivePools,
  fetchCoinbaseBchUsd,
  fetchKrakenBchUsd,
  usdMicrosToDecimal,
  type FetchLike,
} from '../src/index.js';
import {
  RECORDED_COINBASE_BCH_USD,
  RECORDED_KRAKEN_BCH_USD,
  RECORDED_PARYON_STATS,
} from './fixtures/recorded-prices.js';

const NOW = 1_794_835_200;

describe('BCH/USD and Paryon stats clients', () => {
  it('converts decimal USD strings to and from integer micros', () => {
    expect(decimalUsdToMicros('1.00')).toBe(1_000_000n);
    expect(decimalUsdToMicros('0.99801856')).toBe(998_018n);
    expect(decimalUsdToMicros('205.755')).toBe(205_755_000n);
    expect(usdMicrosToDecimal(998_018n)).toBe('0.998018');
    expect(() => decimalUsdToMicros('-1')).toThrow(RangeError);
    expect(() => decimalUsdToMicros('0')).toThrow(RangeError);
  });

  it('fetches Coinbase and Kraken BCH/USD with fallback', async () => {
    const coinbaseFetch: FetchLike = async () =>
      new Response(JSON.stringify(RECORDED_COINBASE_BCH_USD), { status: 200 });
    const krakenFetch: FetchLike = async () =>
      new Response(JSON.stringify(RECORDED_KRAKEN_BCH_USD), { status: 200 });

    const cb = await fetchCoinbaseBchUsd({
      fetch: coinbaseFetch,
      nowSeconds: () => NOW,
    });
    expect(cb.usdPrice).toBe(205_755_000n);
    expect(cb.source).toBe('coinbase-bch-usd');

    const kr = await fetchKrakenBchUsd({
      fetch: krakenFetch,
      nowSeconds: () => NOW,
    });
    expect(kr.usdPrice).toBe(205_660_000n);
    expect(kr.source).toBe('kraken-bch-usd');

    const fallbackSource = createBchUsdSource({
      nowSeconds: () => NOW,
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('coinbase')) {
          return new Response('unavailable', { status: 503 });
        }
        return new Response(JSON.stringify(RECORDED_KRAKEN_BCH_USD), {
          status: 200,
        });
      },
    });
    const fallbackReading = await fallbackSource.getPrice('BCH');
    expect(fallbackReading.source).toBe('kraken-bch-usd');
    expect(fallbackReading.usdPrice).toBe(205_660_000n);

    await expect(fallbackSource.getPrice('ETH')).rejects.toThrow(
      BchPriceUnavailableError,
    );
  });

  it('reads Paryon stats and adapts to PriceSource', async () => {
    const client = new ParyonStatsClient({
      fetch: async () =>
        new Response(JSON.stringify(RECORDED_PARYON_STATS), { status: 200 }),
    });
    const reading = await client.readPusdPrice();
    expect(reading.usdPrice).toBe(998_018n);
    expect(reading.source).toBe('paryon');
    expect(reading.asOf).toBe(
      Math.floor(Date.parse('2026-11-16T13:00:09.268Z') / 1000),
    );

    const source = createParyonPriceSource({
      fetch: async () =>
        new Response(JSON.stringify(RECORDED_PARYON_STATS), { status: 200 }),
    });
    await expect(source.getPrice('MUSD')).rejects.toThrow(
      BchPriceUnavailableError,
    );
  });

  it.skipIf(process.env.BCH_PRICES_LIVE !== '1')(
    'opt-in live network read from Cauldron, Paryon, and Coinbase',
    async () => {
      const [pools, bch, paryon] = await Promise.all([
        fetchCauldronActivePools(BCH_MAINNET_TOKEN_CATEGORIES.PUSD),
        fetchCoinbaseBchUsd(),
        new ParyonStatsClient().readPusdPrice(),
      ]);
      expect(pools.length).toBeGreaterThan(0);
      expect(bch.usdPrice).toBeGreaterThan(0n);
      expect(paryon.usdPrice).toBeGreaterThan(0n);
    },
  );
});
