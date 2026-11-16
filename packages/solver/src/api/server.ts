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
import { loadChainConfig } from '@ferry/chain-config';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { deriveBchKeyDetails } from '../bch/lock-builder.js';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import type { BchQuorumStatus } from '../bch/types.js';
import type { SolverConfig } from '../config.js';
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
  MetricsResponseSchema,
  OperatorNeedsAttentionResponseSchema,
  OrderStatusResponseSchema,
  PayLinkQuoteRequestSchema,
  PayLinkSchema,
  PegsResponseSchema,
  QuoteRequestSchema,
  QuoteResponseSchema,
  RecentSwapsResponseSchema,
  RelayClaimRequestSchema,
  RelayClaimResponseSchema,
  RelayLockRequestSchema,
  RelayLockResponseSchema,
  RevealSecretRequestSchema,
  RevealSecretResponseSchema,
  SendLinkDetailResponseSchema,
  SendQuoteRequestSchema,
  SendQuoteResponseSchema,
  StatsSummarySchema,
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
  });

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

    const parseResult = QuoteRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid quote request payload',
        { issues: parseResult.error.issues },
      );
    }

    const request = parseResult.data;

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
      orderId: orderIdHex,
      terms,
      lane: request.lane,
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

    const response = {
      orderId: order.id,
      direction: order.direction,
      status: order.status,
      lane: order.lane ?? 'safe',
      terms,
      txIds: {
        userLockTxId: order.userLockTxId,
        solverLockTxId: order.solverLockTxId,
        userClaimTxId: order.userClaimTxId,
        solverClaimTxId: order.solverClaimTxId,
        solverRefundTxId: order.solverRefundTxId,
      },
      deadlines: {
        quoteExpiry: terms.quoteExpiry,
        evmDeadline: terms.evmDeadline,
        bchRefundHeight: terms.bchRefundHeight,
      },
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
        orderId: order.id,
        status: order.status,
        accepted: true as const,
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

      const parseResult = RelayLockRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid relay-lock payload',
          { issues: parseResult.error.issues },
        );
      }

      try {
        const txRef = await evmAdapter.relayLock({
          chain: evmAdapter.id,
          orderId: order.id as Hex32,
          payload: parseResult.data.payload ?? parseResult.data,
        });
        const now = Math.floor(Date.now() / 1000);
        order.userLockTxId = txRef.txId;
        order.status = 'USER_LOCK_SEEN';
        order.updatedAt = now;
        db.saveOrder(order);

        const response = {
          orderId: order.id,
          status: order.status,
          txId: txRef.txId,
          relayed: true as const,
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

      const parseResult = RelayClaimRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid relay-claim payload',
          { issues: parseResult.error.issues },
        );
      }

      const secretToUse = parseResult.data.secret ?? order.secret;
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
        order.solverClaimTxId = txRef.txId;
        order.status = 'SOLVER_CLAIM_BROADCAST';
        order.updatedAt = now;
        db.saveOrder(order);

        const response = {
          orderId: order.id,
          status: order.status,
          txId: txRef.txId,
          relayed: true as const,
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
      return reply.status(200).send(chainConfig);
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

    const response = {
      completedSwaps: stats.completedSwaps,
      volumeUsdMicros:
        stats.volumeUsdMicros !== null
          ? stats.volumeUsdMicros.toString()
          : null,
      medianFastSeconds: stats.medianFastSeconds,
      quotePolicy: stats.quotePolicy
        ? {
            spreadBps: stats.quotePolicy.spreadBps,
            fixedFeeUsdMicros: stats.quotePolicy.fixedFeeUsdMicros.toString(),
          }
        : null,
      asOf: stats.asOf,
    };

    StatsSummarySchema.parse(response);
    return reply.status(200).send(response);
  });

  // 10. GET /v1/orders/recent
  app.get('/v1/orders/recent', async (_req, reply) => {
    const recent = db.getRecentSwaps(50);
    const swaps = recent.map((s) => ({
      ...s,
      counterAmount: s.counterAmount.toString(),
      bchTokenAmount: s.bchTokenAmount.toString(),
      orderId: (s.orderId.startsWith('0x')
        ? s.orderId
        : `0x${s.orderId}`) as `0x${string}`,
      baseTxId: (s.baseTxId.startsWith('0x')
        ? s.baseTxId
        : `0x${s.baseTxId}`) as `0x${string}`,
    }));

    const response = { swaps };
    RecentSwapsResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 11. GET /v1/pegs
  app.get('/v1/pegs', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const response = {
      pegs: [
        {
          token: 'PUSD' as const,
          priceUsdMicros: '1000000',
          points: [{ at: now, priceUsdMicros: '1000000' }],
          source: 'reference',
          asOf: now,
        },
        {
          token: 'MUSD' as const,
          priceUsdMicros: '1000000',
          points: [{ at: now, priceUsdMicros: '1000000' }],
          source: 'reference',
          asOf: now,
        },
      ],
    };

    PegsResponseSchema.parse(response);
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

    const response = {
      orderCounts,
      openExposureUsdMicros: openExposure.toString(),
      unfundedQuotesCount: unfundedQuotes,
      needsAttentionCount,
      oldestNonTerminalOrderAgeSeconds: oldestAge,
      bchTip: {
        height: quorum.quorumTip,
        ageSeconds: Math.max(
          0,
          quorum.ageSeconds === Infinity ? 0 : quorum.ageSeconds,
        ),
        stale: bchHealth.stale,
        quorum: quorum.isQuorumHealthy,
        livenessHealthy: quorum.isLivenessHealthy ?? true,
      },
      evmTip,
      lastConfirmedAt: quorum.lastConfirmedAt
        ? Math.floor(quorum.lastConfirmedAt)
        : null,
      timestamp: now,
    };

    MetricsResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 13. GET /v1/operator/needs-attention (Protected by Bearer token)
  app.get('/v1/operator/needs-attention', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
  });

  // 14. POST /v1/links (Create PayLink)
  app.post('/v1/links', async (req, reply) => {
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
      const { id } = req.params;
      const link = db.getPayLink(id);
      if (!link) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Pay link ${id} not found`,
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
        orderId: orderIdHex,
        terms,
        lane: request.lane,
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
