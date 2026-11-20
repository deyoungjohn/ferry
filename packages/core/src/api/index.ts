import {
  MAX_SEND_LINK_WINDOW_SECONDS,
  MIN_SEND_LINK_WINDOW_SECONDS,
} from '../pricing.js';
import { isAddress } from 'viem';
import { z } from 'zod';
import {
  OrderTermsJsonSchema,
  PricingEvidenceJsonSchema,
  unixTimestampSeconds,
  type Hex,
  type Hex32,
} from '../terms.js';

export {
  OrderTermsJsonSchema,
  PricingEvidenceJsonSchema,
  unixTimestampSeconds,
};

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
  'ALREADY_CLAIMED',
  'LIMIT_REACHED',
  'NOT_YOUR_LINK',
  'CLAIM_IN_PROGRESS',
  'LINK_CANCELLED',
  'ALREADY_PAID',
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
    ALREADY_CLAIMED: 409,
    LIMIT_REACHED: 429,
    NOT_YOUR_LINK: 403,
    CLAIM_IN_PROGRESS: 409,
    LINK_CANCELLED: 400,
    ALREADY_PAID: 409,
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

export const API_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> =
  Object.freeze({
    BAD_REQUEST: 'The request was malformed or missing required parameters.',
    VALIDATION_ERROR: 'One or more request fields failed validation.',
    INVALID_SIGNATURE: 'The provided cryptographic signature is invalid.',
    TERMS_MISMATCH: 'The signed order terms do not match the expected terms.',
    AMOUNT_OUT_OF_RANGE: 'The requested swap amount is outside allowed limits.',
    UNSUPPORTED_ROUTE: 'This chain or token route is not supported.',
    UNAUTHORIZED: 'Authentication is required or the bearer token is invalid.',
    NOT_FOUND: 'The requested resource was not found.',
    ORDER_NOT_FOUND: 'The requested swap order was not found.',
    LINK_NOT_FOUND: 'The requested pay link or send link was not found.',
    CONFLICT: 'The request conflicts with the current resource state.',
    LINK_RESERVED: 'This pay link is already reserved by another payer.',
    LINK_CLOSED: 'This pay link is already paid or cancelled.',
    INVALID_ORDER_STATE:
      'This action is not valid for the order’s current state.',
    QUOTE_EXPIRED: 'This quote has expired. Request a fresh quote.',
    LINK_EXPIRED: 'This pay link has expired.',
    REVEAL_NOT_READY:
      'Counterparty lock does not yet meet the confirmation policy for secret reveal.',
    TIMING_INVARIANT_FAILED:
      'The proposed lock deadlines violate the HTLC safety timing invariant.',
    RATE_LIMITED: 'Too many requests; please wait a moment and try again.',
    QUOTING_DISABLED: 'Quoting is temporarily disabled on this solver.',
    PEG_DEVIATION:
      'Quoting is paused because the token price deviates from its peg.',
    STALE_CHAIN_TIP: 'Chain tip data is stale; quoting is temporarily paused.',
    BCH_TIP_UNHEALTHY:
      'Bitcoin Cash node tip is stale or unhealthy; quoting is paused.',
    EVM_TIP_UNHEALTHY:
      'EVM chain tip is stale or unhealthy; quoting is paused.',
    INSUFFICIENT_USER_BALANCE:
      'Insufficient token balance or allowance for this swap.',
    RELAY_LOCK_REVERTED: 'The relayed lock transaction reverted on-chain.',
    INSUFFICIENT_INVENTORY:
      'The solver does not currently have enough inventory for this amount.',
    EXPOSURE_LIMIT_EXCEEDED:
      'This swap would exceed the solver’s open exposure limit.',
    ALREADY_CLAIMED: 'This send link has already been claimed.',
    LIMIT_REACHED: 'Cancellation limit reached.',
    NOT_YOUR_LINK: 'Sender authorization verification failed.',
    CLAIM_IN_PROGRESS: 'Receiver claim is currently in progress.',
    LINK_CANCELLED: 'This send link has been cancelled by the sender.',
    ALREADY_PAID: 'This pay link is already paid or payment has started.',
    UPSTREAM_ERROR:
      'An upstream chain RPC or indexer returned an error; try again.',
    INTERNAL_ERROR: 'The solver encountered an unexpected internal error.',
  });

