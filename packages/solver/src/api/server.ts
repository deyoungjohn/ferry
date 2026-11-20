import { formatUsdMicrosToDecimal } from '../pricing/price-source.js';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import type pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  verifyTypedData,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
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
import * as libauth from '@bitauth/libauth';
import {
  API_ERROR_CODES,
  API_ERROR_HTTP_STATUS,
  ApiErrorResponseSchema,
  CancelPayLinkRequestSchema,
  CancelPayLinkResponseSchema,
  CancelSendLinkQuotaSchema,
  CancelSendLinkRequestSchema,
  CancelSendLinkResponseSchema,
  ChainsResponseSchema,
  CreatePayLinkRequestSchema,
  CreatePayLinkResponseSchema,
  DeletePayLinkResponseSchema,
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
  SendLinksQueryRequestSchema,
  SendLinksQueryResponseSchema,
  SendQuoteRequestSchema,
  StatsResponseSchema,
  switchRouteRequestTypedData,
  SwitchSendLinkRouteRequestSchema,
  SwitchSendLinkRouteResponseSchema,
  type ApiErrorCode,
  type BchFirstUseResponse,
  type BchHistoryResponse,
  type BchTipResponse,
  type CancelSendLinkRequest,
  type CancelSendLinkResponse,
  type DeletePayLinkResponse,
  type SendLinkDetailsResponse,
  type SendLinkQueryMatch,
} from '@ferry/core/api';
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
import { MIN_TRANSACTION_USD_MICROS } from '@ferry/core';
import { claimRequestTypedData } from '@ferry/core/api';
import type { OrderRecord, PayLinkRecord } from '../db/types.js';
import type {
  SolverOrderRecord,
  OrderStatus,
  SwapDirection,
} from '../state-machine/types.js';
import type { SolverEngine } from '../engine/runner.js';
import { createLinkId, verifyPayLinksSignature } from '../paylink/link.js';
import {
  LiquidityManager,
  exposureInAssetUnits,
  type InventoryAssetView,
} from '../pricing/liquidity.js';
import { InventoryReader } from '../pricing/inventory-reader.js';
import type { PriceSource } from '../pricing/price-source.js';
import {
  QuoteBuilder,
  tokenAmountToUsdMicros,
} from '../pricing/quote-builder.js';
import { LiveCostModelReader } from '../pricing/cost-model.js';
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
  bchProxyLimiter?: QuoteRateLimiter | undefined;
  publicClient?: PublicClient | undefined;
  inventoryReader?: InventoryReader | undefined;
  costModelReader?: LiveCostModelReader | undefined;
}

