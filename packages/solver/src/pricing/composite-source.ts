import {
  createBchPriceSource,
  type PriceSource as BchPriceSource,
} from '@ferry/bch-prices';
import type { ChainConfig, ChainId } from '@ferry/chain-config';
import type { PublicClient } from 'viem';
import { chainlinkSourceFromConfig } from '@ferry/evm-prices';
import {
  absDiff,
  assertFreshPrice,
  DEFAULT_CAULDRON_MAX_AGE_SECONDS,
  DEFAULT_PARYON_MAX_AGE_SECONDS,
  DEFAULT_PEG_TOLERANCE_USD_MICROS,
  DEFAULT_SOURCE_DISAGREEMENT_REFUSE_USD_MICROS,
  DEFAULT_SOURCE_DISAGREEMENT_WARN_USD_MICROS,
  formatUsdMicrosToDecimal,
  PriceUnavailableError,
  type AssetPriceReading,
  type DetailedAssetPriceReading,
  type PriceSource,
  type SecondaryPriceReading,
} from './price-source.js';

export interface RoutePriceSourceOptions {
  chainConfig: ChainConfig;
  evmClients?: Map<ChainId, PublicClient> | undefined;
  bchSource?: BchPriceSource | undefined;
  paryonSource?: BchPriceSource | undefined;
  evmSources?: Map<string, PriceSource> | undefined;
  nowSeconds?: () => number;
  pegToleranceUsdMicros?: bigint;
  sourceDisagreementWarnUsdMicros?: bigint;
  sourceDisagreementRefuseUsdMicros?: bigint;
  paryonMaxAgeSeconds?: number;
  cauldronMaxAgeSeconds?: number;
  usdgPegRefusalToleranceUsdMicros?: bigint;
  usdgPegPriceUsdMicros?: bigint;
}

export class RoutePriceSource implements PriceSource {
  private readonly bchSource: BchPriceSource;
  private readonly paryonSource?: BchPriceSource | undefined;
  private readonly evmSources = new Map<string, PriceSource>();
  private readonly nowSeconds: () => number;
  private readonly pegToleranceUsdMicros: bigint;
  private readonly sourceDisagreementWarnUsdMicros: bigint;
  private readonly sourceDisagreementRefuseUsdMicros: bigint;
  private readonly paryonMaxAgeSeconds: number;
  private readonly cauldronMaxAgeSeconds: number;
  private readonly usdgPegRefusalToleranceUsdMicros?: bigint | undefined;
  private readonly usdgPegPriceUsdMicros?: bigint | undefined;

