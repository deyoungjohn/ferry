import {
  pegGuard,
  quoteOut,
  type Direction,
  type OrderTerms,
  type PricingEvidence,
  type PricingRef,
  type QuoteRefusal,
  type PricingPolicy,
} from '@ferry/core';
import {
  assertFreshPrice,
  DEFAULT_PEG_TOLERANCE_USD_MICROS,
  type AssetPriceReading,
  type PriceSource,
} from './price-source.js';
import {
  LiquidityManager,
  MAX_SWAP_USD_MICROS,
  MIN_SWAP_USD_MICROS,
  QUOTE_TTL_S,
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
  inputDecimals?: number | undefined;
  outputDecimals?: number | undefined;
  fixedFeeUsdMicros?: bigint | undefined;
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

export function formatUsdMicrosToDecimal(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
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

    // 2. Bounds check ($1.00 to $50.00)
    const inDecimals =
      params.inputDecimals ?? (params.direction === 'EVM_TO_BCH' ? 6 : 2);
    const outDecimals =
      params.outputDecimals ?? (params.direction === 'EVM_TO_BCH' ? 2 : 6);

    const amountInMicros = tokenAmountToUsdMicros(params.amountIn, inDecimals);

    const minSwap = params.minSwapUsdMicros ?? MIN_SWAP_USD_MICROS;
    if (minSwap > 0n && amountInMicros < minSwap) {
      return {
        ok: false,
        reason: 'ROUTE_DISABLED',
        asset: params.payAsset,
        message: `Amount is below minimum swap of $${formatUsdMicrosToDecimal(minSwap)}`,
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
    if (amountInMicros > MAX_SWAP_USD_MICROS) {
      return {
        ok: false,
        reason: 'OVER_MAX_SWAP',
        maxAmount: (MAX_SWAP_USD_MICROS / 1_000_000n).toString(),
        asset: params.payAsset,
        message: 'Amount exceeds maximum swap of $50.00',
      };
    }

    // 3. Price fetch and freshness check
    let payReading: AssetPriceReading;
    let receiveReading: AssetPriceReading;
    try {
      payReading = await this.priceSource.getPrice(params.payAsset);
      receiveReading = await this.priceSource.getPrice(params.receiveAsset);
      assertFreshPrice(payReading, params.nowSeconds);
      assertFreshPrice(receiveReading, params.nowSeconds);
    } catch (err) {
      return {
        ok: false,
        reason: 'PRICE_UNAVAILABLE',
        asset: params.payAsset,
        message: `Reference price unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 4. Peg guard check
    const pricesToCheck = [payReading.usdPrice, receiveReading.usdPrice];
    if (!pegGuard(pricesToCheck, this.pegToleranceUsdMicros)) {
      return {
        ok: false,
        reason: 'PEG_GUARD',
        asset: params.receiveAsset,
        message: 'Stablecoin reference price deviated beyond peg tolerance',
      };
    }

    // 5. Build PricingEvidence
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

    const skew = params.skewBps ?? 0;
    const effectiveSpreadBps =
      params.direction === 'EVM_TO_BCH'
        ? Math.max(0, this.policy.spreadBps + skew)
        : Math.max(0, this.policy.spreadBps - skew);

    const fixedFeeUsdMicros =
      params.fixedFeeUsdMicros ?? this.policy.fixedFeeUsdMicros ?? 0n;
    const fixedFeeBase = usdMicrosToTokenAmount(fixedFeeUsdMicros, outDecimals);

    const pricingEvidence: PricingEvidence = {
      refs,
      spreadBps: effectiveSpreadBps,
      fixedFeeBase,
      rounding: 'floor',
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
      openExposure: params.openExposure,
      nowSeconds: params.nowSeconds,
      ttlSeconds: QUOTE_TTL_S,
    });

    if (!reserveResult.success) {
      const isLiquidity = reserveResult.reason.includes('available');
      return {
        ok: false,
        reason: isLiquidity
          ? 'INSUFFICIENT_LIQUIDITY'
          : 'INSUFFICIENT_LIQUIDITY',
        maxAmount: reserveResult.maxAmount.toString(),
        asset: params.receiveAsset,
        message: isLiquidity
          ? `Only ${reserveResult.maxAmount} ${params.receiveAsset} available`
          : 'Reservation limit exceeded for address/IP',
      };
    }

    // 8. Assemble terms
    const expiresAt = params.nowSeconds + QUOTE_TTL_S;
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
