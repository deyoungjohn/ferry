import { z } from 'zod';
import {
  ApiErrorCodeSchema,
  ApiErrorResponseSchema,
  HealthResponseSchema,
  LiquidityResponseSchema,
  OrderTermsSchema,
  PayLinkSchema,
  PricingEvidenceSchema,
  QuoteRefusalSchema,
  RouteLiquiditySchema,
  SendLinkSchema,
  unixTimestampSeconds,
  type Hex,
  type Hex32,
} from '@ferry/core';

export {
  ApiErrorCodeSchema,
  ApiErrorResponseSchema,
  HealthResponseSchema,
  LiquidityResponseSchema,
  OrderTermsSchema,
  PayLinkSchema,
  PricingEvidenceSchema,
  QuoteRefusalSchema,
  RouteLiquiditySchema,
  SendLinkSchema,
  unixTimestampSeconds,
};

const hex = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .transform((v) => v.toLowerCase() as Hex);

const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase() as Hex32);

const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as Hex);

const positiveBigIntString = z
  .string()
  .regex(/^\d+$/)
  .transform((v) => BigInt(v));

export const QuoteRequestSchema = z
  .strictObject({
    direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
    bchToken: z.enum(['PUSD', 'MUSD']),
    amountIn: z.union([z.bigint(), positiveBigIntString]),
    userEvmAddress: evmAddress,
    userBchLockingBytecode: hex,
    hashLock: hex32,
    lane: z.enum(['safe', 'fast']).default('safe'),
    fastOptIn: z.boolean().optional(),
    evmChainId: z.number().int().positive().optional(),
    evmToken: evmAddress.optional(),
  })
  .superRefine((req, ctx) => {
    if (req.lane === 'fast' && req.fastOptIn === false) {
      ctx.addIssue({
        code: 'custom',
        message: 'Fast lane requires explicit fastOptIn: true',
        path: ['fastOptIn'],
      });
    }
  });

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const QuoteResponseSchema = z.strictObject({
  orderId: hex32,
  terms: OrderTermsSchema,
  lane: z.enum(['safe', 'fast']),
  signature: hex,
  signerAddress: evmAddress,
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export const OrderStatusResponseSchema = z.strictObject({
  orderId: hex32,
  direction: z.enum(['EVM_TO_BCH', 'BCH_TO_EVM']),
  status: z.string(),
  lane: z.enum(['safe', 'fast']),
  terms: OrderTermsSchema,
  txIds: z.strictObject({
    userLockTxId: z.string().optional(),
    solverLockTxId: z.string().optional(),
    userClaimTxId: z.string().optional(),
    solverClaimTxId: z.string().optional(),
    solverRefundTxId: z.string().optional(),
  }),
  deadlines: z.strictObject({
    quoteExpiry: unixTimestampSeconds,
    evmDeadline: unixTimestampSeconds,
    bchRefundHeight: z.number().int().positive(),
  }),
  updatedAt: unixTimestampSeconds,
});

export type OrderStatusResponse = z.infer<typeof OrderStatusResponseSchema>;

export const RevealSecretRequestSchema = z.strictObject({
  secret: hex32,
});

export type RevealSecretRequest = z.infer<typeof RevealSecretRequestSchema>;

export const RevealSecretResponseSchema = z.strictObject({
  orderId: hex32,
  status: z.string(),
  accepted: z.literal(true),
  updatedAt: unixTimestampSeconds,
});

export type RevealSecretResponse = z.infer<typeof RevealSecretResponseSchema>;

export const RelayLockRequestSchema = z.strictObject({
  permit: z
    .object({
      owner: evmAddress,
      spender: evmAddress,
      value: z.string(),
      deadline: z.number().int().positive(),
      v: z.number().int(),
      r: hex32,
      s: hex32,
    })
    .optional(),
  intent: z
    .object({
      user: evmAddress,
      hashLock: hex32,
      amount: z.string(),
      deadline: z.number().int().positive(),
      signature: hex,
    })
    .optional(),
  payload: z.unknown().optional(),
});

export type RelayLockRequest = z.infer<typeof RelayLockRequestSchema>;

export const RelayLockResponseSchema = z.strictObject({
  orderId: hex32,
  status: z.string(),
  txId: hex32,
  relayed: z.literal(true),
  updatedAt: unixTimestampSeconds,
});

export type RelayLockResponse = z.infer<typeof RelayLockResponseSchema>;

export const RelayClaimRequestSchema = z.strictObject({
  secret: hex32.optional(),
  recipientAddress: evmAddress.optional(),
});

export type RelayClaimRequest = z.infer<typeof RelayClaimRequestSchema>;

export const RelayClaimResponseSchema = z.strictObject({
  orderId: hex32,
  status: z.string(),
  txId: hex32,
  relayed: z.literal(true),
  updatedAt: unixTimestampSeconds,
});

export type RelayClaimResponse = z.infer<typeof RelayClaimResponseSchema>;

export const StatsSummarySchema = z.strictObject({
  completedSwaps: z.number().int().nullable(),
  volumeUsdMicros: z.string().nullable(),
  medianFastSeconds: z.number().int().nullable(),
  quotePolicy: z
    .strictObject({
      spreadBps: z.number().int(),
      fixedFeeUsdMicros: z.string(),
    })
    .nullable(),
  asOf: unixTimestampSeconds.nullable(),
});

export type StatsSummary = z.infer<typeof StatsSummarySchema>;

export const RecentSwapSchema = z.strictObject({
  orderId: hex32,
  settledAt: unixTimestampSeconds,
  direction: z.enum(['COUNTER_TO_BCH', 'BCH_TO_COUNTER']),
  counterSymbol: z.string().min(1).max(12),
  counterDecimals: z.number().int().min(0).max(18),
  counterAmount: z.string(),
  bchSymbol: z.string().min(1).max(12),
  bchDecimals: z.number().int().min(0).max(18),
  bchTokenAmount: z.string(),
  durationSeconds: z.number().int().nonnegative(),
  baseTxId: hex32,
  bchTxId: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export type RecentSwap = z.infer<typeof RecentSwapSchema>;

export const RecentSwapsResponseSchema = z.strictObject({
  swaps: z.array(RecentSwapSchema),
});

export type RecentSwapsResponse = z.infer<typeof RecentSwapsResponseSchema>;

export const PegPointSchema = z.strictObject({
  at: unixTimestampSeconds,
  priceUsdMicros: z.string(),
});

export type PegPoint = z.infer<typeof PegPointSchema>;

export const PegSnapshotSchema = z.strictObject({
  token: z.enum(['PUSD', 'MUSD']),
  priceUsdMicros: z.string().nullable(),
  points: z.array(PegPointSchema).max(1440),
  source: z.string().nullable(),
  asOf: unixTimestampSeconds.nullable(),
});

export type PegSnapshot = z.infer<typeof PegSnapshotSchema>;

export const PegsResponseSchema = z.strictObject({
  pegs: z.array(PegSnapshotSchema),
});

export type PegsResponse = z.infer<typeof PegsResponseSchema>;

export const MetricsResponseSchema = z.strictObject({
  orderCounts: z.record(z.string(), z.number().int()),
  openExposureUsdMicros: z.string(),
  unfundedQuotesCount: z.number().int(),
  needsAttentionCount: z.number().int(),
  oldestNonTerminalOrderAgeSeconds: z.number().int().nullable(),
  bchTip: z.strictObject({
    height: z.number().int(),
    ageSeconds: z.number().int().nonnegative(),
    stale: z.boolean(),
    quorum: z.boolean(),
    livenessHealthy: z.boolean(),
  }),
  evmTip: z.strictObject({
    height: z.number().int(),
    ageSeconds: z.number().int().nonnegative(),
    stale: z.boolean(),
  }),
  lastConfirmedAt: unixTimestampSeconds.nullable(),
  timestamp: unixTimestampSeconds,
});

export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

export const OperatorNeedsAttentionItemSchema = z.strictObject({
  orderId: hex32,
  direction: z.enum(['BCH_TO_COUNTER', 'COUNTER_TO_BCH']),
  status: z.string(),
  lane: z.enum(['safe', 'fast']).optional(),
  createdAt: unixTimestampSeconds,
  updatedAt: unixTimestampSeconds,
  ageSeconds: z.number().int().nonnegative(),
  rejectionReason: z.string().optional(),
  txIds: z.strictObject({
    userLockTxId: z.string().optional(),
    solverLockTxId: z.string().optional(),
    userClaimTxId: z.string().optional(),
    solverClaimTxId: z.string().optional(),
    solverRefundTxId: z.string().optional(),
  }),
});

export const OperatorNeedsAttentionResponseSchema = z.strictObject({
  orders: z.array(OperatorNeedsAttentionItemSchema),
  timestamp: unixTimestampSeconds,
});

export type OperatorNeedsAttentionResponse = z.infer<
  typeof OperatorNeedsAttentionResponseSchema
>;

// PayLink Schemas
export const CreatePayLinkRequestSchema = z.strictObject({
  kind: z.enum(['invoice', 'open']),
  recipientCashaddr: z.string().min(10).max(128),
  recipientLockingBytecode: hex,
  token: z.enum(['PUSD', 'MUSD']),
  amountOut: z.union([z.bigint(), positiveBigIntString]).optional(),
  minAmountOut: z.union([z.bigint(), positiveBigIntString]).optional(),
  memo: z.string().min(1).max(140).optional(),
  reference: z.string().min(1).max(256).optional(),
  expiresAt: unixTimestampSeconds.optional(),
  verification: z
    .strictObject({
      challenge: z.string().min(1),
      signature: z.string().min(1),
    })
    .optional(),
});

export type CreatePayLinkRequest = z.infer<typeof CreatePayLinkRequestSchema>;

export const PayLinkQuoteRequestSchema = z.strictObject({
  counterChain: z.string().default('base'),
  counterSymbol: z.enum(['USDC', 'USDT']).default('USDC'),
  userCounterAddress: evmAddress,
  hashLock: hex32,
  lane: z.enum(['safe', 'fast']).default('safe'),
  fastOptIn: z.boolean().optional(),
  amountOut: z.union([z.bigint(), positiveBigIntString]).optional(),
});

export type PayLinkQuoteRequest = z.infer<typeof PayLinkQuoteRequestSchema>;

export const ListPayLinksQuerySchema = z.strictObject({
  owner: z.string().min(10).max(128),
  challenge: z.string().min(1),
  sig: z.string().min(1),
});

export type ListPayLinksQuery = z.infer<typeof ListPayLinksQuerySchema>;

export const CancelPayLinkRequestSchema = z.strictObject({
  owner: z.string().min(10).max(128),
  challenge: z.string().min(1),
  sig: z.string().min(1),
});

export type CancelPayLinkRequest = z.infer<typeof CancelPayLinkRequestSchema>;

// SendLink Schemas
export const SendQuoteRequestSchema = z.strictObject({
  destinationChainId: z.number().int().positive(),
  token: evmAddress,
  amount: z.union([z.bigint(), positiveBigIntString]),
  recipientAddress: evmAddress,
  windowSeconds: z
    .number()
    .int()
    .positive()
    .max(7 * 86400),
  bchToken: z.enum(['PUSD', 'MUSD']).default('PUSD'),
});

export type SendQuoteRequest = z.infer<typeof SendQuoteRequestSchema>;

export const SendQuoteResponseSchema = z.strictObject({
  quoteId: z.string(),
  destinationChainId: z.number().int().positive(),
  token: evmAddress,
  amount: z.string(),
  recipientAddress: evmAddress,
  windowSeconds: z.number().int().positive(),
  holdFeeBps: z.number().int().nonnegative(),
  effectiveSpreadBps: z.number().int().nonnegative(),
  bchTokenAmount: z.string(),
  evmDeadlineSeconds: unixTimestampSeconds,
  bchRefundHeight: z.number().int().positive(),
  quoteExpiry: unixTimestampSeconds,
});

export type SendQuoteResponse = z.infer<typeof SendQuoteResponseSchema>;

export const SendLinkDetailResponseSchema = z.strictObject({
  id: hex32,
  destinationChainId: z.number().int().positive(),
  token: evmAddress,
  recipientAddress: evmAddress,
  amount: z.string(),
  windowSeconds: z.number().int().positive(),
  status: z.string(),
  claimAfter: unixTimestampSeconds.optional(),
  createdAt: unixTimestampSeconds,
});

export type SendLinkDetailResponse = z.infer<
  typeof SendLinkDetailResponseSchema
>;
