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

import {
  CancelPayLinkResponseSchema,
  ChainsResponseSchema,
  CreatePayLinkRequestSchema,
  MetricsResponseSchema,
  OperatorNeedsAttentionResponseSchema,
  OrderStatusResponseSchema,
  OwnerPayLinksResponseSchema,
  PayLinkDetailsResponseSchema,
  PayLinkQuoteRequestSchema,
  PegsResponseSchema,
  QuoteRequestSchema,
  QuoteResponseSchema,
  RecentOrdersResponseSchema,
  RelayClaimResponseSchema,
  RelayLockRequestSchema,
  RelayLockResponseSchema,
  RevealSecretResponseSchema,
  SendLinkDetailsResponseSchema,
  SendQuoteRequestSchema,
  StatsResponseSchema,
} from '../src/api/index.js';

const HEX32 = `0x${'ab'.repeat(32)}`;
const EVM_ADDR = '0x1111111111111111111111111111111111111111';
const BCH_LOCKING = '0x76a91400112233445566778899aabbccddeeff0011223388ac';

describe('Blueprint route schemas in @ferry/core/api', () => {
  it('parses QuoteRequest, QuoteResponse, OrderStatus, Reveal, and Relay schemas', () => {
    const quoteReq = QuoteRequestSchema.parse({
      direction: 'EVM_TO_BCH',
      token: 'PUSD',
      chainId: 84532,
      evmToken: EVM_ADDR,
      amountIn: '10000000',
      userEvmAddress: EVM_ADDR,
      userBchLockingBytecode: BCH_LOCKING,
      hashLock: HEX32,
      lane: 'fast',
    });
    expect(quoteReq.amountIn).toBe(10_000_000n);

    const quoteRes = QuoteResponseSchema.parse({
      orderId: HEX32,
      signature: `0x${'cd'.repeat(65)}`,
      signerAddress: EVM_ADDR,
      terms: {
        version: 1,
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        bchTokenCategory: HEX32,
        bchTokenAmount: '995',
        evmAmount: '10000000',
        evmToken: EVM_ADDR,
        evmChainId: 84532,
        evmHtlc: EVM_ADDR,
        userEvmAddress: EVM_ADDR,
        userBchLockingBytecode: BCH_LOCKING,
        solverEvmAddress: EVM_ADDR,
        solverBchLockingBytecode: BCH_LOCKING,
        hashLock: HEX32,
        evmDeadline: 1_794_770_000,
        bchRefundHeight: 500_010,
        bchCarrySats: '3000',
        bchMaxFee: '1000',
        quoteId: 'q-1',
        quoteExpiry: 1_794_764_500,
        pricing: {
          refs: [
            {
              asset: 'PUSD',
              usdPrice: '1.00',
              source: 'cauldron',
              asOf: 1_794_764_200,
            },
          ],
          spreadBps: 50,
          fixedFeeBase: '0',
          rounding: 'floor',
        },
      },
    });
    expect(quoteRes.terms.evmAmount).toBe(10_000_000n);
    expect(quoteRes.terms.pricing?.fixedFeeBase).toBe(0n);

    expect(() =>
      QuoteResponseSchema.parse({
        ...quoteRes,
        terms: { ...quoteRes.terms, bchMaxFee: '5000' },
      }),
    ).toThrow(/bchMaxFee/);

    const status = OrderStatusResponseSchema.parse({
      orderId: HEX32,
      state: 'QUOTED',
      direction: 'EVM_TO_BCH',
      txids: { evmLock: HEX32 },
      quoteExpiry: 1_794_764_500,
      counterDeadline: 1_794_770_000,
      bchRefundHeight: 500_010,
      updatedAt: 1_794_764_200,
    });
    expect(status.state).toBe('QUOTED');

    expect(
      RevealSecretResponseSchema.parse({ ok: true, orderId: HEX32 }).ok,
    ).toBe(true);
    expect(
      RelayLockRequestSchema.parse({
        intent: { orderId: HEX32, deadline: 1_794_764_500 },
        signature: '0x1234',
      }).intent.orderId,
    ).toBe(HEX32);
    expect(
      RelayLockResponseSchema.parse({
        ok: true,
        orderId: HEX32,
        txHash: HEX32,
      }).txHash,
    ).toBe(HEX32);
    expect(
      RelayClaimResponseSchema.parse({
        ok: true,
        orderId: HEX32,
        txHash: HEX32,
      }).txHash,
    ).toBe(HEX32);
  });

  it('parses chains, stats, recent orders, pegs, metrics, operator, and link schemas', () => {
    expect(
      ChainsResponseSchema.parse({
        chains: [
          {
            chainId: 84532,
            name: 'Base Sepolia',
            enabled: true,
            confirmations: { fast: 1, safe: 10 },
            tokens: [
              { symbol: 'USDC', address: EVM_ADDR, decimals: 6, permit: true },
            ],
          },
        ],
      }).chains,
    ).toHaveLength(1);

    expect(
      StatsResponseSchema.parse({
        completedSwaps: 12,
        totalVolumeUsd: '1234.56',
        medianFastSeconds: 18,
        asOf: 1_794_764_200,
      }).completedSwaps,
    ).toBe(12);

    expect(
      RecentOrdersResponseSchema.parse({
        orders: [
          {
            orderId: HEX32,
            direction: 'EVM_TO_BCH',
            bchToken: 'PUSD',
            evmChainId: 84532,
            bchTokenAmount: '1000',
            evmAmount: '10000000',
            settledAt: 1_794_764_200,
            durationSeconds: 15,
          },
        ],
      }).orders,
    ).toHaveLength(1);

    expect(
      PegsResponseSchema.parse({
        tokens: [
          {
            asset: 'PUSD',
            currentUsdPrice: '1.00',
            points: [{ at: 1_794_764_200, usdPrice: '1.00' }],
          },
        ],
        asOf: 1_794_764_200,
      }).tokens,
    ).toHaveLength(1);

    expect(
      MetricsResponseSchema.parse({
        openExposureUsd: '0',
        unfundedQuotes: 0,
        tipAges: { bchSeconds: 30, evmSeconds: { '84532': 2 } },
        errorCounts: {},
        lastConfirmedAt: null,
        timestamp: 1_794_764_200,
      }).unfundedQuotes,
    ).toBe(0);

    expect(
      OperatorNeedsAttentionResponseSchema.parse({
        alerts: [],
        orders: [],
        timestamp: 1_794_764_200,
      }).alerts,
    ).toHaveLength(0);

    expect(
      CreatePayLinkRequestSchema.parse({
        token: 'PUSD',
        recipientAddress: 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
        amountOut: '500',
      }).amountOut,
    ).toBe(500n);

    const payLink = PayLinkDetailsResponseSchema.parse({
      id: 'pl-1',
      kind: 'invoice',
      status: 'open',
      token: 'PUSD',
      recipientAddress: 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq23p8f7d9',
      recipientLockingBytecode: BCH_LOCKING,
      amountOut: '500',
      createdAt: 1_794_764_200,
    });
    expect(
      OwnerPayLinksResponseSchema.parse({
        owner: payLink.recipientAddress,
        links: [payLink],
      }).links,
    ).toHaveLength(1);

    expect(
      PayLinkQuoteRequestSchema.parse({
        chainId: 84532,
        evmToken: EVM_ADDR,
        userEvmAddress: EVM_ADDR,
        hashLock: HEX32,
        lane: 'fast',
      }).lane,
    ).toBe('fast');

    expect(
      CancelPayLinkResponseSchema.parse({
        ok: true,
        id: 'pl-1',
        status: 'cancelled',
      }).status,
    ).toBe('cancelled');

    expect(
      SendQuoteRequestSchema.parse({
        token: 'PUSD',
        chainId: 84532,
        evmToken: EVM_ADDR,
        amountIn: '500',
        recipientEvmAddress: EVM_ADDR,
        userEvmAddress: EVM_ADDR,
        userBchLockingBytecode: BCH_LOCKING,
        hashLock: HEX32,
        windowSeconds: 86400,
        lane: 'safe',
      }).windowSeconds,
    ).toBe(86400);

    expect(
      SendLinkDetailsResponseSchema.parse({
        id: 'sl-1',
        status: 'locked',
        token: 'PUSD',
        chainId: 84532,
        evmToken: EVM_ADDR,
        recipientEvmAddress: EVM_ADDR,
        hashLock: HEX32,
        evmDeadline: 1_794_850_600,
        bchRefundHeight: 500_144,
        createdAt: 1_794_764_200,
        updatedAt: 1_794_764_210,
      }).status,
    ).toBe('locked');
  });

  it('validates ListPayLinksQuerySchema and maps every ApiErrorCode to a message', async () => {
    const {
      API_ERROR_MESSAGES,
      ListPayLinksQuerySchema,
      formatApiErrorMessage,
    } = await import('../src/api/index.js');

    expect(
      ListPayLinksQuerySchema.parse({
        owner: 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq00000000',
        sig: 'sig-abc',
      }).owner,
    ).toContain('bchtest:');

    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
      expect(formatApiErrorMessage(code)).toBe(API_ERROR_MESSAGES[code]);
      expect(formatApiErrorMessage(code, 'extra detail')).toContain(
        'extra detail',
      );
    }
  });
});

