import type {
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
} from './types';
import type { LiquidityResponse } from '@ferry/core';

export class RealSolverClient implements SolverClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: { baseUrl?: string; fetch?: typeof fetch }) {
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

  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    if (!this.baseUrl) {
      return {
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount,
        toAmount: 0,
        exchangeRate: 0,
        spreadBps: 40,
        estimatedSeconds: 30,
        expiresInSeconds: 60,
        refusal: {
          reason: 'ROUTE_DISABLED',
          asset: request.fromToken,
          message: 'No solver configured or endpoint reachable',
        },
      };
    }

    const res = await this.fetchFn(`${this.baseUrl}/v1/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      return {
        fromToken: request.fromToken,
        toToken: request.toToken,
        fromAmount: request.fromAmount,
        toAmount: 0,
        exchangeRate: 0,
        spreadBps: 40,
        estimatedSeconds: 30,
        expiresInSeconds: 60,
        refusal: {
          reason: 'ROUTE_DISABLED',
          asset: request.fromToken,
          message: errorData.message ?? `Solver HTTP ${res.status}`,
        },
      };
    }

    return (await res.json()) as QuoteResponse;
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
        medianSecondsFast: 30,
        isHonestEmpty: true,
      };
    }
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/stats`);
      if (res.ok) {
        const data = (await res.json()) as {
          completedSwaps?: number;
          totalVolumeUsd?: number;
        };
        const completedSwaps = Number(data.completedSwaps ?? 0);
        const totalVolumeUsd = Number(data.totalVolumeUsd ?? 0);
        return {
          completedSwaps,
          totalVolumeUsd,
          medianSecondsFast: 30,
          isHonestEmpty: completedSwaps === 0,
        };
      }
    } catch {
      // Fallback
    }
    return {
      completedSwaps: 0,
      totalVolumeUsd: 0,
      medianSecondsFast: 30,
      isHonestEmpty: true,
    };
  }

  async getPegPrices(): Promise<readonly PegPrice[]> {
    const now = Math.floor(Date.now() / 1000);
    if (this.baseUrl) {
      try {
        const res = await this.fetchFn(`${this.baseUrl}/v1/pegs`);
        if (res.ok) {
          const data = (await res.json()) as { pegs?: readonly PegPrice[] };
          if (Array.isArray(data.pegs)) return data.pegs;
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
    if (this.baseUrl) {
      try {
        const res = await this.fetchFn(
          `${this.baseUrl}/v1/orders/recent?page=${page}&pageSize=${pageSize}`,
        );
        if (res.ok) {
          const data = (await res.json()) as PaginatedRecentSwaps;
          return data;
        }
      } catch {
        // Fallback
      }
    }
    return {
      items: [],
      page,
      pageSize,
      totalCount: 0,
      totalPages: 1,
    };
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

  async createOrder(
    quote: SignedQuote,
    userAddress?: string,
  ): Promise<SwapOrder> {
    if (!this.baseUrl) {
      throw new Error('Solver URL is not configured');
    }
    const res = await this.fetchFn(`${this.baseUrl}/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote, userAddress }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create order: HTTP ${res.status}`);
    }
    return (await res.json()) as SwapOrder;
  }

  async submitLock(orderId: string, txHash: string): Promise<SwapOrder> {
    if (!this.baseUrl) {
      throw new Error('Solver URL is not configured');
    }
    const res = await this.fetchFn(
      `${this.baseUrl}/v1/orders/${encodeURIComponent(orderId)}/lock`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      },
    );
    if (!res.ok) {
      throw new Error(`Failed to submit lock: HTTP ${res.status}`);
    }
    return (await res.json()) as SwapOrder;
  }
}

export { RealSolverClient as MockSolverClient };
