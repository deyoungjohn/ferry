import type {
  Hex,
  Hex32,
  LiquidityResponse,
  OrderTerms,
  QuoteRefusal,
} from '@ferry/core';
import type {
  SwitchSendLinkRouteRequest,
  SwitchSendLinkRouteResponse,
} from '@ferry/core/api';

export type { LiquidityResponse };

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
  readonly userAddress?: string | undefined;
  readonly recipientAddress?: string | undefined;
}

export interface SignedQuote {
  readonly orderId: Hex32;
  readonly terms: OrderTerms;
  readonly signature: Hex;
  readonly signerAddress: Hex;
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
  readonly signedQuote?: SignedQuote | undefined;
  readonly formattedPricingEvidence?: string | undefined;
  readonly refusal?: QuoteRefusal | undefined;
}

export type QuoteResult =
  | { readonly ok: true; readonly quote: QuoteResponse }
  | { readonly ok: false; readonly refusal: QuoteRefusal };

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
  readonly source?: string;
  readonly asOf?: number;
}

export interface OrderTransaction {
  readonly id: string;
  readonly label: string;
  readonly actor: 'user' | 'solver';
  readonly chainName: string;
  readonly hash: string;
  readonly explorerUrl?: string | undefined;
  readonly isMock?: boolean | undefined;
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
  readonly signedQuote?: SignedQuote | undefined;
}

export interface SolverHealthResponse {
  readonly ok: boolean;
  readonly quotingEnabled: boolean;
  readonly timestamp: number;
}

export interface OperatorRouteInfo {
  readonly route: string;
  readonly enabled: boolean;
  readonly availableUsd: number;
  readonly skewBps?: number;
  readonly lastError?: string | null;
}

/** What the receiver's page shows for a send link. */
export interface SendLinkView {
  readonly id: string;
  readonly status:
    | 'open'
    | 'locked'
    | 'claimed'
    | 'refunded'
    | 'expired'
    | 'pending_lock'
    | 'cancelled';
  /** Null when the token's decimals are not known to this page. */
  readonly amount: number | null;
  readonly token: string;
  readonly chain: string;
  readonly recipientEvmAddress: string;
  /** Unix seconds: when the claim window ends. */
  readonly expiresAt: number | null;
  /** The sender's note, as plain text. */
  readonly note?: string | undefined;
  /** The EVM lock the receiver claims; what a direct claim from the receiver's wallet needs. */
  readonly lockId?: string | undefined;
  /** The EVM chain the funds arrive on; the claim is signed and sent on it. */
  readonly chainId?: number | undefined;
  readonly orderId?: string | undefined;
  readonly bchRefundHeight?: number | undefined;
  readonly evmToken?: string | undefined;
}

export interface SolverClient {
  isLive(): boolean;
  getLabel(): string;
  getQuote(request: QuoteRequest): Promise<QuoteResponse>;
  getQuoteWithResult?(request: QuoteRequest): Promise<QuoteResult>;
  getLiquidity(): Promise<LiquidityResponse>;
  getStats(): Promise<SolverStats>;
  getRecentSwaps(page: number, pageSize: number): Promise<PaginatedRecentSwaps>;
  getPegPrices(): Promise<readonly PegPrice[]>;
  getOrder(orderId: string): Promise<SwapOrder | null>;
  /** The receiver's view of a send link, or null when there is none with this id. */
  getSendLink?(id: string): Promise<SendLinkView | null>;
  switchSendLinkRoute?(
    id: string,
    request: SwitchSendLinkRouteRequest,
  ): Promise<SwitchSendLinkRouteResponse>;
  createOrder?(quote: SignedQuote, userAddress?: string): Promise<SwapOrder>;
  submitLock?(orderId: string, txHash: string): Promise<SwapOrder>;
  getHealth?(): Promise<SolverHealthResponse>;
  getOperatorRoutes?(token: string): Promise<readonly OperatorRouteInfo[]>;
}
