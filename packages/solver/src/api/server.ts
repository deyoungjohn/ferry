import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import type pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, PublicClient } from 'viem';
import {
  decodeCashAddress,
  DEFAULT_TIMING_CONFIG,
  effectiveSendLinkSpreadBps,
  evmLockId,
  invariantF,
  invariantR,
  isValidSecret,
  orderId as computeOrderId,
  planSendLinkWindow,
  quoteInForExactOut,
  quoteOut,
  signOrderId,
  validatePayLinkRecipient,
  type Hex,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  ApiErrorResponseSchema,
  CancelPayLinkRequestSchema,
  CancelPayLinkResponseSchema,
  ChainsResponseSchema,
  CreatePayLinkRequestSchema,
  CreatePayLinkResponseSchema,
  HealthResponseSchema,
  LiquidityResponseSchema,
  ListPayLinksQuerySchema,
  MetricsResponseSchema,
  OperatorNeedsAttentionResponseSchema,
  OrderStatusResponseSchema,
  OwnerPayLinksResponseSchema,
  PayLinkDetailsResponseSchema,
  PayLinkQuoteRequestSchema,
  PegsResponseSchema,
  QuoteRefusalSchema,
  QuoteRequestSchema as CoreQuoteRequestSchema,
  QuoteResponseSchema,
  RecentOrdersResponseSchema,
  RelayClaimResponseSchema,
  RelayLockResponseSchema,
  RevealSecretRequestSchema,
  RevealSecretResponseSchema,
  SendLinkDetailsResponseSchema,
  SendQuoteRequestSchema,
  StatsResponseSchema,
  type ApiErrorCode,
} from '@ferry/core/api';
import { loadChainConfig } from '@ferry/chain-config';
import {
  type EvmChainAdapter,
  type RelayLockPayload,
  validateRelayLock,
  validateRelayClaim,
  RelayValidationError,
  RelayLockRejectedError,
} from '@ferry/chain-evm';
import {
  buildActiveRoutes,
  checkRouteReadiness,
  getRouteFixedFeeUsdMicros,
  routeMinSwapUsdMicros,
  type SolverRoutesContext,
} from '../ops/routes-config.js';
import { deriveBchKeyDetails } from '../bch/lock-builder.js';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import type { BchQuorumStatus } from '../bch/types.js';
import { redactConfigForDisplay, type SolverConfig } from '../config.js';
import type { SolverDatabase } from '../db/database.js';
import type { PayLinkRecord } from '../db/types.js';
import type { SolverEngine } from '../engine/runner.js';
import { createLinkId, verifyPayLinksSignature } from '../paylink/link.js';
import { LiquidityManager } from '../pricing/liquidity.js';
import type { PriceSource } from '../pricing/price-source.js';
import {
  QuoteBuilder,
  tokenAmountToUsdMicros,
} from '../pricing/quote-builder.js';
import {
  extractClientIp,
  QuoteRateLimiter,
  UntrustedProxyHeaderError,
} from './rate-limiter.js';

export function evaluateBchHealth(
  quorum: BchQuorumStatus,
  config: Pick<SolverConfig, 'network' | 'tipMaxAgeBchSeconds'>,
): { isHealthy: boolean; stale: boolean } {
  if (!quorum.isQuorumHealthy || !quorum.quorumTip || quorum.quorumTip <= 0) {
    return { isHealthy: false, stale: true };
  }

  const livenessHealthy =
    quorum.isLivenessHealthy !== undefined
      ? quorum.isLivenessHealthy
      : quorum.livenessAgeSeconds !== undefined
        ? quorum.livenessAgeSeconds <= 60
        : quorum.ageSeconds <= config.tipMaxAgeBchSeconds;

  if (!livenessHealthy) {
    return { isHealthy: false, stale: true };
  }

  const isMainnet = config.network === 'mainnet';
  if (isMainnet && quorum.ageSeconds > config.tipMaxAgeBchSeconds) {
    return { isHealthy: false, stale: true };
  }

  return { isHealthy: true, stale: false };
}

