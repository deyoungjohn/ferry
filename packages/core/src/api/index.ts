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
