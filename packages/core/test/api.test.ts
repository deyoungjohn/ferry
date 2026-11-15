import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  ApiErrorCodeSchema,
} from '../src/index.js';
import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
} from '../src/api/index.js';

describe('API error codes and schemas', () => {
  it('includes all required error codes with valid HTTP statuses', () => {
    const required = [
      'INSUFFICIENT_USER_BALANCE',
      'RELAY_LOCK_REVERTED',
      'QUOTE_EXPIRED',
      'ORDER_NOT_FOUND',
      'UNSUPPORTED_ROUTE',
      'AMOUNT_OUT_OF_RANGE',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const;
    for (const code of required) {
      expect(API_ERROR_CODES).toContain(code);
      expect(ApiErrorCodeSchema.parse(code)).toBe(code);
      expect(API_ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(API_ERROR_HTTP_STATUS[code]).toBeLessThan(600);
    }
  });

  it('validates ApiErrorResponseSchema and HealthResponseSchema with unix seconds', () => {
    const err = ApiErrorResponseSchema.parse({
      error: { code: 'QUOTE_EXPIRED', message: 'Quote expired' },
    });
    expect(err.error.code).toBe('QUOTE_EXPIRED');

    const health = HealthResponseSchema.parse({
      ok: true,
      quotingEnabled: true,
      timestamp: 1794764200,
    });
    expect(health.timestamp).toBe(1794764200);

    expect(() =>
      HealthResponseSchema.parse({
        ok: true,
        quotingEnabled: true,
        timestamp: 1794764200000,
      }),
    ).toThrow();
  });
});
