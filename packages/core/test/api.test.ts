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

import {
  LiquidityResponseSchema,
  QuoteRefusalSchema,
  formatQuoteRefusalMessage,
} from '../src/api/index.js';

describe('QuoteRefusal and /v1/liquidity schemas', () => {
  it('validates all QuoteRefusal variants and builds one-line messages', () => {
    const insufficient = QuoteRefusalSchema.parse({
      reason: 'INSUFFICIENT_LIQUIDITY',
      maxAmount: '42',
      asset: 'PUSD',
    });
    expect(formatQuoteRefusalMessage(insufficient)).toBe(
      'Only 42 PUSD available; try 42 or less',
    );

    const overMax = QuoteRefusalSchema.parse({
      reason: 'OVER_MAX_SWAP',
      maxAmount: '500',
      asset: 'USDC',
    });
    expect(formatQuoteRefusalMessage(overMax)).toContain('500 USDC');

    for (const reason of [
      'PEG_GUARD',
      'PRICE_UNAVAILABLE',
      'ROUTE_DISABLED',
      'QUOTING_PAUSED',
    ] as const) {
      const parsed = QuoteRefusalSchema.parse({ reason, asset: 'PUSD' });
      expect(formatQuoteRefusalMessage(parsed).length).toBeGreaterThan(0);
    }
  });

  it('validates /v1/liquidity response with unix seconds asOf', () => {
    const res = LiquidityResponseSchema.parse({
      routes: [
        {
          route: 'base:usdc->bch:pusd',
          asset: 'PUSD',
          decimals: 2,
          available: '4200',
          inventory: '10000',
          exposure: '5000',
          reserved: '800',
        },
      ],
      asOf: 1794764200,
    });
    expect(res.routes).toHaveLength(1);
    expect(() =>
      LiquidityResponseSchema.parse({
        routes: [],
        asOf: 1794764200000,
      }),
    ).toThrow();
  });
});