export function formatApiErrorMessage(
  code: ApiErrorCode,
  detail?: string,
): string {
  const base = API_ERROR_MESSAGES[code];
  const trimmed = detail?.trim();
  if (trimmed !== undefined && trimmed.length > 0 && trimmed !== base) {
    return `${base} (${trimmed})`;
  }
  return base;
}

export const CostFeedStatusSchema = z.strictObject({
  lastSuccessTime: unixTimestampSeconds.nullable().optional(),
  lastError: z.string().nullable().optional(),
  lastErrorTime: unixTimestampSeconds.nullable().optional(),
  source: z.string().optional(),
  cached: z.boolean().optional(),
  ageSeconds: nonNegInt.optional(),
});

export type CostFeedStatus = z.infer<typeof CostFeedStatusSchema>;

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
  costFeeds: z.record(z.string(), CostFeedStatusSchema).optional(),
  bchRoutes: z.array(z.string()).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const QUOTE_REFUSAL_REASONS = [
  'INSUFFICIENT_LIQUIDITY',
  'PEG_GUARD',
  'PRICE_UNAVAILABLE',
  'ROUTE_DISABLED',
  'OVER_MAX_SWAP',
  'BELOW_MINIMUM',
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
    reason: z.literal('BELOW_MINIMUM'),
    /** The smallest amount for this route, in US dollars ("5.00"). */
    minAmount: decimalAmountString,
    asset: assetSymbol,
    maxAmount: decimalAmountString.optional(),
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
    case 'BELOW_MINIMUM':
      return `The minimum on this route is $${refusal.minAmount}`;
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
  /** A quote that reserves nothing: for showing a price before the user commits. */
  dryRun: z.boolean().optional(),
  /** The pay link this payment is for, so the swap is tied to it by a mark and never by a guess. */
  payLinkId: textSchema.optional(),
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

/** Every state an order has been in, with the time it got there. */
export const OrderTimelineSchema = z.array(
  z.strictObject({
    status: z.string().min(1).max(64),
    at: unixTimestampSeconds,
  }),
);

export const OrderStatusResponseSchema = z.strictObject({
  orderId: hex32Schema,
  state: z.string().min(1).max(64),
  direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']).optional(),
  txids: OrderStatusTxidsSchema,
  quoteExpiry: unixTimestampSeconds,
  counterDeadline: unixTimestampSeconds,
  bchRefundHeight: positiveUint,
  updatedAt: unixTimestampSeconds,
  createdAt: unixTimestampSeconds.optional(),
  timeline: OrderTimelineSchema.optional(),
  /** What the swap is for (public: the recent swaps list shows the same): token, amounts, chain. */
  summary: z
    .strictObject({
      bchToken: z.string().min(1).max(16),
      bchTokenAmount: z.string().regex(/^\d+$/),
      evmAmount: z.string().regex(/^\d+$/),
      evmChainId: positiveUint,
      evmToken: z.string().min(1).max(32).optional(),
      evmDecimals: z.number().int().min(0).max(36).optional(),
    })
    .optional(),
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

/**
 * The typed data the recipient signs to ask for a send link's claim (EIP-712). The relay checks
 * the signer is the recipient fixed in the order, so a claim signed by anyone else is refused.
 */
export function claimRequestTypedData(input: {
  readonly chainId: number;
  readonly orderId: `0x${string}`;
  readonly lockId: `0x${string}`;
}) {
  return {
    domain: { name: 'Ferry', version: '1', chainId: input.chainId },
    types: {
      ClaimRequest: [
        { name: 'orderId', type: 'bytes32' },
        { name: 'lockId', type: 'bytes32' },
      ],
    },
    primaryType: 'ClaimRequest' as const,
    message: { orderId: input.orderId, lockId: input.lockId },
  };
}

export const RelayClaimRequestSchema = z.strictObject({
  secret: hex32Schema,
  lockId: hex32Schema.optional(),
  /** The recipient's signature of the claim request (see `claimRequestTypedData`). */
  claimSig: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/)
    .optional(),
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
  /** The stablecoin on the EVM side ("USDT"), and its decimals, so the list shows the real token. */
  evmToken: assetSymbol.optional(),
  evmDecimals: nonNegInt.optional(),
  bchTokenAmount: z.string().regex(/^\d+$/),
  evmAmount: z.string().regex(/^\d+$/),
  settledAt: unixTimestampSeconds,
  durationSeconds: nonNegInt,
  /** The person's own lock transaction and claim transaction, when the solver recorded them. */
  sourceTxId: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .optional(),
  claimTxId: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .optional(),
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
  status: z.enum([
    'open',
    'reserved',
    'paid',
    'expired',
    'cancelled',
    'closed',
  ]),
  token: z.enum(['PUSD', 'MUSD']),
  recipientAddress: textSchema,
  recipientLockingBytecode: hexSchema,
  amountOut: uint256Json.optional(),
  memo: z.string().min(1).max(256).optional(),
  createdAt: unixTimestampSeconds,
  expiresAt: unixTimestampSeconds.optional(),
  paidTxid: hex32Schema.optional(),
  /** When the link was paid (Unix seconds), for a paid link. */
  paidAt: unixTimestampSeconds.optional(),
  /** The swap that pays (or is paying) this link, once there is one. */
  orderId: hex32Schema.optional(),
  /** That swap as the server holds it, so a page can paint everything from one answer. */
  order: z
    .strictObject({
      state: z.string().min(1).max(64),
      txids: z.record(z.string(), z.string()),
      createdAt: unixTimestampSeconds,
      updatedAt: unixTimestampSeconds,
      timeline: OrderTimelineSchema,
      /** What the swap moved: token, amounts and chain, so a paid link can show what was paid. */
      summary: z
        .strictObject({
          bchToken: z.string().min(1).max(16),
          bchTokenAmount: z.string().regex(/^\d+$/),
          evmAmount: z.string().regex(/^\d+$/),
          evmChainId: positiveUint,
          evmToken: z.string().min(1).max(32).optional(),
          evmDecimals: z.number().int().min(0).max(36).optional(),
        })
        .optional(),
    })
    .optional(),
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
  ownerSecretHash: hex32Schema.optional(),
});

export type CreatePayLinkRequest = z.infer<typeof CreatePayLinkRequestSchema>;

export const CreatePayLinkResponseSchema = PayLinkJsonSchema;
export type CreatePayLinkResponse = PayLinkJson;

export const DeletePayLinkResponseSchema = z.strictObject({
  ok: z.boolean(),
  id: textSchema,
  status: z.literal('closed'),
});

export type DeletePayLinkResponse = z.infer<typeof DeletePayLinkResponseSchema>;

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

export const ListPayLinksQuerySchema = z.strictObject({
  owner: textSchema,
  sig: z.string().min(1).max(512),
});

export type ListPayLinksQuery = z.infer<typeof ListPayLinksQuerySchema>;

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

/** The longest note a send link may carry, in characters. */
export const SEND_LINK_NOTE_MAX_LENGTH = 140;

/**
 * A short message from the sender that the receiver sees. Plain text only: no line breaks or other
 * control characters. It is visible to anyone who holds the link, so it is not private.
 */
export const sendLinkNoteSchema = z
  .string()
  .trim()
  .min(1, 'A note cannot be empty')
  .max(
    SEND_LINK_NOTE_MAX_LENGTH,
    `A note is at most ${SEND_LINK_NOTE_MAX_LENGTH} characters`,
  )
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value), {
    message: 'A note is plain text: no line breaks or control characters',
  });

