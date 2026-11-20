import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  QUOTE_REFUSAL_REASONS,
  type ApiErrorCode,
  type QuoteRefusal,
} from '@ferry/core/api';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CATEGORIES,
  QuoteVerificationError,
  SolverHttpError,
  SolverNetworkError,
  SolverRefusalError,
  SolverSchemaError,
  SolverTimeoutError,
  formatApiErrorMessage,
  formatQuoteRefusalMessage,
  formatSolverErrorMessage,
  getApiErrorCategory,
  getApiErrorHttpStatus,
  isRetryableApiError,
  isRetryableSolverError,
  type ApiErrorCategory,
} from '../src/errors.js';

const REFUSAL_CASES: readonly {
  reason: (typeof QUOTE_REFUSAL_REASONS)[number];
  refusal: QuoteRefusal;
  expectedSubstring: string;
}[] = [
  {
    reason: 'INSUFFICIENT_LIQUIDITY',
    refusal: {
      reason: 'INSUFFICIENT_LIQUIDITY',
      maxAmount: '42',
      asset: 'PUSD',
    },
    expectedSubstring: '42 PUSD',
  },
  {
    reason: 'BELOW_MINIMUM',
    refusal: {
      reason: 'BELOW_MINIMUM',
      minAmount: '5.00',
      asset: 'USDC',
    },
    expectedSubstring: '$5.00',
  },
  {
    reason: 'OVER_MAX_SWAP',
    refusal: {
      reason: 'OVER_MAX_SWAP',
      maxAmount: '500',
      asset: 'USDC',
    },
    expectedSubstring: '500 USDC',
  },
  {
    reason: 'PEG_GUARD',
    refusal: { reason: 'PEG_GUARD', asset: 'PUSD' },
    expectedSubstring: 'peg guard',
  },
  {
    reason: 'PRICE_UNAVAILABLE',
    refusal: { reason: 'PRICE_UNAVAILABLE', asset: 'MUSD' },
    expectedSubstring: 'price',
  },
  {
    reason: 'ROUTE_DISABLED',
    refusal: { reason: 'ROUTE_DISABLED', asset: 'PUSD' },
    expectedSubstring: 'disabled',
  },
  {
    reason: 'QUOTING_PAUSED',
    refusal: { reason: 'QUOTING_PAUSED', asset: 'MUSD' },
    expectedSubstring: 'paused',
  },
];

