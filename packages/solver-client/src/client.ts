import type { Hex32 } from '@ferry/core';
import {
  ApiErrorResponseSchema,
  CancelPayLinkRequestSchema,
  CancelPayLinkResponseSchema,
  ChainsResponseSchema,
  CreatePayLinkRequestSchema,
  CreatePayLinkResponseSchema,
  HealthResponseSchema,
  LiquidityResponseSchema,
  MetricsResponseSchema,
  OperatorNeedsAttentionResponseSchema,
  OrderStatusResponseSchema,
  OwnerPayLinksResponseSchema,
  PayLinkDetailsResponseSchema,
  PayLinkQuoteRequestSchema,
  PegsResponseSchema,
  QuoteRefusalSchema,
  QuoteRequestSchema,
  QuoteResponseSchema,
  RecentOrdersResponseSchema,
  RelayClaimRequestSchema,
  RelayClaimResponseSchema,
  RelayLockRequestSchema,
  RelayLockResponseSchema,
  RevealSecretRequestSchema,
  RevealSecretResponseSchema,
  SendLinkDetailsResponseSchema,
  SendQuoteRequestSchema,
  StatsResponseSchema,
  CancelSendLinkQuotaSchema,
  CancelSendLinkResponseSchema,
  ConfirmSendLinkRouteRequestSchema,
  ConfirmSendLinkRouteResponseSchema,
  DeletePayLinkResponseSchema,
  SwitchSendLinkRouteRequestSchema,
  SwitchSendLinkRouteResponseSchema,
  type CancelPayLinkRequest,
  type CancelPayLinkResponse,
  type CancelSendLinkQuota,
  type CancelSendLinkRequest,
  type CancelSendLinkResponse,
  type ChainsResponse,
  type ConfirmSendLinkRouteRequest,
  type ConfirmSendLinkRouteResponse,
  type CreatePayLinkRequest,
  type CreatePayLinkResponse,
  type DeletePayLinkResponse,
  type HealthResponse,
  type LiquidityResponse,
  type MetricsResponse,
  type OperatorNeedsAttentionResponse,
  type OrderStatusResponse,
  type OwnerPayLinksResponse,
  type PayLinkDetailsResponse,
  type PayLinkQuoteRequest,
  type PegsResponse,
  type QuoteRequest,
  type QuoteResponse,
  type RecentOrdersResponse,
  type RelayClaimRequest,
  type RelayClaimResponse,
  type RelayLockRequest,
  type RelayLockResponse,
  type RevealSecretResponse,
  type SendLinkDetailsResponse,
  type SendQuoteRequest,
  type StatsResponse,
  type SwitchSendLinkRouteRequest,
  type SwitchSendLinkRouteResponse,
} from '@ferry/core/api';
import type { z } from 'zod';
import {
  SolverHttpError,
  SolverNetworkError,
  SolverRefusalError,
  SolverSchemaError,
  SolverTimeoutError,
} from './errors.js';

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SolverClientOptions {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly bearerToken?: string;
}

export interface RequestCallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly bearerToken?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** A relayed transaction is answered once it is mined: Ethereum blocks take 12 seconds or more. */
const RELAY_TIMEOUT_MS = 90_000;

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    throw new TypeError('Solver baseUrl must not be empty');
  }
  return trimmed;
}

