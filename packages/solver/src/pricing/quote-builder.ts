import {
  pegGuard,
  quoteExactIn,
  type Direction,
  type OrderTerms,
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

/**
 * Replaceable local PricingEvidence type until @ferry/core B1-04 is merged.
 * Matches blueprint §3.5 and FR-17 checkable pricing.
 */
export interface PricingEvidence {
  sources: AssetPriceReading[];
  spreadBps: number;
  fixedFeeUsdMicros: bigint;
  calculatedAt: number;
}

export type QuoteRefusalReason =
  | 'INSUFFICIENT_LIQUIDITY'
  | 'PEG_GUARD'
  | 'PRICE_UNAVAILABLE'
  | 'ROUTE_DISABLED'
  | 'OVER_MAX_SWAP'
  | 'UNDER_MIN_SWAP'
  | 'QUOTING_PAUSED'
  | 'RESERVATION_LIMIT_EXCEEDED';

export interface QuoteRefusal {
  ok: false;
  reason: QuoteRefusalReason;
  maxAmount?: bigint | undefined;
  asset?: string | undefined;
  message: string;
}

export interface BuiltQuote {
  ok: true;
  quoteId: string;
  terms: OrderTerms;
  pricingEvidence: PricingEvidence;
  expiresAt: number;
}

export type QuoteResult = BuiltQuote | QuoteRefusal;

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
  termsTemplate: Omit<
    OrderTerms,
    'direction' | 'bchTokenAmount' | 'evmAmount' | 'quoteId' | 'quoteExpiry'
  >;
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
        message: 'Quoting is temporarily disabled',
      };
    }

    // 2. Bounds check ($1.00 to $50.00)
    const amountInMicros =
      params.direction === 'EVM_TO_BCH'
        ? params.amountIn // EVM USDC (6 decimals) is already in micros
        : params.amountIn * 10_000n; // PUSD (2 decimals) -> 6 decimals

    if (amountInMicros < MIN_SWAP_USD_MICROS) {
      return {
        ok: false,
        reason: 'UNDER_MIN_SWAP',
        message: 'Amount is below minimum swap of $1.00',
      };
    }
    if (amountInMicros > MAX_SWAP_USD_MICROS) {
      return {
        ok: false,
        reason: 'OVER_MAX_SWAP',
        maxAmount: MAX_SWAP_USD_MICROS,
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
        message: `Reference price unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 4. Peg guard check
    const pricesToCheck = [payReading.usdPrice, receiveReading.usdPrice];
    if (!pegGuard(pricesToCheck, this.pegToleranceUsdMicros)) {
      return {
        ok: false,
        reason: 'PEG_GUARD',
        message: 'Stablecoin reference price deviated beyond peg tolerance',
      };
    }

    // 5. Calculate receive amount with floor rounding in solver's favour
    const fromDecimals = params.direction === 'EVM_TO_BCH' ? 6 : 2;
    const toDecimals = params.direction === 'EVM_TO_BCH' ? 2 : 6;
    const receiveAmount = quoteExactIn(
      params.amountIn,
      fromDecimals,
      toDecimals,
      this.policy,
    );

    // 6. Liquidity reservation check
    const reserveResult = this.liquidityManager.reserveQuote({
      quoteId: params.quoteId,
      userAddress: params.userAddress,
      userIp: params.userIp,
      asset: params.receiveAsset,
      amount: receiveAmount,
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
          : 'RESERVATION_LIMIT_EXCEEDED',
        maxAmount: reserveResult.maxAmount,
        asset: params.receiveAsset,
        message: reserveResult.reason,
      };
    }

    // 7. Assemble terms and PricingEvidence
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
    };

    const pricingEvidence: PricingEvidence = {
      sources: [payReading, receiveReading],
      spreadBps: this.policy.spreadBps,
      fixedFeeUsdMicros: this.policy.fixedFeeUsdMicros,
      calculatedAt: params.nowSeconds,
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
