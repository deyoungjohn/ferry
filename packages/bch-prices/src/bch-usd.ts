import { z } from 'zod';
import {
  BchPriceUnavailableError,
  decimalUsdToMicros,
  fetchJsonWithTimeout,
  type AssetPriceReading,
  type FetchLike,
  type PriceSource,
} from './types.js';

export const DEFAULT_COINBASE_BCH_USD_URL =
  'https://api.coinbase.com/v2/prices/BCH-USD/spot';
export const DEFAULT_KRAKEN_BCH_USD_URL =
  'https://api.kraken.com/0/public/Ticker?pair=BCHUSD';

const CoinbaseSpotSchema = z.object({
  data: z.object({
    amount: z.string().regex(/^\d+(?:\.\d+)?$/),
    base: z.literal('BCH'),
    currency: z.literal('USD'),
  }),
});

const KrakenTickerSchema = z.object({
  error: z.array(z.string()),
  result: z.record(
    z.string(),
    z.object({
      c: z.tuple([z.string().regex(/^\d+(?:\.\d+)?$/), z.string()]),
    }),
  ),
});

export interface BchUsdFetchOptions {
  readonly fetch?: FetchLike;
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly nowSeconds?: () => number;
}

export async function fetchCoinbaseBchUsd(
  options: BchUsdFetchOptions = {},
): Promise<AssetPriceReading> {
  const url = options.url ?? DEFAULT_COINBASE_BCH_USD_URL;
  const raw = await fetchJsonWithTimeout({
    url,
    ...(options.fetch !== undefined ? { fetchFn: options.fetch } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  const parsed = CoinbaseSpotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BchPriceUnavailableError('Unexpected Coinbase BCH-USD response');
  }
  const asOf = Math.floor((options.nowSeconds ?? (() => Date.now() / 1000))());
  return {
    usdPrice: decimalUsdToMicros(parsed.data.data.amount),
    source: 'coinbase-bch-usd',
    asOf,
  };
}

export async function fetchKrakenBchUsd(
  options: BchUsdFetchOptions = {},
): Promise<AssetPriceReading> {
  const url = options.url ?? DEFAULT_KRAKEN_BCH_USD_URL;
  const raw = await fetchJsonWithTimeout({
    url,
    ...(options.fetch !== undefined ? { fetchFn: options.fetch } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  const parsed = KrakenTickerSchema.safeParse(raw);
  if (!parsed.success || parsed.data.error.length > 0) {
    throw new BchPriceUnavailableError('Unexpected Kraken BCHUSD response');
  }
  const pairEntry = Object.values(parsed.data.result)[0];
  if (pairEntry === undefined) {
    throw new BchPriceUnavailableError('Kraken BCHUSD result is empty');
  }
  const asOf = Math.floor((options.nowSeconds ?? (() => Date.now() / 1000))());
  return {
    usdPrice: decimalUsdToMicros(pairEntry.c[0]),
    source: 'kraken-bch-usd',
    asOf,
  };
}

export interface BchUsdSourceOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly nowSeconds?: () => number;
  readonly coinbaseUrl?: string;
  readonly krakenUrl?: string;
}

/**
 * Create a PriceSource for BCH that tries Coinbase first and falls back to Kraken.
 */
export function createBchUsdSource(
  options: BchUsdSourceOptions = {},
): PriceSource {
  return {
    async getPrice(asset: string): Promise<AssetPriceReading> {
      if (asset.toUpperCase() !== 'BCH') {
        throw new BchPriceUnavailableError(
          `BchUsdSource only supports BCH, got ${asset}`,
        );
      }
      try {
        return await fetchCoinbaseBchUsd({
          ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
          ...(options.timeoutMs !== undefined
            ? { timeoutMs: options.timeoutMs }
            : {}),
          ...(options.nowSeconds !== undefined
            ? { nowSeconds: options.nowSeconds }
            : {}),
          ...(options.coinbaseUrl !== undefined
            ? { url: options.coinbaseUrl }
            : {}),
        });
      } catch {
        return fetchKrakenBchUsd({
          ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
          ...(options.timeoutMs !== undefined
            ? { timeoutMs: options.timeoutMs }
            : {}),
          ...(options.nowSeconds !== undefined
            ? { nowSeconds: options.nowSeconds }
            : {}),
          ...(options.krakenUrl !== undefined
            ? { url: options.krakenUrl }
            : {}),
        });
      }
    },
  };
}
