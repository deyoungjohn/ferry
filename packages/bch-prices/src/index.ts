export * from './types.js';
export * from './bch-usd.js';
export * from './paryon.js';
export * from './cauldron.js';
export * from './peg-guard.js';
export * from './inventory.js';

import { createBchUsdSource } from './bch-usd.js';
import { createCauldronPriceSource } from './cauldron.js';
import { createParyonPriceSource } from './paryon.js';
import {
  BchPriceUnavailableError,
  type AssetPriceReading,
  type FetchLike,
  type PriceSource,
} from './types.js';

export interface CompositeBchPriceSourceOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly nowSeconds?: () => number;
  readonly cauldronIndexerUrl?: string;
  readonly paryonUrl?: string;
  readonly bchUsdSource?: PriceSource;
}

/**
 * Convenience PriceSource adapter for @ferry/solver:
 * - 'PUSD' / 'MUSD' -> Cauldron spot
 * - 'PUSD_PARYON'   -> Paryon stats API
 * - 'BCH'           -> Coinbase/Kraken BCH-USD
 */
export function createBchPriceSource(
  options: CompositeBchPriceSourceOptions = {},
): PriceSource {
  const bchUsd =
    options.bchUsdSource ??
    createBchUsdSource({
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
      ...(options.nowSeconds !== undefined
        ? { nowSeconds: options.nowSeconds }
        : {}),
    });
  const cauldron = createCauldronPriceSource({
    bchUsdSource: bchUsd,
    ...(options.cauldronIndexerUrl !== undefined
      ? { indexerUrl: options.cauldronIndexerUrl }
      : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options.nowSeconds !== undefined
      ? { nowSeconds: options.nowSeconds }
      : {}),
  });
  const paryon = createParyonPriceSource({
    ...(options.paryonUrl !== undefined ? { url: options.paryonUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(options.nowSeconds !== undefined
      ? { nowSeconds: options.nowSeconds }
      : {}),
  });

  return {
    async getPrice(asset: string): Promise<AssetPriceReading> {
      const upper = asset.toUpperCase();
      if (upper === 'BCH') return bchUsd.getPrice('BCH');
      if (upper === 'PUSD' || upper === 'MUSD') return cauldron.getPrice(upper);
      if (upper === 'PUSD_PARYON' || upper === 'PARYON') {
        return paryon.getPrice('PUSD');
      }
      throw new BchPriceUnavailableError(
        `Unsupported BCH price asset: ${asset}`,
      );
    },
  };
}