describe('QuoteRequestSchema dryRun', () => {
  const base = {
    direction: 'EVM_TO_BCH',
    token: 'PUSD',
    chainId: 8453,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amountIn: '1000000',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode: `0x76a914${'11'.repeat(20)}88ac`,
    hashLock: `0x${'33'.repeat(32)}`,
    lane: 'fast',
  } as const;

  it('accepts an optional boolean dryRun and keeps it', () => {
    expect(QuoteRequestSchema.parse(base).dryRun).toBeUndefined();
    expect(QuoteRequestSchema.parse({ ...base, dryRun: true }).dryRun).toBe(
      true,
    );
    expect(QuoteRequestSchema.parse({ ...base, dryRun: false }).dryRun).toBe(
      false,
    );
  });

  it('rejects a non-boolean dryRun', () => {
    expect(() =>
      QuoteRequestSchema.parse({ ...base, dryRun: 'yes' }),
    ).toThrow();
    expect(() => QuoteRequestSchema.parse({ ...base, dryRun: 1 })).toThrow();
  });
});

describe('send link notes and claim windows', () => {
  const base = {
    token: 'PUSD',
    chainId: 8453,
    evmToken: EVM_ADDR,
    amountIn: '500',
    recipientEvmAddress: EVM_ADDR,
    userEvmAddress: EVM_ADDR,
    userBchLockingBytecode: BCH_LOCKING,
    hashLock: HEX32,
    windowSeconds: 86400,
    lane: 'safe',
  };

  it('accepts a plain note up to 140 characters, trimmed', () => {
    expect(
      SendQuoteRequestSchema.parse({ ...base, note: '  Thanks for dinner  ' })
        .note,
    ).toBe('Thanks for dinner');
    expect(
      SendQuoteRequestSchema.parse({ ...base, note: 'x'.repeat(140) }).note,
    ).toHaveLength(140);
  });

  it('refuses an empty note, one that is too long, and one with line breaks', () => {
    for (const note of [
      '',
      '   ',
      'x'.repeat(141),
      'a\nb',
      'a\tb',
      'a\u2028b',
    ]) {
      expect(() => SendQuoteRequestSchema.parse({ ...base, note })).toThrow();
    }
  });

  it('keeps the window between one hour and seven days', () => {
    expect(
      SendQuoteRequestSchema.parse({ ...base, windowSeconds: 3600 })
        .windowSeconds,
    ).toBe(3600);
    expect(
      SendQuoteRequestSchema.parse({ ...base, windowSeconds: 7 * 86400 })
        .windowSeconds,
    ).toBe(7 * 86400);
    expect(() =>
      SendQuoteRequestSchema.parse({ ...base, windowSeconds: 3599 }),
    ).toThrow();
    expect(() =>
      SendQuoteRequestSchema.parse({ ...base, windowSeconds: 7 * 86400 + 1 }),
    ).toThrow();
  });
});
