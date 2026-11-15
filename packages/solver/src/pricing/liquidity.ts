export const QUOTE_TTL_S = 60; // 60s quote validity
export const MIN_SWAP_USD_MICROS = 1_000_000n; // $1.00
export const MAX_SWAP_USD_MICROS = 50_000_000n; // $50.00
export const MAX_RESERVED_PER_ADDRESS_USD_MICROS = 100_000_000n; // 2x MAX_SWAP ($100)
export const MAX_RESERVED_PER_IP_USD_MICROS = 100_000_000n;

export interface QuoteReservation {
  quoteId: string;
  userAddress: string;
  userIp: string;
  asset: string;
  amount: bigint;
  reservedUntil: number; // Unix timestamp in seconds
}

export interface LiquidityDataResponse {
  asset: string;
  inventory: bigint;
  openExposure: bigint;
  activeReservations: bigint;
  availableLiquidity: bigint;
  maxSwapAmount: bigint;
}

export class LiquidityManager {
  private readonly reservations = new Map<string, QuoteReservation>();

  constructor(
    private readonly maxReservedPerAddress: bigint = MAX_RESERVED_PER_ADDRESS_USD_MICROS,
    private readonly maxReservedPerIp: bigint = MAX_RESERVED_PER_IP_USD_MICROS,
  ) {}

  pruneExpired(nowSeconds: number): void {
    for (const [quoteId, res] of this.reservations.entries()) {
      if (res.reservedUntil <= nowSeconds) {
        this.reservations.delete(quoteId);
      }
    }
  }

  getActiveReservationsForAsset(asset: string, nowSeconds: number): bigint {
    let total = 0n;
    const normAsset = asset.toLowerCase();
    for (const res of this.reservations.values()) {
      if (
        res.reservedUntil > nowSeconds &&
        res.asset.toLowerCase() === normAsset
      ) {
        total += res.amount;
      }
    }
    return total;
  }

  getActiveReservationsForAddress(
    userAddress: string,
    nowSeconds: number,
  ): bigint {
    let total = 0n;
    const norm = userAddress.toLowerCase();
    for (const res of this.reservations.values()) {
      if (
        res.reservedUntil > nowSeconds &&
        res.userAddress.toLowerCase() === norm
      ) {
        total += res.amount;
      }
    }
    return total;
  }

  getActiveReservationsForIp(userIp: string, nowSeconds: number): bigint {
    let total = 0n;
    for (const res of this.reservations.values()) {
      if (res.reservedUntil > nowSeconds && res.userIp === userIp) {
        total += res.amount;
      }
    }
    return total;
  }

  getAvailableLiquidity(
    asset: string,
    currentInventory: bigint,
    openExposure: bigint,
    nowSeconds: number,
  ): bigint {
    this.pruneExpired(nowSeconds);
    const reserved = this.getActiveReservationsForAsset(asset, nowSeconds);
    const committed = openExposure + reserved;
    if (currentInventory <= committed) {
      return 0n;
    }
    return currentInventory - committed;
  }

  getLiquidityData(
    asset: string,
    inventory: bigint,
    openExposure: bigint,
    nowSeconds: number,
  ): LiquidityDataResponse {
    this.pruneExpired(nowSeconds);
    const activeReservations = this.getActiveReservationsForAsset(
      asset,
      nowSeconds,
    );
    const available = this.getAvailableLiquidity(
      asset,
      inventory,
      openExposure,
      nowSeconds,
    );
    return {
      asset,
      inventory,
      openExposure,
      activeReservations,
      availableLiquidity: available,
      maxSwapAmount:
        available < MAX_SWAP_USD_MICROS ? available : MAX_SWAP_USD_MICROS,
    };
  }

  reserveQuote(params: {
    quoteId: string;
    userAddress: string;
    userIp: string;
    asset: string;
    amount: bigint;
    currentInventory: bigint;
    openExposure: bigint;
    nowSeconds: number;
    ttlSeconds?: number;
  }):
    { success: true } | { success: false; reason: string; maxAmount: bigint } {
    this.pruneExpired(params.nowSeconds);

    const available = this.getAvailableLiquidity(
      params.asset,
      params.currentInventory,
      params.openExposure,
      params.nowSeconds,
    );

    // 1. Check available liquidity
    if (params.amount > available) {
      return {
        success: false,
        reason: `Only ${available} ${params.asset} available; try ${available} or less`,
        maxAmount: available,
      };
    }

    // 2. Check per-address reservation cap
    const addressReserved = this.getActiveReservationsForAddress(
      params.userAddress,
      params.nowSeconds,
    );
    if (addressReserved + params.amount > this.maxReservedPerAddress) {
      const remainingAllowance =
        this.maxReservedPerAddress > addressReserved
          ? this.maxReservedPerAddress - addressReserved
          : 0n;
      return {
        success: false,
        reason: `Quote reservation limit exceeded for address (max ${this.maxReservedPerAddress})`,
        maxAmount:
          remainingAllowance < available ? remainingAllowance : available,
      };
    }

    // 3. Check per-IP reservation cap
    const ipReserved = this.getActiveReservationsForIp(
      params.userIp,
      params.nowSeconds,
    );
    if (ipReserved + params.amount > this.maxReservedPerIp) {
      const remainingAllowance =
        this.maxReservedPerIp > ipReserved
          ? this.maxReservedPerIp - ipReserved
          : 0n;
      return {
        success: false,
        reason: `Quote reservation limit exceeded for IP (max ${this.maxReservedPerIp})`,
        maxAmount:
          remainingAllowance < available ? remainingAllowance : available,
      };
    }

    // Record reservation
    const ttl = params.ttlSeconds ?? QUOTE_TTL_S;
    this.reservations.set(params.quoteId, {
      quoteId: params.quoteId,
      userAddress: params.userAddress,
      userIp: params.userIp,
      asset: params.asset,
      amount: params.amount,
      reservedUntil: params.nowSeconds + ttl,
    });

    return { success: true };
  }

  releaseReservation(quoteId: string): void {
    this.reservations.delete(quoteId);
  }

  /**
   * When user lock arrives on chain, reservation is released as it is now
   * tracked as in-flight exposure.
   */
  onUserLockSeen(quoteId: string): void {
    this.releaseReservation(quoteId);
  }
}