const EXPECTED_ERROR_TABLE: readonly {
  code: ApiErrorCode;
  status: number;
  category: ApiErrorCategory;
  retryable: boolean;
}[] = [
  {
    code: 'BAD_REQUEST',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  {
    code: 'VALIDATION_ERROR',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  {
    code: 'INVALID_SIGNATURE',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  {
    code: 'TERMS_MISMATCH',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  {
    code: 'AMOUNT_OUT_OF_RANGE',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  {
    code: 'UNSUPPORTED_ROUTE',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  {
    code: 'INSUFFICIENT_USER_BALANCE',
    status: 400,
    category: 'validation',
    retryable: false,
  },
  { code: 'UNAUTHORIZED', status: 401, category: 'auth', retryable: false },
  { code: 'NOT_FOUND', status: 404, category: 'not_found', retryable: false },
  {
    code: 'ORDER_NOT_FOUND',
    status: 404,
    category: 'not_found',
    retryable: false,
  },
  {
    code: 'LINK_NOT_FOUND',
    status: 404,
    category: 'not_found',
    retryable: false,
  },
  { code: 'CONFLICT', status: 409, category: 'conflict', retryable: false },
  {
    code: 'LINK_RESERVED',
    status: 409,
    category: 'conflict',
    retryable: false,
  },
  { code: 'LINK_CLOSED', status: 409, category: 'conflict', retryable: false },
  {
    code: 'INVALID_ORDER_STATE',
    status: 409,
    category: 'conflict',
    retryable: false,
  },
  { code: 'QUOTE_EXPIRED', status: 410, category: 'expired', retryable: false },
  { code: 'LINK_EXPIRED', status: 410, category: 'expired', retryable: false },
  {
    code: 'REVEAL_NOT_READY',
    status: 425,
    category: 'precondition',
    retryable: true,
  },
  {
    code: 'TIMING_INVARIANT_FAILED',
    status: 422,
    category: 'precondition',
    retryable: true,
  },
  {
    code: 'RATE_LIMITED',
    status: 429,
    category: 'rate_limit',
    retryable: true,
  },
  {
    code: 'QUOTING_DISABLED',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'PEG_DEVIATION',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'STALE_CHAIN_TIP',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'BCH_TIP_UNHEALTHY',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'EVM_TIP_UNHEALTHY',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'INSUFFICIENT_INVENTORY',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'EXPOSURE_LIMIT_EXCEEDED',
    status: 503,
    category: 'unavailable',
    retryable: true,
  },
  {
    code: 'RELAY_LOCK_REVERTED',
    status: 502,
    category: 'upstream',
    retryable: true,
  },
  {
    code: 'UPSTREAM_ERROR',
    status: 502,
    category: 'upstream',
    retryable: true,
  },
  {
    code: 'ALREADY_CLAIMED',
    status: 409,
    category: 'conflict',
    retryable: false,
  },
  {
    code: 'CLAIM_IN_PROGRESS',
    status: 409,
    category: 'conflict',
    retryable: false,
  },
  {
    code: 'LIMIT_REACHED',
    status: 429,
    category: 'rate_limit',
    retryable: true,
  },
  {
    code: 'LINK_CANCELLED',
    status: 400,
    category: 'conflict',
    retryable: false,
  },
  {
    code: 'NOT_YOUR_LINK',
    status: 403,
    category: 'auth',
    retryable: false,
  },
  {
    code: 'INTERNAL_ERROR',
    status: 500,
    category: 'internal',
    retryable: false,
  },
];

describe('typed solver errors and message builders', () => {
  it('covers every QuoteRefusalReason in table tests', () => {
    expect(new Set(REFUSAL_CASES.map((c) => c.reason))).toEqual(
      new Set(QUOTE_REFUSAL_REASONS),
    );
    expect(REFUSAL_CASES).toHaveLength(QUOTE_REFUSAL_REASONS.length);

    for (const testCase of REFUSAL_CASES) {
      const err = new SolverRefusalError(
        'https://solver.example/v1/quotes',
        422,
        testCase.refusal,
      );
      expect(err.refusal).toEqual(testCase.refusal);
      expect(err.message).toBe(formatQuoteRefusalMessage(testCase.refusal));
      expect(err.message.toLowerCase()).toContain(
        testCase.expectedSubstring.toLowerCase(),
      );
      expect(formatSolverErrorMessage(err)).toBe(err.message);
      expect(isRetryableSolverError(err)).toBe(false);
    }
  });

  it('covers every ApiErrorCode in table tests', () => {
    expect(new Set(EXPECTED_ERROR_TABLE.map((e) => e.code))).toEqual(
      new Set(API_ERROR_CODES),
    );
    expect(EXPECTED_ERROR_TABLE).toHaveLength(API_ERROR_CODES.length);

    for (const row of EXPECTED_ERROR_TABLE) {
      expect(API_ERROR_HTTP_STATUS[row.code]).toBe(row.status);
      expect(getApiErrorHttpStatus(row.code)).toBe(row.status);
      expect(API_ERROR_CATEGORIES[row.code]).toBe(row.category);
      expect(getApiErrorCategory(row.code)).toBe(row.category);
      expect(isRetryableApiError(row.code)).toBe(row.retryable);

      const err = new SolverHttpError({
        url: 'https://solver.example/v1/quotes',
        status: row.status,
        message: 'raw server detail',
        apiError: {
          error: {
            code: row.code,
            message: 'raw server detail',
          },
        },
      });
      expect(err.code).toBe(row.code);
      expect(err.category).toBe(row.category);
      expect(err.userMessage).toBe(
        formatApiErrorMessage(row.code, 'raw server detail'),
      );
      expect(err.userMessage).toContain('raw server detail');
      expect(formatSolverErrorMessage(err)).toBe(err.userMessage);
      expect(isRetryableSolverError(err)).toBe(row.retryable);
    }
  });

  it('formats non-API solver errors cleanly', () => {
    const timeout = new SolverTimeoutError('https://solver.example', 5000);
    expect(formatSolverErrorMessage(timeout)).toContain('took too long');
    expect(isRetryableSolverError(timeout)).toBe(true);

    const network = new SolverNetworkError(
      'https://solver.example',
      'ECONNREFUSED',
    );
    expect(formatSolverErrorMessage(network)).toContain('Could not reach');
    expect(isRetryableSolverError(network)).toBe(true);

    const schema = new SolverSchemaError({
      url: 'https://solver.example',
      route: '/v1/health',
      message: 'mismatch',
    });
    expect(formatSolverErrorMessage(schema)).toContain('unexpected response');
    expect(isRetryableSolverError(schema)).toBe(false);

    const verify = new QuoteVerificationError('bchRefundHeight', 'too low');
    expect(formatSolverErrorMessage(verify)).toContain('bchRefundHeight');
    expect(isRetryableSolverError(verify)).toBe(false);
  });
});
