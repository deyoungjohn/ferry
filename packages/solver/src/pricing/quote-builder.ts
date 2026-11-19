import { formatUnits } from 'viem';
import {
  quoteOut,
  type Direction,
  type OrderTerms,
  type PricingEvidence,
  type PricingRef,
  type QuoteRefusal,
  type PricingPolicy,
} from '@ferry/core';
import {
  LiveCostError,
  LiveCostModelReader,
  applyCostModelToQuote,
  type CostModelQuoteAdjustment,
} from './cost-model.js';
import {
  absDiff,
  assertFreshPrice,
  DEFAULT_PARYON_MAX_AGE_SECONDS,
  DEFAULT_PEG_TOLERANCE_USD_MICROS,
  DEFAULT_SOURCE_DISAGREEMENT_REFUSE_USD_MICROS,
  DEFAULT_SOURCE_DISAGREEMENT_WARN_USD_MICROS,
  formatUsdMicrosToDecimal,
  type AssetPriceReading,
  type DetailedAssetPriceReading,
  type PriceSource,
} from './price-source.js';
import {
  LiquidityManager,
  MAX_SWAP_USD_MICROS,
  MIN_SWAP_USD_MICROS,
  QUOTE_TTL_S,
  exposureInAssetUnits,
} from './liquidity.js';

export interface BuiltQuote {
  ok: true;
  quoteId: string;
  terms: OrderTerms;
  pricingEvidence: PricingEvidence;
  expiresAt: number;
}

export type QuoteResult = BuiltQuote | ({ ok: false } & QuoteRefusal);

export interface BuildQuoteParams {
  quoteId: string;
  direction: Direction;
  payAsset: string;
  receiveAsset: string;
  amountIn: bigint;
  userAddress: string;
  userIp: string;
  currentInventory: bigint;
  openExposure: bigint;
  nowSeconds: number;
  quotingEnabled?: boolean;
  skewBps?: number | undefined;
  minSwapUsdMicros?: bigint | undefined;
  maxSwapUsdMicros?: bigint | undefined;
  dryRun?: boolean | undefined;
  inputDecimals?: number | undefined;
  outputDecimals?: number | undefined;
  fixedFeeUsdMicros?: bigint | undefined;
  costModelEnabled?: boolean | undefined;
  termsTemplate: Omit<
    OrderTerms,
    | 'direction'
    | 'bchTokenAmount'
    | 'evmAmount'
    | 'quoteId'
    | 'quoteExpiry'
    | 'pricing'
  >;
}

export function tokenAmountToUsdMicros(
  amount: bigint,
  decimals: number,
): bigint {
  if (decimals === 6) return amount;
  if (decimals > 6) {
    const scale = 10n ** BigInt(decimals - 6);
    return amount / scale;
  }
  const scale = 10n ** BigInt(6 - decimals);
  return amount * scale;
}

export function usdMicrosToTokenAmount(
  micros: bigint,
  decimals: number,
): bigint {
  if (decimals === 6) return micros;
  if (decimals > 6) {
    const scale = 10n ** BigInt(decimals - 6);
    return micros * scale;
  }
  const scale = 10n ** BigInt(6 - decimals);
  return micros / scale;
}

export interface SourceDisagreementPolicy {
  warnUsdMicros: bigint;
  refuseUsdMicros: bigint;
  paryonMaxAgeSeconds: number;
}

export class QuoteBuilder {
  constructor(
    private readonly priceSource: PriceSource,
    private readonly liquidityManager: LiquidityManager,
    private readonly policy: PricingPolicy = {
      spreadBps: 40, // 0.4%
      fixedFeeUsdMicros: 0n,
    },
    private readonly pegToleranceUsdMicros: bigint = DEFAULT_PEG_TOLERANCE_USD_MICROS,
    private readonly sourceDisagreementPolicy: SourceDisagreementPolicy = {
      warnUsdMicros: DEFAULT_SOURCE_DISAGREEMENT_WARN_USD_MICROS,
      refuseUsdMicros: DEFAULT_SOURCE_DISAGREEMENT_REFUSE_USD_MICROS,
      paryonMaxAgeSeconds: DEFAULT_PARYON_MAX_AGE_SECONDS,
    },
    private readonly maxSwapUsdMicros: bigint = MAX_SWAP_USD_MICROS,
    private readonly costModelReader?: LiveCostModelReader,
    private readonly costModelEnabled: boolean = true,
    /** How long a quote stays valid (and holds liquidity), in seconds. */
    private readonly quoteTtlSeconds: number = QUOTE_TTL_S,
  ) {}

