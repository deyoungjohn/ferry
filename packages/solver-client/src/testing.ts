import type { Hex, Hex32 } from '@ferry/core';
import {
  ApiErrorResponseSchema,
  CancelPayLinkResponseSchema,
  ChainsResponseSchema,
  CreatePayLinkResponseSchema,
  HealthResponseSchema,
  LiquidityResponseSchema,
  MetricsResponseSchema,
  OperatorNeedsAttentionResponseSchema,
  OrderStatusResponseSchema,
  OwnerPayLinksResponseSchema,
  PayLinkDetailsResponseSchema,
  PegsResponseSchema,
  QuoteRefusalSchema,
  QuoteResponseSchema,
  RecentOrdersResponseSchema,
  RelayClaimResponseSchema,
  RelayLockResponseSchema,
  RevealSecretResponseSchema,
  SendLinkDetailsResponseSchema,
  StatsResponseSchema,
} from '@ferry/core/api';
import type { z } from 'zod';
import type { FetchLike } from './client.js';
import { sha256 } from 'viem';

export interface ContractSuiteFixtures {
  readonly chainId?: number;
  readonly evmToken?: Hex;
  readonly userEvmAddress?: Hex;
  readonly recipientEvmAddress?: Hex;
  readonly userBchLockingBytecode?: Hex;
  readonly hashLock?: Hex32;
  readonly secret?: Hex32;
  readonly amountIn?: string;
  readonly insufficientLiquidityAmountIn?: string;
  readonly orderId?: Hex32;
  readonly unknownOrderId?: Hex32;
  readonly expiredQuoteOrderId?: Hex32;
  readonly payLinkId?: string;
  readonly sendLinkId?: string;
  readonly ownerCashaddr?: string;
  readonly ownerSig?: string;
}

export interface ContractSuiteOptions {
  readonly fetch?: FetchLike;
  readonly bearerToken?: string;
  readonly timeoutMs?: number;
  readonly fixtures?: ContractSuiteFixtures;
}

export interface ContractCheckResult {
  readonly route: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly reason?: string;
}

export interface ContractSuiteReport {
  readonly baseUrl: string;
  readonly ok: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly ContractCheckResult[];
}

const DEFAULT_EVM_TOKEN = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as Hex;
const DEFAULT_USER_EVM = '0x1111111111111111111111111111111111111111' as Hex;
const DEFAULT_RECIPIENT_EVM =
  '0x2222222222222222222222222222222222222222' as Hex;
const DEFAULT_BCH_LOCKING =
  '0x76a914111111111111111111111111111111111111111188ac' as Hex;
/** A different, valid hash lock for each extra quote: the solver accepts a hash lock once. */
function otherHashLock(hashLock: Hex32, n: number): Hex32 {
  return sha256(
    `${hashLock}${n.toString(16).padStart(2, '0')}` as Hex32,
  ) as Hex32;
}

const DEFAULT_HASH_LOCK =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex32;
const DEFAULT_SECRET =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex32;
const DEFAULT_ORDER_ID =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex32;
const DEFAULT_UNKNOWN_ORDER_ID =
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex32;
const DEFAULT_EXPIRED_ORDER_ID =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex32;
const DEFAULT_SIG = '0x' + '11'.repeat(65);
const DEFAULT_CASHADDR = 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq00000000';

interface HttpCallOutcome {
  readonly ok: boolean;
  readonly status?: number;
  readonly json?: unknown;
  readonly reason?: string;
}

async function performRequest(params: {
  fetchFn: FetchLike;
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  bearerToken?: string;
  timeoutMs: number;
}): Promise<HttpCallOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, params.timeoutMs);

  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (params.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (params.bearerToken !== undefined && params.bearerToken.length > 0) {
    headers['authorization'] = `Bearer ${params.bearerToken}`;
  }

  let response: Response;
  try {
    response = await params.fetchFn(params.url, {
      method: params.method,
      headers,
      signal: controller.signal,
      ...(params.body !== undefined
        ? { body: JSON.stringify(params.body) }
        : {}),
    });
  } catch (error) {
    if (timedOut) {
      return { ok: false, reason: `Timed out after ${params.timeoutMs}ms` };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let json: unknown = undefined;
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return {
        ok: false,
        status: response.status,
        reason: `Expected JSON body, got non-JSON (${text.slice(0, 80)})`,
      };
    }
  }

  return { ok: true, status: response.status, json };
}