  constructor(options: RoutePriceSourceOptions) {
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.pegToleranceUsdMicros =
      options.pegToleranceUsdMicros ?? DEFAULT_PEG_TOLERANCE_USD_MICROS;
    this.sourceDisagreementWarnUsdMicros =
      options.sourceDisagreementWarnUsdMicros ??
      DEFAULT_SOURCE_DISAGREEMENT_WARN_USD_MICROS;
    this.sourceDisagreementRefuseUsdMicros =
      options.sourceDisagreementRefuseUsdMicros ??
      DEFAULT_SOURCE_DISAGREEMENT_REFUSE_USD_MICROS;
    this.paryonMaxAgeSeconds =
      options.paryonMaxAgeSeconds ?? DEFAULT_PARYON_MAX_AGE_SECONDS;
    this.cauldronMaxAgeSeconds =
      options.cauldronMaxAgeSeconds ?? DEFAULT_CAULDRON_MAX_AGE_SECONDS;
    const envTolerance =
      typeof process !== 'undefined' &&
      process.env.USDG_PEG_REFUSAL_TOLERANCE_USD_MICROS
        ? BigInt(process.env.USDG_PEG_REFUSAL_TOLERANCE_USD_MICROS)
        : undefined;
    this.usdgPegRefusalToleranceUsdMicros =
      options.usdgPegRefusalToleranceUsdMicros ?? envTolerance;
    this.usdgPegPriceUsdMicros = options.usdgPegPriceUsdMicros;

    this.bchSource =
      options.bchSource ??
      createBchPriceSource({
        nowSeconds: this.nowSeconds,
      });
    this.paryonSource = options.paryonSource;

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

  async getDetailedPrice(
    asset: string,
    chainId?: string,
  ): Promise<DetailedAssetPriceReading> {
    const symbol = asset.toUpperCase();
    const now = this.nowSeconds();

    // 1. BCH Stablecoins (PUSD, MUSD) & BCH spot
    if (symbol === 'PUSD' || symbol === 'MUSD' || symbol === 'BCH') {
      try {
        // Primary price: Cauldron on-chain spot (or BCH-USD for BCH)
        const primary = await this.bchSource.getPrice(symbol);
        if (!primary || primary.usdPrice <= 0n) {
          throw new PriceUnavailableError(
            `Invalid price reading for primary ${symbol} source`,
          );
        }

        const maxAge = symbol === 'BCH' ? 60 : this.cauldronMaxAgeSeconds;
        assertFreshPrice(primary, now, maxAge);

        // Rule (a) Peg guard: refuse when primary price is more than PEG_TOLERANCE from $1
        if (symbol === 'PUSD' || symbol === 'MUSD') {
          const pegDiff = absDiff(primary.usdPrice, 1_000_000n);
          if (pegDiff > this.pegToleranceUsdMicros) {
            const devPct = (Number(pegDiff) / 10_000).toFixed(2);
            const tolPct = (
              Number(this.pegToleranceUsdMicros) / 10_000
            ).toFixed(2);
            throw new PriceUnavailableError(
              `Peg guard refused ${symbol} primary price ($${formatUsdMicrosToDecimal(primary.usdPrice)} from ${primary.source}): deviated ${pegDiff} micros (${devPct}%) from $1, exceeding peg tolerance of ${this.pegToleranceUsdMicros} micros (${tolPct}%)`,
            );
          }
        }

        // Secondary reference (Paryon) for PUSD
        let secondary: SecondaryPriceReading | undefined;
        if (symbol === 'PUSD') {
          try {
            const paryonReading = this.paryonSource
              ? await this.paryonSource.getPrice('PUSD')
              : await this.bchSource.getPrice('PUSD_PARYON');

            const age = now - paryonReading.asOf;
            if (
              age < 0 ||
              age > this.paryonMaxAgeSeconds ||
              paryonReading.usdPrice <= 0n
            ) {
              // Stale secondary: NEVER refuses a quote! Shown as unavailable.
              secondary = {
                usdPrice:
                  paryonReading.usdPrice > 0n
                    ? paryonReading.usdPrice
                    : primary.usdPrice,
                source: 'paryon',
                asOf: paryonReading.asOf,
                available: false,
                status: 'unavailable',
                refusalRule: `source_disagreement (warn > ${(Number(this.sourceDisagreementWarnUsdMicros) / 10_000).toFixed(2)}%, refuse > ${(Number(this.sourceDisagreementRefuseUsdMicros) / 10_000).toFixed(2)}%)`,
                reason: `stale (${age}s old, max ${this.paryonMaxAgeSeconds}s)`,
              };
            } else {
              // Fresh secondary: evaluate Rule (b) source disagreement
              const disagreementMicros = absDiff(
                primary.usdPrice,
                paryonReading.usdPrice,
              );
              const diffPct = (Number(disagreementMicros) / 10_000).toFixed(2);
              const refusePct = (
                Number(this.sourceDisagreementRefuseUsdMicros) / 10_000
              ).toFixed(2);
              const warnPct = (
                Number(this.sourceDisagreementWarnUsdMicros) / 10_000
              ).toFixed(2);

              if (disagreementMicros > this.sourceDisagreementRefuseUsdMicros) {
                // Disagreement > refuse limit: refuse quote!
                throw new PriceUnavailableError(
                  `Source disagreement of ${disagreementMicros} micros (${diffPct}%) between cauldron ($${formatUsdMicrosToDecimal(primary.usdPrice)}) and paryon ($${formatUsdMicrosToDecimal(paryonReading.usdPrice)}) exceeds ${this.sourceDisagreementRefuseUsdMicros} micros (${refusePct}%) limit`,
                );
              }

              const isWarn =
                disagreementMicros > this.sourceDisagreementWarnUsdMicros;
              secondary = {
                usdPrice: paryonReading.usdPrice,
                source: 'paryon',
                asOf: paryonReading.asOf,
                available: true,
                status: isWarn ? 'warn' : 'ok',
                disagreementMicros,
                disagreementPct: diffPct,
                refusalRule: `source_disagreement (warn > ${warnPct}%, refuse > ${refusePct}%)`,
                reason: isWarn
                  ? `approaching tolerance (${diffPct}% disagreement / ${disagreementMicros} micros)`
                  : undefined,
              };
            }
          } catch (err) {
            if (
              err instanceof PriceUnavailableError &&
              err.message.includes('Source disagreement')
            ) {
              throw err;
            }
            // A missing or failed secondary reference never refuses a quote; shown as unavailable
            secondary = {
              usdPrice: primary.usdPrice,
              source: 'paryon',
              asOf: now,
              available: false,
              status: 'unavailable',
              refusalRule: `source_disagreement (warn > ${(Number(this.sourceDisagreementWarnUsdMicros) / 10_000).toFixed(2)}%, refuse > ${(Number(this.sourceDisagreementRefuseUsdMicros) / 10_000).toFixed(2)}%)`,
              reason: `unavailable: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }

        return {
          usdPrice: primary.usdPrice,
          source: primary.source,
          asOf: primary.asOf,
          heartbeatSeconds: primary.heartbeatSeconds,
          role: 'primary',
          primary,
          secondary,
        };
      } catch (err) {
        if (err instanceof PriceUnavailableError) throw err;
        throw new PriceUnavailableError(
          `BCH price source unavailable for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. EVM Stablecoins (USDC, USDT, USDG)
    if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'USDG') {
      const targetChain = (
        chainId ?? (symbol === 'USDG' ? 'robinhood' : 'base')
      ).toLowerCase();
      const evmSource =
        this.evmSources.get(targetChain) ??
        this.evmSources.get(symbol.toLowerCase());

      let reading: AssetPriceReading;
      if (evmSource) {
        try {
          reading = await evmSource.getPrice(symbol);
          assertFreshPrice(reading, now);
        } catch (err) {
          if (symbol === 'USDG') {
            reading = this.getUsdgPegReading(now);
          } else {
            throw err;
          }
        }
      } else if (symbol === 'USDG') {
        reading = this.getUsdgPegReading(now);
      } else {
        throw new PriceUnavailableError(
          `No price source configured for EVM asset ${symbol} on chain ${targetChain}`,
        );
      }

      // Rule (a) Peg guard on primary EVM asset
      const pegDiff = absDiff(reading.usdPrice, 1_000_000n);
      const tolerance =
        symbol === 'USDG' && this.usdgPegRefusalToleranceUsdMicros !== undefined
          ? this.usdgPegRefusalToleranceUsdMicros
          : this.pegToleranceUsdMicros;

      if (pegDiff > tolerance) {
        const devPct = (Number(pegDiff) / 10_000).toFixed(2);
        const tolPct = (Number(tolerance) / 10_000).toFixed(2);
        throw new PriceUnavailableError(
          `Peg guard refused ${symbol} primary price ($${formatUsdMicrosToDecimal(reading.usdPrice)} from ${reading.source}): deviated ${pegDiff} micros (${devPct}%) from $1, exceeding peg tolerance of ${tolerance} micros (${tolPct}%)`,
        );
      }

      return {
        usdPrice: reading.usdPrice,
        source: reading.source,
        asOf: reading.asOf,
        heartbeatSeconds: reading.heartbeatSeconds,
        role: 'primary',
        primary: reading,
      };
    }

    throw new PriceUnavailableError(`Unsupported asset for pricing: ${asset}`);
  }

  private getUsdgPegReading(now: number): AssetPriceReading {
    const envPrice =
      typeof process !== 'undefined' && process.env.USDG_PEG_USD_MICROS
        ? BigInt(process.env.USDG_PEG_USD_MICROS)
        : undefined;
    const usdPrice = this.usdgPegPriceUsdMicros ?? envPrice ?? 1_000_000n;
    return {
      usdPrice,
      source: 'usdg-peg-assumption',
      asOf: now,
      role: 'primary',
    };
  }

  async getPrice(asset: string, chainId?: string): Promise<AssetPriceReading> {
    return this.getDetailedPrice(asset, chainId);
  }
}
