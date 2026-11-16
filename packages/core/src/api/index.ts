import { isAddress } from 'viem';
import { z } from 'zod';
import {
  PricingEvidenceSchema,
  unixTimestampSeconds,
  type Hex,
  type Hex32,
} from '../terms.js';

export { unixTimestampSeconds };

const hexSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .max(20002)
  .transform((value) => value.toLowerCase() as Hex);

const hex32Schema = hexSchema.refine(
  (value) => value.length === 66,
  'Expected exactly 32 bytes',
) as z.ZodType<Hex32>;

const evmAddressSchema = z
  .string()
  .refine((value) => isAddress(value), 'Malformed EVM address')
  .transform((value) => value.toLowerCase() as Hex);

const positiveUint = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonNegInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const textSchema = z.string().min(1).max(256);

const uint256Json = z
  .union([
    z.bigint(),
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n && value <= (1n << 256n) - 1n, {
    message: 'Expected positive uint256',
  });

const nonNegUint256Json = z
  .union([
    z.bigint(),
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value >= 0n && value <= (1n << 256n) - 1n, {
    message: 'Expected non-negative uint256',
  });

const uint64Json = z
  .union([
    z.bigint(),
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative(),
  ])
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n && value <= (1n << 64n) - 1n, {
    message: 'Expected positive uint64',
  });

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
  tips: z
    .strictObject({
      bchHeight: nonNegInt,
      evmBlocks: z.record(z.string(), nonNegInt).optional(),
    })
    .optional(),
  tipAges: z
    .strictObject({
      bchSeconds: nonNegInt,
      evmSeconds: z.record(z.string(), nonNegInt).optional(),
    })
    .optional(),
  inventory: z.record(z.string(), z.string()).optional(),
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

export const PricingEvidenceJsonSchema = PricingEvidenceSchema.extend({
  fixedFeeBase: nonNegUint256Json,
});

export const OrderTermsJsonSchema = z
  .strictObject({
    version: z.literal(1),
    direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
    bchToken: z.enum(['PUSD', 'MUSD']),
    bchTokenCategory: hex32Schema,
    bchTokenAmount: uint256Json,
    evmAmount: uint256Json,
    evmToken: evmAddressSchema,
    evmChainId: positiveUint,
    evmHtlc: evmAddressSchema,
    userEvmAddress: evmAddressSchema,
    userBchLockingBytecode: hexSchema,
    solverEvmAddress: evmAddressSchema,
    solverBchLockingBytecode: hexSchema,
    hashLock: hex32Schema,
    evmDeadline: unixTimestampSeconds,
    bchRefundHeight: positiveUint.max(499_999_999),
    bchCarrySats: uint64Json,
    bchMaxFee: nonNegUint256Json,
    quoteId: textSchema,
    quoteExpiry: unixTimestampSeconds,
    pricing: PricingEvidenceJsonSchema.optional(),
  })
  .superRefine((terms, ctx) => {
    if (terms.bchMaxFee > terms.bchCarrySats) {
      ctx.addIssue({
        code: 'custom',
        message: 'bchMaxFee exceeds bchCarrySats',
        path: ['bchMaxFee'],
      });
    }
  });

export const QuoteRequestSchema = z.strictObject({
  direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
  token: z.enum(['PUSD', 'MUSD']),
  chainId: positiveUint,
  evmToken: evmAddressSchema,
  amountIn: uint256Json,
  userEvmAddress: evmAddressSchema,
  userBchLockingBytecode: hexSchema,
  hashLock: hex32Schema,
  lane: z.enum(['fast', 'safe']),
  fastOptIn: z.boolean().optional(),
});

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const QuoteResponseSchema = z.strictObject({
  orderId: hex32Schema,
  terms: OrderTermsJsonSchema,
  signature: hexSchema,
  signerAddress: evmAddressSchema,
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export const OrderStatusTxidsSchema = z.strictObject({
  evmLock: hex32Schema.optional(),
  evmClaim: hex32Schema.optional(),
  evmRefund: hex32Schema.optional(),
  bchLock: hex32Schema.optional(),
  bchClaim: hex32Schema.optional(),
  bchRefund: hex32Schema.optional(),
});

export type OrderStatusTxids = z.infer<typeof OrderStatusTxidsSchema>;

export const OrderStatusResponseSchema = z.strictObject({
  orderId: hex32Schema,
  state: z.string().min(1).max(64),
  direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']).optional(),
  txids: OrderStatusTxidsSchema,
  quoteExpiry: unixTimestampSeconds,
  counterDeadline: unixTimestampSeconds,
  bchRefundHeight: positiveUint,
  updatedAt: unixTimestampSeconds,
});

export type OrderStatusResponse = z.infer<typeof OrderStatusResponseSchema>;

export const RevealSecretRequestSchema = z.strictObject({
  secret: hex32Schema,
});

export type RevealSecretRequest = z.infer<typeof RevealSecretRequestSchema>;

export const RevealSecretResponseSchema = z.strictObject({
  ok: z.boolean(),
  orderId: hex32Schema,
  state: z.string().min(1).max(64).optional(),
  updatedAt: unixTimestampSeconds.optional(),
});

export type RevealSecretResponse = z.infer<typeof RevealSecretResponseSchema>;

export const RelayLockRequestSchema = z.strictObject({
  permit: z
    .strictObject({
      value: uint256Json,
      deadline: unixTimestampSeconds,
      v: nonNegInt,
      r: hex32Schema,
      s: hex32Schema,
    })
    .optional(),
  intent: z.strictObject({
    orderId: hex32Schema,
    deadline: unixTimestampSeconds,
    nonce: nonNegUint256Json.optional(),
  }),
  signature: hexSchema,
});

export type RelayLockRequest = z.infer<typeof RelayLockRequestSchema>;

export const RelayLockResponseSchema = z.strictObject({
  ok: z.boolean(),
  orderId: hex32Schema,
  txHash: hex32Schema,
  updatedAt: unixTimestampSeconds.optional(),
});

export type RelayLockResponse = z.infer<typeof RelayLockResponseSchema>;

export const RelayClaimRequestSchema = z.strictObject({
  secret: hex32Schema,
  lockId: hex32Schema.optional(),
});

export type RelayClaimRequest = z.infer<typeof RelayClaimRequestSchema>;

export const RelayClaimResponseSchema = z.strictObject({
  ok: z.boolean(),
  orderId: hex32Schema,
  txHash: hex32Schema,
  updatedAt: unixTimestampSeconds.optional(),
});

export type RelayClaimResponse = z.infer<typeof RelayClaimResponseSchema>;

export const ChainTokenInfoSchema = z.strictObject({
  symbol: assetSymbol,
  address: evmAddressSchema,
  decimals: z.number().int().min(0).max(36),
  permit: z.boolean(),
});

export const ChainInfoSchema = z.strictObject({
  chainId: positiveUint,
  name: textSchema,
  enabled: z.boolean(),
  confirmations: z.strictObject({
    fast: positiveUint,
    safe: positiveUint,
  }),
  tokens: z.array(ChainTokenInfoSchema),
});

export const ChainsResponseSchema = z.strictObject({
  chains: z.array(ChainInfoSchema),
  asOf: unixTimestampSeconds.optional(),
});

export type ChainsResponse = z.infer<typeof ChainsResponseSchema>;

export const StatsResponseSchema = z.strictObject({
  completedSwaps: nonNegInt,
  totalVolumeUsd: decimalAmountString,
  medianFastSeconds: nonNegInt,
  quotePolicy: z
    .strictObject({
      spreadBps: z.number().int().min(0).max(9999),
      fixedFeeBase: z.string().regex(/^\d+$/),
      minUsd: decimalAmountString.optional(),
      maxUsd: decimalAmountString.optional(),
    })
    .optional(),
  asOf: unixTimestampSeconds,
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

export const RecentOrderItemSchema = z.strictObject({
  orderId: hex32Schema,
  direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
  bchToken: z.enum(['PUSD', 'MUSD']),
  evmChainId: positiveUint,
  bchTokenAmount: z.string().regex(/^\d+$/),
  evmAmount: z.string().regex(/^\d+$/),
  settledAt: unixTimestampSeconds,
  durationSeconds: nonNegInt,
});

export const RecentOrdersResponseSchema = z.strictObject({
  orders: z.array(RecentOrderItemSchema),
  asOf: unixTimestampSeconds.optional(),
});

export type RecentOrdersResponse = z.infer<typeof RecentOrdersResponseSchema>;

export const PegPointSchema = z.strictObject({
  at: unixTimestampSeconds,
  usdPrice: decimalAmountString,
});

export const PegTokenHistorySchema = z.strictObject({
  asset: assetSymbol,
  currentUsdPrice: decimalAmountString,
  points: z.array(PegPointSchema),
});

export const PegsResponseSchema = z.strictObject({
  tokens: z.array(PegTokenHistorySchema),
  asOf: unixTimestampSeconds,
});

export type PegsResponse = z.infer<typeof PegsResponseSchema>;

export const MetricsResponseSchema = z.strictObject({
  openExposureUsd: decimalAmountString,
  unfundedQuotes: nonNegInt,
  tipAges: z.strictObject({
    bchSeconds: nonNegInt,
    evmSeconds: z.record(z.string(), nonNegInt),
  }),
  errorCounts: z.record(z.string(), nonNegInt),
  lastConfirmedAt: unixTimestampSeconds.nullable(),
  timestamp: unixTimestampSeconds,
});

export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

export const OperatorAlertSchema = z.strictObject({
  id: textSchema,
  kind: textSchema,
  message: z.string().min(1).max(512),
  createdAt: unixTimestampSeconds,
  ageSeconds: nonNegInt,
});

export const OperatorAttentionOrderSchema = z.strictObject({
  orderId: hex32Schema,
  state: textSchema,
  reason: z.string().min(1).max(512),
  createdAt: unixTimestampSeconds,
  updatedAt: unixTimestampSeconds,
  ageSeconds: nonNegInt,
});

export const OperatorNeedsAttentionResponseSchema = z.strictObject({
  alerts: z.array(OperatorAlertSchema),
  orders: z.array(OperatorAttentionOrderSchema),
  timestamp: unixTimestampSeconds,
});

export type OperatorNeedsAttentionResponse = z.infer<
  typeof OperatorNeedsAttentionResponseSchema
>;

export const PayLinkJsonSchema = z.strictObject({
  id: textSchema,
  kind: z.enum(['invoice', 'open']),
  status: z.enum(['open', 'reserved', 'paid', 'expired', 'cancelled']),
  token: z.enum(['PUSD', 'MUSD']),
  recipientAddress: textSchema,
  recipientLockingBytecode: hexSchema,
  amountOut: uint256Json.optional(),
  memo: z.string().min(1).max(256).optional(),
  createdAt: unixTimestampSeconds,
  expiresAt: unixTimestampSeconds.optional(),
  paidTxid: hex32Schema.optional(),
  verified: z.boolean().optional(),
});

export type PayLinkJson = z.infer<typeof PayLinkJsonSchema>;

export const CreatePayLinkRequestSchema = z.strictObject({
  token: z.enum(['PUSD', 'MUSD']),
  recipientAddress: textSchema,
  amountOut: uint256Json.optional(),
  memo: z.string().min(1).max(256).optional(),
  expiresAt: unixTimestampSeconds.optional(),
  ownerSig: z.string().min(1).max(512).optional(),
});

export type CreatePayLinkRequest = z.infer<typeof CreatePayLinkRequestSchema>;

export const CreatePayLinkResponseSchema = PayLinkJsonSchema;
export type CreatePayLinkResponse = PayLinkJson;

export const PayLinkDetailsResponseSchema = PayLinkJsonSchema;
export type PayLinkDetailsResponse = PayLinkJson;

export const PayLinkQuoteRequestSchema = z.strictObject({
  chainId: positiveUint,
  evmToken: evmAddressSchema,
  amountOut: uint256Json.optional(),
  userEvmAddress: evmAddressSchema,
  hashLock: hex32Schema,
  lane: z.enum(['fast', 'safe']),
  fastOptIn: z.boolean().optional(),
});

export type PayLinkQuoteRequest = z.infer<typeof PayLinkQuoteRequestSchema>;

export const OwnerPayLinksResponseSchema = z.strictObject({
  owner: textSchema,
  links: z.array(PayLinkJsonSchema),
  asOf: unixTimestampSeconds.optional(),
});

export type OwnerPayLinksResponse = z.infer<typeof OwnerPayLinksResponseSchema>;

export const CancelPayLinkRequestSchema = z.strictObject({
  owner: textSchema,
  sig: z.string().min(1).max(512),
});

export type CancelPayLinkRequest = z.infer<typeof CancelPayLinkRequestSchema>;

export const CancelPayLinkResponseSchema = z.strictObject({
  ok: z.boolean(),
  id: textSchema,
  status: z.literal('cancelled'),
  updatedAt: unixTimestampSeconds.optional(),
});

export type CancelPayLinkResponse = z.infer<typeof CancelPayLinkResponseSchema>;

export const SendQuoteRequestSchema = z.strictObject({
  token: z.enum(['PUSD', 'MUSD']),
  chainId: positiveUint,
  evmToken: evmAddressSchema,
  amountIn: uint256Json,
  recipientEvmAddress: evmAddressSchema,
  userEvmAddress: evmAddressSchema,
  userBchLockingBytecode: hexSchema,
  hashLock: hex32Schema,
  windowSeconds: positiveUint,
  lane: z.enum(['fast', 'safe']),
});

export type SendQuoteRequest = z.infer<typeof SendQuoteRequestSchema>;

export const SendLinkDetailsResponseSchema = z.strictObject({
  id: textSchema,
  orderId: hex32Schema.optional(),
  status: z.enum(['pending_lock', 'locked', 'claimed', 'refunded', 'expired']),
  token: z.enum(['PUSD', 'MUSD']),
  chainId: positiveUint,
  evmToken: evmAddressSchema,
  amountIn: z.string().regex(/^\d+$/).optional(),
  amountOut: z.string().regex(/^\d+$/).optional(),
  recipientEvmAddress: evmAddressSchema,
  hashLock: hex32Schema,
  evmDeadline: unixTimestampSeconds,
  bchRefundHeight: positiveUint,
  createdAt: unixTimestampSeconds,
  updatedAt: unixTimestampSeconds,
});

export type SendLinkDetailsResponse = z.infer<
  typeof SendLinkDetailsResponseSchema
>;
