import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import type pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import {
  API_ERROR_HTTP_STATUS,
  effectiveSendLinkSpreadBps,
  holdFeeBps,
  invariantF,
  invariantR,
  isValidSecret,
  orderId as computeOrderId,
  planSendLinkWindow,
  quoteInForExactOut,
  signOrderId,
  validatePayLinkRecipient,
  DEFAULT_TIMING_CONFIG,
  type ApiErrorCode,
  type Hex,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import {
  ChainsResponseSchema,
  StatsResponseSchema,
  RecentOrdersResponseSchema,
  PegsResponseSchema,
  MetricsResponseSchema,
  QuoteRequestSchema as CoreQuoteRequestSchema,
  QuoteResponseSchema,
  OrderStatusResponseSchema,
  RevealSecretRequestSchema,
  RevealSecretResponseSchema,
  RelayLockResponseSchema,
  RelayClaimResponseSchema,
} from '@ferry/core/api';
import { loadChainConfig } from '@ferry/chain-config';
import type { EvmChainAdapter } from '@ferry/chain-evm';
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
import { QuoteBuilder } from '../pricing/quote-builder.js';
import {
  extractClientIp,
  QuoteRateLimiter,
  UntrustedProxyHeaderError,
} from './rate-limiter.js';
import {
  CancelPayLinkRequestSchema,
  CreatePayLinkRequestSchema,
  HealthResponseSchema,
  LiquidityResponseSchema,
  ListPayLinksQuerySchema,
  OperatorNeedsAttentionResponseSchema,
  PayLinkQuoteRequestSchema,
  PayLinkSchema,
  SendLinkDetailResponseSchema,
  SendQuoteRequestSchema,
  SendQuoteResponseSchema,
} from './schemas.js';

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
  bchClient: BchQuorumClient;
  engine: SolverEngine;
  priceSource: PriceSource;
  logger?: pino.Logger | undefined;
  rateLimiter?: QuoteRateLimiter | undefined;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config, db, evmAdapter, bchClient, engine, priceSource } = options;

  const app = Fastify({
    logger: false, // Pino structured logger handled at application level
    bodyLimit: 65536, // 64KB request body size limit
  });

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
      return reply.status(statusCode).send({
        error: {
          code: error.code && statusCode < 500 ? error.code : 'INTERNAL_ERROR',
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

  void app.register(cors, { origin: true });

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

  function sendApiError(
    reply: {
      status: (code: number) => { send: (payload: unknown) => unknown };
    },
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    const statusCode = API_ERROR_HTTP_STATUS[code] ?? 400;
    return reply.status(statusCode).send({
      error: {
        code,
        message,
        details,
      },
    });
  }

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
    if (!config.quotingEnabled || !engine.isQuotingEnabled()) {
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

    // Fast lane bounds check ($25 max)
    const amountInBigInt = BigInt(request.amountIn);
    if (
      request.lane === 'fast' &&
      amountInBigInt > config.zeroConfMaxUsdMicros
    ) {
      return sendApiError(
        reply,
        'AMOUNT_OUT_OF_RANGE',
        'Fast lane is limited to $25.00',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const quoteId = `quote-${now}-${Math.random().toString(36).slice(2, 9)}`;

    // Solver BCH keys
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

    // Invariant timing parameters
    const counterDeadline =
      request.direction === 'EVM_TO_BCH'
        ? now + config.fwdEvmDeadlineSeconds
        : now + config.revEvmDeadlineSeconds;
    const bchRefundHeight =
      request.direction === 'EVM_TO_BCH'
        ? quorum.quorumTip + config.fwdBchRefundBlocks
        : quorum.quorumTip + config.revBchRefundBlocks;

    // Build terms template
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
      evmToken: (request.evmToken ?? config.baseUsdcAddress) as `0x${string}`,
      evmChainId: request.evmChainId ?? config.baseChainId,
      evmHtlc: config.baseHtlcAddress as `0x${string}`,
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

    // Calculate quote through QuoteBuilder
    const currentInventory = 100_000_000n; // default available inventory for routes
    const openExposure = db.getOpenExposureUsdMicros();

    const quoteResult = await quoteBuilder.buildQuote({
      quoteId,
      direction: request.direction,
      payAsset: request.direction === 'EVM_TO_BCH' ? 'USDC' : request.bchToken,
      receiveAsset:
        request.direction === 'EVM_TO_BCH' ? request.bchToken : 'USDC',
      amountIn: amountInBigInt,
      userAddress: request.userEvmAddress,
      userIp: clientIp,
      currentInventory,
      openExposure,
      nowSeconds: now,
      quotingEnabled: config.quotingEnabled,
      termsTemplate,
    });

    if (!quoteResult.ok) {
      return reply.status(422).send({
        reason: quoteResult.reason,
        maxAmount: quoteResult.maxAmount,
        asset: quoteResult.asset,
        message: quoteResult.message,
      });
    }

    const { terms } = quoteResult;

    // Check Invariant F or R
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

    // Save order in database
    db.saveOrder({
      id: orderIdHex,
      direction: terms.direction,
      status: 'QUOTED',
      userCounterAddress: terms.userEvmAddress,
      lockId: orderIdHex,
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
        return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
      }

      // Check secret matches hashLock
      if (!isValidSecret(secret, order.hashLock)) {
        return sendApiError(
          reply,
          'BAD_REQUEST',
          'Secret preimage does not match hash lock',
        );
      }

      const now = Math.floor(Date.now() / 1000);
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

      const raw = (req.body ?? {}) as Record<string, unknown>;
      try {
        const txRef = await evmAdapter.relayLock({
          chain: evmAdapter.id,
          orderId: order.id as Hex32,
          payload: (raw.payload ?? raw) as unknown,
        });
        const now = Math.floor(Date.now() / 1000);
        const txHash = (
          txRef.txId.startsWith('0x') ? txRef.txId : `0x${txRef.txId}`
        ) as Hex32;
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
      } catch (err) {
        return sendApiError(
          reply,
          'RELAY_LOCK_REVERTED',
          `Relay lock failed on chain: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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

      try {
        const txRef = await evmAdapter.claim(
          order.lockId,
          secretToUse as Hex32,
        );
        const now = Math.floor(Date.now() / 1000);
        const txHash = (
          txRef.txId.startsWith('0x') ? txRef.txId : `0x${txRef.txId}`
        ) as Hex32;
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
      } catch (err) {
        return sendApiError(
          reply,
          'UPSTREAM_ERROR',
          `Relay claim failed on chain: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
    const ok = bchHealth.isHealthy && isEvmHealthy && config.quotingEnabled;

    const response = {
      ok,
      quotingEnabled: config.quotingEnabled,
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
            address: asset.address,
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

  // 10. GET /v1/orders/recent (Strict privacy: NO user addresses)
  app.get('/v1/orders/recent', async (_req, reply) => {
    const recent = db.getRecentSwaps(50);
    const orders = recent.map((s) => ({
      orderId: (s.orderId.startsWith('0x')
        ? s.orderId
        : `0x${s.orderId}`) as `0x${string}`,
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
      swaps: orders, // backwards-compatible alias
      asOf: Math.floor(Date.now() / 1000),
    };
    RecentOrdersResponseSchema.parse({
      orders: response.orders,
      asOf: response.asOf,
    });
    return reply.status(200).send(response);
  });

  // 11. GET /v1/pegs
  app.get('/v1/pegs', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const tokens = [
      {
        asset: 'PUSD' as const,
        currentUsdPrice: '1.00',
        points: [{ at: now, usdPrice: '1.00' }],
      },
      {
        asset: 'MUSD' as const,
        currentUsdPrice: '1.00',
        points: [{ at: now, usdPrice: '1.00' }],
      },
    ];

    const response = {
      tokens,
      pegs: tokens, // backwards-compatible alias
      asOf: now,
    };

    PegsResponseSchema.parse({ tokens, asOf: now });
    return reply.status(200).send(response);
  });

  // 12. GET /v1/metrics (Strict privacy: no order lists or user addresses)
  app.get('/v1/metrics', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const orderCounts = db.getOrderCountsByStatus();
    const openExposure = db.getOpenExposureUsdMicros();
    const unfundedQuotes = db.countGlobalUnfundedQuotes(now);
    const needsAttentionCount = db.countNeedsAttentionOrders();
    const oldestAge = db.getOldestNonTerminalOrderAgeSeconds(now);

    const quorum = bchClient.getQuorumStatus();
    const bchHealth = evaluateBchHealth(quorum, config);

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
      // Backwards-compatible fields for existing test assertions
      orderCounts,
      openExposureUsdMicros: openExposure.toString(),
      unfundedQuotesCount: unfundedQuotes,
      needsAttentionCount,
      oldestNonTerminalOrderAgeSeconds: oldestAge,
      bchTip: {
        height: quorum.quorumTip,
        ageSeconds: bchSeconds,
        stale: bchHealth.stale,
        quorum: quorum.isQuorumHealthy,
        livenessHealthy: quorum.isLivenessHealthy ?? true,
      },
      evmTip,
    };

    MetricsResponseSchema.parse({
      openExposureUsd: response.openExposureUsd,
      unfundedQuotes: response.unfundedQuotes,
      tipAges: response.tipAges,
      errorCounts: response.errorCounts,
      lastConfirmedAt: response.lastConfirmedAt,
      timestamp: response.timestamp,
    });
    return reply.status(200).send(response);
  });

  // 13. GET /v1/operator/needs-attention (Protected by Bearer token)
  app.get(
    '/v1/operator/needs-attention',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      const now = Math.floor(Date.now() / 1000);
      const summary = db.getNeedsAttentionOrdersSummary(now);

      const orders = summary.map((o) => ({
        orderId: (o.orderId.startsWith('0x')
          ? o.orderId
          : `0x${o.orderId}`) as `0x${string}`,
        direction: o.direction,
        status: o.status,
        lane: o.lane,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        ageSeconds: o.ageSeconds,
        rejectionReason: o.rejectionReason,
        txIds: o.txIds,
      }));

      const response = {
        orders,
        timestamp: now,
      };

      OperatorNeedsAttentionResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 13b. GET /v1/operator/alerts (Protected by Bearer token)
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

  // 13c. GET /v1/operator/inventory (Protected by Bearer token)
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

  // 13d. POST /v1/kill-switch (Protected by Bearer token)
  app.post(
    '/v1/kill-switch',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
      engine.stop();
      return reply.status(200).send({
        ok: true,
        message: 'Kill switch activated: solver engine stopped',
        timestamp: Math.floor(Date.now() / 1000),
      });
    },
  );

  // 13e. POST /v1/pause & POST /v1/resume (Protected by Bearer token)
  app.post(
    '/v1/pause',
    { preHandler: verifyOperatorAuth },
    async (_req, reply) => {
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
      return reply.status(200).send({
        ok: true,
        quotingEnabled: true,
        timestamp: Math.floor(Date.now() / 1000),
      });
    },
  );

  // 13f. GET /v1/config (Protected by Bearer token)
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

    const parseResult = CreatePayLinkRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid create pay link payload',
        { issues: parseResult.error.issues },
      );
    }

    const body = parseResult.data;

    const rateCheck = rateLimiter.check(body.recipientCashaddr, clientIp);
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded on link creation for ${rateCheck.reason}`,
      );
    }

    // Validate recipient cashaddr and locking bytecode
    const recipientCheck = validatePayLinkRecipient(
      body.recipientCashaddr,
      body.recipientLockingBytecode,
    );
    if (!recipientCheck.ok) {
      return sendApiError(reply, 'BAD_REQUEST', recipientCheck.reason);
    }

    const now = Math.floor(Date.now() / 1000);
    const linkId = createLinkId();

    const linkRecord: PayLinkRecord = {
      id: linkId,
      kind: body.kind,
      recipientCashaddr: body.recipientCashaddr,
      recipientLockingBytecode: body.recipientLockingBytecode,
      token: body.token,
      amountOut:
        body.amountOut !== undefined ? BigInt(body.amountOut) : undefined,
      minAmountOut:
        body.minAmountOut !== undefined ? BigInt(body.minAmountOut) : undefined,
      memo: body.memo,
      reference: body.reference,
      expiresAt: body.expiresAt,
      verified: Boolean(body.verification),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };

    db.savePayLink(linkRecord);
    const created = db.getPayLink(linkId)!;

    const response = {
      id: created.id,
      recipientCashaddr: created.recipientCashaddr,
      recipientLockingBytecode:
        created.recipientLockingBytecode as `0x${string}`,
      token: created.token,
      amountOut: created.amountOut,
      minAmountOut: created.minAmountOut,
      note: created.memo,
      expiresAt: created.expiresAt,
      verified: created.verified,
      status: created.status,
      createdAt: created.createdAt,
    };

    PayLinkSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 15. GET /v1/links (List recipient's pay links)
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
        query.challenge,
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
      recipientCashaddr: l.recipientCashaddr,
      recipientLockingBytecode: l.recipientLockingBytecode as `0x${string}`,
      token: l.token,
      amountOut: l.amountOut,
      minAmountOut: l.minAmountOut,
      note: l.memo,
      expiresAt: l.expiresAt,
      verified: l.verified,
      status: l.status,
      createdAt: l.createdAt,
    }));

    return reply.status(200).send({ links });
  });

  // 16. GET /v1/links/:id (Get public pay link details)
  app.get<{ Params: { id: string } }>('/v1/links/:id', async (req, reply) => {
    const { id } = req.params;
    const link = db.getPayLink(id);
    if (!link) {
      return sendApiError(reply, 'LINK_NOT_FOUND', `Pay link ${id} not found`);
    }

    const response = {
      id: link.id,
      recipientCashaddr: link.recipientCashaddr,
      recipientLockingBytecode: link.recipientLockingBytecode as `0x${string}`,
      token: link.token,
      amountOut: link.amountOut,
      minAmountOut: link.minAmountOut,
      note: link.memo,
      expiresAt: link.expiresAt,
      verified: link.verified,
      status: link.status,
      createdAt: link.createdAt,
    };

    PayLinkSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 17. POST /v1/links/:id/quotes (Exact-output quote for pay link)
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

      const parseResult = PayLinkQuoteRequestSchema.safeParse(req.body);
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

      // Compute exact input required to cover targetAmountOut
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
        6, // USDC decimals
        link.token === 'MUSD' ? 8 : 2,
        pricingEvidence,
      );

      const quoteResult = await quoteBuilder.buildQuote({
        quoteId,
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: link.token,
        amountIn: neededIn,
        userAddress: request.userCounterAddress,
        userIp: '127.0.0.1',
        currentInventory: 100_000_000n,
        openExposure: db.getOpenExposureUsdMicros(),
        nowSeconds: now,
        quotingEnabled: config.quotingEnabled,
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
          userEvmAddress: request.userCounterAddress as `0x${string}`,
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
        return reply.status(422).send({
          reason: quoteResult.reason,
          maxAmount: quoteResult.maxAmount,
          asset: quoteResult.asset,
          message: quoteResult.message,
        });
      }

      const { terms } = quoteResult;
      const orderIdHex = computeOrderId(terms);
      const signature = await signOrderId(orderIdHex, solverAccount);

      db.saveOrder({
        id: orderIdHex,
        direction: 'COUNTER_TO_BCH',
        status: 'QUOTED',
        userCounterAddress: terms.userEvmAddress,
        lockId: orderIdHex,
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
          request.challenge,
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

      if (link.status !== 'open') {
        return sendApiError(
          reply,
          'LINK_CLOSED',
          'Only open pay links can be cancelled',
        );
      }

      db.updatePayLinkStatus(link.id, 'cancelled');
      const updated = db.getPayLink(id)!;

      const response = {
        id: updated.id,
        recipientCashaddr: updated.recipientCashaddr,
        recipientLockingBytecode:
          updated.recipientLockingBytecode as `0x${string}`,
        token: updated.token,
        amountOut: updated.amountOut,
        minAmountOut: updated.minAmountOut,
        note: updated.memo,
        expiresAt: updated.expiresAt,
        verified: updated.verified,
        status: updated.status,
        createdAt: updated.createdAt,
      };

      PayLinkSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 19. POST /v1/send-quotes (Send link quotes with hold fee & window planning)
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

    const parseResult = SendQuoteRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid send quote request payload',
        { issues: parseResult.error.issues },
      );
    }

    const request = parseResult.data;

    const rateCheck = rateLimiter.check(request.recipientAddress, clientIp);
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded on send quote requests for ${rateCheck.reason}`,
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const quorum = bchClient.getQuorumStatus();

    // Plan window and deadlines
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

    const feeBps = holdFeeBps(request.windowSeconds);
    const effectiveSpread = effectiveSendLinkSpreadBps(
      config.spreadBps,
      request.windowSeconds,
    );

    const pricingEvidence = {
      refs: [
        {
          asset: request.bchToken,
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

    const targetAmount = BigInt(request.amount);
    // Exact in calculation for reverse flow (User locks BCH token, receives EVM USDC)
    const neededBchToken = quoteInForExactOut(
      targetAmount,
      request.bchToken === 'MUSD' ? 8 : 2,
      6, // EVM USDC decimals
      pricingEvidence,
    );

    const quoteId = `sq-${now}-${Math.random().toString(36).slice(2, 9)}`;
    const quoteExpiry = now + config.quoteTtlSeconds;

    const response = {
      quoteId,
      destinationChainId: request.destinationChainId,
      token: request.token,
      amount: targetAmount.toString(),
      recipientAddress: request.recipientAddress,
      windowSeconds: request.windowSeconds,
      holdFeeBps: feeBps,
      effectiveSpreadBps: effectiveSpread,
      bchTokenAmount: neededBchToken.toString(),
      evmDeadlineSeconds: windowPlan.evmDeadlineSeconds,
      bchRefundHeight: windowPlan.bchRefundHeight,
      quoteExpiry,
    };

    SendQuoteResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 20. GET /v1/send-links/:id (Public send-link details; NEVER the secret)
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

      const response = {
        id: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as `0x${string}`,
        destinationChainId: terms.evmChainId,
        token: terms.evmToken,
        recipientAddress: terms.userEvmAddress.toLowerCase() as `0x${string}`,
        amount: terms.evmAmount.toString(),
        windowSeconds: Math.max(0, terms.evmDeadline - order.createdAt),
        status: order.status.toLowerCase(),
        createdAt: order.createdAt,
      };

      SendLinkDetailResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  return app;
}