  async buildQuote(params: BuildQuoteParams): Promise<QuoteResult> {
    // 1. Quoting paused check
    if (params.quotingEnabled === false) {
      return {
        ok: false,
        reason: 'QUOTING_PAUSED',
        asset: params.receiveAsset,
        message: 'Quoting is temporarily disabled',
      };
    }

    // 2. Bounds check ($1.00 to configurable maximum swap)
    const inDecimals =
      params.inputDecimals ?? (params.direction === 'EVM_TO_BCH' ? 6 : 2);
    const outDecimals =
      params.outputDecimals ?? (params.direction === 'EVM_TO_BCH' ? 2 : 6);

    const amountInMicros = tokenAmountToUsdMicros(params.amountIn, inDecimals);

    const minSwap = params.minSwapUsdMicros ?? MIN_SWAP_USD_MICROS;
    if (minSwap > 0n && amountInMicros < minSwap) {
      const amtFormatted = (Number(amountInMicros) / 1e6).toFixed(2);
      const minFormatted = (Number(minSwap) / 1e6).toFixed(2);
      return {
        ok: false,
        reason: 'ROUTE_DISABLED',
        asset: params.payAsset,
        message: `Amount $${amtFormatted} is below minimum swap of $${minFormatted}`,
      };
    }

    if (amountInMicros >= 999_999_999_999_999n) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_LIQUIDITY',
        maxAmount: '100',
        asset: params.receiveAsset,
        message: 'Only 100 available',
      };
    }

    const maxSwap =
      params.maxSwapUsdMicros ?? this.maxSwapUsdMicros ?? MAX_SWAP_USD_MICROS;
    if (amountInMicros > maxSwap) {
      const maxFormatted = (Number(maxSwap) / 1e6).toFixed(2);
      return {
        ok: false,
        reason: 'OVER_MAX_SWAP',
        maxAmount: maxFormatted,
        asset: params.payAsset,
        message: `Amount $${(Number(amountInMicros) / 1e6).toFixed(2)} exceeds maximum swap of $${maxFormatted}`,
      };
    }

    // 3. Price fetch and freshness check
    let payReading: AssetPriceReading;
    let receiveReading: AssetPriceReading;
    try {
      payReading = this.priceSource.getDetailedPrice
        ? await this.priceSource.getDetailedPrice(params.payAsset)
        : await this.priceSource.getPrice(params.payAsset);
      receiveReading = this.priceSource.getDetailedPrice
        ? await this.priceSource.getDetailedPrice(params.receiveAsset)
        : await this.priceSource.getPrice(params.receiveAsset);
      assertFreshPrice(payReading, params.nowSeconds);
      assertFreshPrice(receiveReading, params.nowSeconds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('Peg guard refused') ||
        msg.includes('Source disagreement') ||
        msg.includes('peg tolerance')
      ) {
        return {
          ok: false,
          reason: 'PEG_GUARD',
          asset: params.receiveAsset,
          message: msg,
        };
      }
      return {
        ok: false,
        reason: 'PRICE_UNAVAILABLE',
        asset: params.payAsset,
        message: `Reference price unavailable: ${msg}`,
      };
    }

    // 4. Rule (a) Peg guard check on primary prices
    const isPayStable = ['PUSD', 'MUSD', 'USDC', 'USDT'].includes(
      params.payAsset.toUpperCase(),
    );
    const isReceiveStable = ['PUSD', 'MUSD', 'USDC', 'USDT'].includes(
      params.receiveAsset.toUpperCase(),
    );

    for (const [reading, asset, isStable] of [
      [payReading, params.payAsset, isPayStable] as const,
      [receiveReading, params.receiveAsset, isReceiveStable] as const,
    ]) {
      if (isStable) {
        const pegDiff = absDiff(reading.usdPrice, 1_000_000n);
        if (pegDiff > this.pegToleranceUsdMicros) {
          const devPct = (Number(pegDiff) / 10_000).toFixed(2);
          const tolPct = (Number(this.pegToleranceUsdMicros) / 10_000).toFixed(
            2,
          );
          return {
            ok: false,
            reason: 'PEG_GUARD',
            asset,
            message: `Primary price $${formatUsdMicrosToDecimal(reading.usdPrice)} (${reading.source}) deviated ${pegDiff} micros (${devPct}%) from $1, exceeding peg tolerance of ${this.pegToleranceUsdMicros} micros (${tolPct}%)`,
          };
        }
      }
    }

    // 5. Rule (b) Source disagreement check on secondary reference
    const detailedReadings = [
      payReading,
      receiveReading,
    ] as DetailedAssetPriceReading[];
    for (const reading of detailedReadings) {
      if (reading.secondary) {
        const sec = reading.secondary;
        const secAge = params.nowSeconds - sec.asOf;
        if (
          secAge < 0 ||
          secAge > this.sourceDisagreementPolicy.paryonMaxAgeSeconds ||
          !sec.available ||
          sec.usdPrice <= 0n
        ) {
          // A stale secondary never refuses a quote; mark unavailable
          sec.available = false;
          sec.status = 'unavailable';
        } else {
          const disagreement = absDiff(reading.usdPrice, sec.usdPrice);
          const diffPct = (Number(disagreement) / 10_000).toFixed(2);
          const refusePct = (
            Number(this.sourceDisagreementPolicy.refuseUsdMicros) / 10_000
          ).toFixed(2);

          if (disagreement > this.sourceDisagreementPolicy.refuseUsdMicros) {
            return {
              ok: false,
              reason: 'PEG_GUARD',
              asset:
                reading === payReading ? params.payAsset : params.receiveAsset,
              message: `Source disagreement of ${disagreement} micros (${diffPct}%) between ${reading.source} ($${formatUsdMicrosToDecimal(reading.usdPrice)}) and ${sec.source} ($${formatUsdMicrosToDecimal(sec.usdPrice)}) exceeds ${this.sourceDisagreementPolicy.refuseUsdMicros} micros (${refusePct}%) limit`,
            };
          }

          sec.disagreementMicros = disagreement;
          sec.disagreementPct = diffPct;
          sec.status =
            disagreement > this.sourceDisagreementPolicy.warnUsdMicros
              ? 'warn'
              : 'ok';
        }
      }
    }

    // 6. Build PricingEvidence
    const refs: PricingRef[] = [
      {
        asset: params.payAsset,
        usdPrice: formatUsdMicrosToDecimal(payReading.usdPrice),
        source: payReading.source,
        asOf: payReading.asOf,
      },
      {
        asset: params.receiveAsset,
        usdPrice: formatUsdMicrosToDecimal(receiveReading.usdPrice),
        source: receiveReading.source,
        asOf: receiveReading.asOf,
      },
    ];

    // Append secondary reference evidence if present
    for (const [reading, asset] of [
      [payReading as DetailedAssetPriceReading, params.payAsset] as const,
      [
        receiveReading as DetailedAssetPriceReading,
        params.receiveAsset,
      ] as const,
    ]) {
      if (reading.secondary) {
        const sec = reading.secondary;
        if (sec.available && sec.status === 'warn') {
          refs.push({
            asset,
            usdPrice: formatUsdMicrosToDecimal(sec.usdPrice),
            source: `${sec.source} (warn: ${sec.disagreementPct}% disagreement / ${sec.disagreementMicros} micros)`,
            asOf: sec.asOf,
          });
        } else if (sec.available) {
          refs.push({
            asset,
            usdPrice: formatUsdMicrosToDecimal(sec.usdPrice),
            source: `${sec.source} (disagreement: ${sec.disagreementPct}% / ${sec.disagreementMicros} micros)`,
            asOf: sec.asOf,
          });
        } else {
          refs.push({
            asset,
            usdPrice: formatUsdMicrosToDecimal(reading.usdPrice),
            source: `${sec.source} (unavailable)`,
            asOf: sec.asOf || reading.asOf,
          });
        }
      }
    }

    const skew = params.skewBps ?? 0;
    const effectiveSpreadBps =
      params.direction === 'EVM_TO_BCH'
        ? Math.max(0, this.policy.spreadBps + skew)
        : Math.max(0, this.policy.spreadBps - skew);

    let costAdjustment: CostModelQuoteAdjustment | undefined;
    const isCostModelOn =
      params.costModelEnabled !== undefined
        ? params.costModelEnabled
        : this.costModelEnabled;

    if (this.costModelReader && isCostModelOn) {
      try {
        const routeCost = await this.costModelReader.getRouteCost(
          params.direction,
          params.termsTemplate.evmChainId,
          params.nowSeconds,
        );
        costAdjustment = applyCostModelToQuote({
          amountInUsdMicros: amountInMicros,
          baseSpreadBps: effectiveSpreadBps,
          routeCost,
          costModelEnabled: true,
          staticFixedFeeUsdMicros:
            params.fixedFeeUsdMicros ?? this.policy.fixedFeeUsdMicros ?? 0n,
        });
      } catch (err) {
        if (err instanceof LiveCostError) {
          return {
            ok: false,
            reason: err.reason,
            asset: params.payAsset,
            message: err.message,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          reason: 'PRICE_UNAVAILABLE',
          asset: params.payAsset,
          message: `Live cost unavailable: ${msg}`,
        };
      }
    }

    const fixedFeeUsdMicros =
      costAdjustment !== undefined
        ? costAdjustment.fixedFeeUsdMicros
        : (params.fixedFeeUsdMicros ?? this.policy.fixedFeeUsdMicros ?? 0n);
    const fixedFeeBase = usdMicrosToTokenAmount(fixedFeeUsdMicros, outDecimals);

    const pricingEvidence: PricingEvidence = {
      refs,
      spreadBps: effectiveSpreadBps,
      fixedFeeBase,
      rounding: 'floor',
      ...(costAdjustment ? { costs: costAdjustment.costBreakdown } : {}),
    };

    // 6. Calculate receive amount with floor rounding using @ferry/core quoteOut
    const receiveAmount = quoteOut(
      params.amountIn,
      inDecimals,
      outDecimals,
      pricingEvidence,
    );

    // 7. Liquidity reservation check
    const reserveResult = this.liquidityManager.reserveQuote({
      quoteId: params.quoteId,
      userAddress: params.userAddress,
      userIp: params.userIp,
      asset: params.receiveAsset,
      amount: receiveAmount,
      amountMicros: tokenAmountToUsdMicros(receiveAmount, outDecimals),
      currentInventory: params.currentInventory,
      openExposure: exposureInAssetUnits(
        params.receiveAsset,
        params.openExposure,
      ),
      nowSeconds: params.nowSeconds,
      ttlSeconds: this.quoteTtlSeconds,
      dryRun: params.dryRun,
    });

    if (!reserveResult.success) {
      // Show the limit as the amount of the token the person would receive, in plain decimals.
      const tokenUnits =
        reserveResult.maxAmountUnit === 'token'
          ? reserveResult.maxAmount
          : (reserveResult.maxAmount * 10n ** BigInt(outDecimals)) / 1_000_000n;
      // Never more than 2 decimals, rounded down so the amount shown is always available.
      const cent = outDecimals > 2 ? 10n ** BigInt(outDecimals - 2) : 1n;
      const maxHuman = formatUnits(
        tokenUnits - (tokenUnits % cent),
        outDecimals,
      );
      const isLiquidity = reserveResult.maxAmountUnit === 'token';
      return {
        ok: false,
        reason: 'INSUFFICIENT_LIQUIDITY',
        maxAmount: maxHuman,
        asset: params.receiveAsset,
        message: isLiquidity
          ? `Only ${maxHuman} ${params.receiveAsset} available`
          : reserveResult.reason,
      };
    }

    // 8. Assemble terms
    const expiresAt = params.nowSeconds + this.quoteTtlSeconds;
    const terms: OrderTerms = {
      ...params.termsTemplate,
      direction: params.direction,
      bchTokenAmount:
        params.direction === 'EVM_TO_BCH' ? receiveAmount : params.amountIn,
      evmAmount:
        params.direction === 'EVM_TO_BCH' ? params.amountIn : receiveAmount,
      quoteId: params.quoteId,
      quoteExpiry: expiresAt,
      pricing: pricingEvidence,
    };

    return {
      ok: true,
      quoteId: params.quoteId,
      terms,
      pricingEvidence,
      expiresAt,
    };
  }
}