/**
 * Blinded 32-byte hex tag (64 hex characters with or without 0x prefix).
 * Derived as HMAC-SHA-256(viewKey, "ferry:send-links:v1:" + n).
 */
export const viewTagSchema = z
  .string()
  .transform((v) =>
    v.startsWith('0x') ? v.toLowerCase() : `0x${v.toLowerCase()}`,
  )
  .refine((v) => /^0x[0-9a-f]{64}$/.test(v), 'Expected 32-byte hex tag')
  .transform((v) => v as Hex32);

export const SendQuoteRequestSchema = z.strictObject({
  token: z.enum(['PUSD', 'MUSD']),
  chainId: positiveUint,
  evmToken: evmAddressSchema,
  amountIn: uint256Json,
  recipientEvmAddress: evmAddressSchema,
  userEvmAddress: evmAddressSchema,
  userBchLockingBytecode: hexSchema,
  hashLock: hex32Schema,
  /** Claim window in seconds: from one hour to seven days. */
  windowSeconds: positiveUint
    .min(MIN_SEND_LINK_WINDOW_SECONDS)
    .max(MAX_SEND_LINK_WINDOW_SECONDS),
  /** Optional message for the receiver. */
  note: sendLinkNoteSchema.optional(),
  /** Optional blinded tag (32 bytes hex) so the sender can list their send links across devices. */
  viewTag: viewTagSchema.optional(),
  /** Optional cancel hash (sha256 of cancel key) so the sender can cancel without leaking wallet root. */
  cancelHash: hex32Schema.optional(),
  lane: z.enum(['fast', 'safe']),
});

