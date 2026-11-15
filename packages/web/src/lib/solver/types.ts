export type SwapLane = 'fast' | 'safe';

export interface QuoteRequest {
  readonly fromToken: string;
  readonly toToken: string;
  readonly fromChain: string;
  readonly toChain: string;
  readonly fromAmount: number;
  readonly lane: SwapLane;
}

export interface QuoteResponse {
  readonly fromToken: string;
  readonly toToken: string;
  readonly fromAmount: number;
  readonly toAmount: number;
  readonly exchangeRate: number;
  readonly spreadBps: number;
  readonly estimatedSeconds: number;
  readonly expiresInSeconds: number;
}

export interface SolverStats {
  readonly completedSwaps: number;
  readonly totalVolumeUsd: number;
  readonly medianSecondsFast: number;
  readonly isHonestEmpty: boolean;
}

export interface RecentSwap {
  readonly id: string;
  readonly timestampSeconds: number;
  readonly fromToken: string;
  readonly fromAmount: number;
  readonly fromChain: string;
  readonly toToken: string;
  readonly toAmount: number;
  readonly toChain: string;
  readonly durationSeconds: number;
  readonly sourceTxHash: string;
  readonly targetTxHash: string;
  readonly isMock: boolean;
}

export interface PaginatedRecentSwaps {
  readonly items: readonly RecentSwap[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly totalPages: number;
}

export interface PegPrice {
  readonly symbol: string;
  readonly priceUsd: number;
  readonly change24hPercent: number;
  readonly sparkline: readonly number[];
}

export interface SolverClient {
  isLive(): boolean;
  getLabel(): string;
  getQuote(request: QuoteRequest): Promise<QuoteResponse>;
  getStats(): Promise<SolverStats>;
  getRecentSwaps(page: number, pageSize: number): Promise<PaginatedRecentSwaps>;
  getPegPrices(): Promise<readonly PegPrice[]>;
}
