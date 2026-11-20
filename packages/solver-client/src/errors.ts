import {
  API_ERROR_HTTP_STATUS,
  formatApiErrorMessage,
  formatQuoteRefusalMessage,
  type ApiErrorCode,
  type ApiErrorResponse,
  type QuoteRefusal,
} from '@ferry/core/api';
import type { z } from 'zod';

export { formatApiErrorMessage, formatQuoteRefusalMessage };

export type ApiErrorCategory =
  | 'validation'
  | 'auth'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'precondition'
  | 'rate_limit'
  | 'unavailable'
  | 'upstream'
  | 'internal';

export const API_ERROR_CATEGORIES: Readonly<
  Record<ApiErrorCode, ApiErrorCategory>
> = Object.freeze({
  BAD_REQUEST: 'validation',
  VALIDATION_ERROR: 'validation',
  INVALID_SIGNATURE: 'validation',
  TERMS_MISMATCH: 'validation',
  AMOUNT_OUT_OF_RANGE: 'validation',
  UNSUPPORTED_ROUTE: 'validation',
  INSUFFICIENT_USER_BALANCE: 'validation',
  UNAUTHORIZED: 'auth',
  NOT_FOUND: 'not_found',
  ORDER_NOT_FOUND: 'not_found',
  LINK_NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  LINK_RESERVED: 'conflict',
  LINK_CLOSED: 'conflict',
  INVALID_ORDER_STATE: 'conflict',
  QUOTE_EXPIRED: 'expired',
  LINK_EXPIRED: 'expired',
  REVEAL_NOT_READY: 'precondition',
  TIMING_INVARIANT_FAILED: 'precondition',
  RATE_LIMITED: 'rate_limit',
  QUOTING_DISABLED: 'unavailable',
  PEG_DEVIATION: 'unavailable',
  STALE_CHAIN_TIP: 'unavailable',
  BCH_TIP_UNHEALTHY: 'unavailable',
  EVM_TIP_UNHEALTHY: 'unavailable',
  INSUFFICIENT_INVENTORY: 'unavailable',
  EXPOSURE_LIMIT_EXCEEDED: 'unavailable',
  ALREADY_CLAIMED: 'conflict',
  LIMIT_REACHED: 'rate_limit',
  NOT_YOUR_LINK: 'auth',
  CLAIM_IN_PROGRESS: 'conflict',
  LINK_CANCELLED: 'conflict',
  ALREADY_PAID: 'conflict',
  RELAY_LOCK_REVERTED: 'upstream',
  UPSTREAM_ERROR: 'upstream',
  INTERNAL_ERROR: 'internal',
});

const RETRYABLE_CATEGORIES = new Set<ApiErrorCategory>([
  'precondition',
  'rate_limit',
  'unavailable',
  'upstream',
]);

export function getApiErrorHttpStatus(code: ApiErrorCode): number {
  return API_ERROR_HTTP_STATUS[code];
}

export function getApiErrorCategory(code: ApiErrorCode): ApiErrorCategory {
  return API_ERROR_CATEGORIES[code];
}

export function isRetryableApiError(code: ApiErrorCode): boolean {
  return RETRYABLE_CATEGORIES.has(API_ERROR_CATEGORIES[code]);
}

export class SolverNetworkError extends Error {
  readonly url: string;

  constructor(url: string, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SolverNetworkError';
    this.url = url;
  }
}

export class SolverTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Solver request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'SolverTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class SolverRefusalError extends Error {
  readonly url: string;
  readonly status: number;
  readonly refusal: QuoteRefusal;

  constructor(url: string, status: number, refusal: QuoteRefusal) {
    super(formatQuoteRefusalMessage(refusal));
    this.name = 'SolverRefusalError';
    this.url = url;
    this.status = status;
    this.refusal = refusal;
  }
}

export class SolverHttpError extends Error {
  readonly url: string;
  readonly status: number;
  readonly code: ApiErrorCode | undefined;
  readonly category: ApiErrorCategory | undefined;
  readonly apiError: ApiErrorResponse | undefined;
  readonly bodyText: string | undefined;

  constructor(params: {
    url: string;
    status: number;
    message: string;
    apiError?: ApiErrorResponse;
    bodyText?: string;
  }) {
    super(params.message);
    this.name = 'SolverHttpError';
    this.url = params.url;
    this.status = params.status;
    this.apiError = params.apiError;
    this.code = params.apiError?.error.code;
    this.category =
      this.code !== undefined ? API_ERROR_CATEGORIES[this.code] : undefined;
    this.bodyText = params.bodyText;
  }

  get userMessage(): string {
    if (this.code !== undefined) {
      return formatApiErrorMessage(this.code, this.apiError?.error.message);
    }
    return this.message;
  }
}

export class SolverSchemaError extends Error {
  readonly url: string;
  readonly route: string;
  readonly issues: readonly z.ZodIssue[] | undefined;

  constructor(params: {
    url: string;
    route: string;
    message: string;
    issues?: readonly z.ZodIssue[];
  }) {
    super(params.message);
    this.name = 'SolverSchemaError';
    this.url = params.url;
    this.route = params.route;
    this.issues = params.issues;
  }
}

export class QuoteVerificationError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Quote verification failed for ${field}: ${reason}`);
    this.name = 'QuoteVerificationError';
    this.field = field;
    this.reason = reason;
  }
}

export function isRetryableSolverError(error: unknown): boolean {
  if (
    error instanceof SolverTimeoutError ||
    error instanceof SolverNetworkError
  ) {
    return true;
  }
  if (error instanceof SolverHttpError) {
    if (error.code !== undefined) {
      return isRetryableApiError(error.code);
    }
    return error.status >= 500 || error.status === 429;
  }
  return false;
}

export function formatSolverErrorMessage(error: unknown): string {
  if (error instanceof SolverRefusalError) {
    return formatQuoteRefusalMessage(error.refusal);
  }
  if (error instanceof SolverHttpError) {
    return error.userMessage;
  }
  if (error instanceof SolverTimeoutError) {
    return 'The solver took too long to respond. Please try again.';
  }
  if (error instanceof SolverNetworkError) {
    return 'Could not reach the solver. Check your connection and try again.';
  }
  if (error instanceof SolverSchemaError) {
    return 'The solver returned an unexpected response format.';
  }
  if (error instanceof QuoteVerificationError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected solver error occurred.';
}
