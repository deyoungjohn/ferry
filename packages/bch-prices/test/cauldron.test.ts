import { describe, expect, it } from 'vitest';
import {
  BCH_MAINNET_TOKEN_CATEGORIES,
  BchPriceUnavailableError,
  CauldronSpotReader,
  aggregateCauldronPools,
  computeCauldronSpotFromReserves,
  createBchPriceSource,
  createCauldronBrowserPriceReader,
  createCauldronPriceSource,
  fetchCauldronActivePools,
  readCauldronSpot,
  type ElectrumPriceClient,
  type FetchLike,
} from '../src/index.js';
import {
  RECORDED_CAULDRON_MUSD_POOLS,
  RECORDED_CAULDRON_PUSD_POOLS,
  RECORDED_COINBASE_BCH_USD,
  RECORDED_PARYON_STATS,
} from './fixtures/recorded-prices.js';

const NOW = 1_794_835_200;

function makeMockFetch(routes: Record<string, unknown>): FetchLike {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [prefix, payload] of Object.entries(routes)) {
      if (url.includes(prefix)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('Not found', { status: 404 });
  };
}

describe('Cauldron spot reader and adapters', () => {
  it('computes exact micro-USD spot price from pool reserves', () => {
    // 253.26168769 BCH and 52,189.92 PUSD at $205.755/BCH
    const spot = computeCauldronSpotFromReserves({
      sats: 25_326_168_769n,
      tokens: 5_218_992n,
      tokenDecimals: 2,
      bchUsdMicros: 205_755_000n,
    });
    expect(spot.bchPerTokenSats).toBe(485_269n);
    expect(spot.usdPriceMicros).toBe(998_465n);
  });

  it('rejects empty or non-positive reserves', () => {
    expect(() =>
      computeCauldronSpotFromReserves({
        sats: 0n,
        tokens: 100n,
        tokenDecimals: 2,
        bchUsdMicros: 200_000_000n,
      }),
    ).toThrow(BchPriceUnavailableError);

    expect(() => aggregateCauldronPools([{ sats: 0n, tokens: 100n }])).toThrow(
      BchPriceUnavailableError,
    );
  });

  it('reads Cauldron spot from an Electrum quorum client (readCauldronSpot)', async () => {
    const fakeElectrum: ElectrumPriceClient = {
      async listUnspent(scriptHash) {
        if (scriptHash === 'sh-pool-1') {
          return [
            {
              tx_hash: 'aa'.repeat(32),
              tx_pos: 0,
              value: 25_326_168_769,
              token_data: {
                category: BCH_MAINNET_TOKEN_CATEGORIES.PUSD,
                amount: '5218992',
              },
            },
          ];
        }
        return [
          {
            tx_hash: 'bb'.repeat(32),
            tx_pos: 1,
            value: 6_985_994,
            token_data: {
              category: BCH_MAINNET_TOKEN_CATEGORIES.PUSD,
              amount: 1437,
            },
          },
        ];
      },
    };

    const spot = await readCauldronSpot(fakeElectrum, {
      scriptHashes: ['sh-pool-1', 'sh-pool-2'],
      tokenCategory: BCH_MAINNET_TOKEN_CATEGORIES.PUSD,
      bchUsdMicros: 205_755_000n,
      nowSeconds: () => NOW,
    });

    expect(spot.source).toBe('cauldron');
    expect(spot.poolCount).toBe(2);
    expect(spot.sats).toBe(25_333_154_763n);
    expect(spot.tokens).toBe(5_220_429n);
    expect(spot.asOf).toBe(NOW);
    expect(spot.usdPrice).toBeGreaterThan(990_000n);
    expect(spot.usdPrice).toBeLessThan(1_010_000n);
  });

  it('fetches active pools and adapts to solver PriceSource and browser PriceReader', async () => {
    const mockFetch = makeMockFetch({
      [BCH_MAINNET_TOKEN_CATEGORIES.PUSD]: RECORDED_CAULDRON_PUSD_POOLS,
      [BCH_MAINNET_TOKEN_CATEGORIES.MUSD]: RECORDED_CAULDRON_MUSD_POOLS,
      'coinbase.com': RECORDED_COINBASE_BCH_USD,
      'paryonusd.com': RECORDED_PARYON_STATS,
    });

    const pools = await fetchCauldronActivePools(
      BCH_MAINNET_TOKEN_CATEGORIES.PUSD,
      { fetch: mockFetch },
    );
    expect(pools).toHaveLength(2);

    const composite = createBchPriceSource({
      fetch: mockFetch,
      nowSeconds: () => NOW,
    });

    const pusd = await composite.getPrice('PUSD');
    expect(pusd.source).toBe('cauldron');
    expect(pusd.usdPrice).toBeGreaterThan(990_000n);
    expect(pusd.asOf).toBe(NOW);

    const musd = await composite.getPrice('MUSD');
    expect(musd.source).toBe('cauldron');
    expect(musd.usdPrice).toBeGreaterThan(990_000n);

    const paryon = await composite.getPrice('PUSD_PARYON');
    expect(paryon.source).toBe('paryon');
    expect(paryon.usdPrice).toBe(998_018n);

    const browserReader = createCauldronBrowserPriceReader({
      bchUsdSource: composite,
      fetch: mockFetch,
      nowSeconds: () => NOW,
    });
    const browserReading = await browserReader.readPrice('PUSD');
    expect(browserReading.asset).toBe('PUSD');
    expect(browserReading.usdPrice).toMatch(/^0\.99\d{4}$/);
    expect(browserReading.source).toBe('cauldron');

    const spotReader = new CauldronSpotReader({
      bchUsdSource: composite,
      fetch: mockFetch,
      nowSeconds: () => NOW,
    });
    expect((await spotReader.readSpot('PUSD')).poolCount).toBe(2);

    const cauldronSource = createCauldronPriceSource({
      bchUsdSource: composite,
      fetch: mockFetch,
      nowSeconds: () => NOW,
    });
    await expect(cauldronSource.getPrice('USDC')).rejects.toThrow(
      BchPriceUnavailableError,
    );
  });
});
