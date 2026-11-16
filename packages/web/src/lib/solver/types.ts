export type SwapLane = 'fast' | 'safe';

export type OrderStatus =
  | 'QUOTED'
  | 'USER_LOCK_SEEN'
  | 'USER_LOCK_FINAL'
  | 'SOLVER_LOCK_SEEN'
  | 'SOLVER_LOCK_FINAL'
  | 'USER_CLAIM_SEEN'
  | 'SOLVER_CLAIM_SEEN'
  | 'DONE'
  | 'REFUNDED'
  | 'EXPIRED';

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

export interface OrderTransaction {
  readonly id: string;
  readonly label: string;
  readonly actor: 'user' | 'solver';
  readonly chainName: string;
  readonly hash: string;
  readonly explorerUrl?: string;
  readonly isMock?: boolean;
}

export interface SwapOrder {
  readonly id: string;
  readonly mode: 'swap' | 'pay-link' | 'send-link';
  readonly status: OrderStatus;
  readonly lane: SwapLane;
  readonly fromToken: string;
  readonly toToken: string;
  readonly fromAmount: number;
  readonly toAmount: number;
  readonly fromChain: string;
  readonly toChain: string;
  readonly userAddress: string;
  readonly recipientAddress: string;
  readonly solverAddress: string;
  readonly currentConfirmations: number;
  readonly requiredConfirmations: number;
  readonly estimatedSecondsRemaining: number;
  readonly elapsedSeconds: number;
  readonly waitDescription: string;
  readonly transactions: readonly OrderTransaction[];
  readonly createdAtSeconds: number;
  readonly updatedAtSeconds: number;
  readonly isMock: boolean;
}

export interface SolverClient {
  isLive(): boolean;
  getLabel(): string;
  getQuote(request: QuoteRequest): Promise<QuoteResponse>;
  getStats(): Promise<SolverStats>;
  getRecentSwaps(page: number, pageSize: number): Promise<PaginatedRecentSwaps>;
  getPegPrices(): Promise<readonly PegPrice[]>;
  getOrder(orderId: string): Promise<SwapOrder | null>;
}