function serializeJsonBody(body: unknown): string {
  return JSON.stringify(body, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export class SolverClient {
  readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly defaultTimeoutMs: number;
  private readonly defaultBearerToken: string | undefined;

  constructor(options: SolverClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const resolvedFetch = options.fetch ?? globalThis.fetch;
    if (typeof resolvedFetch !== 'function') {
      throw new TypeError('A fetch implementation is required');
    }
    this.fetchFn = resolvedFetch;
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultBearerToken = options.bearerToken;
  }

  async quote(
    request: QuoteRequest,
    options?: RequestCallOptions,
  ): Promise<QuoteResponse> {
    const parsed = QuoteRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      '/v1/quotes',
      QuoteResponseSchema,
      parsed,
      options,
    );
  }

  async getOrder(
    orderId: Hex32,
    options?: RequestCallOptions,
  ): Promise<OrderStatusResponse> {
    return this.requestJson(
      'GET',
      `/v1/orders/${encodeURIComponent(orderId)}`,
      OrderStatusResponseSchema,
      undefined,
      options,
    );
  }

  async revealSecret(
    orderId: Hex32,
    secret: Hex32,
    options?: RequestCallOptions,
  ): Promise<RevealSecretResponse> {
    const body = RevealSecretRequestSchema.parse({ secret });
    return this.requestJson(
      'POST',
      `/v1/orders/${encodeURIComponent(orderId)}/secret`,
      RevealSecretResponseSchema,
      body,
      options,
    );
  }

  async relayLock(
    orderId: Hex32,
    request: RelayLockRequest,
    options?: RequestCallOptions,
  ): Promise<RelayLockResponse> {
    const body = RelayLockRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      `/v1/orders/${encodeURIComponent(orderId)}/relay-lock`,
      RelayLockResponseSchema,
      body,
      { timeoutMs: RELAY_TIMEOUT_MS, ...options },
    );
  }

  async relayClaim(
    orderId: Hex32,
    request: RelayClaimRequest,
    options?: RequestCallOptions,
  ): Promise<RelayClaimResponse> {
    const body = RelayClaimRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      `/v1/orders/${encodeURIComponent(orderId)}/relay-claim`,
      RelayClaimResponseSchema,
      body,
      { timeoutMs: RELAY_TIMEOUT_MS, ...options },
    );
  }

  async health(options?: RequestCallOptions): Promise<HealthResponse> {
    return this.requestJson(
      'GET',
      '/v1/health',
      HealthResponseSchema,
      undefined,
      options,
    );
  }

  async liquidity(options?: RequestCallOptions): Promise<LiquidityResponse> {
    return this.requestJson(
      'GET',
      '/v1/liquidity',
      LiquidityResponseSchema,
      undefined,
      options,
    );
  }

  async chains(options?: RequestCallOptions): Promise<ChainsResponse> {
    return this.requestJson(
      'GET',
      '/v1/chains',
      ChainsResponseSchema,
      undefined,
      options,
    );
  }

  async stats(options?: RequestCallOptions): Promise<StatsResponse> {
    return this.requestJson(
      'GET',
      '/v1/stats',
      StatsResponseSchema,
      undefined,
      options,
    );
  }

  async recentOrders(
    options?: RequestCallOptions,
  ): Promise<RecentOrdersResponse> {
    return this.requestJson(
      'GET',
      '/v1/orders/recent',
      RecentOrdersResponseSchema,
      undefined,
      options,
    );
  }

  async pegs(options?: RequestCallOptions): Promise<PegsResponse> {
    return this.requestJson(
      'GET',
      '/v1/pegs',
      PegsResponseSchema,
      undefined,
      options,
    );
  }

  async metrics(options?: RequestCallOptions): Promise<MetricsResponse> {
    return this.requestJson(
      'GET',
      '/v1/metrics',
      MetricsResponseSchema,
      undefined,
      options,
    );
  }

  async operatorNeedsAttention(
    options?: RequestCallOptions,
  ): Promise<OperatorNeedsAttentionResponse> {
    return this.requestJson(
      'GET',
      '/v1/operator/needs-attention',
      OperatorNeedsAttentionResponseSchema,
      undefined,
      options,
    );
  }

  async createPayLink(
    request: CreatePayLinkRequest,
    options?: RequestCallOptions,
  ): Promise<CreatePayLinkResponse> {
    const body = CreatePayLinkRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      '/v1/links',
      CreatePayLinkResponseSchema,
      body,
      options,
    );
  }

  async getPayLink(
    id: string,
    options?: RequestCallOptions,
  ): Promise<PayLinkDetailsResponse> {
    return this.requestJson(
      'GET',
      `/v1/links/${encodeURIComponent(id)}`,
      PayLinkDetailsResponseSchema,
      undefined,
      options,
    );
  }

  async quotePayLink(
    id: string,
    request: PayLinkQuoteRequest,
    options?: RequestCallOptions,
  ): Promise<QuoteResponse> {
    const body = PayLinkQuoteRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      `/v1/links/${encodeURIComponent(id)}/quotes`,
      QuoteResponseSchema,
      body,
      options,
    );
  }

  async listOwnerPayLinks(
    owner: string,
    sig: string,
    options?: RequestCallOptions,
  ): Promise<OwnerPayLinksResponse> {
    const params = new URLSearchParams({ owner, sig });
    return this.requestJson(
      'GET',
      `/v1/links?${params.toString()}`,
      OwnerPayLinksResponseSchema,
      undefined,
      options,
    );
  }

  async cancelPayLink(
    id: string,
    request: CancelPayLinkRequest,
    options?: RequestCallOptions,
  ): Promise<CancelPayLinkResponse> {
    const body = CancelPayLinkRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      `/v1/links/${encodeURIComponent(id)}/cancel`,
      CancelPayLinkResponseSchema,
      body,
      options,
    );
  }

  async deletePayLink(
    id: string,
    secret: string,
    options?: RequestCallOptions,
  ): Promise<DeletePayLinkResponse> {
    return this.requestJson(
      'DELETE',
      `/v1/links/${encodeURIComponent(id)}`,
      DeletePayLinkResponseSchema,
      { secret },
      options,
    );
  }

  async quoteSendLink(
    request: SendQuoteRequest,
    options?: RequestCallOptions,
  ): Promise<QuoteResponse> {
    const body = SendQuoteRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      '/v1/send-quotes',
      QuoteResponseSchema,
      body,
      options,
    );
  }

  async getSendLink(
    id: string,
    options?: RequestCallOptions,
  ): Promise<SendLinkDetailsResponse> {
    return this.requestJson(
      'GET',
      `/v1/send-links/${encodeURIComponent(id)}`,
      SendLinkDetailsResponseSchema,
      undefined,
      options,
    );
  }

  async cancelSendLink(
    id: string,
    req: CancelSendLinkRequest,
    options?: RequestCallOptions,
  ): Promise<CancelSendLinkResponse> {
    return this.requestJson(
      'POST',
      `/v1/send-links/${encodeURIComponent(id)}/cancel`,
      CancelSendLinkResponseSchema,
      req,
      options,
    );
  }

  async getSendLinkCancelQuota(
    id: string,
    options?: RequestCallOptions,
  ): Promise<CancelSendLinkQuota> {
    return this.requestJson(
      'GET',
      `/v1/send-links/${encodeURIComponent(id)}/cancel-quota`,
      CancelSendLinkQuotaSchema,
      undefined,
      options,
    );
  }

  async switchSendLinkRoute(
    id: string,
    request: SwitchSendLinkRouteRequest,
    options?: RequestCallOptions,
  ): Promise<SwitchSendLinkRouteResponse> {
    const body = SwitchSendLinkRouteRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      `/v1/send-links/${encodeURIComponent(id)}/switch-route`,
      SwitchSendLinkRouteResponseSchema,
      body,
      options,
    );
  }

  async confirmSendLinkRoute(
    id: string,
    request: ConfirmSendLinkRouteRequest,
    options?: RequestCallOptions,
  ): Promise<ConfirmSendLinkRouteResponse> {
    const body = ConfirmSendLinkRouteRequestSchema.parse(request);
    return this.requestJson(
      'POST',
      `/v1/send-links/${encodeURIComponent(id)}/confirm`,
      ConfirmSendLinkRouteResponseSchema,
      body,
      options,
    );
  }

  private async requestJson<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    options?: RequestCallOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;

    const onExternalAbort = (): void => {
      controller.abort();
    };
    if (options?.signal !== undefined) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onExternalAbort, {
          once: true,
        });
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const token = options?.bearerToken ?? this.defaultBearerToken;
    if (token !== undefined && token.length > 0) {
      headers['authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: serializeJsonBody(body) } : {}),
      });
    } catch (error) {
      if (timedOut) {
        throw new SolverTimeoutError(url, timeoutMs);
      }
      if (isAbortError(error)) {
        throw new SolverNetworkError(
          url,
          `Request to ${url} was aborted`,
          error,
        );
      }
      const message =
        error instanceof Error ? error.message : 'Network request failed';
      throw new SolverNetworkError(url, message, error);
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onExternalAbort);
    }

    const rawText = await response.text();
    let parsedJson: unknown = undefined;
    if (rawText.length > 0) {
      try {
        parsedJson = JSON.parse(rawText) as unknown;
      } catch {
        if (response.ok) {
          throw new SolverSchemaError({
            url,
            route: path,
            message: `Invalid JSON response from ${path}`,
          });
        }
      }
    }

    if (!response.ok) {
      if (parsedJson !== undefined) {
        const refusal = QuoteRefusalSchema.safeParse(parsedJson);
        if (refusal.success) {
          throw new SolverRefusalError(url, response.status, refusal.data);
        }
        const apiError = ApiErrorResponseSchema.safeParse(parsedJson);
        if (apiError.success) {
          throw new SolverHttpError({
            url,
            status: response.status,
            message: apiError.data.error.message,
            apiError: apiError.data,
          });
        }
      }
      throw new SolverHttpError({
        url,
        status: response.status,
        message: `Solver returned HTTP ${response.status} for ${path}`,
        bodyText: rawText,
      });
    }

    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new SolverSchemaError({
        url,
        route: path,
        message: `Response schema mismatch for ${path}`,
        issues: validated.error.issues,
      });
    }
    return validated.data;
  }
}
