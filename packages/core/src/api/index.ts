import { z } from 'zod';
import { unixTimestampSeconds } from '../terms.js';

export { unixTimestampSeconds };

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'INVALID_SIGNATURE',
  'TERMS_MISMATCH',
  'AMOUNT_OUT_OF_RANGE',
  'UNSUPPORTED_ROUTE',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'ORDER_NOT_FOUND',
  'LINK_NOT_FOUND',
  'CONFLICT',
  'LINK_RESERVED',
  'LINK_CLOSED',
  'INVALID_ORDER_STATE',
  'QUOTE_EXPIRED',
  'LINK_EXPIRED',
  'REVEAL_NOT_READY',
  'TIMING_INVARIANT_FAILED',
  'RATE_LIMITED',
  'QUOTING_DISABLED',
  'PEG_DEVIATION',
  'STALE_CHAIN_TIP',
  'BCH_TIP_UNHEALTHY',
  'EVM_TIP_UNHEALTHY',
  'INSUFFICIENT_USER_BALANCE',
  'RELAY_LOCK_REVERTED',
  'INSUFFICIENT_INVENTORY',
  'EXPOSURE_LIMIT_EXCEEDED',
  'UPSTREAM_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

export const API_ERROR_HTTP_STATUS: Readonly<Record<ApiErrorCode, number>> =
  Object.freeze({
    BAD_REQUEST: 400,
    VALIDATION_ERROR: 400,
    INVALID_SIGNATURE: 400,
    TERMS_MISMATCH: 400,
    AMOUNT_OUT_OF_RANGE: 400,
    UNSUPPORTED_ROUTE: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    ORDER_NOT_FOUND: 404,
    LINK_NOT_FOUND: 404,
    CONFLICT: 409,
    LINK_RESERVED: 409,
    LINK_CLOSED: 409,
    INVALID_ORDER_STATE: 409,
    QUOTE_EXPIRED: 410,
    LINK_EXPIRED: 410,
    REVEAL_NOT_READY: 425,
    TIMING_INVARIANT_FAILED: 422,
    RATE_LIMITED: 429,
    QUOTING_DISABLED: 503,
    PEG_DEVIATION: 503,
    STALE_CHAIN_TIP: 503,
    BCH_TIP_UNHEALTHY: 503,
    EVM_TIP_UNHEALTHY: 503,
    INSUFFICIENT_USER_BALANCE: 400,
    RELAY_LOCK_REVERTED: 502,
    INSUFFICIENT_INVENTORY: 503,
    EXPOSURE_LIMIT_EXCEEDED: 503,
    UPSTREAM_ERROR: 502,
    INTERNAL_ERROR: 500,
  });

export const ApiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(512),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const HealthResponseSchema = z.strictObject({
  ok: z.boolean(),
  quotingEnabled: z.boolean(),
  timestamp: unixTimestampSeconds,
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const QUOTE_REFUSAL_REASONS = [
  'INSUFFICIENT_LIQUIDITY',
  'PEG_GUARD',
  'PRICE_UNAVAILABLE',
  'ROUTE_DISABLED',
  'OVER_MAX_SWAP',
  'QUOTING_PAUSED',
] as const;

export type QuoteRefusalReason = (typeof QUOTE_REFUSAL_REASONS)[number];

const decimalAmountString = z.string().regex(/^\d+(?:\.\d+)?$/);
const assetSymbol = z.string().min(1).max(32);
const optionalMessage = z.string().min(1).max(256).optional();

export const QuoteRefusalSchema = z.discriminatedUnion('reason', [
  z.strictObject({
    reason: z.literal('INSUFFICIENT_LIQUIDITY'),
    maxAmount: decimalAmountString,
    asset: assetSymbol,
    message: optionalMessage,
  }),
  z.strictObject({
    reason: z.literal('OVER_MAX_SWAP'),
    maxAmount: decimalAmountString,
    asset: assetSymbol,
    message: optionalMessage,
  }),
  z.strictObject({
    reason: z.literal('PEG_GUARD'),
    asset: assetSymbol,
    maxAmount: decimalAmountString.optional(),
    message: optionalMessage,
  }),
  z.strictObject({
    reason: z.literal('PRICE_UNAVAILABLE'),
    asset: assetSymbol,
    maxAmount: decimalAmountString.optional(),
    message: optionalMessage,
  }),
  z.strictObject({
    reason: z.literal('ROUTE_DISABLED'),
    asset: assetSymbol,
    maxAmount: decimalAmountString.optional(),
    message: optionalMessage,
  }),
  z.strictObject({
    reason: z.literal('QUOTING_PAUSED'),
    asset: assetSymbol,
    maxAmount: decimalAmountString.optional(),
    message: optionalMessage,
  }),
]);

export type QuoteRefusal = z.infer<typeof QuoteRefusalSchema>;

export function formatQuoteRefusalMessage(refusal: QuoteRefusal): string {
  switch (refusal.reason) {
    case 'INSUFFICIENT_LIQUIDITY':
      return `Only ${refusal.maxAmount} ${refusal.asset} available; try ${refusal.maxAmount} or less`;
    case 'OVER_MAX_SWAP':
      return `Swap exceeds the ${refusal.maxAmount} ${refusal.asset} maximum; try ${refusal.maxAmount} or less`;
    case 'PEG_GUARD':
      return `Quoting paused for ${refusal.asset} because the peg guard is active`;
    case 'PRICE_UNAVAILABLE':
      return `Live reference price for ${refusal.asset} is temporarily unavailable`;
    case 'ROUTE_DISABLED':
      return `This swap route (${refusal.asset}) is currently disabled`;
    case 'QUOTING_PAUSED':
      return `Quoting for ${refusal.asset} is temporarily paused`;
  }
}

export const RouteLiquiditySchema = z.strictObject({
  route: z.string().min(1).max(64),
  asset: assetSymbol,
  decimals: z.number().int().min(0).max(36),
  available: z.string().regex(/^\d+$/),
  inventory: z.string().regex(/^\d+$/),
  exposure: z.string().regex(/^\d+$/),
  reserved: z.string().regex(/^\d+$/),
});

export type RouteLiquidity = z.infer<typeof RouteLiquiditySchema>;

export const LiquidityResponseSchema = z.strictObject({
  routes: z.array(RouteLiquiditySchema),
  asOf: unixTimestampSeconds,
});

export type LiquidityResponse = z.infer<typeof LiquidityResponseSchema>;