export type SendQuoteRequest = z.infer<typeof SendQuoteRequestSchema>;

export const SendLinkDetailsResponseSchema = z.strictObject({
  id: textSchema,
  orderId: hex32Schema.optional(),
  status: z.enum([
    'pending_lock',
    'locked',
    'claimed',
    'refunded',
    'expired',
    'cancelled',
  ]),
  token: z.enum(['PUSD', 'MUSD']),
  chainId: positiveUint,
  evmToken: evmAddressSchema,
  amountIn: z.string().regex(/^\d+$/).optional(),
  amountOut: z.string().regex(/^\d+$/).optional(),
  recipientEvmAddress: evmAddressSchema,
  hashLock: hex32Schema,
  evmDeadline: unixTimestampSeconds,
  bchRefundHeight: positiveUint,
  /** The sender's message, when there is one. */
  note: sendLinkNoteSchema.optional(),
  /** The EVM lock the receiver claims: what the receiver's own wallet needs to send the claim. */
  lockId: hex32Schema.optional(),
  createdAt: unixTimestampSeconds,
  updatedAt: unixTimestampSeconds,
});

export type SendLinkDetailsResponse = z.infer<
  typeof SendLinkDetailsResponseSchema
>;

export const CancelSendLinkQuotaSchema = z.strictObject({
  dailyUsed: z.number().int().nonnegative(),
  dailyLimit: z.number().int().positive(),
  dailyRemaining: z.number().int().nonnegative(),
  monthlyUsed: z.number().int().nonnegative(),
  monthlyLimit: z.number().int().positive(),
  monthlyRemaining: z.number().int().nonnegative(),
  nextAllowedAt: unixTimestampSeconds.nullable().optional(),
});
export type CancelSendLinkQuota = z.infer<typeof CancelSendLinkQuotaSchema>;

export const CancelSendLinkRequestSchema = z.strictObject({
  /** Cancel key derived from recovery root (swapCancelKeyAt(root, n)). */
  cancelKey: hex32Schema.optional(),
  /** Recovery root key (REFUSED: revealing root leaks all secrets and view tags). */
  recoveryRoot: hex32Schema.optional(),
  /** Recovery signature (REFUSED: revealing recovery proof leaks secrets and view tags). */
  recoverySignature: z.string().optional(),
  swapIndex: z.number().int().nonnegative().optional(),
  /** Signature from the BCH key that created userBchLockingBytecode (exact P2PKH match). */
  bchSignature: z.string().optional(),
  bchPublicKey: z.string().optional(),
  /** EVM signature (REFUSED: recovery signatures cannot be accepted as proof). */
  evmSignature: z.string().optional(),
  signerAddress: z.string().optional(),
  /** Secret preimage from link (not accepted as authorization on its own). */
  secret: hex32Schema.optional(),
});
export type CancelSendLinkRequest = z.infer<typeof CancelSendLinkRequestSchema>;

export const CancelSendLinkResponseSchema = z.strictObject({
  success: z.boolean(),
  orderId: textSchema,
  status: z.literal('cancelled'),
  refundTxId: z.string().optional(),
  quota: CancelSendLinkQuotaSchema,
});
export type CancelSendLinkResponse = z.infer<
  typeof CancelSendLinkResponseSchema
>;

/** Maximum number of blinded view tags a client can query in one request. */
export const MAX_SEND_LINK_QUERY_TAGS = 50;

export const SendLinksQueryRequestSchema = z.strictObject({
  tags: z
    .array(viewTagSchema)
    .min(1, 'At least one tag is required')
    .max(
      MAX_SEND_LINK_QUERY_TAGS,
      `At most ${MAX_SEND_LINK_QUERY_TAGS} tags can be queried at once`,
    ),
});

export type SendLinksQueryRequest = z.infer<typeof SendLinksQueryRequestSchema>;

export const SendLinkQueryMatchSchema = SendLinkDetailsResponseSchema.extend({
  tag: hex32Schema,
});

export type SendLinkQueryMatch = z.infer<typeof SendLinkQueryMatchSchema>;

