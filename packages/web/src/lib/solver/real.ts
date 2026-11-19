import type {
  SendLinkView,
  SolverClient,
  QuoteRequest,
  QuoteResponse,
  QuoteResult,
  SolverStats,
  PaginatedRecentSwaps,
  PegPrice,
  SwapOrder,
  SolverHealthResponse,
  OperatorRouteInfo,
  SignedQuote,
  RecentSwap,
} from './types';
import { orderTermsFromJson, type LiquidityResponse } from '@ferry/core';
import { SendLinkDetailsResponseSchema } from '@ferry/core/api';
import { buildCoreQuoteRequest, describeFarToken } from './core-quote';

export const LIVE_EXECUTION_MESSAGE =
  'Live swap execution is not switched on in this release yet. You can quote and check routes; locking funds from the page comes next.';

export class RealSolverClient implements SolverClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  private readonly retryDelayMs: number;

  constructor(options?: {
    baseUrl?: string;
    fetch?: typeof fetch;
    retryDelayMs?: number;
  }) {
    this.retryDelayMs = options?.retryDelayMs ?? 1500;
    const envUrls =
      typeof import.meta !== 'undefined'
        ? (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
        : undefined;
    const firstUrl = envUrls?.split(',')[0]?.trim();
    this.baseUrl = (options?.baseUrl ?? firstUrl ?? '').replace(/\/+$/, '');
    this.fetchFn =
      options?.fetch ??
      (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
  }

  isLive(): boolean {
    return true;
  }

  getLabel(): string {
    return 'Live Solver';
  }

  async getHealth(): Promise<SolverHealthResponse> {
    if (!this.baseUrl) {
      return {
        ok: false,
        quotingEnabled: false,
        timestamp: Math.floor(Date.now() / 1000),
      };
    }
    const res = await this.fetchFn(`${this.baseUrl}/v1/health`);
    if (!res.ok) {
      throw new Error(`Solver health check returned status ${res.status}`);
    }
    return (await res.json()) as SolverHealthResponse;
  }

  async getOperatorRoutes(
    token: string,
  ): Promise<readonly OperatorRouteInfo[]> {
    if (!this.baseUrl) return [];
    const res = await this.fetchFn(`${this.baseUrl}/v1/operator/routes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      routes?: readonly OperatorRouteInfo[];
    };
    return Array.isArray(data.routes) ? data.routes : [];
  }

  async getLiquidity(): Promise<LiquidityResponse> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.baseUrl) {
      return { asOf: now, routes: [] };
    }
    const res = await this.fetchFn(`${this.baseUrl}/v1/liquidity`);
    if (!res.ok) {
      return { asOf: now, routes: [] };
    }
    return (await res.json()) as LiquidityResponse;
  }

  /**
   * A refusal because the reference price blipped (peg guard, price unavailable) usually clears
   * within seconds: ask again twice before showing it, so a first-time visitor is not turned away.
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    let quote = await this.getQuoteOnce(request);
    for (let attempt = 0; attempt < 2; attempt++) {
      const reason = quote.refusal?.reason;
      if (reason !== 'PEG_GUARD' && reason !== 'PRICE_UNAVAILABLE') break;
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      quote = await this.getQuoteOnce(request);
    }
    return quote;
  }

  private async getQuoteOnce(request: QuoteRequest): Promise<QuoteResponse> {
    const refusalResponse = (
      reason: 'ROUTE_DISABLED' | 'QUOTING_PAUSED' | 'PRICE_UNAVAILABLE',
      message: string,
    ): QuoteResponse => ({
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      toAmount: 0,
      exchangeRate: 0,
      spreadBps: 0,
      estimatedSeconds: 30,
      expiresInSeconds: 60,
      refusal: { reason, asset: request.fromToken, message },
    });

    if (!this.baseUrl) {
      return refusalResponse(
        'ROUTE_DISABLED',
        'No solver configured or endpoint reachable',
      );
    }
    const built = buildCoreQuoteRequest(request);
    if (!built) {
      return refusalResponse(
        'ROUTE_DISABLED',
        'This route is not available in this build',
      );
    }

    const res = await this.fetchFn(`${this.baseUrl}/v1/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(built.request, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!res.ok) {
      const reason = body.reason as string | undefined;
      const known = [
        'INSUFFICIENT_LIQUIDITY',
        'OVER_MAX_SWAP',
        'BELOW_MINIMUM',
        'PEG_GUARD',
        'PRICE_UNAVAILABLE',
        'ROUTE_DISABLED',
        'QUOTING_PAUSED',
      ];
      if (reason && known.includes(reason)) {
        return {
          ...refusalResponse('ROUTE_DISABLED', String(body.message ?? reason)),
          refusal: body as unknown as NonNullable<QuoteResponse['refusal']>,
        };
      }
      return refusalResponse(
        'ROUTE_DISABLED',
        String(body.message ?? `Solver HTTP ${res.status}`),
      );
    }

    const terms = orderTermsFromJson(
      (body as { terms: Parameters<typeof orderTermsFromJson>[0] }).terms,
    );
    const reverse = built.request.direction === 'BCH_TO_EVM';
    const toAmount = reverse
      ? Number(terms.evmAmount) / 10 ** built.farToken.decimals
      : Number(terms.bchTokenAmount) / 100;
    return {
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      toAmount,
      exchangeRate: request.fromAmount > 0 ? toAmount / request.fromAmount : 0,
      spreadBps: terms.pricing.spreadBps,
      estimatedSeconds: request.lane === 'fast' ? 30 : 600,
      expiresInSeconds: Math.max(
        0,
        Number(terms.quoteExpiry) - Math.floor(Date.now() / 1000),
      ),
      signedQuote: {
        orderId: body.orderId as SignedQuote['orderId'],
        terms,
        signature: body.signature as SignedQuote['signature'],
        signerAddress: body.signerAddress as SignedQuote['signerAddress'],
      },
    };
  }

  async getQuoteWithResult(request: QuoteRequest): Promise<QuoteResult> {
    const quote = await this.getQuote(request);
    if (quote.refusal) {
      return { ok: false, refusal: quote.refusal };
    }
    return { ok: true, quote };
  }

  async getStats(): Promise<SolverStats> {
    if (!this.baseUrl) {
      return {
        completedSwaps: 0,
        totalVolumeUsd: 0,
        medianSecondsFast: 0,
        isHonestEmpty: true,
      };
    }
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/stats`);
      if (res.ok) {
        const data = (await res.json()) as {
          completedSwaps?: number;
          totalVolumeUsd?: string | number;
          medianFastSeconds?: number;
        };
        const completedSwaps = Number(data.completedSwaps ?? 0);
        const totalVolumeUsd = Number(data.totalVolumeUsd ?? 0);
        return {
          completedSwaps,
          totalVolumeUsd,
          medianSecondsFast: Number(data.medianFastSeconds ?? 0),
          isHonestEmpty: completedSwaps === 0,
        };
      }
    } catch {
      // Fallback
    }
    return {
      completedSwaps: 0,
      totalVolumeUsd: 0,
      medianSecondsFast: 0,
      isHonestEmpty: true,
    };
  }

  async getPegPrices(): Promise<readonly PegPrice[]> {
    const now = Math.floor(Date.now() / 1000);
    if (this.baseUrl) {
      try {
        const res = await this.fetchFn(`${this.baseUrl}/v1/pegs`);
        if (res.ok) {
          const data = (await res.json()) as {
            tokens?: Array<{
              asset: string;
              currentUsdPrice: string;
              points: Array<{ usdPrice: string }>;
            }>;
          };
          if (Array.isArray(data.tokens) && data.tokens.length > 0) {
            return data.tokens.map((t) => ({
              symbol: t.asset,
              priceUsd: Number(t.currentUsdPrice),
              change24hPercent: 0,
              sparkline: t.points.map((point) => Number(point.usdPrice)),
              source: 'Cauldron spot',
              asOf: now,
            }));
          }
        }
      } catch {
        // Fallback
      }
    }
    return [
      {
        symbol: 'PUSD',
        priceUsd: 1.0,
        change24hPercent: 0,
        sparkline: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        source: 'Cauldron DEX spot',
        asOf: now,
      },
      {
        symbol: 'MUSD',
        priceUsd: 1.0,
        change24hPercent: 0,
        sparkline: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        source: 'Cauldron DEX spot',
        asOf: now,
      },
    ];
  }

  async getRecentSwaps(
    page: number,
    pageSize: number,
  ): Promise<PaginatedRecentSwaps> {
    const empty = {
      items: [] as RecentSwap[],
      page,
      pageSize,
      totalCount: 0,
      totalPages: 1,
    };
    if (!this.baseUrl) return empty;
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/orders/recent`);
      if (!res.ok) return empty;
      const data = (await res.json()) as {
        orders?: Array<{
          orderId: string;
          direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
          bchToken: string;
          bchTokenAmount: string;
          evmAmount: string;
          evmChainId: number;
          settledAt: number;
          durationSeconds: number;
          sourceTxId?: string;
          claimTxId?: string;
        }>;
      };
      const orders = Array.isArray(data.orders) ? data.orders : [];
      const all: RecentSwap[] = orders.map((o) => {
        const bch = Number(o.bchTokenAmount) / 100;
        const evm = Number(o.evmAmount) / 1_000_000;
        const forward = o.direction === 'EVM_TO_BCH';
        return {
          id: o.orderId,
          timestampSeconds: o.settledAt,
          fromToken: forward ? 'USDC' : o.bchToken,
          fromAmount: forward ? evm : bch,
          fromChain: forward ? `Chain ${o.evmChainId}` : 'Bitcoin Cash',
          toToken: forward ? o.bchToken : 'USDC',
          toAmount: forward ? bch : evm,
          toChain: forward ? 'Bitcoin Cash' : `Chain ${o.evmChainId}`,
          durationSeconds: o.durationSeconds,
          sourceTxHash: o.sourceTxId ?? '',
          targetTxHash: o.claimTxId ?? '',
          isMock: false,
        };
      });
      const start = Math.max(0, (page - 1) * pageSize);
      return {
        items: all.slice(start, start + pageSize),
        page,
        pageSize,
        totalCount: all.length,
        totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      };
    } catch {
      return empty;
    }
  }

  async getSendLink(id: string): Promise<SendLinkView | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await this.fetchFn(
        `${this.baseUrl}/v1/send-links/${encodeURIComponent(id)}`,
      );
      if (!res.ok) return null;
      const body = SendLinkDetailsResponseSchema.parse(await res.json());
      const token = describeFarToken(body.chainId, body.evmToken);
      const decimals = token?.decimals ?? null;
      return {
        id: body.id,
        status:
          body.status === 'pending_lock'
            ? 'pending_lock'
            : body.status === 'locked'
              ? 'open'
              : body.status,
        amount:
          body.amountOut !== undefined && decimals !== null
            ? Number(body.amountOut) / 10 ** decimals
            : null,
        token: token?.symbol ?? 'USDC',
        chain: token?.chain ?? `Chain ${body.chainId}`,
        recipientEvmAddress: body.recipientEvmAddress,
        expiresAt: body.evmDeadline,
        note: body.note,
        lockId: body.lockId,
      };
    } catch {
      return null;
    }
  }

  async getOrder(orderId: string): Promise<SwapOrder | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await this.fetchFn(
        `${this.baseUrl}/v1/orders/${encodeURIComponent(orderId)}`,
      );
      if (res.ok) {
        return (await res.json()) as SwapOrder;
      }
    } catch {
      // Fallback
    }
    return null;
  }

  async createOrder(): Promise<SwapOrder> {
    throw new Error(LIVE_EXECUTION_MESSAGE);
  }

  async submitLock(): Promise<SwapOrder> {
    throw new Error(LIVE_EXECUTION_MESSAGE);
  }
}

export { RealSolverClient as MockSolverClient };