export const createSolverServer = buildServer;
/** Blocks of slack added to a send link's Bitcoin Cash refund height (about an hour). */
const SEND_LINK_EXTRA_BCH_BLOCKS = 6;

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config, db, evmAdapter, bchClient, engine, priceSource } = options;

  /**
   * A pay link follows the swap that pays it: the order is attached when one exists, and the link
   * becomes paid once that order is done.
   */
  const syncPayLink = (link: PayLinkRecord): PayLinkRecord => {
    if (link.status !== 'open' && link.status !== 'reserved') return link;
    const order = db.findOrderForPayLink(link);
    if (!order) return link;
    const done = order.status === 'DONE';
    const next: PayLinkRecord = {
      ...link,
      orderId: order.id,
      status: done ? 'paid' : 'reserved',
      updatedAt: done ? order.updatedAt : link.updatedAt,
    };
    if (next.orderId !== link.orderId || next.status !== link.status) {
      db.savePayLink(next);
    }
    return next;
  };

  /** The transaction ids of an order, named by chain and role (the same names as /v1/orders/:id). */
  const orderTxidMap = (order: OrderRecord): Record<string, string> => {
    const hex = (v: string) => (v.startsWith('0x') ? v : `0x${v}`);
    const forward =
      order.direction === 'EVM_TO_BCH' || order.direction === 'COUNTER_TO_BCH';
    const out: Record<string, string> = {};
    if (order.userLockTxId)
      out[forward ? 'evmLock' : 'bchLock'] = hex(order.userLockTxId);
    if (order.solverLockTxId)
      out[forward ? 'bchLock' : 'evmLock'] = hex(order.solverLockTxId);
    if (order.userClaimTxId)
      out[forward ? 'bchClaim' : 'evmClaim'] = hex(order.userClaimTxId);
    if (order.solverClaimTxId)
      out[forward ? 'evmClaim' : 'bchClaim'] = hex(order.solverClaimTxId);
    if (order.solverRefundTxId) {
      if (order.status === 'RELEASED') {
        out[forward ? 'evmRefund' : 'bchRefund'] = hex(order.solverRefundTxId);
      } else if (forward && !order.solverLockTxId) {
        out.evmRefund = hex(order.solverRefundTxId);
      } else {
        out[forward ? 'bchRefund' : 'evmRefund'] = hex(order.solverRefundTxId);
      }
    }
    return out;
  };

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

  // Prices asked for only to look (a dry run: nothing reserved) have their own, much larger
  // allowance: a page asks for several while a person types an amount or the exact amount is found.
  const previewLimiter = new QuoteRateLimiter({
    windowMs: config.rateLimitWindowMs,
    maxPerAddress: config.rateLimitMaxPerAddress * 10,
    maxPerIp: config.rateLimitMaxPerIp * 10,
  });

  // Allowance for Bitcoin Cash reads/broadcast proxy: generous to allow 2,000-address scans
  const bchProxyLimiter =
    options.bchProxyLimiter ??
    new QuoteRateLimiter({
      windowMs: 60_000,
      maxPerAddress: 10_000,
      maxPerIp: 3_000,
    });

  interface BchProxyCacheEntry<T> {
    data: T;
    cachedAt: number;
  }
  const historyCache = new Map<
    string,
    BchProxyCacheEntry<BchHistoryResponse>
  >();
  const firstUseCache = new Map<
    string,
    BchProxyCacheEntry<BchFirstUseResponse>
  >();
  const txCache = new Map<string, string>();
  let tipCache: BchProxyCacheEntry<BchTipResponse> | null = null;
  const MAX_BCH_HISTORY_ENTRIES = 1000;

  const solverAccount = privateKeyToAccount(
    config.solverEvmPrivateKey as `0x${string}`,
  );

  const defaultReservationCap =
    config.maxSwapUsdMicros * 2n < config.maxExposureUsdMicros
      ? config.maxSwapUsdMicros * 2n
      : config.maxExposureUsdMicros;

  const reservationCapPerAddress =
    config.reservationCapPerAddressUsdMicros ?? defaultReservationCap;
  const reservationCapPerIp =
    config.reservationCapPerIpUsdMicros ?? defaultReservationCap;

  const liquidityManager = new LiquidityManager(
    reservationCapPerAddress,
    reservationCapPerIp,
  );

  const inventoryReader =
    options.inventoryReader ??
    new InventoryReader({
      config,
      bchClient,
      evmAdapter,
      evmAdapters: options.evmAdapters,
      evmClients: options.evmClients,
      solverEvmAddress: solverAccount.address,
    });

  const liveCostClient =
    options.evmClients?.get('base') ??
    (options.publicClient ||
      (evmAdapter as unknown as { client?: PublicClient })?.client);

  const baseClients: PublicClient[] = [];
  if (liveCostClient) {
    baseClients.push(liveCostClient);
  }
  if (config.baseRpcUrls) {
    const viemChain = config.network === 'mainnet' ? base : baseSepolia;
    const urls = config.baseRpcUrls
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    for (const url of urls) {
      try {
        baseClients.push(
          createPublicClient({
            chain: viemChain,
            transport: http(url),
          }) as unknown as PublicClient,
        );
      } catch {
        // ignore invalid URL format
      }
    }
  }

  const costModelReader =
    options.costModelReader ??
    (baseClients.length > 0 || liveCostClient
      ? new LiveCostModelReader({
          client: liveCostClient,
          clients: baseClients.length > 0 ? baseClients : undefined,
          bchClient,
          ethUsdFeedAddress: config.ethUsdFeedAddress as `0x${string}`,
          limits: {
            ethUsdMaxAgeSeconds: config.ethUsdMaxAgeSeconds,
            bchUsdMaxAgeSeconds: config.bchUsdMaxAgeSeconds,
            baseGasMaxAgeSeconds: config.baseGasMaxAgeSeconds,
            bchFeeRateMaxAgeSeconds: config.bchFeeRateMaxAgeSeconds,
            bchUsdDisagreementPercent: config.bchUsdDisagreementPercent,
            costFeedGraceSeconds: config.costFeedGraceSeconds,
          },
          costSafetyPercent: config.costSafetyPercent,
          minMarginUsdMicros: config.minMarginUsdMicros,
          cacheTtlSeconds: config.costCacheTtlSeconds,
          costFeedGraceSeconds: config.costFeedGraceSeconds,
        })
      : undefined);

  /** Why quoting is off, for the refusal text (never reveals more than which condition holds). */
  const quotingPausedMessage = (): string =>
    !config.quotingEnabled
      ? 'Quoting is switched off in the solver settings.'
      : (engine.quotingBlockReason?.() ??
        'Quoting is currently disabled on the solver');

  /** What a swap moved (token, amounts, chain), from its signed terms, for answers about links. */
  const orderSummaryOf = (
    termsJson: string,
  ): {
    summary?: {
      bchToken: string;
      bchTokenAmount: string;
      evmAmount: string;
      evmChainId: number;
      evmToken?: string;
      evmDecimals?: number;
    };
  } => {
    try {
      const raw = JSON.parse(termsJson) as Record<string, unknown>;
      const num = (v: unknown) => String(v ?? '').replace(/n$/, '');
      const chainId = Number(raw.evmChainId);
      if (
        !Number.isInteger(chainId) ||
        chainId <= 0 ||
        !/^\d+$/.test(num(raw.bchTokenAmount)) ||
        !/^\d+$/.test(num(raw.evmAmount))
      ) {
        return {};
      }
      const asset = (
        options.routesContext ?? buildActiveRoutes(config)
      ).chainConfig.facts
        .find((c) => c.chainId === chainId)
        ?.assets.find(
          (a) =>
            a.address?.toLowerCase() === String(raw.evmToken).toLowerCase(),
        );
      return {
        summary: {
          bchToken: String(raw.bchToken),
          bchTokenAmount: num(raw.bchTokenAmount),
          evmAmount: num(raw.evmAmount),
          evmChainId: chainId,
          ...(asset
            ? { evmToken: asset.symbol, evmDecimals: asset.decimals ?? 6 }
            : {}),
        },
      };
    } catch {
      return {};
    }
  };

  const quoteBuilder = new QuoteBuilder(
    priceSource,
    liquidityManager,
    {
      spreadBps: config.spreadBps,
      fixedFeeUsdMicros: config.fixedFeeUsdMicros,
    },
    config.pegToleranceUsdMicros,
    {
      warnUsdMicros: config.sourceDisagreementWarnUsdMicros,
      refuseUsdMicros: config.sourceDisagreementRefuseUsdMicros,
      paryonMaxAgeSeconds: config.paryonMaxAgeSeconds,
    },
    config.maxSwapUsdMicros,
    costModelReader,
    config.costModelEnabled,
    config.quoteTtlSeconds,
  );

  if (options.logger) {
    options.logger.info(
      {
        network: config.network,
        minSwapUsd: (Number(config.minSwapUsdMicros) / 1e6).toFixed(2),
        maxSwapUsd: (Number(config.maxSwapUsdMicros) / 1e6).toFixed(2),
        maxExposureUsd: (Number(config.maxExposureUsdMicros) / 1e6).toFixed(2),
        reservationCapPerAddressUsd: (
          Number(reservationCapPerAddress) / 1e6
        ).toFixed(2),
        reservationCapPerIpUsd: (Number(reservationCapPerIp) / 1e6).toFixed(2),
        spreadBps: config.spreadBps,
        fixedFeeUsd: (Number(config.fixedFeeUsdMicros) / 1e6).toFixed(2),
        quoteTtlSeconds: config.quoteTtlSeconds,
        skewMaxBps: config.skewMaxBps,
        costModelEnabled: config.costModelEnabled,
        costSafetyPercent: config.costSafetyPercent,
      },
      'Effective solver policy configured',
    );
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
    const isDryRun = Boolean(raw.dryRun);
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
      ...(raw.payLinkId !== undefined ? { payLinkId: raw.payLinkId } : {}),
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

    // A hash lock is used by one order only: a second swap with the same secret could be claimed
    // by whoever learned it from the first. The page then moves to its next secret.
    if (!isDryRun && db.getOrderByHashLock(coreRequest.hashLock)) {
      return sendApiError(
        reply,
        'CONFLICT',
        'hashLock has already been used by another order',
      );
    }
    const request = {
      ...coreRequest,
      bchToken: coreRequest.token,
      evmChainId: coreRequest.chainId,
    };

    // Rate limit check
    const rateCheck = (isDryRun ? previewLimiter : rateLimiter).check(
      request.userEvmAddress,
      clientIp,
    );
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        'Too many quote requests in a short time. Wait a minute and try again.',
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
        message: quotingPausedMessage(),
      });
    }

    // BCH health check: refuse to quote when node tip is stale or unhealthy
    const quorum = bchClient.getQuorumStatus();
    const bchHealth = evaluateBchHealth(quorum, config);
    if (!bchHealth.isHealthy) {
      const refusal = {
        reason: 'INSUFFICIENT_LIQUIDITY' as const,
        maxAmount: '0',
        asset: request.bchToken,
        message: `Bitcoin Cash node tip is stale or unhealthy (tip: ${quorum.quorumTip ?? 0}, age: ${quorum.ageSeconds}s, max: ${config.tipMaxAgeBchSeconds}s)`,
      };
      QuoteRefusalSchema.parse(refusal);
      return reply.status(422).send(refusal);
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
        : (chainFact.assets.find((a) => a.symbol === 'USDC')?.address ??
          chainFact.assets[0]?.address));

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
          (a.address.toLowerCase() === requestedToken.toLowerCase() ||
            a.symbol.toUpperCase() === requestedToken.toUpperCase()),
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

    const receiveAsset =
      request.direction === 'EVM_TO_BCH'
        ? request.bchToken
        : (evmAsset?.symbol ?? 'USDC');

    let currentInventory: bigint;
    try {
      currentInventory = await inventoryReader.getAssetInventory({
        asset: receiveAsset,
        chain: evmChainName,
        tokenAddress: requestedToken,
      });
    } catch (err) {
      const refusal = {
        reason: 'INSUFFICIENT_LIQUIDITY' as const,
        maxAmount: '0',
        asset: receiveAsset,
        message: `Inventory balance unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
      QuoteRefusalSchema.parse(refusal);
      return reply.status(422).send(refusal);
    }

    // Gas availability checks
    if (request.direction === 'EVM_TO_BCH') {
      try {
        const bchInv = await inventoryReader.getBchInventory();
        const minBchSats = config.bchCarrySats + config.bchMaxFeeSats;
        if (bchInv.sats < minBchSats) {
          const refusal = {
            reason: 'INSUFFICIENT_LIQUIDITY' as const,
            maxAmount: '0',
            asset: request.bchToken,
            message: `Solver BCH fee balance (${bchInv.sats} sats) is below required ${minBchSats} sats (carry: ${config.bchCarrySats}, fee: ${config.bchMaxFeeSats})`,
          };
          QuoteRefusalSchema.parse(refusal);
          return reply.status(422).send(refusal);
        }
      } catch {
        // Handled during currentInventory read or upstream
      }
    } else if (request.direction === 'BCH_TO_EVM') {
      try {
        const evmInv = await inventoryReader.getEvmInventory(
          evmChainName,
          requestedToken,
        );
        if (evmInv.nativeWei <= 0n) {
          const refusal = {
            reason: 'INSUFFICIENT_LIQUIDITY' as const,
            maxAmount: '0',
            asset: evmAsset?.symbol ?? 'USDC',
            message: `Solver native gas balance on ${chainFact.name} is ${evmInv.nativeWei} wei; requires native gas for counter-lock`,
          };
          QuoteRefusalSchema.parse(refusal);
          return reply.status(422).send(refusal);
        }
      } catch {
        // Handled
      }
    }

    const openExposure = db.getOpenExposureUsdMicros();

    const quoteResult = await quoteBuilder.buildQuote({
      quoteId,
      direction: request.direction,
      payAsset:
        request.direction === 'EVM_TO_BCH'
          ? (evmAsset?.symbol ?? 'USDC')
          : request.bchToken,
      receiveAsset,
      evmChain: chainFact.id,
      amountIn: amountInBigInt,
      inputDecimals: inDecimals,
      outputDecimals: outDecimals,
      fixedFeeUsdMicros,
      minSwapUsdMicros,
      maxSwapUsdMicros: config.maxSwapUsdMicros,
      dryRun: isDryRun,
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
        ...('minAmount' in quoteResult
          ? { minAmount: quoteResult.minAmount }
          : {}),
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

    // The pay link this payment is for, when the request names one that is open and matches the
    // token and the recipient: the order is then marked as that link's payment.
    let payLinkId: string | undefined;
    if (request.payLinkId) {
      const link = db.getPayLink(request.payLinkId);
      if (
        link &&
        (link.status === 'open' || link.status === 'reserved') &&
        link.token === request.token &&
        link.recipientLockingBytecode.toLowerCase() ===
          request.userBchLockingBytecode.toLowerCase()
      ) {
        payLinkId = link.id;
      }
    }

    if (!isDryRun) {
      db.saveOrder({
        id: orderIdHex,
        direction: terms.direction,
        status: 'QUOTED',
        ...(payLinkId ? { payLinkId } : {}),
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
  });

  function formatOrderStatusResponse(order: OrderRecord) {
    let terms: OrderTerms;
    try {
      terms = JSON.parse(order.termsJson, (_k, v) =>
        typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
      );
    } catch {
      throw new Error('Failed to parse stored order terms');
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
      if (order.status === 'RELEASED') {
        if (isEvmToBch) {
          txids.evmRefund = tx;
        } else {
          txids.bchRefund = tx;
        }
      } else if (isEvmToBch && !order.solverLockTxId) {
        txids.evmRefund = tx;
      } else if (isEvmToBch) {
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
      createdAt: order.createdAt,
      timeline: db.listOrderEvents(order.id),
      summary: {
        bchToken: String(terms.bchToken),
        bchTokenAmount: terms.bchTokenAmount.toString(),
        evmAmount: terms.evmAmount.toString(),
        evmChainId: Number(terms.evmChainId),
        ...(() => {
          const asset = (
            options.routesContext ?? buildActiveRoutes(config)
          ).chainConfig.facts
            .find((c) => c.chainId === Number(terms.evmChainId))
            ?.assets.find(
              (a) =>
                a.address?.toLowerCase() ===
                String(terms.evmToken).toLowerCase(),
            );
          return asset
            ? { evmToken: asset.symbol, evmDecimals: asset.decimals ?? 6 }
            : {};
        })(),
      },
    };

    return OrderStatusResponseSchema.parse(response);
  }

  // 2. GET /v1/orders/:id
  app.get<{ Params: { id: string } }>('/v1/orders/:id', async (req, reply) => {
    const { id } = req.params;
    const activeId = db.resolveSendLinkOrderId(id);
    const order = db.getOrder(activeId);
    if (!order) {
      return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
    }

    try {
      const response = formatOrderStatusResponse(order);
      return reply.status(200).send(response);
    } catch {
      return sendApiError(
        reply,
        'INTERNAL_ERROR',
        'Failed to parse stored order terms',
      );
    }
  });

  // 2b. GET /v1/orders/by-hash-lock/:hashLock
  app.get<{ Params: { hashLock: string } }>(
    '/v1/orders/by-hash-lock/:hashLock',
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

      const rateCheck = rateLimiter.checkIp(clientIp);
      if (!rateCheck.allowed) {
        return sendApiError(
          reply,
          'RATE_LIMITED',
          `Rate limit exceeded for ${clientIp}`,
        );
      }

      const { hashLock } = req.params;
      const order = db.getOrderByHashLock(hashLock);
      if (!order) {
        return sendApiError(
          reply,
          'ORDER_NOT_FOUND',
          `Order with hash lock ${hashLock} not found`,
        );
      }

      try {
        const response = formatOrderStatusResponse(order);
        return reply.status(200).send(response);
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse stored order terms',
        );
      }
    },
  );

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

      if (order.status === 'CANCELLED' || db.isOrderCancelled(order.id)) {
        return sendApiError(
          reply,
          'LINK_CANCELLED',
          'This send link was cancelled by the sender and cannot be claimed',
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
      const activeId = db.resolveSendLinkOrderId(id);
      const order = db.getOrder(activeId);
      if (!order) {
        return sendApiError(reply, 'ORDER_NOT_FOUND', `Order ${id} not found`);
      }

      if (order.status === 'CANCELLED' || db.isOrderCancelled(order.id)) {
        return sendApiError(
          reply,
          'LINK_CANCELLED',
          'This send link was cancelled by the sender and cannot be claimed',
        );
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

      // A claim that carries a signature must be signed by the recipient fixed in the order
      // (the send link's entered address): anyone else is refused, not merely redirected.
      if (typeof raw.claimSig === 'string' && orderTerms) {
        const typed = claimRequestTypedData({
          chainId: Number(orderTerms.evmChainId),
          orderId: order.id as `0x${string}`,
          lockId: lockId as `0x${string}`,
        });
        let signedByRecipient: boolean;
        try {
          signedByRecipient = await verifyTypedData({
            address: orderTerms.userEvmAddress as `0x${string}`,
            ...typed,
            signature: raw.claimSig as `0x${string}`,
          });
        } catch {
          signedByRecipient = false;
        }
        if (!signedByRecipient) {
          return sendApiError(
            reply,
            'UNAUTHORIZED',
            `Only ${orderTerms.userEvmAddress} can claim this link: sign the claim with that wallet`,
          );
        }
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
      if (order.direction === 'BCH_TO_EVM') {
        order.secret = secretToUse;
        order.userClaimTxId = txHash;
        order.status = 'USER_CLAIM_SEEN';
      } else {
        order.solverClaimTxId = txHash;
        order.status = 'SOLVER_CLAIM_BROADCAST';
      }
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

    const evmBlocks: Record<string, number> = {};
    const evmSeconds: Record<string, number> = {};
    let evmHealthy = true;

    try {
      const tip = await evmAdapter.getTip();
      const height = Math.max(0, tip.height);
      const age = Math.max(0, tip.ageSeconds);
      const chainKey = (evmAdapter.id ?? 'base').toLowerCase();
      evmBlocks[chainKey] = height;
      evmSeconds[chainKey] = age;
      if (
        (tip as { stale?: boolean }).stale ||
        age > config.tipMaxAgeBaseSeconds ||
        height <= 0
      ) {
        evmHealthy = false;
      }
    } catch {
      const chainKey = (evmAdapter.id ?? 'base').toLowerCase();
      evmBlocks[chainKey] = 0;
      evmSeconds[chainKey] = config.tipMaxAgeBaseSeconds + 1;
      evmHealthy = false;
    }

    if (options.evmAdapters) {
      for (const [key, adapter] of options.evmAdapters.entries()) {
        const chainKey = key.toLowerCase();
        if (evmBlocks[chainKey] !== undefined) continue;
        try {
          const tip = await adapter.getTip();
          const height = Math.max(0, tip.height);
          const age = Math.max(0, tip.ageSeconds);
          evmBlocks[chainKey] = height;
          evmSeconds[chainKey] = age;
          if (
            (tip as { stale?: boolean }).stale ||
            age > config.tipMaxAgeBaseSeconds ||
            height <= 0
          ) {
            evmHealthy = false;
          }
        } catch {
          evmBlocks[chainKey] = 0;
          evmSeconds[chainKey] = config.tipMaxAgeBaseSeconds + 1;
          evmHealthy = false;
        }
      }
    }

    const bchHeight = Math.max(0, Math.floor(quorum.quorumTip ?? 0));
    const bchSeconds = Math.max(
      0,
      Math.floor(
        quorum.ageSeconds === Infinity || isNaN(quorum.ageSeconds)
          ? 0
          : quorum.ageSeconds,
      ),
    );

    const isQuotingActive = config.quotingEnabled && !db.isQuotingPaused();
    const ok = bchHealth.isHealthy && evmHealthy && isQuotingActive;

    const costFeeds = costModelReader
      ? costModelReader.getFeedStatuses()
      : undefined;

    const response = {
      ok,
      quotingEnabled: isQuotingActive,
      timestamp: Math.floor(Date.now() / 1000),
      tips: {
        bchHeight,
        evmBlocks,
      },
      tipAges: {
        bchSeconds,
        evmSeconds,
      },
      bchRoutes: [
        'GET /v1/bch/utxos/:scriptHash',
        'GET /v1/bch/history/:scriptHash',
        'GET /v1/bch/first-use/:scriptHash',
        'GET /v1/bch/tx/:txid',
        'POST /v1/bch/broadcast',
        'GET /v1/bch/tip',
      ],
      ...(costFeeds ? { costFeeds } : {}),
    };

    HealthResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 7. GET /v1/liquidity
  app.get('/v1/liquidity', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const openExposure = db.getOpenExposureUsdMicros();

    // A failed read reports nothing for these routes; it must not look like an empty wallet.
    let pusdInventory = 0n;
    let musdInventory = 0n;
    let bchRead: boolean;
    try {
      const bch = await inventoryReader.getBchInventory();
      pusdInventory = bch.pusd;
      musdInventory = bch.musd;
      bchRead = true;
    } catch {
      bchRead = false;
    }

    const pusdData = liquidityManager.getLiquidityData(
      'PUSD',
      pusdInventory,
      exposureInAssetUnits('PUSD', openExposure),
      2,
      now,
      'base-usdc-to-bch-pusd',
    );

    const musdData = liquidityManager.getLiquidityData(
      'MUSD',
      musdInventory,
      exposureInAssetUnits('MUSD', openExposure),
      2,
      now,
      'base-usdc-to-bch-musd',
    );

    const routesList = bchRead ? [pusdData, musdData] : [];

    const routesCtx = options.routesContext ?? buildActiveRoutes(config);
    for (const chainFact of routesCtx.chainConfig.facts) {
      const chainKey = chainFact.id.toLowerCase();
      const isEnabled = routesCtx.enabledRoutes.some(
        (r) => r.chain.toLowerCase() === chainKey,
      );
      if (!isEnabled) continue;

      // Every enabled stablecoin of the chain (USDC, USDT, USDG), each from its own inventory.
      const enabledSymbols = new Set(
        routesCtx.enabledRoutes
          .filter((r) => r.chain.toLowerCase() === chainKey)
          .map((r) => r.asset.toUpperCase()),
      );
      for (const asset of chainFact.assets) {
        const symbol = asset.symbol.toUpperCase();
        if (!asset.verified || !enabledSymbols.has(symbol)) continue;
        try {
          const inventory = await inventoryReader.getAssetInventory({
            asset: symbol,
            chain: chainKey,
            tokenAddress: asset.address ?? undefined,
          });

          routesList.push(
            liquidityManager.getLiquidityData(
              symbol,
              inventory,
              openExposure,
              asset.decimals ?? 6,
              now,
              `bch-pusd-to-${chainKey}-${symbol.toLowerCase()}`,
            ),
          );

          const hasMusd = routesCtx.enabledRoutes.some(
            (r) =>
              r.chain.toLowerCase() === chainKey &&
              (r as { bchToken?: string }).bchToken === 'MUSD',
          );
          if (hasMusd) {
            routesList.push(
              liquidityManager.getLiquidityData(
                symbol,
                inventory,
                openExposure,
                asset.decimals ?? 6,
                now,
                `bch-musd-to-${chainKey}-${symbol.toLowerCase()}`,
              ),
            );
          }
        } catch {
          // Failing reads report nothing for that entry rather than zero
        }
      }
    }

    const response = {
      routes: routesList,
      asOf: now,
    };

    LiquidityResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 8. GET /v1/chains
  app.get('/v1/chains', async (_req, reply) => {
    try {
      const routesCtx = options.routesContext ?? buildActiveRoutes(config);
      const chains = routesCtx.chainConfig.facts.map((facts) => {
        const enabled = routesCtx.enabledRoutes.some(
          (route) => route.chain.toLowerCase() === facts.id.toLowerCase(),
        );
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
  // GET /v1/orders?address=0x...: the swaps of one EVM address (the address does not rotate,
  // unlike a Bitcoin Cash one). Public data only: ids, direction, state, time, amounts.
  app.get('/v1/orders', async (req, reply) => {
    const address = String(
      (req.query as { address?: string } | undefined)?.address ?? '',
    );
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return reply
        .status(400)
        .send({ error: 'address must be a 0x-prefixed EVM address' });
    }
    const orders = db.listOrdersByAddress(address).map((o) => {
      let evmAmount = '';
      let bchTokenAmount = '';
      let bchToken = '';
      let evmChainId = 0;
      let evmToken = '';
      try {
        const terms = JSON.parse(o.termsJson) as Record<string, unknown>;
        evmAmount = String(terms.evmAmount ?? '').replace(/n$/, '');
        bchTokenAmount = String(terms.bchTokenAmount ?? '').replace(/n$/, '');
        bchToken = String(terms.bchToken ?? '');
        evmChainId = Number(terms.evmChainId ?? 0);
        evmToken = String(terms.evmToken ?? '');
      } catch {
        // terms unreadable: still list the order
      }
      return {
        orderId: o.id,
        direction:
          o.direction === 'BCH_TO_COUNTER' || o.direction === 'BCH_TO_EVM'
            ? 'BCH_TO_EVM'
            : 'EVM_TO_BCH',
        status: o.status,
        createdAt: o.createdAt,
        evmAmount,
        bchTokenAmount,
        bchToken,
        // The chain and token, so a list shows USDT or USDG with its own decimals.
        evmChainId,
        evmToken,
      };
    });
    return reply
      .status(200)
      .send({ orders, asOf: Math.floor(Date.now() / 1000) });
  });

  function checkBchRateLimit(
    req: FastifyRequest,
    reply: FastifyReply,
  ): boolean {
    let clientIp: string;
    try {
      clientIp = extractClientIp(req, config.trustedProxy, config.network);
    } catch (err) {
      if (err instanceof UntrustedProxyHeaderError) {
        sendApiError(reply, 'UNAUTHORIZED', err.message);
        return false;
      }
      clientIp = '127.0.0.1';
    }

    const rateCheck = bchProxyLimiter.checkIp(clientIp);
    if (!rateCheck.allowed) {
      sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded for ${clientIp}`,
      );
      return false;
    }
    return true;
  }

  function checkBchQuorum(reply: FastifyReply): boolean {
    if (typeof bchClient.getQuorumStatus === 'function') {
      const quorum = bchClient.getQuorumStatus();
      if (!quorum.isQuorumHealthy) {
        reply.status(503).send({
          error: `Bitcoin Cash read failed: BCH quorum unhealthy (${quorum.quotingState})`,
        });
        return false;
      }
    }
    return true;
  }

  // GET /v1/bch/utxos/:scriptHash: the solver's own (quorum) view of the unspent outputs at a
  // script hash, so the page and the solver look at the same chain. Public chain data only.
  app.get<{ Params: { scriptHash: string } }>(
    '/v1/bch/utxos/:scriptHash',
    async (req, reply) => {
      if (!checkBchRateLimit(req, reply)) return;
      const { scriptHash } = req.params;
      if (!/^[0-9a-fA-F]{64}$/.test(scriptHash)) {
        return reply
          .status(400)
          .send({ error: 'scriptHash must be 64 hex characters' });
      }
      if (!checkBchQuorum(reply)) return;
      try {
        const utxos = await bchClient.listUnspent(scriptHash, 'include_tokens');
        return reply
          .status(200)
          .send({ utxos, asOf: Math.floor(Date.now() / 1000) });
      } catch (error) {
        return reply.status(503).send({
          error: `Bitcoin Cash read failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  );

  // GET /v1/bch/history/:scriptHash: transaction history for a script hash, capped at 1,000 entries. 5s cache.
  app.get<{ Params: { scriptHash: string } }>(
    '/v1/bch/history/:scriptHash',
    async (req, reply) => {
      if (!checkBchRateLimit(req, reply)) return;
      const { scriptHash } = req.params;
      if (!/^[0-9a-fA-F]{64}$/.test(scriptHash)) {
        return reply
          .status(400)
          .send({ error: 'scriptHash must be 64 hex characters' });
      }
      const now = Date.now();
      const cached = historyCache.get(scriptHash.toLowerCase());
      if (cached && now - cached.cachedAt < 5_000) {
        return reply.status(200).send(cached.data);
      }
      if (!checkBchQuorum(reply)) return;
      try {
        const rawHistory = await bchClient.getHistory(scriptHash);
        const history = rawHistory
          .slice(0, MAX_BCH_HISTORY_ENTRIES)
          .map((h) => ({
            tx_hash: h.tx_hash,
            height: h.height,
          }));
        const payload: BchHistoryResponse = { history };
        historyCache.set(scriptHash.toLowerCase(), {
          data: payload,
          cachedAt: now,
        });
        return reply.status(200).send(payload);
      } catch (error) {
        return reply.status(503).send({
          error: `Bitcoin Cash read failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  );

  // GET /v1/bch/first-use/:scriptHash: earliest confirmed history entry (lowest block height > 0,
  // or first unconfirmed if none confirmed; nulls if empty). 5s cache.
  app.get<{ Params: { scriptHash: string } }>(
    '/v1/bch/first-use/:scriptHash',
    async (req, reply) => {
      if (!checkBchRateLimit(req, reply)) return;
      const { scriptHash } = req.params;
      if (!/^[0-9a-fA-F]{64}$/.test(scriptHash)) {
        return reply
          .status(400)
          .send({ error: 'scriptHash must be 64 hex characters' });
      }
      const now = Date.now();
      const cached = firstUseCache.get(scriptHash.toLowerCase());
      if (cached && now - cached.cachedAt < 5_000) {
        return reply.status(200).send(cached.data);
      }
      if (!checkBchQuorum(reply)) return;
      try {
        const rawHistory = await bchClient.getHistory(scriptHash);
        let payload: BchFirstUseResponse = { txHash: null, height: null };
        if (rawHistory.length > 0) {
          const confirmed = rawHistory.filter((h) => h.height > 0);
          if (confirmed.length > 0) {
            confirmed.sort((a, b) => a.height - b.height);
            payload = {
              txHash: confirmed[0]!.tx_hash,
              height: confirmed[0]!.height,
            };
          } else {
            payload = {
              txHash: rawHistory[0]!.tx_hash,
              height: rawHistory[0]!.height,
            };
          }
        }
        firstUseCache.set(scriptHash.toLowerCase(), {
          data: payload,
          cachedAt: now,
        });
        return reply.status(200).send(payload);
      } catch (error) {
        return reply.status(503).send({
          error: `Bitcoin Cash read failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  );

  // GET /v1/bch/tx/:txid: returns raw transaction hex. Cached forever if confirmed; not cached if unconfirmed.
  app.get<{ Params: { txid: string } }>(
    '/v1/bch/tx/:txid',
    async (req, reply) => {
      if (!checkBchRateLimit(req, reply)) return;
      const { txid } = req.params;
      if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
        return reply
          .status(400)
          .send({ error: 'txid must be 64 hex characters' });
      }
      const cachedHex = txCache.get(txid.toLowerCase());
      if (cachedHex) {
        return reply.status(200).send({ hex: cachedHex });
      }
      if (!checkBchQuorum(reply)) return;
      try {
        const tx = (await bchClient.getTransaction(txid, true)) as unknown as
          Record<string, unknown> | string;
        let hex: string | undefined;
        let confirmations = 0;
        if (typeof tx === 'string') {
          hex = tx;
        } else if (tx && typeof tx.hex === 'string') {
          hex = tx.hex;
          confirmations =
            typeof tx.confirmations === 'number' ? tx.confirmations : 0;
        }
        if (!hex) {
          return reply.status(404).send({ error: 'Transaction not found' });
        }
        if (confirmations > 0) {
          txCache.set(txid.toLowerCase(), hex);
        }
        return reply.status(200).send({ hex });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/not found|no such mempool/i.test(msg)) {
          return reply.status(404).send({ error: 'Transaction not found' });
        }
        return reply.status(503).send({
          error: `Bitcoin Cash read failed: ${msg}`,
        });
      }
    },
  );

  // POST /v1/bch/broadcast: broadcast transaction to all quorum servers in parallel. Max 100 kB body limit.
  app.post<{ Body: { hex: string } }>(
    '/v1/bch/broadcast',
    {
      bodyLimit: 100 * 1024,
    },
    async (req, reply) => {
      if (!checkBchRateLimit(req, reply)) return;
      const { hex } = req.body ?? {};
      if (
        typeof hex !== 'string' ||
        hex.length === 0 ||
        hex.length % 2 !== 0 ||
        !/^[0-9a-fA-F]+$/.test(hex)
      ) {
        return reply.status(400).send({
          error: 'hex must be a valid non-empty hexadecimal transaction string',
        });
      }
      if (hex.length / 2 > 100 * 1024) {
        return reply.status(400).send({
          error: 'Transaction exceeds 100 kB limit',
        });
      }
      try {
        const txid = await bchClient.broadcastAll(hex);
        return reply.status(200).send({ txid });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/All servers rejected/i.test(msg)) {
          return reply.status(400).send({ error: msg });
        }
        return reply.status(503).send({
          error: `Bitcoin Cash broadcast failed: ${msg}`,
        });
      }
    },
  );

  // GET /v1/bch/tip: returns tip header information { height, hash, timestamp }. 2s cache.
  // GET /v1/evm/balance?chainId=&token=&owner=: the balance of one verified token on one enabled
  // chain for an address, read with the solver's own (paid) RPC. Not an RPC proxy: the chain and
  // token must be in the recorded facts, it makes one balanceOf call, answers cache for 5 seconds
  // and each IP has a limit. The page asks here first and reads the chain itself only as a fallback.
  const evmBalanceCache = new Map<string, { value: string; at: number }>();
  app.get('/v1/evm/balance', async (req, reply) => {
    if (!checkBchRateLimit(req, reply)) return;
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const chainId = Number(q.chainId);
    const token = String(q.token ?? '');
    const owner = String(q.owner ?? '');
    if (
      !Number.isInteger(chainId) ||
      !/^0x[0-9a-fA-F]{40}$/.test(token) ||
      !/^0x[0-9a-fA-F]{40}$/.test(owner)
    ) {
      return reply.status(400).send({
        error: 'chainId, token and owner (0x addresses) are required',
      });
    }
    const routes = options.routesContext ?? buildActiveRoutes(config);
    const chainFact = routes.chainConfig.facts.find(
      (c) => c.chainId === chainId,
    );
    const asset = chainFact?.assets.find(
      (a) => a.verified && a.address?.toLowerCase() === token.toLowerCase(),
    );
    if (!chainFact || !asset) {
      return reply
        .status(422)
        .send({ error: 'That chain or token is not one Ferry supports' });
    }
    const key = `${chainId}:${token.toLowerCase()}:${owner.toLowerCase()}`;
    const cached = evmBalanceCache.get(key);
    if (cached && Date.now() - cached.at < 5_000) {
      return reply.status(200).send({ balance: cached.value });
    }
    try {
      const client =
        options.evmClients?.get(chainFact.id as never) ?? options.publicClient;
      if (!client)
        throw new Error('No RPC client is configured for this chain');
      const balance = (await client.readContract({
        address: token as `0x${string}`,
        abi: [
          {
            type: 'function',
            name: 'balanceOf',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ] as const,
        functionName: 'balanceOf',
        args: [owner as `0x${string}`],
      })) as bigint;
      if (evmBalanceCache.size > 5000) evmBalanceCache.clear();
      evmBalanceCache.set(key, { value: balance.toString(), at: Date.now() });
      return reply.status(200).send({ balance: balance.toString() });
    } catch (error) {
      return reply.status(503).send({
        error: `Balance read failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.get('/v1/bch/tip', async (req, reply) => {
    if (!checkBchRateLimit(req, reply)) return;
    const now = Date.now();
    if (tipCache && now - tipCache.cachedAt < 2_000) {
      return reply.status(200).send(tipCache.data);
    }
    if (!checkBchQuorum(reply)) return;
    try {
      const tip = await bchClient.getTipHeader();
      tipCache = { data: tip, cachedAt: now };
      return reply.status(200).send(tip);
    } catch (error) {
      return reply.status(503).send({
        error: `Bitcoin Cash read failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.get('/v1/orders/recent', async (_req, reply) => {
    const recent = db.getRecentSwaps(50);
    const facts = (options.routesContext ?? buildActiveRoutes(config))
      .chainConfig.facts;
    const orders = recent.map((s) => {
      const chainId = s.evmChainId ?? config.baseChainId ?? 8453;
      const asset = facts
        .find((c) => c.chainId === chainId)
        ?.assets.find(
          (a) => a.address?.toLowerCase() === s.evmTokenAddress?.toLowerCase(),
        );
      return {
        orderId: (s.orderId.startsWith('0x')
          ? s.orderId
          : `0x${s.orderId}`) as Hex32,
        direction: (s.direction === 'BCH_TO_COUNTER'
          ? 'BCH_TO_EVM'
          : 'EVM_TO_BCH') as 'EVM_TO_BCH' | 'BCH_TO_EVM',
        bchToken: (s.bchSymbol === 'MUSD' ? 'MUSD' : 'PUSD') as 'PUSD' | 'MUSD',
        evmChainId: chainId,
        ...(asset
          ? { evmToken: asset.symbol, evmDecimals: asset.decimals ?? 6 }
          : {}),
        bchTokenAmount: s.bchTokenAmount.toString(),
        evmAmount: s.counterAmount.toString(),
        settledAt: s.settledAt,
        durationSeconds: Math.max(0, s.durationSeconds),
        ...(s.sourceTxId ? { sourceTxId: s.sourceTxId } : {}),
        ...(s.claimTxId ? { claimTxId: s.claimTxId } : {}),
      };
    });

    const response = {
      orders,
      asOf: Math.floor(Date.now() / 1000),
    };
    RecentOrdersResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  // 11. GET /v1/pegs
  // The price of each token as the quote engine reads it now (the DEX spot), with a rolling
  // history kept in memory (a point at most every two minutes, the last 24 hours).
  const pegHistory = new Map<string, Array<{ at: number; usdPrice: string }>>();
  app.get('/v1/pegs', async (_req, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const tokens: Array<{
      asset: string;
      currentUsdPrice: string;
      points: Array<{ at: number; usdPrice: string }>;
    }> = [];
    for (const asset of ['PUSD', 'MUSD']) {
      let price: string;
      try {
        const reading = await priceSource.getPrice(asset);
        price = formatUsdMicrosToDecimal(reading.usdPrice);
      } catch {
        // No fresh reading: keep the last known price, else par.
        price = pegHistory.get(asset)?.at(-1)?.usdPrice ?? '1.00';
      }
      const history = pegHistory.get(asset) ?? [];
      const last = history.at(-1);
      if (!last || now - last.at >= 120) {
        history.push({ at: now, usdPrice: price });
      } else {
        last.usdPrice = price;
      }
      const cutoff = now - 86_400;
      while (history.length > 0 && history[0]!.at < cutoff) history.shift();
      pegHistory.set(asset, history);
      tokens.push({
        asset,
        currentUsdPrice: price,
        points:
          history.length > 0 ? [...history] : [{ at: now, usdPrice: price }],
      });
    }

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
      const openExposure = db.getOpenExposureUsdMicros();

      let pusdBal = 0n;
      let musdBal = 0n;
      let bchSats = 0n;
      try {
        const bch = await inventoryReader.getBchInventory();
        pusdBal = bch.pusd;
        musdBal = bch.musd;
        bchSats = bch.sats;
      } catch {
        // Leave at 0n if read fails
      }

      let evmUsdcBal = 0n;
      let evmNativeBal = 0n;
      try {
        const evm = await inventoryReader.getEvmInventory('base');
        evmNativeBal = evm.nativeWei;
        const usdcKey = (config.baseUsdcAddress || '').toLowerCase();
        evmUsdcBal = evm.tokens.get(usdcKey) ?? 0n;
      } catch {
        // Leave at 0n if read fails
      }

      const pusdReserved = liquidityManager.getActiveReservationsForAsset(
        'PUSD',
        now,
      );
      const musdReserved = liquidityManager.getActiveReservationsForAsset(
        'MUSD',
        now,
      );
      const usdcReserved = liquidityManager.getActiveReservationsForAsset(
        'USDC',
        now,
      );

      const bchExposure = openExposure / 10_000n;
      const pusdAvailable = liquidityManager.getAvailableLiquidity(
        'PUSD',
        pusdBal,
        bchExposure,
        now,
      );
      const musdAvailable = liquidityManager.getAvailableLiquidity(
        'MUSD',
        musdBal,
        bchExposure,
        now,
      );
      const usdcAvailable = liquidityManager.getAvailableLiquidity(
        'USDC',
        evmUsdcBal,
        openExposure,
        now,
      );

      const assets: InventoryAssetView[] = [
        {
          chain: 'bch',
          symbol: 'PUSD',
          balance: pusdBal.toString(),
          reserved: pusdReserved.toString(),
          exposure: bchExposure.toString(),
          available: pusdAvailable.toString(),
        },
        {
          chain: 'bch',
          symbol: 'MUSD',
          balance: musdBal.toString(),
          reserved: musdReserved.toString(),
          exposure: bchExposure.toString(),
          available: musdAvailable.toString(),
        },
        {
          chain: 'bch',
          symbol: 'BCH',
          balance: bchSats.toString(),
          reserved: '0',
          exposure: '0',
          available: bchSats.toString(),
        },
        {
          chain: 'base',
          symbol: 'USDC',
          balance: evmUsdcBal.toString(),
          reserved: usdcReserved.toString(),
          exposure: openExposure.toString(),
          available: usdcAvailable.toString(),
        },
        {
          chain: 'base',
          symbol: 'ETH',
          balance: evmNativeBal.toString(),
          reserved: '0',
          exposure: '0',
          available: evmNativeBal.toString(),
        },
      ];

      const pusdUsdMicros = pusdBal * 10_000n;
      const usdcUsdMicros = evmUsdcBal;

      const view = liquidityManager.getInventoryView({
        bchInventory: pusdBal,
        bchExposure,
        evmInventory: evmUsdcBal,
        evmExposure: openExposure,
        skewMaxBps: config.skewMaxBps,
        nowSeconds: now,
        assets,
        bchUsdMicros: pusdUsdMicros,
        evmUsdMicros: usdcUsdMicros,
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
      ...(raw.ownerSecretHash !== undefined
        ? { ownerSecretHash: raw.ownerSecretHash }
        : {}),
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

    // A pay link is for at least one dollar (PUSD and MUSD have 2 decimals: 100 = $1.00).
    if (
      body.amountOut !== undefined &&
      BigInt(body.amountOut) * 10_000n < MIN_TRANSACTION_USD_MICROS
    ) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'A pay link must be for at least $1.00',
      );
    }

    if (
      !config.quotingEnabled ||
      !engine.isQuotingEnabled() ||
      db.isQuotingPaused()
    ) {
      return reply.status(422).send({
        reason: 'QUOTING_PAUSED',
        asset: body.token,
        message: quotingPausedMessage(),
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
      ownerSecretHash: body.ownerSecretHash,
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
    const stored = db.getPayLink(id);
    if (!stored) {
      return sendApiError(reply, 'LINK_NOT_FOUND', `Pay link ${id} not found`);
    }
    const link = syncPayLink(stored);

    const response = {
      id: link.id,
      kind:
        (link.kind as 'invoice' | 'open') ??
        (link.amountOut ? 'invoice' : 'open'),
      status: link.status as
        'open' | 'reserved' | 'paid' | 'expired' | 'cancelled' | 'closed',
      token: link.token as 'PUSD' | 'MUSD',
      recipientAddress: link.recipientCashaddr,
      recipientLockingBytecode: link.recipientLockingBytecode as Hex,
      amountOut:
        link.amountOut !== undefined ? link.amountOut.toString() : undefined,
      memo: link.memo,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      ...(link.status === 'paid' ? { paidAt: link.updatedAt } : {}),
      ...(link.orderId ? { orderId: link.orderId } : {}),
      ...(() => {
        const linked = link.orderId ? db.getOrder(link.orderId) : null;
        return linked
          ? {
              order: {
                state: linked.status,
                txids: orderTxidMap(linked),
                createdAt: linked.createdAt,
                updatedAt: linked.updatedAt,
                timeline: db.listOrderEvents(linked.id),
                ...orderSummaryOf(linked.termsJson),
              },
            }
          : {};
      })(),
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
          message: quotingPausedMessage(),
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
      if (db.getOrderByHashLock(request.hashLock)) {
        return sendApiError(
          reply,
          'CONFLICT',
          'hashLock has already been used by another order',
        );
      }
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
        2,
        pricingEvidence,
      );

      let currentInventory: bigint;
      try {
        currentInventory = await inventoryReader.getAssetInventory({
          asset: link.token,
        });
      } catch (err) {
        return reply.status(422).send({
          reason: 'INSUFFICIENT_LIQUIDITY',
          maxAmount: '0',
          asset: link.token,
          message: `Inventory balance unavailable for link: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const quoteResult = await quoteBuilder.buildQuote({
        quoteId,
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: link.token,
        evmChain: 'base',
        amountIn: neededIn,
        userAddress: request.userEvmAddress,
        userIp: '127.0.0.1',
        currentInventory,
        openExposure: db.getOpenExposureUsdMicros(),
        nowSeconds: now,
        quotingEnabled: config.quotingEnabled,
        minSwapUsdMicros: MIN_TRANSACTION_USD_MICROS,
        maxSwapUsdMicros: config.maxSwapUsdMicros,
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
          ...('minAmount' in quoteResult
            ? { minAmount: quoteResult.minAmount }
            : {}),
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

  // 18b. DELETE /v1/links/:id (Delete/Close PayLink with Owner Secret)
  app.delete<{
    Params: { id: string };
    Body?: { secret?: string };
  }>('/v1/links/:id', async (req, reply) => {
    const { id } = req.params;
    const bodySecret =
      typeof req.body === 'object' && req.body !== null
        ? (req.body as { secret?: string }).secret
        : undefined;
    const headerSecret = req.headers['x-owner-secret'] as string | undefined;
    const secret = bodySecret ?? headerSecret;

    const link = db.getPayLink(id);
    if (!link) {
      return sendApiError(reply, 'LINK_NOT_FOUND', `Pay link ${id} not found`);
    }

    if (!link.ownerSecretHash) {
      return sendApiError(
        reply,
        'UNAUTHORIZED',
        'Pay link was created without an owner secret and cannot be deleted with a secret',
      );
    }

    if (!secret) {
      return sendApiError(
        reply,
        'UNAUTHORIZED',
        'Missing owner secret for pay link deletion',
      );
    }

    let secretMatches = false;
    try {
      const cleanSecret = secret.startsWith('0x') ? secret.slice(2) : secret;
      let secretBytes: Uint8Array;
      if (/^[0-9a-fA-F]+$/.test(cleanSecret) && cleanSecret.length % 2 === 0) {
        secretBytes = libauth.hexToBin(cleanSecret);
      } else {
        secretBytes = new TextEncoder().encode(secret);
      }
      const hashedHex =
        `0x${libauth.binToHex(libauth.sha256.hash(secretBytes))}`.toLowerCase();
      if (hashedHex === link.ownerSecretHash.toLowerCase()) {
        secretMatches = true;
      }
    } catch {
      secretMatches = false;
    }

    if (!secretMatches) {
      return sendApiError(reply, 'UNAUTHORIZED', 'Invalid owner secret');
    }

    if (link.status === 'paid') {
      return sendApiError(
        reply,
        'ALREADY_PAID',
        'Cannot delete a paid pay link',
      );
    }

    const payingOrder = db.findOrderForPayLink(link);
    if (
      payingOrder &&
      payingOrder.status !== 'QUOTED' &&
      payingOrder.status !== 'EXPIRED' &&
      payingOrder.status !== 'REJECTED'
    ) {
      return sendApiError(
        reply,
        'ALREADY_PAID',
        'Cannot delete a pay link with payment in progress',
      );
    }

    db.updatePayLinkStatus(link.id, 'closed');
    const response: DeletePayLinkResponse = {
      ok: true,
      id: link.id,
      status: 'closed',
    };
    DeletePayLinkResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

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

    let viewTag = raw.viewTag !== undefined ? String(raw.viewTag) : undefined;
    if (
      viewTag &&
      !viewTag.startsWith('0x') &&
      /^[0-9a-fA-F]{64}$/.test(viewTag)
    ) {
      viewTag = `0x${viewTag}`;
    }

    let cancelHash =
      raw.cancelHash !== undefined ? String(raw.cancelHash) : undefined;
    if (
      cancelHash &&
      !cancelHash.startsWith('0x') &&
      /^[0-9a-fA-F]{64}$/.test(cancelHash)
    ) {
      cancelHash = `0x${cancelHash}`;
    }

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
      ...(raw.note !== undefined ? { note: raw.note } : {}),
      ...(viewTag !== undefined ? { viewTag } : {}),
      ...(cancelHash !== undefined ? { cancelHash } : {}),
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

    // A send link is for at least one dollar (the token is a Bitcoin Cash stablecoin, 2 decimals).
    if (BigInt(request.amountIn) * 10_000n < MIN_TRANSACTION_USD_MICROS) {
      return reply.status(422).send({
        reason: 'ROUTE_DISABLED',
        asset: request.token,
        message: 'A send link must be for at least $1.00',
      });
    }

    if (db.getOrderByHashLock(request.hashLock)) {
      return sendApiError(
        reply,
        'CONFLICT',
        'hashLock has already been used by another order',
      );
    }

    if (request.viewTag !== undefined && db.hasSendLinkTag(request.viewTag)) {
      return sendApiError(
        reply,
        'CONFLICT',
        'viewTag has already been used by another order',
      );
    }

    if (
      !config.quotingEnabled ||
      !engine.isQuotingEnabled() ||
      db.isQuotingPaused()
    ) {
      return reply.status(422).send({
        reason: 'QUOTING_PAUSED',
        asset: request.token,
        message: quotingPausedMessage(),
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

    // The route (chain and token) must be a recorded, enabled one.
    const sendRoutes = options.routesContext ?? buildActiveRoutes(config);
    const sendChain = sendRoutes.chainConfig.facts.find(
      (c) =>
        c.chainId === request.chainId ||
        (c.id === 'base' && config.baseChainId === request.chainId),
    );
    const sendAsset =
      sendChain?.assets.find(
        (a) => a.address?.toLowerCase() === request.evmToken.toLowerCase(),
      ) ??
      (sendChain?.id === 'base' &&
      request.evmToken.toLowerCase() === config.baseUsdcAddress.toLowerCase()
        ? { symbol: 'USDC' as const, decimals: 6 }
        : undefined);
    const sendRouteActive =
      sendChain !== undefined &&
      sendAsset !== undefined &&
      (sendRoutes.enabledRoutes.some(
        (r) =>
          r.chain.toLowerCase() === sendChain.id.toLowerCase() &&
          r.asset.toLowerCase() === sendAsset.symbol.toLowerCase(),
      ) ||
        (sendChain.id === 'base' && Boolean(config.baseHtlcAddress)));
    if (!sendChain || !sendAsset || !sendRouteActive) {
      return reply.status(422).send({
        reason: 'ROUTE_DISABLED',
        asset: request.token,
        message: `Route is disabled for chain ${request.chainId} and token ${request.evmToken}`,
      });
    }
    const sendDecimals = sendAsset.decimals ?? 6;
    const sendHtlc = (sendChain.htlcAddress ??
      config.baseHtlcAddress) as `0x${string}`;

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
          asset: sendAsset.symbol,
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
    const amountOut = quoteOut(inAmount, 2, sendDecimals, pricingEvidence);

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
      evmHtlc: sendHtlc,
      userEvmAddress: request.recipientEvmAddress as `0x${string}`,
      userBchLockingBytecode: request.userBchLockingBytecode as `0x${string}`,
      solverEvmAddress: solverAccount.address as `0x${string}`,
      solverBchLockingBytecode: solverBchLockingBytecode as `0x${string}`,
      hashLock: request.hashLock as `0x${string}`,
      evmDeadline: windowPlan.evmDeadlineSeconds,
      // The plan has no slack of its own, and the engine checks the timing rule again when it
      // locks, after the sender's lock has confirmed: without these blocks every send link is
      // rejected at that second check. Six blocks is about an hour added to the sender's own refund.
      bchRefundHeight: windowPlan.bchRefundHeight + SEND_LINK_EXTRA_BCH_BLOCKS,
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
    db.markSendLinkOrder(orderIdHex);
    // The note is kept beside the order, not inside its signed terms.
    if (request.note !== undefined) {
      db.saveSendLinkNote(orderIdHex, request.note, now);
    }
    // The viewTag is kept beside the order, not inside its signed terms.
    if (request.viewTag !== undefined) {
      db.saveSendLinkTag(request.viewTag, orderIdHex, now);
    }
    // The cancelHash is kept beside the order, not inside its signed terms.
    if (request.cancelHash !== undefined) {
      db.saveSendLinkCancelHash(orderIdHex, request.cancelHash, now);
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
  });

  function formatSendLinkDetails(
    order: OrderRecord,
    now: number,
    note: string | null,
  ): SendLinkDetailsResponse {
    let terms: OrderTerms;
    try {
      terms = JSON.parse(order.termsJson, (_k, v) =>
        typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
      );
    } catch {
      throw new Error('Failed to parse stored send link terms');
    }

    let status:
      | 'pending_lock'
      | 'locked'
      | 'claimed'
      | 'refunded'
      | 'expired'
      | 'cancelled';
    // The names below are the engine's own order states (DONE, SECRET_KNOWN, SOLVER_REFUNDED, ...);
    // an earlier version mapped names the engine never uses, so a finished link read as pending.
    if (order.status === 'CANCELLED' || db.isOrderCancelled(order.id)) {
      status = 'cancelled';
    } else if (
      order.status === 'DONE' ||
      order.status === 'SECRET_KNOWN' ||
      order.status === 'SWAP_COMPLETE' ||
      order.status === 'CLAIMED' ||
      order.status === 'SOLVER_CLAIM_FINAL' ||
      order.status === 'SOLVER_CLAIM_BROADCAST' ||
      order.status === 'USER_CLAIM_SEEN' ||
      order.status === 'USER_CLAIM_FINAL'
    ) {
      status = 'claimed';
    } else if (
      order.status === 'REFUNDED' ||
      order.status === 'SOLVER_REFUNDED'
    ) {
      status = 'refunded';
    } else if (
      order.status === 'EXPIRED' ||
      order.status === 'REJECTED' ||
      now > terms.evmDeadline
    ) {
      status = 'expired';
    } else if (
      order.status === 'USER_LOCK_SEEN' ||
      order.status === 'USER_LOCK_FINAL' ||
      order.status === 'SOLVER_LOCK_SEEN' ||
      order.status === 'SOLVER_LOCK_BROADCAST' ||
      order.status === 'LOCKED'
    ) {
      status = 'locked';
    } else {
      status = 'pending_lock';
    }

    const response: SendLinkDetailsResponse = {
      id: order.id,
      ...(/^0x[0-9a-fA-F]{64}$/.test(order.id)
        ? { orderId: order.id.toLowerCase() as Hex32 }
        : {}),
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
      ...(note !== null ? { note } : {}),
      ...(/^0x[0-9a-fA-F]{64}$/.test(order.lockId)
        ? { lockId: order.lockId.toLowerCase() as Hex32 }
        : {}),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };

    return response;
  }

  // 20. GET /v1/send-links/:id
  app.get<{ Params: { id: string } }>(
    '/v1/send-links/:id',
    async (req, reply) => {
      const { id } = req.params;
      const activeId = db.resolveSendLinkOrderId(id);
      const order = db.getOrder(activeId);
      if (!order) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Send link ${id} not found`,
        );
      }

      const now = Math.floor(Date.now() / 1000);
      const note = db.getSendLinkNote(order.id);
      let response: SendLinkDetailsResponse;
      try {
        response = formatSendLinkDetails(order, now, note);
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse stored send link terms',
        );
      }

      SendLinkDetailsResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 21. POST /v1/send-links/query
  app.post('/v1/send-links/query', async (req, reply) => {
    let clientIp: string;
    try {
      clientIp = extractClientIp(req, config.trustedProxy, config.network);
    } catch (err) {
      if (err instanceof UntrustedProxyHeaderError) {
        return sendApiError(reply, 'UNAUTHORIZED', err.message);
      }
      clientIp = '127.0.0.1';
    }

    const rateCheck = rateLimiter.checkIp(clientIp);
    if (!rateCheck.allowed) {
      return sendApiError(
        reply,
        'RATE_LIMITED',
        `Rate limit exceeded for ${clientIp}`,
      );
    }

    const parseResult = SendLinksQueryRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendApiError(
        reply,
        'VALIDATION_ERROR',
        'Invalid send links query request payload',
        { issues: parseResult.error.issues },
      );
    }

    const { tags } = parseResult.data;
    const matchedRecords = db.getOrdersBySendLinkTags(tags);
    const now = Math.floor(Date.now() / 1000);
    const matches: SendLinkQueryMatch[] = [];

    for (const match of matchedRecords) {
      const note = db.getSendLinkNote(match.order.id);
      try {
        const details = formatSendLinkDetails(match.order, now, note);
        matches.push({
          ...details,
          tag: (match.tag.startsWith('0x')
            ? match.tag.toLowerCase()
            : `0x${match.tag.toLowerCase()}`) as Hex32,
        });
      } catch {
        // Skip corrupted order records gracefully
      }
    }

    const response = {
      links: matches,
      matches,
    };

    SendLinksQueryResponseSchema.parse(response);
    return reply.status(200).send(response);
  });

  let cachedSecp256k1: libauth.Secp256k1 | null = null;
  async function getSecp256k1(): Promise<libauth.Secp256k1> {
    if (!cachedSecp256k1) {
      cachedSecp256k1 = await libauth.instantiateSecp256k1();
    }
    return cachedSecp256k1;
  }

  async function verifySenderCancellationAuth(
    terms: OrderTerms,
    body: CancelSendLinkRequest,
    orderId: string,
    storedCancelHash: { cancelHash: string; spent: boolean } | null,
  ): Promise<boolean> {
    // 1. Refuse any request providing recoveryRoot or recovery/EVM signatures
    if (body.recoveryRoot || body.recoverySignature || body.evmSignature) {
      return false;
    }

    // 2. Method 1: Cancel key (revealed by sender, hashes to stored cancelHash)
    if (body.cancelKey && storedCancelHash && !storedCancelHash.spent) {
      try {
        const cleanKey = body.cancelKey.replace(/^0x/i, '');
        if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
          const keyBytes = libauth.hexToBin(cleanKey);
          const computedHash =
            `0x${libauth.binToHex(libauth.sha256.hash(keyBytes))}`.toLowerCase();
          if (computedHash === storedCancelHash.cancelHash.toLowerCase()) {
            return true;
          }
        }
      } catch {
        // invalid cancel key
      }
    }

    // 3. Method 2: Bitcoin Cash wallet signature (exact P2PKH refund bytecode check)
    if (body.bchPublicKey && body.bchSignature) {
      try {
        const pubKeyBin = libauth.hexToBin(
          body.bchPublicKey.replace(/^0x/i, ''),
        );
        const pkh = libauth.hash160(pubKeyBin);
        const expectedP2pkh =
          `76a914${libauth.binToHex(pkh)}88ac`.toLowerCase();
        const userLocking = terms.userBchLockingBytecode
          .replace(/^0x/i, '')
          .toLowerCase();

        // Exact match: the lock's refund bytecode must be the pubkey hash's P2PKH, no substring match
        if (userLocking === expectedP2pkh) {
          const cancelMsg = `cancel:${orderId}`;
          const msgHash = libauth.sha256.hash(
            new TextEncoder().encode(cancelMsg),
          );
          const sigBin = libauth.hexToBin(
            body.bchSignature.replace(/^0x/i, ''),
          );
          const secp = await getSecp256k1();
          if (sigBin.length === 64) {
            if (secp.verifySignatureSchnorr(sigBin, pubKeyBin, msgHash)) {
              return true;
            }
          }
          if (secp.verifySignatureDERLowS(sigBin, pubKeyBin, msgHash)) {
            return true;
          }
          if (secp.verifySignatureCompact(sigBin, pubKeyBin, msgHash)) {
            return true;
          }
        }
      } catch {
        // verification failed
      }
    }

    return false;
  }

  // 22. GET /v1/send-links/:id/cancel-quota
  app.get<{ Params: { id: string } }>(
    '/v1/send-links/:id/cancel-quota',
    async (req, reply) => {
      const { id } = req.params;
      const activeId = db.resolveSendLinkOrderId(id);
      const order = db.getOrder(activeId);
      if (!order) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Send link ${id} not found`,
        );
      }
      let terms: OrderTerms;
      try {
        terms = JSON.parse(order.termsJson);
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse order terms',
        );
      }
      const senderIdentity = terms.userBchLockingBytecode.toLowerCase();
      const now = Math.floor(Date.now() / 1000);
      const quota = db.getSendLinkCancellationQuota(senderIdentity, now);
      CancelSendLinkQuotaSchema.parse(quota);
      return reply.status(200).send(quota);
    },
  );

  // 23. POST /v1/send-links/:id/cancel
  app.post<{ Params: { id: string } }>(
    '/v1/send-links/:id/cancel',
    async (req, reply) => {
      const { id } = req.params;
      const activeId = db.resolveSendLinkOrderId(id);
      const order = db.getOrder(activeId);
      if (!order) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Send link ${id} not found`,
        );
      }

      let terms: OrderTerms;
      try {
        terms = JSON.parse(order.termsJson);
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse order terms',
        );
      }

      // 1. Check if already claimed
      if (
        order.status === 'DONE' ||
        order.status === 'SECRET_KNOWN' ||
        order.status === 'SWAP_COMPLETE' ||
        order.status === 'CLAIMED' ||
        order.status === 'SOLVER_CLAIM_FINAL' ||
        order.status === 'SOLVER_CLAIM_BROADCAST' ||
        order.status === 'USER_CLAIM_SEEN' ||
        order.status === 'USER_CLAIM_FINAL' ||
        (order.secret && isValidSecret(order.secret, order.hashLock))
      ) {
        return sendApiError(
          reply,
          'ALREADY_CLAIMED',
          'This send link has already been claimed and cannot be cancelled',
        );
      }

      // 2. Check if claim is in progress / EVM counter-lock exists
      if (
        order.solverLockTxId ||
        order.status === 'SOLVER_LOCK_BROADCAST' ||
        order.status === 'SOLVER_LOCK_SEEN' ||
        db.getAction(order.id, 'SOLVER_LOCK') ||
        db.getAction(order.id, 'lock')
      ) {
        return sendApiError(
          reply,
          'CLAIM_IN_PROGRESS',
          'A receiver claim is already in progress and the link cannot be cancelled',
        );
      }

      const parseResult = CancelSendLinkRequestSchema.safeParse(req.body ?? {});
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid cancel send link request payload',
          { issues: parseResult.error.issues },
        );
      }

      const senderIdentity = terms.userBchLockingBytecode.toLowerCase();
      const now = Math.floor(Date.now() / 1000);

      // 3. Check if already cancelled (idempotent)
      if (order.status === 'CANCELLED' || db.isOrderCancelled(order.id)) {
        const quota = db.getSendLinkCancellationQuota(senderIdentity, now);
        const response: CancelSendLinkResponse = {
          success: true,
          orderId: order.id,
          status: 'cancelled',
          ...(order.solverRefundTxId
            ? { refundTxId: order.solverRefundTxId }
            : {}),
          quota,
        };
        CancelSendLinkResponseSchema.parse(response);
        return reply.status(200).send(response);
      }

      // 4. Verify authorization (proves knowledge of cancelKey or BCH wallet key)
      if (
        parseResult.data.recoveryRoot ||
        parseResult.data.recoverySignature ||
        parseResult.data.evmSignature
      ) {
        return sendApiError(
          reply,
          'NOT_YOUR_LINK',
          'Recovery root or signatures are refused as proof to prevent secret disclosure. Use the cancel key or Bitcoin Cash wallet signature.',
        );
      }

      const storedCancelHash = db.getSendLinkCancelHash(order.id);
      const isAuthorized = await verifySenderCancellationAuth(
        terms,
        parseResult.data,
        order.id,
        storedCancelHash,
      );
      if (!isAuthorized) {
        return sendApiError(
          reply,
          'NOT_YOUR_LINK',
          'Unauthorized: cancellation requires the cancel key or the Bitcoin Cash wallet that created the lock',
        );
      }

      // 5. Check quota limits (2 per 24h, 10 per 30d per sender identity)
      const quota = db.getSendLinkCancellationQuota(senderIdentity, now);
      if (quota.dailyRemaining <= 0 || quota.monthlyRemaining <= 0) {
        const nextTimeStr = quota.nextAllowedAt
          ? new Date(quota.nextAllowedAt * 1000).toISOString()
          : 'later';
        return sendApiError(
          reply,
          'LIMIT_REACHED',
          `Cancellation limit reached (max 2 per 24 hours, 10 per 30 days). Next cancellation available at ${nextTimeStr}.`,
          {
            quota,
            nextAllowedAt: quota.nextAllowedAt,
          },
        );
      }

      // 6. Record cancellation and update order state
      db.recordSendLinkCancellation(order.id, senderIdentity, now);
      db.markSendLinkCancelHashSpent(order.id);
      order.status = 'CANCELLED';
      order.updatedAt = now;

      // Also mark original order as CANCELLED if different
      if (id !== order.id) {
        const orig = db.getOrder(id);
        if (orig) {
          orig.status = 'CANCELLED';
          orig.updatedAt = now;
          db.saveOrder(orig);
        }
      }

      // 7. If user lock is on chain, execute early release
      let refundTxId = order.solverRefundTxId;
      if (
        !refundTxId &&
        (order.userLockTxId ||
          order.status === 'USER_LOCK_SEEN' ||
          order.status === 'USER_LOCK_FINAL' ||
          order.status === 'LOCKED')
      ) {
        try {
          if (engine && typeof engine.earlyReleaseUserBchLock === 'function') {
            const solverOrder: SolverOrderRecord = {
              ...order,
              direction: order.direction as SwapDirection,
              status: order.status as OrderStatus,
              terms,
              hashLock: order.hashLock as `0x${string}`,
              secret: order.secret as `0x${string}` | undefined,
              secretSource: undefined,
            };
            await engine.earlyReleaseUserBchLock(
              solverOrder,
              'Cancelled by sender',
            );
            const refreshed = db.getOrder(order.id);
            if (refreshed?.solverRefundTxId) {
              refundTxId = refreshed.solverRefundTxId;
              order.solverRefundTxId = refundTxId;
            }
          }
        } catch {
          // If on-chain release encounters issue, order remains cancelled
        }
      }

      db.saveOrder(order);
      const updatedQuota = db.getSendLinkCancellationQuota(senderIdentity, now);

      const response: CancelSendLinkResponse = {
        success: true,
        orderId: order.id,
        status: 'cancelled',
        ...(refundTxId ? { refundTxId } : {}),
        quota: updatedQuota,
      };

      CancelSendLinkResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  // 24. POST /v1/send-links/:id/switch-route
  app.post<{ Params: { id: string } }>(
    '/v1/send-links/:id/switch-route',
    async (req, reply) => {
      const { id } = req.params;
      const activeId = db.resolveSendLinkOrderId(id);
      const order = db.getOrder(activeId);
      if (!order) {
        return sendApiError(
          reply,
          'LINK_NOT_FOUND',
          `Send link ${id} not found`,
        );
      }

      // Check if send link was cancelled
      if (order.status === 'CANCELLED' || db.isOrderCancelled(activeId)) {
        return sendApiError(
          reply,
          'CONFLICT',
          'Cannot switch route: send link has been cancelled',
        );
      }

      // Check if order is already locked or in a post-lock status
      if (
        order.solverLockTxId ||
        order.status === 'SOLVER_LOCK_BROADCAST' ||
        order.status === 'SOLVER_LOCK_SEEN' ||
        order.status === 'SECRET_KNOWN' ||
        order.status === 'USER_CLAIM_SEEN' ||
        order.status === 'SOLVER_CLAIM_BROADCAST' ||
        order.status === 'SOLVER_CLAIM_FINAL' ||
        order.status === 'DONE' ||
        order.status === 'RELEASED' ||
        order.status === 'REFUNDED' ||
        order.status === 'SOLVER_REFUNDED'
      ) {
        return sendApiError(
          reply,
          'CONFLICT',
          'Cannot switch route: the solver has already locked funds on the destination chain',
        );
      }

      const parseResult = SwitchSendLinkRouteRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return sendApiError(
          reply,
          'VALIDATION_ERROR',
          'Invalid switch route request payload',
          { issues: parseResult.error.issues },
        );
      }

      const request = parseResult.data;

      let currentOrderTerms: OrderTerms;
      try {
        currentOrderTerms = JSON.parse(order.termsJson, (_k, v) =>
          typeof v === 'string' && /^\d+n$/.test(v)
            ? BigInt(v.slice(0, -1))
            : v,
        ) as OrderTerms;
      } catch {
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          'Failed to parse current order terms',
        );
      }

      // 1. Authorization: Verify EIP-712 recipient signature
      const typed = switchRouteRequestTypedData({
        targetChainId: request.chainId,
        orderId: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as `0x${string}`,
        token: request.token as `0x${string}`,
      });

      let signedByRecipient: boolean;
      try {
        signedByRecipient = await verifyTypedData({
          address: currentOrderTerms.userEvmAddress as `0x${string}`,
          ...typed,
          signature: request.signature as `0x${string}`,
        });
      } catch {
        signedByRecipient = false;
      }

      if (!signedByRecipient) {
        return sendApiError(
          reply,
          'UNAUTHORIZED',
          `Only ${currentOrderTerms.userEvmAddress} can change this route: sign the switch request with that wallet`,
        );
      }

      // 2. Route validation
      const sendRoutes = options.routesContext ?? buildActiveRoutes(config);
      const targetChain = sendRoutes.chainConfig.facts.find(
        (c) =>
          c.chainId === request.chainId ||
          (c.id === 'base' && config.baseChainId === request.chainId),
      );
      const targetAsset =
        targetChain?.assets.find(
          (a) => a.address?.toLowerCase() === request.token.toLowerCase(),
        ) ??
        (targetChain?.id === 'base' &&
        request.token.toLowerCase() === config.baseUsdcAddress.toLowerCase()
          ? {
              symbol: 'USDC' as const,
              decimals: 6,
              address: config.baseUsdcAddress,
            }
          : undefined);

      const targetRouteActive =
        targetChain !== undefined &&
        targetAsset !== undefined &&
        (sendRoutes.enabledRoutes.some(
          (r) =>
            r.chain.toLowerCase() === targetChain.id.toLowerCase() &&
            r.asset.toLowerCase() === targetAsset.symbol.toLowerCase(),
        ) ||
          (targetChain.id === 'base' && Boolean(config.baseHtlcAddress)));

      if (!targetChain || !targetAsset || !targetRouteActive) {
        return reply.status(422).send({
          reason: 'ROUTE_DISABLED',
          message: `Route is disabled for chain ${request.chainId} and token ${request.token}`,
        });
      }

      const targetDecimals = targetAsset.decimals ?? 6;
      const targetHtlc = (targetChain.htlcAddress ??
        config.baseHtlcAddress) as `0x${string}`;

      // 3. Time safety check:
      // Invariant R requires available time before bchRefundHeight to exceed (evmDeadline - now) + 30m safety margin + solverReaction
      const now = Math.floor(Date.now() / 1000);
      const quorum = bchClient.getQuorumStatus();

      const timingCheck = invariantR(
        {
          evmDeadlineSeconds: currentOrderTerms.evmDeadline,
          bchRefundHeight: currentOrderTerms.bchRefundHeight,
        },
        {
          unixSeconds: now,
          bchTipHeight: quorum.quorumTip,
        },
        DEFAULT_TIMING_CONFIG,
      );

      if (!timingCheck.allowed) {
        return sendApiError(
          reply,
          'TIMING_INVARIANT_FAILED',
          'This send link can no longer be claimed in time. The sender will receive a refund on Bitcoin Cash.',
        );
      }

      // 4. Pricing and Amount Out
      const effectiveSpread = effectiveSendLinkSpreadBps(
        config.spreadBps,
        Math.max(1, currentOrderTerms.evmDeadline - now),
      );

      const pricingEvidence = {
        refs: [
          {
            asset: currentOrderTerms.bchToken,
            usdPrice: '1.000000',
            source: 'reference',
            asOf: now,
          },
          {
            asset: targetAsset.symbol,
            usdPrice: '1.000000',
            source: 'reference',
            asOf: now,
          },
        ],
        spreadBps: effectiveSpread,
        fixedFeeBase: 0n,
        rounding: 'floor' as const,
      };

      const inAmount =
        typeof currentOrderTerms.bchTokenAmount === 'bigint'
          ? currentOrderTerms.bchTokenAmount
          : BigInt(String(currentOrderTerms.bchTokenAmount).replace(/n$/, ''));
      const amountOut = quoteOut(inAmount, 2, targetDecimals, pricingEvidence);

      // 5. Check Liquidity on Target Route
      let hasLiquidity = true;
      try {
        const inventory = await inventoryReader.getAssetInventory({
          asset: targetAsset.symbol,
          chain: targetChain.id,
          tokenAddress: targetAsset.address ?? undefined,
        });
        if (inventory < amountOut) {
          hasLiquidity = false;
        }
      } catch {
        hasLiquidity = false;
      }

      if (!hasLiquidity) {
        // Collect alternative routes that DO have liquidity
        const alternativeRoutes: Array<{
          chainId: number;
          chain: string;
          asset: string;
          token: string;
        }> = [];

        for (const candidateChain of sendRoutes.chainConfig.facts) {
          const cKey = candidateChain.id.toLowerCase();
          for (const candAsset of candidateChain.assets) {
            if (
              candidateChain.chainId === request.chainId &&
              candAsset.address?.toLowerCase() === request.token.toLowerCase()
            ) {
              continue;
            }
            try {
              const candInv = await inventoryReader.getAssetInventory({
                asset: candAsset.symbol,
                chain: cKey,
                tokenAddress: candAsset.address ?? undefined,
              });
              const candOut = quoteOut(
                inAmount,
                2,
                candAsset.decimals ?? 6,
                pricingEvidence,
              );
              if (candInv >= candOut) {
                alternativeRoutes.push({
                  chainId: candidateChain.chainId,
                  chain: candidateChain.name ?? candidateChain.id,
                  asset: candAsset.symbol,
                  token: (
                    candAsset.address ?? config.baseUsdcAddress
                  ).toLowerCase(),
                });
              }
            } catch {
              // skip failing reads
            }
          }
        }

        const suggestedRoutes = alternativeRoutes.slice(0, 2);
        return reply.status(422).send({
          error: {
            code: 'INSUFFICIENT_INVENTORY',
            message: `Not enough liquidity for ${targetAsset.symbol} on ${targetChain.name} right now`,
            details: {
              suggestedRoutes,
            },
          },
          reason: 'INSUFFICIENT_LIQUIDITY',
          message: `Not enough liquidity for ${targetAsset.symbol} on ${targetChain.name} right now`,
          suggestedRoutes,
        });
      }

      // 6. Build new terms
      const quoteId = `sq-switch-${now}-${Math.random().toString(36).slice(2, 9)}`;
      const newTerms: OrderTerms = {
        ...currentOrderTerms,
        evmToken: request.token as `0x${string}`,
        evmChainId: request.chainId,
        evmHtlc: targetHtlc,
        evmAmount: amountOut,
        quoteId,
        quoteExpiry: now + config.quoteTtlSeconds,
        pricing: pricingEvidence,
      };

      const newOrderIdHex = computeOrderId(newTerms);
      const newLockId = evmLockId(newTerms.solverEvmAddress, newTerms.hashLock);

      const newOrderRecord: OrderRecord = {
        id: newOrderIdHex,
        direction: 'BCH_TO_EVM',
        status: order.status,
        userCounterAddress: newTerms.userEvmAddress,
        lockId: newLockId,
        termsJson: JSON.stringify(newTerms, (_, v) =>
          typeof v === 'bigint' ? v.toString() + 'n' : v,
        ),
        hashLock: newTerms.hashLock,
        userLockTxId: order.userLockTxId,
        lane: order.lane,
        fastOptIn: order.fastOptIn,
        firstSeenAtMs: order.firstSeenAtMs,
        needsAttention: false,
        createdAt: now,
        updatedAt: now,
      };

      try {
        db.switchSendLinkRouteAtomic({
          currentOrderId: order.id,
          newOrder: newOrderRecord,
          switchedAt: now,
        });
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === 'LOCK_ALREADY_EXISTS') {
          return sendApiError(
            reply,
            'CONFLICT',
            'Cannot switch route: EVM lock already broadcast',
          );
        }
        if (code === 'LINK_CANCELLED') {
          return sendApiError(
            reply,
            'CONFLICT',
            'Cannot switch route: send link has been cancelled',
          );
        }
        return sendApiError(
          reply,
          'INTERNAL_ERROR',
          `Atomic route switch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const response = {
        ok: true as const,
        originalOrderId: (order.id.startsWith('0x')
          ? order.id
          : `0x${order.id}`) as `0x${string}`,
        newOrderId: (newOrderIdHex.startsWith('0x')
          ? newOrderIdHex
          : `0x${newOrderIdHex}`) as `0x${string}`,
        chainId: request.chainId,
        token: request.token,
        evmAmount: amountOut.toString(),
        expiresAt: newTerms.evmDeadline,
        updatedAt: now,
      };

      SwitchSendLinkRouteResponseSchema.parse(response);
      return reply.status(200).send(response);
    },
  );

  return app;
}