export const SendLinksQueryResponseSchema = z.strictObject({
  links: z.array(SendLinkQueryMatchSchema),
  matches: z.array(SendLinkQueryMatchSchema).optional(),
});

export type SendLinksQueryResponse = z.infer<
  typeof SendLinksQueryResponseSchema
>;

// -- Bitcoin Cash Proxy Schemas ---------------------------------------------

export const BchHistoryEntrySchema = z.strictObject({
  tx_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  height: z.number().int(),
});
export type BchHistoryEntry = z.infer<typeof BchHistoryEntrySchema>;

export const BchHistoryResponseSchema = z.strictObject({
  history: z.array(BchHistoryEntrySchema),
});
export type BchHistoryResponse = z.infer<typeof BchHistoryResponseSchema>;

export const BchFirstUseResponseSchema = z.strictObject({
  txHash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .nullable(),
  height: z.number().int().nullable(),
});
export type BchFirstUseResponse = z.infer<typeof BchFirstUseResponseSchema>;

export const BchTxResponseSchema = z.strictObject({
  hex: z.string().regex(/^[0-9a-fA-F]+$/),
});
export type BchTxResponse = z.infer<typeof BchTxResponseSchema>;

export const BchBroadcastRequestSchema = z.strictObject({
  hex: z.string().regex(/^[0-9a-fA-F]+$/),
});
export type BchBroadcastRequest = z.infer<typeof BchBroadcastRequestSchema>;

export const BchBroadcastResponseSchema = z.strictObject({
  txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
});
export type BchBroadcastResponse = z.infer<typeof BchBroadcastResponseSchema>;

export const BchTipResponseSchema = z.strictObject({
  height: z.number().int().nonnegative(),
  hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  timestamp: z.number().int().nonnegative(),
});
export type BchTipResponse = z.infer<typeof BchTipResponseSchema>;

export const BchUtxoTokenDataSchema = z.strictObject({
  category: z.string().regex(/^[0-9a-fA-F]{64}$/),
  amount: z.string(),
  nft: z
    .strictObject({
      capability: z.enum(['none', 'mutable', 'minting']).optional(),
      commitment: z.string().optional(),
    })
    .optional(),
});

export const BchUtxoItemSchema = z.strictObject({
  tx_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  tx_pos: z.number().int().nonnegative(),
  value: z.number().int().nonnegative(),
  height: z.number().int(),
  token_data: BchUtxoTokenDataSchema.optional(),
});
export type BchUtxoItem = z.infer<typeof BchUtxoItemSchema>;

export const BchUtxosResponseSchema = z.strictObject({
  utxos: z.array(BchUtxoItemSchema),
  asOf: z.number().int().nonnegative().optional(),
});
export type BchUtxosResponse = z.infer<typeof BchUtxosResponseSchema>;

/**
 * The typed data the recipient signs to ask to switch a send link's route (EIP-712).
 * Chain-bound to the target chain so a stranger cannot forge or redirect the request.
 */
export function switchRouteRequestTypedData(input: {
  readonly targetChainId: number;
  readonly orderId: `0x${string}`;
  readonly token: `0x${string}`;
}) {
  return {
    domain: { name: 'Ferry', version: '1', chainId: input.targetChainId },
    types: {
      SwitchRouteRequest: [
        { name: 'orderId', type: 'bytes32' },
        { name: 'token', type: 'address' },
      ],
    },
    primaryType: 'SwitchRouteRequest' as const,
    message: { orderId: input.orderId, token: input.token },
  };
}

export const SwitchSendLinkRouteRequestSchema = z.strictObject({
  chainId: positiveUint,
  token: evmAddressSchema,
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/)
    .describe('Recipient EIP-712 signature of switchRouteRequestTypedData'),
});

export type SwitchSendLinkRouteRequest = z.infer<
  typeof SwitchSendLinkRouteRequestSchema
>;

export const SwitchSendLinkRouteResponseSchema = z.strictObject({
  ok: z.literal(true),
  originalOrderId: hex32Schema,
  newOrderId: hex32Schema,
  chainId: positiveUint,
  token: evmAddressSchema,
  evmAmount: uint256Json,
  expiresAt: unixTimestampSeconds,
  updatedAt: unixTimestampSeconds,
});

export type SwitchSendLinkRouteResponse = z.infer<
  typeof SwitchSendLinkRouteResponseSchema
>;