function validateSchema<T>(
  route: string,
  outcome: HttpCallOutcome,
  expectedStatuses: readonly number[],
  schema: z.ZodType<T>,
  extraCheck?: (data: T) => string | undefined,
): { result: ContractCheckResult; data?: T } {
  if (!outcome.ok || outcome.status === undefined) {
    return {
      result: {
        route,
        ok: false,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        reason: outcome.reason ?? 'Request failed',
      },
    };
  }

  if (!expectedStatuses.includes(outcome.status)) {
    return {
      result: {
        route,
        ok: false,
        status: outcome.status,
        reason: `Expected HTTP ${expectedStatuses.join('/')}, got ${outcome.status}`,
      },
    };
  }

  const parsed = schema.safeParse(outcome.json);
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {
      result: {
        route,
        ok: false,
        status: outcome.status,
        reason: `Schema mismatch: ${issueSummary}`,
      },
    };
  }

  if (extraCheck !== undefined) {
    const extraError = extraCheck(parsed.data);
    if (extraError !== undefined) {
      return {
        result: {
          route,
          ok: false,
          status: outcome.status,
          reason: extraError,
        },
      };
    }
  }

  return {
    result: { route, ok: true, status: outcome.status },
    data: parsed.data,
  };
}

export async function runContractSuite(
  baseUrl: string,
  options: ContractSuiteOptions = {},
): Promise<ContractSuiteReport> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (normalizedBaseUrl.length === 0) {
    throw new TypeError('baseUrl must not be empty');
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new TypeError('A fetch implementation is required');
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const fixtures = options.fixtures ?? {};
  const chainId = fixtures.chainId ?? 84532;
  const evmToken = fixtures.evmToken ?? DEFAULT_EVM_TOKEN;
  const userEvmAddress = fixtures.userEvmAddress ?? DEFAULT_USER_EVM;
  const recipientEvmAddress =
    fixtures.recipientEvmAddress ?? DEFAULT_RECIPIENT_EVM;
  const userBchLockingBytecode =
    fixtures.userBchLockingBytecode ?? DEFAULT_BCH_LOCKING;
  const hashLock = fixtures.hashLock ?? DEFAULT_HASH_LOCK;
  const secret = fixtures.secret ?? DEFAULT_SECRET;
  const amountIn = fixtures.amountIn ?? '1000000';
  const insufficientLiquidityAmountIn =
    fixtures.insufficientLiquidityAmountIn ?? '999999999999999';
  const unknownOrderId = fixtures.unknownOrderId ?? DEFAULT_UNKNOWN_ORDER_ID;
  const expiredQuoteOrderId =
    fixtures.expiredQuoteOrderId ?? DEFAULT_EXPIRED_ORDER_ID;
  const ownerCashaddr = fixtures.ownerCashaddr ?? DEFAULT_CASHADDR;
  const ownerSig = fixtures.ownerSig ?? DEFAULT_SIG;
  const bearerToken = options.bearerToken ?? 'contract-suite-operator-token';

  const nowSec = Math.floor(Date.now() / 1000);
  const results: ContractCheckResult[] = [];

  const call = async <T>(params: {
    route: string;
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    expectedStatuses: readonly number[];
    schema: z.ZodType<T>;
    auth?: boolean;
    extraCheck?: (data: T) => string | undefined;
  }): Promise<T | undefined> => {
    const outcome = await performRequest({
      fetchFn,
      url: `${normalizedBaseUrl}${params.path}`,
      method: params.method,
      body: params.body,
      ...(params.auth ? { bearerToken } : {}),
      timeoutMs,
    });
    const checked = validateSchema(
      params.route,
      outcome,
      params.expectedStatuses,
      params.schema,
      params.extraCheck,
    );
    results.push(checked.result);
    return checked.data;
  };

  // 1-8. Health, discovery, metrics, operator routes
  await call({
    route: 'GET /v1/health',
    method: 'GET',
    path: '/v1/health',
    expectedStatuses: [200],
    schema: HealthResponseSchema,
  });

  await call({
    route: 'GET /v1/liquidity',
    method: 'GET',
    path: '/v1/liquidity',
    expectedStatuses: [200],
    schema: LiquidityResponseSchema,
  });

  await call({
    route: 'GET /v1/chains',
    method: 'GET',
    path: '/v1/chains',
    expectedStatuses: [200],
    schema: ChainsResponseSchema,
  });

  await call({
    route: 'GET /v1/stats',
    method: 'GET',
    path: '/v1/stats',
    expectedStatuses: [200],
    schema: StatsResponseSchema,
  });

  await call({
    route: 'GET /v1/orders/recent',
    method: 'GET',
    path: '/v1/orders/recent',
    expectedStatuses: [200],
    schema: RecentOrdersResponseSchema,
  });

  await call({
    route: 'GET /v1/pegs',
    method: 'GET',
    path: '/v1/pegs',
    expectedStatuses: [200],
    schema: PegsResponseSchema,
  });

  await call({
    route: 'GET /v1/metrics',
    method: 'GET',
    path: '/v1/metrics',
    expectedStatuses: [200],
    schema: MetricsResponseSchema,
  });

  await call({
    route: 'GET /v1/operator/needs-attention',
    method: 'GET',
    path: '/v1/operator/needs-attention',
    expectedStatuses: [200],
    schema: OperatorNeedsAttentionResponseSchema,
    auth: true,
  });

  // 9-13. Quote & Order lifecycle routes
  const quoteData = await call({
    route: 'POST /v1/quotes',
    method: 'POST',
    path: '/v1/quotes',
    body: {
      direction: 'EVM_TO_BCH',
      token: 'PUSD',
      chainId,
      evmToken,
      amountIn,
      userEvmAddress,
      userBchLockingBytecode,
      hashLock,
      lane: 'safe',
    },
    expectedStatuses: [200],
    schema: QuoteResponseSchema,
  });

  const activeOrderId =
    fixtures.orderId ?? quoteData?.orderId ?? DEFAULT_ORDER_ID;

  await call({
    route: 'GET /v1/orders/:orderId',
    method: 'GET',
    path: `/v1/orders/${encodeURIComponent(activeOrderId)}`,
    expectedStatuses: [200],
    schema: OrderStatusResponseSchema,
  });

  await call({
    route: 'POST /v1/orders/:orderId/secret',
    method: 'POST',
    path: `/v1/orders/${encodeURIComponent(activeOrderId)}/secret`,
    body: { secret },
    expectedStatuses: [200],
    schema: RevealSecretResponseSchema,
  });

  await call({
    route: 'POST /v1/orders/:orderId/relay-lock',
    method: 'POST',
    path: `/v1/orders/${encodeURIComponent(activeOrderId)}/relay-lock`,
    body: {
      intent: {
        orderId: activeOrderId,
        deadline: nowSec + 3600,
        nonce: '0',
      },
      signature: DEFAULT_SIG,
    },
    expectedStatuses: [200],
    schema: RelayLockResponseSchema,
  });

  await call({
    route: 'POST /v1/orders/:orderId/relay-claim',
    method: 'POST',
    path: `/v1/orders/${encodeURIComponent(activeOrderId)}/relay-claim`,
    body: { secret },
    expectedStatuses: [200],
    schema: RelayClaimResponseSchema,
  });

  // 14-18. Pay-link routes
  const createdLink = await call({
    route: 'POST /v1/links',
    method: 'POST',
    path: '/v1/links',
    body: {
      token: 'PUSD',
      recipientAddress: ownerCashaddr,
      amountOut: '2500',
      memo: 'Contract test invoice',
    },
    expectedStatuses: [200, 201],
    schema: CreatePayLinkResponseSchema,
  });

  const activePayLinkId = fixtures.payLinkId ?? createdLink?.id ?? 'pl-1';

  await call({
    route: 'GET /v1/links/:id',
    method: 'GET',
    path: `/v1/links/${encodeURIComponent(activePayLinkId)}`,
    expectedStatuses: [200],
    schema: PayLinkDetailsResponseSchema,
  });

  await call({
    route: 'POST /v1/links/:id/quotes',
    method: 'POST',
    path: `/v1/links/${encodeURIComponent(activePayLinkId)}/quotes`,
    body: {
      chainId,
      evmToken,
      userEvmAddress,
      hashLock: otherHashLock(hashLock, 1),
      lane: 'safe',
    },
    expectedStatuses: [200],
    schema: QuoteResponseSchema,
  });

  const listParams = new URLSearchParams({
    owner: ownerCashaddr,
    sig: ownerSig,
  });
  await call({
    route: 'GET /v1/links?owner=&sig=',
    method: 'GET',
    path: `/v1/links?${listParams.toString()}`,
    expectedStatuses: [200],
    schema: OwnerPayLinksResponseSchema,
  });

  await call({
    route: 'POST /v1/links/:id/cancel',
    method: 'POST',
    path: `/v1/links/${encodeURIComponent(activePayLinkId)}/cancel`,
    body: {
      owner: ownerCashaddr,
      sig: ownerSig,
    },
    expectedStatuses: [200],
    schema: CancelPayLinkResponseSchema,
  });

  // 19-20. Send-link routes
  const sendQuote = await call({
    route: 'POST /v1/send-quotes',
    method: 'POST',
    path: '/v1/send-quotes',
    body: {
      token: 'PUSD',
      chainId,
      evmToken,
      amountIn,
      recipientEvmAddress,
      userEvmAddress,
      userBchLockingBytecode,
      hashLock: otherHashLock(hashLock, 2),
      windowSeconds: 86400,
      lane: 'safe',
    },
    expectedStatuses: [200],
    schema: QuoteResponseSchema,
  });

  const activeSendLinkId = fixtures.sendLinkId ?? sendQuote?.orderId ?? 'sl-1';

  await call({
    route: 'GET /v1/send-links/:id',
    method: 'GET',
    path: `/v1/send-links/${encodeURIComponent(activeSendLinkId)}`,
    expectedStatuses: [200],
    schema: SendLinkDetailsResponseSchema,
  });

  // 21-24. Negative cases
  await call({
    route: 'POST /v1/quotes [bad body]',
    method: 'POST',
    path: '/v1/quotes',
    body: { invalid: true },
    expectedStatuses: [400],
    schema: ApiErrorResponseSchema,
    extraCheck: (err) =>
      err.error.code === 'BAD_REQUEST' || err.error.code === 'VALIDATION_ERROR'
        ? undefined
        : `Expected BAD_REQUEST or VALIDATION_ERROR, got ${err.error.code}`,
  });

  await call({
    route: 'GET /v1/orders/:orderId [unknown order]',
    method: 'GET',
    path: `/v1/orders/${encodeURIComponent(unknownOrderId)}`,
    expectedStatuses: [404],
    schema: ApiErrorResponseSchema,
    extraCheck: (err) =>
      err.error.code === 'ORDER_NOT_FOUND' || err.error.code === 'NOT_FOUND'
        ? undefined
        : `Expected ORDER_NOT_FOUND or NOT_FOUND, got ${err.error.code}`,
  });

  await call({
    route: 'POST /v1/orders/:orderId/secret [expired quote]',
    method: 'POST',
    path: `/v1/orders/${encodeURIComponent(expiredQuoteOrderId)}/secret`,
    body: { secret },
    expectedStatuses: [410],
    schema: ApiErrorResponseSchema,
    extraCheck: (err) =>
      err.error.code === 'QUOTE_EXPIRED'
        ? undefined
        : `Expected QUOTE_EXPIRED, got ${err.error.code}`,
  });

  await call({
    route: 'POST /v1/quotes [insufficient liquidity]',
    method: 'POST',
    path: '/v1/quotes',
    body: {
      direction: 'EVM_TO_BCH',
      token: 'PUSD',
      chainId,
      evmToken,
      amountIn: insufficientLiquidityAmountIn,
      userEvmAddress,
      userBchLockingBytecode,
      hashLock: otherHashLock(hashLock, 3),
      lane: 'safe',
    },
    expectedStatuses: [422],
    schema: QuoteRefusalSchema,
    extraCheck: (refusal) =>
      refusal.reason === 'INSUFFICIENT_LIQUIDITY'
        ? undefined
        : `Expected INSUFFICIENT_LIQUIDITY, got ${refusal.reason}`,
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return {
    baseUrl: normalizedBaseUrl,
    ok: failed === 0,
    passed,
    failed,
    results,
  };
}
