import {
  createBchPriceSource,
  evaluatePegGuard,
  type PriceSource as BchPriceSource,
} from '@ferry/bch-prices';
import type { ChainConfig, ChainId } from '@ferry/chain-config';
import type { PublicClient } from 'viem';
import { chainlinkSourceFromConfig } from './chainlink.js';
import {
  PriceUnavailableError,
  type AssetPriceReading,
  type PriceSource,
} from './price-source.js';

export interface RoutePriceSourceOptions {
  chainConfig: ChainConfig;
  evmClients?: Map<ChainId, PublicClient> | undefined;
  bchSource?: BchPriceSource | undefined;
  evmSources?: Map<string, PriceSource> | undefined;
  nowSeconds?: () => number;
  pegToleranceUsdMicros?: bigint;
}

export class RoutePriceSource implements PriceSource {
  private readonly bchSource: BchPriceSource;
  private readonly evmSources = new Map<string, PriceSource>();
  private readonly nowSeconds: () => number;
  private readonly pegToleranceUsdMicros: bigint;

  constructor(options: RoutePriceSourceOptions) {
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.pegToleranceUsdMicros = options.pegToleranceUsdMicros ?? 20_000n; // 2% ($0.02)

    this.bchSource =
      options.bchSource ??
      createBchPriceSource({
        nowSeconds: this.nowSeconds,
      });

    if (options.evmSources) {
      for (const [key, src] of options.evmSources.entries()) {
        this.evmSources.set(key.toLowerCase(), src);
      }
    }

    if (options.evmClients) {
      for (const [chainId, client] of options.evmClients.entries()) {
        try {
          const chainlink = chainlinkSourceFromConfig(
            options.chainConfig,
            chainId,
            client,
            { nowSeconds: this.nowSeconds },
          );
          this.evmSources.set(chainId.toLowerCase(), chainlink);
        } catch {
          // If no chain config or feeds exist, route-level queries will fail closed with PriceUnavailableError
        }
      }
    }
  }

  async getPrice(asset: string, chainId?: string): Promise<AssetPriceReading> {
    const symbol = asset.toUpperCase();

    // 1. BCH Stablecoins & BCH
    if (symbol === 'PUSD' || symbol === 'MUSD' || symbol === 'BCH') {
      try {
        const reading = await this.bchSource.getPrice(symbol);
        if (symbol === 'PUSD' || symbol === 'MUSD') {
          // Verify peg guard
          const evaluation = evaluatePegGuard({
            readings: [reading],
            toleranceUsdMicros: this.pegToleranceUsdMicros,
            nowSeconds: this.nowSeconds(),
            maxAgeSeconds: 300,
          });
          if (evaluation.status === 'refuse') {
            throw new PriceUnavailableError(
              `Peg guard refused ${symbol} price (${reading.usdPrice}): ${evaluation.reason ?? 'deviation'}`,
            );
          }
        }
        return {
          usdPrice: reading.usdPrice,
          source: reading.source,
          asOf: reading.asOf,
          heartbeatSeconds: reading.heartbeatSeconds,
        };
      } catch (err) {
        if (err instanceof PriceUnavailableError) throw err;
        throw new PriceUnavailableError(
          `BCH price source unavailable for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. EVM Stablecoins (USDC, USDT)
    if (symbol === 'USDC' || symbol === 'USDT') {
      const targetChain = (chainId ?? 'base').toLowerCase();
      const evmSource =
        this.evmSources.get(targetChain) ??
        this.evmSources.get(symbol.toLowerCase());
      if (!evmSource) {
        throw new PriceUnavailableError(
          `No price source configured for EVM asset ${symbol} on chain ${targetChain}`,
        );
      }
      return evmSource.getPrice(symbol);
    }

    throw new PriceUnavailableError(`Unsupported asset for pricing: ${asset}`);
  }
}