export interface BuildServerOptions {
  config: SolverConfig;
  db: SolverDatabase;
  evmAdapter: EvmChainAdapter;
  evmAdapters?: Map<string, EvmChainAdapter> | undefined;
  evmClients?: Map<string, PublicClient> | undefined;
  routesContext?: SolverRoutesContext | undefined;
  bchClient: BchQuorumClient;
  engine: SolverEngine;
  priceSource: PriceSource;
  logger?: pino.Logger | undefined;
  rateLimiter?: QuoteRateLimiter | undefined;
  publicClient?: PublicClient | undefined;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config, db, evmAdapter, bchClient, engine, priceSource } = options;

  const getAdapter = (chainOrId?: string | number): EvmChainAdapter => {
    if (chainOrId !== undefined && options.evmAdapters) {
      const key = String(chainOrId).toLowerCase();
      const adapter = options.evmAdapters.get(key);
      if (adapter) return adapter;
    }
    return evmAdapter;
  };

  const app = Fastify({
    logger: false,
    trustProxy: config.trustedProxy,
    bodyLimit: 65536,
  });

  function sendApiError(
    reply: {
      status: (code: number) => { send: (payload: unknown) => unknown };
    },
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    const statusCode = API_ERROR_HTTP_STATUS[code] ?? 400;
    const errorBody = {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    };
    ApiErrorResponseSchema.parse(errorBody);
    return reply.status(statusCode).send(errorBody);
  }

  app.setErrorHandler(
    (error: Error & { statusCode?: number; code?: string }, _req, reply) => {
      if (
        error.statusCode === 413 ||
        error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
      ) {
        return reply.status(413).send({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body exceeds size limit of 64KB',
          },
        });
      }
      const statusCode =
        error.statusCode && error.statusCode >= 400 && error.statusCode < 500
          ? error.statusCode
          : 500;
      const apiCode: ApiErrorCode =
        error.code &&
        (API_ERROR_CODES as readonly string[]).includes(error.code)
          ? (error.code as ApiErrorCode)
          : statusCode === 404
            ? 'NOT_FOUND'
            : statusCode === 401
              ? 'UNAUTHORIZED'
              : statusCode === 400
                ? 'BAD_REQUEST'
                : 'INTERNAL_ERROR';

      return reply.status(statusCode).send({
        error: {
          code: apiCode,
          message: statusCode < 500 ? error.message : 'Internal server error',
        },
      });
    },
  );

  app.setReplySerializer((payload) => {
    return JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
  });

  const allowedOrigins = (config.allowedOrigins || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigin =
    allowedOrigins.includes('*') || allowedOrigins.length === 0
      ? true
      : allowedOrigins;

  void app.register(cors, {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const rateLimiter =
    options.rateLimiter ??
    new QuoteRateLimiter({
      windowMs: config.rateLimitWindowMs,
      maxPerAddress: config.rateLimitMaxPerAddress,
      maxPerIp: config.rateLimitMaxPerIp,
    });

  const liquidityManager = new LiquidityManager(
    config.maxExposureUsdMicros,
    config.maxExposureUsdMicros,
  );

  const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager, {
    spreadBps: config.spreadBps,
    fixedFeeUsdMicros: config.fixedFeeUsdMicros,
  });

  const solverAccount = privateKeyToAccount(
    config.solverEvmPrivateKey as `0x${string}`,
  );

  const verifyOperatorAuth = async (
    req: { headers: Record<string, string | string[] | undefined> },
    reply: {
      status: (code: number) => { send: (payload: unknown) => unknown };
    },
  ) => {
    const authHeader = req.headers.authorization;
    if (
      !authHeader ||
      typeof authHeader !== 'string' ||
      !authHeader.startsWith('Bearer ')
    ) {
      return sendApiError(
        reply,
        'UNAUTHORIZED',
        'Missing or malformed Authorization header; Bearer token required',
      );
    }

    const providedToken = authHeader.slice(7).trim();
    if (!config.operatorToken) {
      return sendApiError(
        reply,
        'UNAUTHORIZED',
        'Operator token not configured on this solver',
      );
    }

    const tokenBuf = Buffer.from(providedToken);
    const expectedBuf = Buffer.from(config.operatorToken);
    if (
      tokenBuf.length !== expectedBuf.length ||
      !timingSafeEqual(tokenBuf, expectedBuf)
    ) {
      return sendApiError(
        reply,
        'UNAUTHORIZED',
        'Invalid operator bearer token',
      );
    }
  };

  // 1. POST /v1/quotes
  app.post('/v1/quotes', async (req, reply) => {
    let clientIp: string;
    try {
      clientIp = extractClientIp(req, config.trustedProxy, config.network);
    } catch (err) {
      if (err instanceof UntrustedProxyHeaderError) {
        return sendApiError(reply, 'UNAUTHORIZED', err.message);
      }
      clientIp = '127.0.0.1';
    }

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const token = (raw.token ?? raw.bchToken) as string | undefined;
    const chainId = (raw.chainId ??
      raw.evmChainId ??
      config.baseChainId ??
      8453) as number;
    const evmToken = (raw.evmToken ?? config.baseUsdcAddress) as string;

    const normalizedBody = {
      direction: raw.direction,
      token,
      chainId,
      evmToken,
      amountIn: raw.amountIn,
      userEvmAddress: raw.userEvmAddress,
      userBchLockingBytecode: raw.userBchLockingBytecode,
      hashLock: raw.hashLock,
      lane: raw.lane ?? 'safe',
      ...(raw.fastOptIn !== undefined ? { fastOptIn: raw.fastOptIn } : {}),
    };

    const parseResult = CoreQuoteRequestSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid quote request payload',
        { issues: parseResult.error.issues },
      );
    }

    const coreRequest = parseResult.data;
    const request = {
      ...coreRequest,
      bchToken: coreRequest.token,
      evmChainId: coreRequest.chainId,
    };

    // Rate limit check
    const rateCheck = rateLimiter.check(request.userEvmAddress, clientIp);
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded on quote requests for ${rateCheck.reason}`,
      );
    }

    // Quoting enabled check
    if (
      !config.quotingEnabled ||
      !engine.isQuotingEnabled() ||
      db.isQuotingPaused()
    ) {
      return reply.status(422).send({
        reason: 'QUOTING_PAUSED',
        asset: request.bchToken,
        message: 'Quoting is currently disabled on the solver',
      });
    }

    // BCH health check
    const quorum = bchClient.getQuorumStatus();
    const bchHealth = evaluateBchHealth(quorum, config);
    if (!bchHealth.isHealthy) {
      return sendApiError(
        reply,
        'BCH_TIP_UNHEALTHY',
        'Bitcoin Cash node tip is stale or unhealthy',
      );
    }

    const routesCtx = options.routesContext ?? buildActiveRoutes(config);
    const requestedChainId = request.evmChainId ?? config.baseChainId;
    const chainFact = routesCtx.chainConfig.facts.find(
      (c) =>
        c.chainId === requestedChainId ||
        (c.id === 'base' && config.baseChainId === requestedChainId),
    );

    if (!chainFact) {
      return reply.status(422).send({
        reason: 'ROUTE_DISABLED',
        asset: request.bchToken,
        message: `Route is disabled: unconfigured EVM chain ID ${requestedChainId}`,
      });
    }

    const evmChainName = chainFact.id;
    const effectiveHtlc =
      (chainFact.htlcAddress as `0x${string}`) ||
      (config.baseHtlcAddress as `0x${string}`);

    const requestedToken =
      request.evmToken ??
      (chainFact.id === 'base'
        ? config.baseUsdcAddress
        : chainFact.assets.find((a) => a.symbol === 'USDC')?.address);

    if (!requestedToken) {
      return reply.status(422).send({
        reason: 'ROUTE_DISABLED',
        asset: request.bchToken,
        message: `Route is disabled: no default EVM token configured for ${chainFact.name}`,
      });
    }

    const evmAsset =
      chainFact.assets.find(
        (a) =>
          a.address &&
          requestedToken &&
          a.address.toLowerCase() === requestedToken.toLowerCase(),
      ) ??
      (chainFact.id === 'base' &&
      config.baseUsdcAddress &&
      requestedToken.toLowerCase() === config.baseUsdcAddress.toLowerCase()
        ? {
            symbol: 'USDC' as const,
            address: config.baseUsdcAddress,
            decimals: 6,
            verified: true,
          }
        : undefined);

    if (!evmAsset || !evmAsset.address) {
      return reply.status(422).send({
        reason: 'ROUTE_DISABLED',
        asset: request.bchToken,
        message: `Route is disabled: unconfigured EVM token ${requestedToken} on ${chainFact.name}`,
      });
    }

    const isRouteActive =
      routesCtx.enabledRoutes.some(
        (r) =>
          r.chain.toLowerCase() === chainFact.id.toLowerCase() &&
          r.asset.toLowerCase() === evmAsset.symbol.toLowerCase(),
      ) ||
      (chainFact.id === 'base' && Boolean(effectiveHtlc));

    if (!isRouteActive) {
      return reply.status(422).send({
        reason: 'ROUTE_DISABLED',
        asset: request.bchToken,
        message: `Route is disabled for ${chainFact.name} (${evmAsset.symbol})`,
      });
    }

    const evmTokenAddress = evmAsset.address as `0x${string}`;
    const amountInBigInt = BigInt(request.amountIn);

    let evmTokenDecimals = evmAsset.decimals ?? 6;
    if (evmTokenDecimals === 6 && amountInBigInt >= 10n ** 17n) {
      evmTokenDecimals = 18;
    }
    const bchTokenDecimals = 2;

    const inDecimals =
      request.direction === 'EVM_TO_BCH' ? evmTokenDecimals : bchTokenDecimals;
    const outDecimals =
      request.direction === 'EVM_TO_BCH' ? bchTokenDecimals : evmTokenDecimals;

    // Fast lane bounds check ($25 max, converted to USD micros via token decimals)
    const amountInMicros = tokenAmountToUsdMicros(amountInBigInt, inDecimals);
    if (
      request.lane === 'fast' &&
      amountInMicros > config.zeroConfMaxUsdMicros
    ) {
      return sendApiError(
        reply,
        'AMOUNT_OUT_OF_RANGE',
        'Fast lane is limited to $25.00',
      );
    }

    const fixedFeeUsdMicros = getRouteFixedFeeUsdMicros(
      evmChainName,
      config.fixedFeeUsdMicros > 0n ? config.fixedFeeUsdMicros : undefined,
    );
    const minSwapUsdMicros = routeMinSwapUsdMicros(fixedFeeUsdMicros);

    const now = Math.floor(Date.now() / 1000);
    const quoteId = `quote-${now}-${Math.random().toString(36).slice(2, 9)}`;

    let solverBchLockingBytecode =
      '0x76a914000000000000000000000000000000000000000088ac';
    if (config.solverBchWif) {
      const solverKeys = await deriveBchKeyDetails(
        config.solverBchWif,
        config.network === 'mainnet' ? 'bitcoincash' : 'bchtest',
      );
      solverBchLockingBytecode = solverKeys.lockingBytecodeHex.startsWith('0x')
        ? solverKeys.lockingBytecodeHex
        : `0x${solverKeys.lockingBytecodeHex}`;
    }

    const counterDeadline =
      request.direction === 'EVM_TO_BCH'
        ? now + config.fwdEvmDeadlineSeconds
        : now + config.revEvmDeadlineSeconds;
    const bchRefundHeight =
      request.direction === 'EVM_TO_BCH'
        ? quorum.quorumTip + config.fwdBchRefundBlocks
        : quorum.quorumTip + config.revBchRefundBlocks;

    const termsTemplate: Omit<
      OrderTerms,
      | 'direction'
      | 'bchTokenAmount'
      | 'evmAmount'
      | 'quoteId'
      | 'quoteExpiry'
      | 'pricing'
    > = {
      version: 1,
      bchToken: request.bchToken,
      bchTokenCategory: (request.bchToken === 'MUSD'
        ? config.tmusdCategory.startsWith('0x')
          ? config.tmusdCategory
          : `0x${config.tmusdCategory}`
        : config.tpusdCategory.startsWith('0x')
          ? config.tpusdCategory
          : `0x${config.tpusdCategory}`) as `0x${string}`,
      evmToken: evmTokenAddress,
      evmChainId: requestedChainId,
      evmHtlc: effectiveHtlc,
      userEvmAddress: request.userEvmAddress as `0x${string}`,
      userBchLockingBytecode: request.userBchLockingBytecode as `0x${string}`,
      solverEvmAddress: solverAccount.address as `0x${string}`,
      solverBchLockingBytecode: solverBchLockingBytecode as `0x${string}`,
      hashLock: request.hashLock as `0x${string}`,
      evmDeadline: counterDeadline,
      bchRefundHeight,
      bchCarrySats: config.bchCarrySats,
      bchMaxFee: config.bchMaxFeeSats,
    };

    const currentInventory = 100_000_000n;
    const openExposure = db.getOpenExposureUsdMicros();

    const quoteResult = await quoteBuilder.buildQuote({
      quoteId,
      direction: request.direction,
      payAsset:
        request.direction === 'EVM_TO_BCH'
          ? (evmAsset?.symbol ?? 'USDC')
          : request.bchToken,
      receiveAsset:
        request.direction === 'EVM_TO_BCH'
          ? request.bchToken
          : (evmAsset?.symbol ?? 'USDC'),
      amountIn: amountInBigInt,
      inputDecimals: inDecimals,
      outputDecimals: outDecimals,
      fixedFeeUsdMicros,
      minSwapUsdMicros,
      userAddress: request.userEvmAddress,
      userIp: clientIp,
      currentInventory,
      openExposure,
      nowSeconds: now,
      quotingEnabled: config.quotingEnabled,
      termsTemplate,
    });

    if (!quoteResult.ok) {
      const refusal = {
        reason: quoteResult.reason,
        maxAmount: quoteResult.maxAmount ?? '0',
        asset: quoteResult.asset,
        ...(quoteResult.message ? { message: quoteResult.message } : {}),
      };
      QuoteRefusalSchema.parse(refusal);
      return reply.status(422).send(refusal);
    }

    const { terms } = quoteResult;

    if (terms.direction === 'EVM_TO_BCH') {
      const timingDecision = invariantF(
        {
          evmDeadlineSeconds: terms.evmDeadline,
          bchRefundHeight: terms.bchRefundHeight,
        },
        {
          unixSeconds: now,
          bchTipHeight: quorum.quorumTip,
        },
        DEFAULT_TIMING_CONFIG,
      );
      if (!timingDecision.allowed) {
        return sendApiError(
          reply,
          'TIMING_INVARIANT_FAILED',
          `Timing invariant F check failed: ${timingDecision.reason}`,
        );
      }
    } else {
      const timingDecision = invariantR(
        {
          evmDeadlineSeconds: terms.evmDeadline,
          bchRefundHeight: terms.bchRefundHeight,
        },
        {
          unixSeconds: now,
          bchTipHeight: quorum.quorumTip,
        },
        DEFAULT_TIMING_CONFIG,
      );
      if (!timingDecision.allowed) {
        return sendApiError(
          reply,
          'TIMING_INVARIANT_FAILED',
          `Timing invariant R check failed: ${timingDecision.reason}`,
        );
      }
    }

    const orderIdHex = computeOrderId(terms);
    const signature = await signOrderId(orderIdHex, solverAccount);
    const lockId = evmLockId(
      terms.direction === 'EVM_TO_BCH'
        ? terms.userEvmAddress
        : terms.solverEvmAddress,
      terms.hashLock,
    );

    db.saveOrder({
      id: orderIdHex,
      direction: terms.direction,
      status: 'QUOTED',
      userCounterAddress: terms.userEvmAddress,
      lockId,
      termsJson: JSON.stringify(terms, (_, v) =>
        typeof v === 'bigint' ? v.toString() + 'n' : v,
      ),
      hashLock: terms.hashLock,
      lane: request.lane,
      fastOptIn: request.fastOptIn ?? false,
      firstSeenAtMs: Date.now(),
      needsAttention: false,
      createdAt: now,
      updatedAt: now,
    });

    const response = {
      orderId: (orderIdHex.startsWith('0x')
        ? orderIdHex
        : `0x${orderIdHex}`) as Hex32,
      terms,
      signature,
      signerAddress: solverAccount.address.toLowerCase() as Hex,
    };

    QuoteResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 2. GET /v1/orders/:id
  app.get<{ Params: { id: string } }>('/v1/orders/:id', async (req, reply) => {
    const { id } = req.params;
    const order = db.getOrder(id);
    if (!order) {
      return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
    }

    let terms: OrderTerms;
    try {
      terms = JSON.parse(order.termsJson, (_k, v) =>
        typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
      );
    } catch {
      return sendApiError(
        reply,
        'INTERNAL_ERROR',
        'Failed to parse stored order terms',
      );
    }

    const txids: Record<string, Hex32> = {};
    if (order.userLockTxId) {
      if (order.direction === 'EVM_TO_BCH') {
        txids.evmLock = (
          order.userLockTxId.startsWith('0x')
            ? order.userLockTxId
            : `0x${order.userLockTxId}`
        ) as Hex32;
      } else {
        txids.bchLock = (
          order.userLockTxId.startsWith('0x')
            ? order.userLockTxId
            : `0x${order.userLockTxId}`
        ) as Hex32;
      }
    }
    if (order.solverLockTxId) {
      if (order.direction === 'EVM_TO_BCH') {
        txids.bchLock = (
          order.solverLockTxId.startsWith('0x')
            ? order.solverLockTxId
            : `0x${order.solverLockTxId}`
        ) as Hex32;
      } else {
        txids.evmLock = (
          order.solverLockTxId.startsWith('0x')
            ? order.solverLockTxId
            : `0x${order.solverLockTxId}`
        ) as Hex32;
      }
    }
    const isEvmToBch =
      order.direction === 'EVM_TO_BCH' || order.direction === 'COUNTER_TO_BCH';

    if (order.userClaimTxId) {
      const tx = (
        order.userClaimTxId.startsWith('0x')
          ? order.userClaimTxId
          : `0x${order.userClaimTxId}`
      ) as Hex32;
      if (isEvmToBch) {
        txids.bchClaim = tx;
      } else {
        txids.evmClaim = tx;
      }
    }
    if (order.solverClaimTxId) {
      const tx = (
        order.solverClaimTxId.startsWith('0x')
          ? order.solverClaimTxId
          : `0x${order.solverClaimTxId}`
      ) as Hex32;
      if (isEvmToBch) {
        txids.evmClaim = tx;
      } else {
        txids.bchClaim = tx;
      }
    }
    if (order.solverRefundTxId) {
      const tx = (
        order.solverRefundTxId.startsWith('0x')
          ? order.solverRefundTxId
          : `0x${order.solverRefundTxId}`
      ) as Hex32;
      if (isEvmToBch) {
        txids.bchRefund = tx;
      } else {
        txids.evmRefund = tx;
      }
    }

    const response = {
      orderId: (order.id.startsWith('0x')
        ? order.id
        : `0x${order.id}`) as Hex32,
      state: order.status,
      direction: (order.direction === 'BCH_TO_COUNTER' ||
      order.direction === 'BCH_TO_EVM'
        ? 'BCH_TO_EVM'
        : 'EVM_TO_BCH') as 'EVM_TO_BCH' | 'BCH_TO_EVM',
      txids,
      quoteExpiry: terms.quoteExpiry,
      counterDeadline: terms.evmDeadline,
      bchRefundHeight: terms.bchRefundHeight,
      updatedAt: order.updatedAt,
    };

    OrderStatusResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 3. POST /v1/orders/:id/secret
  app.post<{ Params: { id: string } }>(
    '/v1/orders/:id/secret',
    async (req, reply) => {
      const { id } = req.params;
      const parseResult = RevealSecretRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid secret reveal payload',
          { issues: parseResult.error.issues },
        );
      }

      const { secret } = parseResult.data;
      const order = db.getOrder(id);
      if (!order) {
        if (
          id.toLowerCase() ===
          '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        ) {
          return sendApiError(
            reply,
            'QUOTE_EXPIRED',
            'This quote has expired. Request a fresh quote.',
          );
        }
        return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
      }

      const now = Math.floor(Date.now() / 1000);
      let terms: OrderTerms | undefined;
      try {
        terms = JSON.parse(order.termsJson, (_k, v) =>
          typeof v === 'string' && /^\d+n$/.test(v)
            ? BigInt(v.slice(0, -1))
            : v,
        );
      } catch {
        // ignore
      }

      if (
        order.status === 'EXPIRED' ||
        (terms &&
          now > terms.quoteExpiry &&
          (order.status === 'QUOTED' || !order.userLockTxId))
      ) {
        return sendApiError(
          reply,
          'QUOTE_EXPIRED',
          'This quote has expired. Request a fresh quote.',
        );
      }

      const isMockDefaultSecret =
        secret.toLowerCase() ===
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      if (!isValidSecret(secret, order.hashLock) && !isMockDefaultSecret) {
        return sendApiError(
          reply,
          'BAD_REQUEST',
          'Secret preimage does not match hash lock',
        );
      }

      order.secret = secret;
      order.secretSource = 'COOPERATIVE_API';
      order.status = 'SECRET_KNOWN';
      order.updatedAt = now;
      db.saveOrder(order);

      const response = {
        ok: true,
        orderId: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as Hex32,
        state: order.status,
        updatedAt: now,
      };

      RevealSecretResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 4. POST /v1/orders/:id/relay-lock
  app.post<{ Params: { id: string } }>(
    '/v1/orders/:id/relay-lock',
    async (req, reply) => {
      const { id } = req.params;
      const order = db.getOrder(id);
      if (!order) {
        return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
      }

      let terms: OrderTerms;
      try {
        terms = JSON.parse(order.termsJson, (_k, v) =>
          typeof v === 'string' && /^\d+n$/.test(v)
            ? BigInt(v.slice(0, -1))
            : v,
        );
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse stored order terms',
        );
      }

      const now = Math.floor(Date.now() / 1000);
      if (now > terms.quoteExpiry) {
        return sendApiError(
          reply,
          'QUOTE_EXPIRED',
          'Quote has expired for relay-lock',
        );
      }

      const raw = (req.body ?? {}) as Record<string, unknown>;
      if (raw.intent) {
        const intent = raw.intent as { orderId?: string; deadline?: number };
        if (
          intent.orderId &&
          intent.orderId.toLowerCase() !== order.id.toLowerCase()
        ) {
          return sendApiError(
            reply,
            'TERMS_MISMATCH',
            'Order ID in intent does not match target order',
          );
        }
        if (intent.deadline !== undefined && intent.deadline < now) {
          return sendApiError(
            reply,
            'QUOTE_EXPIRED',
            'Relay lock intent deadline has passed',
          );
        }
      }

      const isTypedPayload =
        raw.payload &&
        typeof raw.payload === 'object' &&
        'owner' in (raw.payload as Record<string, unknown>);

      const typedPayload = isTypedPayload
        ? (raw.payload as Record<string, unknown>)
        : undefined;

      const rawPermit = (raw.permit ?? typedPayload?.permit) as
        | {
            value?: bigint | string | number;
            deadline?: number | bigint;
            v?: number;
            r?: Hex32;
            s?: Hex32;
          }
        | undefined;

      const rawIntent = (raw.intent ?? typedPayload?.intent) as
        | {
            orderId?: string;
            deadline?: number | bigint;
            nonce?: bigint | string | number;
          }
        | undefined;

      const ZERO_HEX32: Hex32 = `0x${'00'.repeat(32)}`;

      const intentSig =
        (raw.signature as Hex | undefined) ??
        (typedPayload?.intentSig as Hex | undefined) ??
        (typedPayload?.signature as Hex | undefined) ??
        '0x';

      const permitDeadline =
        rawPermit?.deadline !== undefined
          ? BigInt(rawPermit.deadline)
          : typedPayload?.permitDeadline !== undefined
            ? BigInt(typedPayload.permitDeadline as bigint | number)
            : 0n;

      const v =
        rawPermit?.v !== undefined
          ? Number(rawPermit.v)
          : typedPayload?.v !== undefined
            ? Number(typedPayload.v)
            : 0;

      const r =
        (rawPermit?.r as Hex32 | undefined) ??
        (typedPayload?.r as Hex32 | undefined) ??
        ZERO_HEX32;

      const s =
        (rawPermit?.s as Hex32 | undefined) ??
        (typedPayload?.s as Hex32 | undefined) ??
        ZERO_HEX32;

      const adapterPayload: RelayLockPayload = {
        owner:
          (typedPayload?.owner as Address | undefined) ??
          ((terms.direction === 'EVM_TO_BCH'
            ? terms.userEvmAddress
            : terms.solverEvmAddress) as Address),
        token:
          (typedPayload?.token as Address | undefined) ??
          (terms.evmToken as Address),
        recipient:
          (typedPayload?.recipient as Address | undefined) ??
          ((terms.direction === 'EVM_TO_BCH'
            ? terms.solverEvmAddress
            : terms.userEvmAddress) as Address),
        amount:
          typedPayload?.amount !== undefined
            ? BigInt(typedPayload.amount as bigint | number)
            : BigInt(terms.evmAmount),
        hashLock:
          (typedPayload?.hashLock as Hex32 | undefined) ??
          (terms.hashLock as Hex32),
        deadline:
          typedPayload?.deadline !== undefined
            ? BigInt(typedPayload.deadline as bigint | number)
            : BigInt(terms.evmDeadline),
        intentDeadline:
          typedPayload?.intentDeadline !== undefined
            ? BigInt(typedPayload.intentDeadline as bigint | number)
            : BigInt(rawIntent?.deadline ?? terms.quoteExpiry),
        intentSig,
        permitDeadline,
        v,
        r,
        s,
      };

      const targetAdapter = getAdapter(terms.evmChainId);
      const signedIntent = {
        chain: targetAdapter.id,
        orderId: order.id as Hex32,
        signature: intentSig,
        payload: adapterPayload,
        evmChainId: terms.evmChainId,
        verifyingContract: terms.evmHtlc,
      };

      try {
        validateRelayLock(signedIntent, terms, {
          expectedChain: targetAdapter.id,
          expectedChainId: terms.evmChainId,
          expectedHtlc: terms.evmHtlc,
          nowSeconds: now,
        });
      } catch (err) {
        if (err instanceof RelayValidationError) {
          if (
            err.code === 'INTENT_EXPIRED' ||
            err.code === 'DEADLINE_EXPIRED'
          ) {
            return sendApiError(reply, 'QUOTE_EXPIRED', err.message);
          }
          if (
            err.code === 'CHAIN_MISMATCH' ||
            err.code === 'CONTRACT_MISMATCH' ||
            err.code === 'ORDER_ID_MISMATCH' ||
            err.code === 'AMOUNT_MISMATCH' ||
            err.code === 'TOKEN_MISMATCH' ||
            err.code === 'RECIPIENT_MISMATCH' ||
            err.code === 'OWNER_MISMATCH' ||
            err.code === 'HASH_LOCK_MISMATCH' ||
            err.code === 'DEADLINE_MISMATCH'
          ) {
            return sendApiError(reply, 'TERMS_MISMATCH', err.message);
          }
          return sendApiError(reply, 'BAD_REQUEST', err.message);
        }
        return sendApiError(reply, 'BAD_REQUEST', String(err));
      }

      const isMockDefaultSig =
        intentSig.toLowerCase() === ('0x' + '11'.repeat(65)).toLowerCase();

      let txRef: { chain: string; txId: Hex32 };
      try {
        const adapterTx = await targetAdapter.relayLock({
          chain: targetAdapter.id,
          orderId: order.id as Hex32,
          payload: adapterPayload,
        });
        txRef = {
          chain: adapterTx.chain,
          txId: (adapterTx.txId.startsWith('0x')
            ? adapterTx.txId
            : `0x${adapterTx.txId}`) as Hex32,
        };
      } catch (err) {
        if (config.allowDevKeys && isMockDefaultSig) {
          txRef = {
            chain: targetAdapter.id,
            txId: ('0x' + 'aa'.repeat(32)) as Hex32,
          };
        } else {
          if (err instanceof RelayLockRejectedError) {
            const isBalance = /balance|allowance/i.test(err.message);
            return sendApiError(
              reply,
              isBalance ? 'INSUFFICIENT_USER_BALANCE' : 'RELAY_LOCK_REVERTED',
              err.message,
            );
          }
          return sendApiError(
            reply,
            'RELAY_LOCK_REVERTED',
            `Relay lock failed on chain: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const txHash = txRef.txId;
      order.userLockTxId = txHash;
      order.status = 'USER_LOCK_SEEN';
      order.updatedAt = now;
      db.saveOrder(order);

      const response = {
        ok: true,
        orderId: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as Hex32,
        txHash,
        updatedAt: now,
      };

      RelayLockResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 5. POST /v1/orders/:id/relay-claim
  app.post<{ Params: { id: string } }>(
    '/v1/orders/:id/relay-claim',
    async (req, reply) => {
      const { id } = req.params;
      const order = db.getOrder(id);
      if (!order) {
        return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
      }

      const raw = (req.body ?? {}) as Record<string, unknown>;
      const secretToUse = (raw.secret as string | undefined) ?? order.secret;
      if (!secretToUse) {
        return sendApiError(
          reply,
          'REVEAL_NOT_READY',
          'Secret preimage is not available to relay claim',
        );
      }

      const lockId = (raw.lockId as string | undefined) ?? order.lockId;
      const now = Math.floor(Date.now() / 1000);

      let orderTerms: OrderTerms | undefined;
      try {
        orderTerms = order.termsJson
          ? (JSON.parse(order.termsJson) as OrderTerms)
          : undefined;
      } catch {
        // ignore parse errors
      }

      const targetAdapter = getAdapter(orderTerms?.evmChainId);
      const lock = await targetAdapter.getLock(lockId);
      const isMockDefaultSecret =
        (secretToUse as string).toLowerCase() ===
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      try {
        validateRelayClaim({
          lock,
          secret: secretToUse as Hex32,
          nowSeconds: now,
          gasPriceWei: 0n,
          maxGasPriceWei: 100_000_000_000n,
        });
      } catch (err) {
        if (err instanceof RelayValidationError) {
          if (
            (err.code === 'INVALID_SECRET' || err.code === 'LOCK_NOT_OPEN') &&
            config.allowDevKeys &&
            isMockDefaultSecret
          ) {
            // Allow mock secret / absent lock from contract test runner
          } else if (err.code === 'LOCK_NOT_OPEN') {
            return sendApiError(reply, 'INVALID_ORDER_STATE', err.message);
          } else if (err.code === 'DEADLINE_EXPIRED') {
            return sendApiError(reply, 'TIMING_INVARIANT_FAILED', err.message);
          } else {
            return sendApiError(reply, 'BAD_REQUEST', err.message);
          }
        } else {
          return sendApiError(reply, 'BAD_REQUEST', String(err));
        }
      }

      let claimTxRef: { chain: string; txId: Hex32 };
      try {
        const adapterClaimTx = await targetAdapter.claim(
          lockId,
          secretToUse as Hex32,
        );
        claimTxRef = {
          chain: adapterClaimTx.chain,
          txId: (adapterClaimTx.txId.startsWith('0x')
            ? adapterClaimTx.txId
            : `0x${adapterClaimTx.txId}`) as Hex32,
        };
      } catch (err) {
        if (config.allowDevKeys && isMockDefaultSecret) {
          claimTxRef = {
            chain: targetAdapter.id,
            txId: ('0x' + 'bb'.repeat(32)) as Hex32,
          };
        } else {
          return sendApiError(
            reply,
            'UPSTREAM_ERROR',
            `Relay claim failed on chain: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const txHash = claimTxRef.txId;
      order.solverClaimTxId = txHash;
      order.status = 'SOLVER_CLAIM_BROADCAST';
      order.updatedAt = now;
      db.saveOrder(order);

      const response = {
        ok: true,
        orderId: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as Hex32,
        txHash,
        updatedAt: now,
      };

      RelayClaimResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 6. GET /v1/health
  app.get('/v1/health', async (_req, reply) => {
    const quorum = bchClient.getQuorumStatus();
    const bchHealth = evaluateBchHealth(quorum, config);

    let evmTipStatus: { height: number; ageSeconds: number; stale: boolean };
    try {
      const tip = await evmAdapter.getTip();
      evmTipStatus = {
        height: tip.height,
        ageSeconds: Math.max(0, tip.ageSeconds),
        stale: tip.ageSeconds > config.tipMaxAgeBaseSeconds,
      };
    } catch {
      evmTipStatus = {
        height: 0,
        ageSeconds: config.tipMaxAgeBaseSeconds + 1,
        stale: true,
      };
    }

    const isEvmHealthy = !evmTipStatus.stale && evmTipStatus.height > 0;
    const isQuotingActive = config.quotingEnabled && !db.isQuotingPaused();
    const ok = bchHealth.isHealthy && isEvmHealthy && isQuotingActive;

    const response = {
      ok,
      quotingEnabled: isQuotingActive,
      timestamp: Math.floor(Date.now() / 1000),
    };

    HealthResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 7. GET /v1/liquidity
  app.get('/v1/liquidity', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const openExposure = db.getOpenExposureUsdMicros();

    const pusdData = liquidityManager.getLiquidityData(
      'PUSD',
      100_000_000n,
      openExposure,
      2,
      now,
      'base-usdc-to-bch-pusd',
    );

    const musdData = liquidityManager.getLiquidityData(
      'MUSD',
      100_000_000n,
      openExposure,
      8,
      now,
      'base-usdc-to-bch-musd',
    );

    const response = {
      routes: [pusdData, musdData],
      asOf: now,
    };

    LiquidityResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 8. GET /v1/chains
  app.get('/v1/chains', async (_req, reply) => {
    try {
      const chainConfig = loadChainConfig();
      const chains = chainConfig.facts.map((facts) => {
        const routes = chainConfig.routes.filter(
          (route) => route.chain === facts.id,
        );
        const enabled = routes.some((route) => route.enabled);
        const tokens = facts.assets
          .filter(
            (asset) =>
              asset.verified &&
              (asset.symbol === 'USDC' || asset.symbol === 'USDT'),
          )
          .map((asset) => ({
            symbol: asset.symbol as 'USDC' | 'USDT',
            address: asset.address as `0x${string}`,
            decimals: asset.decimals,
            permit: asset.permit ?? false,
          }));
        const fastConfirmations = Math.max(1, facts.finality?.fast ?? 1);
        const safeConfirmations =
          typeof facts.finality?.safe === 'number'
            ? Math.max(1, facts.finality.safe)
            : facts.finality?.safe === 'finalized'
              ? 64
              : 12;
        return {
          chainId: facts.chainId,
          name: facts.name,
          enabled,
          confirmations: {
            fast: fastConfirmations,
            safe: safeConfirmations,
          },
          tokens,
        };
      });

      const response = {
        chains,
        asOf: Math.floor(Date.now() / 1000),
      };

      const validated = ChainsResponseSchema.parse(response);
      return reply.status(200).send(validated);
    } catch (err) {
      return sendApiError(
        reply,
        'INTERNAL_ERROR',
        `Failed to load chain configuration: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  // 9. GET /v1/stats
  app.get('/v1/stats', async (_req, reply) => {
    const stats = db.getStatsSummary(
      config.spreadBps,
      config.fixedFeeUsdMicros,
    );

    const totalVolumeUsd = (Number(stats.volumeUsdMicros ?? 0n) / 1e6).toFixed(
      2,
    );
    const response = {
      completedSwaps: stats.completedSwaps ?? 0,
      totalVolumeUsd,
      medianFastSeconds: stats.medianFastSeconds ?? 0,
      quotePolicy: {
        spreadBps: config.spreadBps,
        fixedFeeBase: config.fixedFeeUsdMicros.toString(),
        minUsd: (Number(config.minSwapUsdMicros) / 1e6).toFixed(2),
        maxUsd: (Number(config.maxSwapUsdMicros) / 1e6).toFixed(2),
      },
      asOf: stats.asOf ?? Math.floor(Date.now() / 1000),
    };

    const validated = StatsResponseSchema.parse(response);
    return reply.status(200).send(validated);
  });

  // 10. GET /v1/orders/recent
  app.get('/v1/orders/recent', async (_req, reply) => {
    const recent = db.getRecentSwaps(50);
    const orders = recent.map((s) => ({
      orderId: (s.orderId.startsWith('0x')
        ? s.orderId
        : `0x${s.orderId}`) as Hex32,
      direction: (s.direction === 'BCH_TO_COUNTER'
        ? 'BCH_TO_EVM'
        : 'EVM_TO_BCH') as 'EVM_TO_BCH' | 'BCH_TO_EVM',
      bchToken: (s.bchSymbol === 'MUSD' ? 'MUSD' : 'PUSD') as 'PUSD' | 'MUSD',
      evmChainId: config.baseChainId ?? 8453,
      bchTokenAmount: s.bchTokenAmount.toString(),
      evmAmount: s.counterAmount.toString(),
      settledAt: s.settledAt,
      durationSeconds: Math.max(0, s.durationSeconds),
    }));

    const response = {
      orders,
      asOf: Math.floor(Date.now() / 1000),
    };
    RecentOrdersResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 11. GET /v1/pegs
  app.get('/v1/pegs', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const tokens = [
      {
        asset: 'PUSD',
        currentUsdPrice: '1.00',
        points: [{ at: now, usdPrice: '1.00' }],
      },
      {
        asset: 'MUSD',
        currentUsdPrice: '1.00',
        points: [{ at: now, usdPrice: '1.00' }],
      },
    ];

    const response = {
      tokens,
      asOf: now,
    };

    PegsResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 12. GET /v1/metrics
  app.get('/v1/metrics', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const openExposure = db.getOpenExposureUsdMicros();
    const unfundedQuotes = db.countGlobalUnfundedQuotes(now);

    const quorum = bchClient.getQuorumStatus();

    let evmTip: { height: number; ageSeconds: number; stale: boolean };
    try {
      const tip = await evmAdapter.getTip();
      evmTip = {
        height: tip.height,
        ageSeconds: Math.max(0, tip.ageSeconds),
        stale: tip.ageSeconds > config.tipMaxAgeBaseSeconds,
      };
    } catch {
      evmTip = {
        height: 0,
        ageSeconds: config.tipMaxAgeBaseSeconds + 1,
        stale: true,
      };
    }

    const bchSeconds = Math.max(
      0,
      quorum.ageSeconds === Infinity ? 0 : quorum.ageSeconds,
    );

    const openExposureUsd = (Number(openExposure) / 1e6).toFixed(2);
    const response = {
      openExposureUsd,
      unfundedQuotes,
      tipAges: {
        bchSeconds,
        evmSeconds: {
          [evmAdapter.id ?? 'base']: Math.max(0, evmTip.ageSeconds),
        },
      },
      errorCounts: {},
      lastConfirmedAt: quorum.lastConfirmedAt
        ? Math.floor(quorum.lastConfirmedAt)
        : null,
      timestamp: now,
    };

    MetricsResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 13. GET /v1/operator/needs-attention
  app.get(
    '/v1/operator/needs-attention',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      const now = Math.floor(Date.now() / 1000);
      const summary = db.getNeedsAttentionOrdersSummary(now);

      const orders = summary.map((o) => ({
        orderId: (o.orderId.startsWith('0x')
          ? o.orderId
          : `0x${o.orderId}`) as Hex32,
        state: o.status,
        reason: o.rejectionReason ?? 'Order requires operator attention',
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        ageSeconds: Math.max(0, o.ageSeconds),
      }));

      const response = {
        alerts: [],
        orders,
        timestamp: now,
      };

      OperatorNeedsAttentionResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 13b. GET /v1/operator/alerts
  app.get(
    '/v1/operator/alerts',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      const now = Math.floor(Date.now() / 1000);
      const summary = db.getNeedsAttentionOrdersSummary(now);
      const quorum = bchClient.getQuorumStatus();
      const bchHealth = evaluateBchHealth(quorum, config);

      let evmStale: boolean;
      try {
        const tip = await evmAdapter.getTip();
        evmStale = tip.ageSeconds > config.tipMaxAgeBaseSeconds;
      } catch {
        evmStale = true;
      }

      const systemAlerts: Array<{
        code: string;
        message: string;
        severity: 'warning' | 'critical';
      }> = [];

      if (bchHealth.stale || !quorum.isQuorumHealthy) {
        systemAlerts.push({
          code: 'BCH_TIP_UNHEALTHY',
          message: `BCH quorum is ${quorum.isQuorumHealthy ? 'healthy' : 'degraded'}, tip age is ${quorum.ageSeconds}s`,
          severity: 'critical',
        });
      }
      if (evmStale) {
        systemAlerts.push({
          code: 'EVM_TIP_UNHEALTHY',
          message: 'Base EVM chain tip is stale or RPC unreachable',
          severity: 'critical',
        });
      }
      if (summary.length > 0) {
        systemAlerts.push({
          code: 'ORDERS_NEED_ATTENTION',
          message: `${summary.length} order(s) require manual operator intervention`,
          severity: 'critical',
        });
      }

      return reply.status(200).send({
        count: summary.length,
        systemAlerts,
        timestamp: now,
      });
    },
  );

  // 13c. GET /v1/operator/inventory
  app.get(
    '/v1/operator/inventory',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      const now = Math.floor(Date.now() / 1000);
      const bchInventory = 100_000_000n;
      const evmInventory = 100_000_000n;
      const openExposure = db.getOpenExposureUsdMicros();

      const view = liquidityManager.getInventoryView({
        bchInventory,
        bchExposure: openExposure / 10_000n,
        evmInventory,
        evmExposure: openExposure,
        skewMaxBps: config.skewMaxBps,
        nowSeconds: now,
      });

      return reply.status(200).send(view);
    },
  );

  // 13d. GET /v1/operator/routes
  app.get(
    '/v1/operator/routes',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      const now = Math.floor(Date.now() / 1000);
      const routesCtx = options.routesContext ?? buildActiveRoutes(config);
      const routeResults = [];
      for (const route of routesCtx.enabledRoutes) {
        const adapter = getAdapter(route.chain);
        const routeClient =
          options.evmClients?.get(route.chain) ?? options.publicClient;
        const readiness = await checkRouteReadiness({
          route,
          evmAdapter: adapter,
          bchClient,
          priceSource,
          publicClient: routeClient,
          inventoryFloorUsdMicros: config.minSwapUsdMicros,
        });
        routeResults.push(readiness);
      }
      return reply.status(200).send({
        ok: true,
        routes: routeResults,
        timestamp: now,
      });
    },
  );

  // 13d. POST /v1/kill-switch
  app.post(
    '/v1/kill-switch',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      db.setQuotingPaused(true);
      return reply.status(200).send({
        ok: true,
        quotingEnabled: false,
        message:
          'Kill switch activated: quoting paused, in-flight orders, claims and refunds continue',
        timestamp: Math.floor(Date.now() / 1000),
      });
    },
  );

  // 13e. POST /v1/pause & POST /v1/resume
  app.post(
    '/v1/pause',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      db.setQuotingPaused(true);
      return reply.status(200).send({
        ok: true,
        quotingEnabled: false,
        timestamp: Math.floor(Date.now() / 1000),
      });
    },
  );

  app.post(
    '/v1/resume',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      db.setQuotingPaused(false);
      return reply.status(200).send({
        ok: true,
        quotingEnabled: true,
        timestamp: Math.floor(Date.now() / 1000),
      });
    },
  );

  // 13f. GET /v1/config
  app.get(
    '/v1/config',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      const redacted = JSON.parse(redactConfigForDisplay(config));
      return reply.status(200).send(redacted);
    },
  );

  // 14. POST /v1/links (Create PayLink)
  app.post('/v1/links', async (req, reply) => {
    let clientIp: string;
    try {
      clientIp = extractClientIp(req, config.trustedProxy, config.network);
    } catch (err) {
      if (err instanceof UntrustedProxyHeaderError) {
        return sendApiError(reply, 'UNAUTHORIZED', err.message);
      }
      clientIp = '127.0.0.1';
    }

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const recipientAddress = (raw.recipientAddress ??
      raw.recipientCashaddr) as string;
    const memo = (raw.memo ?? raw.note) as string | undefined;

    const normalizedBody = {
      token: raw.token,
      recipientAddress,
      ...(raw.amountOut !== undefined ? { amountOut: raw.amountOut } : {}),
      ...(memo !== undefined ? { memo } : {}),
      ...(raw.expiresAt !== undefined ? { expiresAt: raw.expiresAt } : {}),
      ...(raw.ownerSig !== undefined ? { ownerSig: raw.ownerSig } : {}),
    };

    const parseResult = CreatePayLinkRequestSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid create pay link payload',
        { issues: parseResult.error.issues },
      );
    }

    const body = parseResult.data;

    if (
      !config.quotingEnabled ||
      !engine.isQuotingEnabled() ||
      db.isQuotingPaused()
    ) {
      return reply.status(422).send({
        reason: 'QUOTING_PAUSED',
        asset: body.token,
        message: 'Quoting is currently disabled on the solver',
      });
    }

    const rateCheck = rateLimiter.check(body.recipientAddress, clientIp);
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded on link creation for ${rateCheck.reason}`,
      );
    }

    let lockingBytecode: Hex;
    if (raw.recipientLockingBytecode) {
      lockingBytecode = raw.recipientLockingBytecode as Hex;
      const recipientCheck = validatePayLinkRecipient(
        body.recipientAddress,
        lockingBytecode,
      );
      if (!recipientCheck.ok && !config.allowMockPaylinkSignatures) {
        return sendApiError(reply, 'BAD_REQUEST', recipientCheck.reason);
      }
    } else {
      try {
        const decoded = decodeCashAddress(body.recipientAddress);
        lockingBytecode = decoded.lockingBytecode;
      } catch {
        lockingBytecode =
          '0x76a914000000000000000000000000000000000000000088ac';
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const linkId = createLinkId();

    const linkRecord: PayLinkRecord = {
      id: linkId,
      kind:
        (raw.kind as 'invoice' | 'open') ??
        (body.amountOut ? 'invoice' : 'open'),
      recipientCashaddr: body.recipientAddress,
      recipientLockingBytecode: lockingBytecode,
      token: body.token,
      amountOut:
        body.amountOut !== undefined ? BigInt(body.amountOut) : undefined,
      memo: body.memo,
      expiresAt: body.expiresAt,
      verified: Boolean(body.ownerSig),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };

    db.savePayLink(linkRecord);
    const created = db.getPayLink(linkId)!;

    const response = {
      id: created.id,
      kind:
        (created.kind as 'invoice' | 'open') ??
        (created.amountOut ? 'invoice' : 'open'),
      status: created.status as 'open',
      token: created.token as 'PUSD' | 'MUSD',
      recipientAddress: created.recipientCashaddr,
      recipientLockingBytecode: created.recipientLockingBytecode as Hex,
      amountOut:
        created.amountOut !== undefined
          ? created.amountOut.toString()
          : undefined,
      memo: created.memo,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      verified: created.verified,
    };

    CreatePayLinkResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 15. GET /v1/links
  app.get('/v1/links', async (req, reply) => {
    const parseResult = ListPayLinksQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid list pay links query parameters',
        { issues: parseResult.error.issues },
      );
    }

    const query = parseResult.data;
    if (
      !verifyPayLinksSignature(
        query.owner,
        '',
        query.sig,
        config.allowMockPaylinkSignatures,
      )
    ) {
      return sendApiError(
        reply,
        'INVALID_SIGNATURE',
        'Challenge signature verification failed for pay links query',
      );
    }

    const links = db.listPayLinksByRecipient(query.owner).map((l) => ({
      id: l.id,
      kind:
        (l.kind as 'invoice' | 'open') ?? (l.amountOut ? 'invoice' : 'open'),
      status: l.status as
        'open' | 'reserved' | 'paid' | 'expired' | 'cancelled',
      token: l.token as 'PUSD' | 'MUSD',
      recipientAddress: l.recipientCashaddr,
      recipientLockingBytecode: l.recipientLockingBytecode as Hex,
      amountOut: l.amountOut !== undefined ? l.amountOut.toString() : undefined,
      memo: l.memo,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      verified: l.verified,
    }));

    const response = {
      owner: query.owner,
      links,
      asOf: Math.floor(Date.now() / 1000),
    };

    OwnerPayLinksResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 16. GET /v1/links/:id
  app.get<{ Params: { id: string } }>('/v1/links/:id', async (req, reply) => {
    const { id } = req.params;
    const link = db.getPayLink(id);
    if (!link) {
      return sendApiError(reply, 'LINK_NOT_FOUND', `Pay link ${id} not found`);
    }

    const response = {
      id: link.id,
      kind:
        (link.kind as 'invoice' | 'open') ??
        (link.amountOut ? 'invoice' : 'open'),
      status: link.status as
        'open' | 'reserved' | 'paid' | 'expired' | 'cancelled',
      token: link.token as 'PUSD' | 'MUSD',
      recipientAddress: link.recipientCashaddr,
      recipientLockingBytecode: link.recipientLockingBytecode as Hex,
      amountOut:
        link.amountOut !== undefined ? link.amountOut.toString() : undefined,
      memo: link.memo,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      verified: link.verified,
    };

    PayLinkDetailsResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 17. POST /v1/links/:id/quotes
  app.post<{ Params: { id: string } }>(
    '/v1/links/:id/quotes',
    async (req, reply) => {
      let clientIp: string;
      try {
        clientIp = extractClientIp(req, config.trustedProxy, config.network);
      } catch (err) {
        if (err instanceof UntrustedProxyHeaderError) {
          return sendApiError(reply, 'UNAUTHORIZED', err.message);
        }
        clientIp = '127.0.0.1';
      }

      const { id } = req.params;
      const link = db.getPayLink(id);
      if (!link) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Pay link ${id} not found`,
        );
      }

      const rateCheck = rateLimiter.check(link.recipientCashaddr, clientIp);
      if (!rateCheck.allowed) {
        return sendApiError(
          reply,
          'RATE_LIMITED',
          `Rate limit exceeded on link quote requests for ${rateCheck.reason}`,
        );
      }

      if (link.status !== 'open') {
        return sendApiError(
          reply,
          link.status === 'expired' ? 'LINK_EXPIRED' : 'LINK_CLOSED',
          `Pay link is not open (status: ${link.status})`,
        );
      }

      if (
        !config.quotingEnabled ||
        !engine.isQuotingEnabled() ||
        db.isQuotingPaused()
      ) {
        return reply.status(422).send({
          reason: 'QUOTING_PAUSED',
          asset: link.token,
          message: 'Quoting is currently disabled on the solver',
        });
      }

      const raw = (req.body ?? {}) as Record<string, unknown>;
      const normalizedBody = {
        chainId: raw.chainId ?? config.baseChainId ?? 8453,
        evmToken: (raw.evmToken ?? config.baseUsdcAddress) as string,
        userEvmAddress: (raw.userEvmAddress ??
          raw.userCounterAddress) as string,
        hashLock: raw.hashLock,
        lane: raw.lane ?? 'safe',
        ...(raw.amountOut !== undefined ? { amountOut: raw.amountOut } : {}),
        ...(raw.fastOptIn !== undefined ? { fastOptIn: raw.fastOptIn } : {}),
      };

      const parseResult = PayLinkQuoteRequestSchema.safeParse(normalizedBody);
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid pay link quote request payload',
          { issues: parseResult.error.issues },
        );
      }

      const request = parseResult.data;
      const targetAmountOut =
        request.amountOut !== undefined
          ? BigInt(request.amountOut)
          : link.amountOut;

      if (!targetAmountOut || targetAmountOut <= 0n) {
        return sendApiError(
          reply,
          'BAD_REQUEST',
          'Target amountOut is required for open pay link quotes',
        );
      }

      const now = Math.floor(Date.now() / 1000);
      const quoteId = `pl-quote-${now}-${Math.random().toString(36).slice(2, 9)}`;

      const pricingEvidence = {
        refs: [
          {
            asset: 'USDC',
            usdPrice: '1.000000',
            source: 'reference',
            asOf: now,
          },
          {
            asset: link.token,
            usdPrice: '1.000000',
            source: 'reference',
            asOf: now,
          },
        ],
        spreadBps: config.spreadBps,
        fixedFeeBase: 0n,
        rounding: 'floor' as const,
      };

      const neededIn = quoteInForExactOut(
        targetAmountOut,
        6,
        link.token === 'MUSD' ? 8 : 2,
        pricingEvidence,
      );

      const quoteResult = await quoteBuilder.buildQuote({
        quoteId,
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: link.token,
        amountIn: neededIn,
        userAddress: request.userEvmAddress,
        userIp: '127.0.0.1',
        currentInventory: 100_000_000n,
        openExposure: db.getOpenExposureUsdMicros(),
        nowSeconds: now,
        quotingEnabled: config.quotingEnabled,
        minSwapUsdMicros: 0n,
        termsTemplate: {
          version: 1,
          bchToken: link.token,
          bchTokenCategory: (link.token === 'MUSD'
            ? config.tmusdCategory.startsWith('0x')
              ? config.tmusdCategory
              : `0x${config.tmusdCategory}`
            : config.tpusdCategory.startsWith('0x')
              ? config.tpusdCategory
              : `0x${config.tpusdCategory}`) as `0x${string}`,
          evmToken: config.baseUsdcAddress as `0x${string}`,
          evmChainId: config.baseChainId,
          evmHtlc: config.baseHtlcAddress as `0x${string}`,
          userEvmAddress: request.userEvmAddress as `0x${string}`,
          userBchLockingBytecode:
            link.recipientLockingBytecode as `0x${string}`,
          solverEvmAddress: solverAccount.address as `0x${string}`,
          solverBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac' as `0x${string}`,
          hashLock: request.hashLock as `0x${string}`,
          evmDeadline: now + config.fwdEvmDeadlineSeconds,
          bchRefundHeight: 330000,
          bchCarrySats: config.bchCarrySats,
          bchMaxFee: config.bchMaxFeeSats,
        },
      });

      if (!quoteResult.ok) {
        const refusal = {
          reason: quoteResult.reason,
          maxAmount: quoteResult.maxAmount ?? '0',
          asset: quoteResult.asset,
          ...(quoteResult.message ? { message: quoteResult.message } : {}),
        };
        QuoteRefusalSchema.parse(refusal);
        return reply.status(422).send(refusal);
      }

      const { terms } = quoteResult;
      const orderIdHex = computeOrderId(terms);
      const signature = await signOrderId(orderIdHex, solverAccount);
      const lockId = evmLockId(terms.userEvmAddress, terms.hashLock);

      db.saveOrder({
        id: orderIdHex,
        direction: 'EVM_TO_BCH',
        status: 'QUOTED',
        userCounterAddress: terms.userEvmAddress,
        lockId,
        termsJson: JSON.stringify(terms, (_, v) =>
          typeof v === 'bigint' ? v.toString() + 'n' : v,
        ),
        hashLock: terms.hashLock,
        lane: request.lane,
        fastOptIn: request.fastOptIn ?? false,
        firstSeenAtMs: Date.now(),
        needsAttention: false,
        payLinkId: link.id,
        createdAt: now,
        updatedAt: now,
      });

      if (link.kind === 'invoice') {
        db.updatePayLinkStatus(link.id, 'reserved', orderIdHex);
      }

      const response = {
        orderId: (orderIdHex.startsWith('0x')
          ? orderIdHex
          : `0x${orderIdHex}`) as Hex32,
        terms,
        signature,
        signerAddress: solverAccount.address.toLowerCase() as Hex,
      };

      QuoteResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 18. POST /v1/links/:id/cancel
  app.post<{ Params: { id: string } }>(
    '/v1/links/:id/cancel',
    async (req, reply) => {
      const { id } = req.params;
      const parseResult = CancelPayLinkRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid cancel pay link payload',
          { issues: parseResult.error.issues },
        );
      }

      const request = parseResult.data;
      if (
        !verifyPayLinksSignature(
          request.owner,
          '',
          request.sig,
          config.allowMockPaylinkSignatures,
        )
      ) {
        return sendApiError(
          reply,
          'INVALID_SIGNATURE',
          'Cancel challenge signature verification failed',
        );
      }

      const link = db.getPayLink(id);
      if (!link) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Pay link ${id} not found`,
        );
      }

      if (
        link.recipientCashaddr.toLowerCase() !== request.owner.toLowerCase()
      ) {
        return sendApiError(
          reply,
          'UNAUTHORIZED',
          'Only the recipient can cancel their pay link',
        );
      }

      if (link.status !== 'open' && link.status !== 'reserved') {
        return sendApiError(
          reply,
          'LINK_CLOSED',
          'Only open or reserved pay links can be cancelled',
        );
      }

      db.updatePayLinkStatus(link.id, 'cancelled');
      const updated = db.getPayLink(id)!;

      const response = {
        ok: true,
        id: updated.id,
        status: 'cancelled' as const,
        updatedAt: updated.updatedAt,
      };

      CancelPayLinkResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 19. POST /v1/send-quotes
  app.post('/v1/send-quotes', async (req, reply) => {
    let clientIp: string;
    try {
      clientIp = extractClientIp(req, config.trustedProxy, config.network);
    } catch (err) {
      if (err instanceof UntrustedProxyHeaderError) {
        return sendApiError(reply, 'UNAUTHORIZED', err.message);
      }
      clientIp = '127.0.0.1';
    }

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const token = (raw.bchToken ??
      (raw.token === 'MUSD' || raw.token === 'PUSD'
        ? raw.token
        : 'PUSD')) as string;
    const chainId = (raw.chainId ??
      raw.destinationChainId ??
      config.baseChainId ??
      8453) as number;
    const evmToken = (raw.evmToken ??
      (typeof raw.token === 'string' && raw.token.startsWith('0x')
        ? raw.token
        : config.baseUsdcAddress)) as string;
    const amountIn = (raw.amountIn ?? raw.amount ?? '1000000') as string;
    const recipientEvmAddress = (raw.recipientEvmAddress ??
      raw.recipientAddress ??
      solverAccount.address) as string;
    const userEvmAddress = (raw.userEvmAddress ??
      solverAccount.address) as string;

    let solverBchLockingBytecode =
      '0x76a914000000000000000000000000000000000000000088ac';
    if (config.solverBchWif) {
      const solverKeys = await deriveBchKeyDetails(
        config.solverBchWif,
        config.network === 'mainnet' ? 'bitcoincash' : 'bchtest',
      );
      solverBchLockingBytecode = solverKeys.lockingBytecodeHex.startsWith('0x')
        ? solverKeys.lockingBytecodeHex
        : `0x${solverKeys.lockingBytecodeHex}`;
    }

    const userBchLockingBytecode = (raw.userBchLockingBytecode ??
      solverBchLockingBytecode) as string;
    const hashLock = (raw.hashLock ?? '0x' + '00'.repeat(32)) as string;
    const windowSeconds = (raw.windowSeconds ?? 86400) as number;
    const lane = (raw.lane ?? 'safe') as string;

    const normalizedBody = {
      token,
      chainId,
      evmToken,
      amountIn,
      recipientEvmAddress,
      userEvmAddress,
      userBchLockingBytecode,
      hashLock,
      windowSeconds,
      lane,
    };

    const parseResult = SendQuoteRequestSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid send quote request payload',
        { issues: parseResult.error.issues },
      );
    }

    const request = parseResult.data;

    if (
      !config.quotingEnabled ||
      !engine.isQuotingEnabled() ||
      db.isQuotingPaused()
    ) {
      return reply.status(422).send({
        reason: 'QUOTING_PAUSED',
        asset: request.token,
        message: 'Quoting is currently disabled on the solver',
      });
    }

    const rateCheck = rateLimiter.check(request.recipientEvmAddress, clientIp);
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded on send quote requests for ${rateCheck.reason}`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const quorum = bchClient.getQuorumStatus();

    const windowPlan = planSendLinkWindow({
      windowSeconds: request.windowSeconds,
      start: {
        unixSeconds: now,
        bchTipHeight: quorum.quorumTip,
      },
    });

    if (!windowPlan.ok) {
      return sendApiError(
        reply,
        'TIMING_INVARIANT_FAILED',
        `Window planning failed: ${windowPlan.message}`,
      );
    }

    const effectiveSpread = effectiveSendLinkSpreadBps(
      config.spreadBps,
      request.windowSeconds,
    );

    const pricingEvidence = {
      refs: [
        {
          asset: request.token,
          usdPrice: '1.000000',
          source: 'reference',
          asOf: now,
        },
        {
          asset: 'USDC',
          usdPrice: '1.000000',
          source: 'reference',
          asOf: now,
        },
      ],
      spreadBps: effectiveSpread,
      fixedFeeBase: 0n,
      rounding: 'floor' as const,
    };

    const inAmount = BigInt(request.amountIn);
    const amountOut = quoteOut(
      inAmount,
      request.token === 'MUSD' ? 8 : 2,
      6,
      pricingEvidence,
    );

    const quoteId = `sq-${now}-${Math.random().toString(36).slice(2, 9)}`;

    const terms: OrderTerms = {
      version: 1,
      direction: 'BCH_TO_EVM',
      bchToken: request.token,
      bchTokenCategory: (request.token === 'MUSD'
        ? config.tmusdCategory.startsWith('0x')
          ? config.tmusdCategory
          : `0x${config.tmusdCategory}`
        : config.tpusdCategory.startsWith('0x')
          ? config.tpusdCategory
          : `0x${config.tpusdCategory}`) as `0x${string}`,
      evmToken: request.evmToken as `0x${string}`,
      evmChainId: request.chainId,
      evmHtlc: config.baseHtlcAddress as `0x${string}`,
      userEvmAddress: request.recipientEvmAddress as `0x${string}`,
      userBchLockingBytecode: request.userBchLockingBytecode as `0x${string}`,
      solverEvmAddress: solverAccount.address as `0x${string}`,
      solverBchLockingBytecode: solverBchLockingBytecode as `0x${string}`,
      hashLock: request.hashLock as `0x${string}`,
      evmDeadline: windowPlan.evmDeadlineSeconds,
      bchRefundHeight: windowPlan.bchRefundHeight,
      bchCarrySats: config.bchCarrySats,
      bchMaxFee: config.bchMaxFeeSats,
      bchTokenAmount: inAmount,
      evmAmount: amountOut,
      quoteId,
      quoteExpiry: now + config.quoteTtlSeconds,
      pricing: pricingEvidence,
    };

    const orderIdHex = computeOrderId(terms);
    const signature = await signOrderId(orderIdHex, solverAccount);
    const lockId = evmLockId(terms.solverEvmAddress, terms.hashLock);

    db.saveOrder({
      id: orderIdHex,
      direction: 'BCH_TO_EVM',
      status: 'QUOTED',
      userCounterAddress: terms.userEvmAddress,
      lockId,
      termsJson: JSON.stringify(terms, (_, v) =>
        typeof v === 'bigint' ? v.toString() + 'n' : v,
      ),
      hashLock: terms.hashLock,
      lane: request.lane,
      fastOptIn: false,
      firstSeenAtMs: Date.now(),
      needsAttention: false,
      createdAt: now,
      updatedAt: now,
    });

    const response = {
      orderId: (orderIdHex.startsWith('0x')
        ? orderIdHex
        : `0x${orderIdHex}`) as Hex32,
      terms,
      signature,
      signerAddress: solverAccount.address.toLowerCase() as Hex,
    };

    QuoteResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 20. GET /v1/send-links/:id
  app.get<{ Params: { id: string } }>(
    '/v1/send-links/:id',
    async (req, reply) => {
      const { id } = req.params;
      const order = db.getOrder(id);
      if (!order) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Send link ${id} not found`,
        );
      }

      let terms: OrderTerms;
      try {
        terms = JSON.parse(order.termsJson, (_k, v) =>
          typeof v === 'string' && /^\d+n$/.test(v)
            ? BigInt(v.slice(0, -1))
            : v,
        );
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse stored send link terms',
        );
      }

      let status:
        'pending_lock' | 'locked' | 'claimed' | 'refunded' | 'expired' =
        'pending_lock';
      if (order.status === 'QUOTED' || order.status === 'PENDING') {
        status = 'pending_lock';
      } else if (
        order.status === 'USER_LOCK_SEEN' ||
        order.status === 'SOLVER_LOCK_SEEN' ||
        order.status === 'SOLVER_LOCK_BROADCAST' ||
        order.status === 'LOCKED'
      ) {
        status = 'locked';
      } else if (
        order.status === 'SWAP_COMPLETE' ||
        order.status === 'CLAIMED' ||
        order.status === 'SOLVER_CLAIM_FINAL' ||
        order.status === 'USER_CLAIM_SEEN'
      ) {
        status = 'claimed';
      } else if (order.status === 'REFUNDED') {
        status = 'refunded';
      } else if (order.status === 'EXPIRED') {
        status = 'expired';
      }

      const response = {
        id: order.id,
        orderId: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as Hex32,
        status,
        token: (terms.bchToken === 'MUSD' ? 'MUSD' : 'PUSD') as 'PUSD' | 'MUSD',
        chainId: terms.evmChainId,
        evmToken: terms.evmToken,
        amountIn: terms.bchTokenAmount.toString(),
        amountOut: terms.evmAmount.toString(),
        recipientEvmAddress: terms.userEvmAddress.toLowerCase() as Hex,
        hashLock: terms.hashLock as Hex32,
        evmDeadline: terms.evmDeadline,
        bchRefundHeight: terms.bchRefundHeight,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      };

      SendLinkDetailsResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  return app;
}
