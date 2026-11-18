import { availableLiquidity } from '@ferry/core';

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
  amountMicros?: bigint | undefined;
  reservedUntil: number; // Unix timestamp in seconds
}

export interface RouteLiquidityData {
  route: string;
  asset: string;
  decimals: number;
  available: string;
  inventory: string;
  exposure: string;
  reserved: string;
}

export interface InventoryAssetView {
  chain: string;
  symbol: string;
  balance: string;
  reserved: string;
  exposure: string;
  available: string;
}

export interface InventoryView {
  assets: InventoryAssetView[];
  skewBps: number;
  skewMaxBps: number;
  timestamp: number;
}

/**
 * Calculates inventory skew in basis points according to blueprint §21.1.
 * When PUSD is low (bchUsdMicros < evmUsdMicros), skew is positive:
 * this widens the spread on forward swaps and narrows it on reverse swaps.
 * Capped at ±skewMaxBps.
 */
export function calculateSkewBps(
  bchUsdMicros: bigint,
  evmUsdMicros: bigint,
  skewMaxBps: number = 50,
): number {
  const total = bchUsdMicros + evmUsdMicros;
  if (total === 0n) return 0;
  const ratio = Number(evmUsdMicros - bchUsdMicros) / Number(total);
  const rawSkew = Math.round(ratio * skewMaxBps);
  return Math.max(-skewMaxBps, Math.min(skewMaxBps, rawSkew));
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
        total += res.amountMicros ?? res.amount;
      }
    }
    return total;
  }

  getActiveReservationsForIp(userIp: string, nowSeconds: number): bigint {
    let total = 0n;
    for (const res of this.reservations.values()) {
      if (res.reservedUntil > nowSeconds && res.userIp === userIp) {
        total += res.amountMicros ?? res.amount;
      }
    }
    return total;
  }

  getAvailableLiquidity(
    asset: string,
    currentInventory: bigint,
    openExposure: bigint,
    nowSeconds: number,
    inventoryFloor: bigint = 0n,
  ): bigint {
    this.pruneExpired(nowSeconds);
    const active = this.getActiveReservationsForAsset(asset, nowSeconds);
    return availableLiquidity(
      currentInventory,
      openExposure,
      active,
      inventoryFloor,
    );
  }

  getLiquidityData(
    asset: string,
    inventory: bigint,
    openExposure: bigint,
    decimals: number,
    nowSeconds: number,
    route: string = `${asset.toLowerCase()}-route`,
  ): RouteLiquidityData {
    const available = this.getAvailableLiquidity(
      asset,
      inventory,
      openExposure,
      nowSeconds,
    );
    const reserved = this.getActiveReservationsForAsset(asset, nowSeconds);

    return {
      route,
      asset,
      decimals,
      available: available.toString(),
      inventory: inventory.toString(),
      exposure: openExposure.toString(),
      reserved: reserved.toString(),
    };
  }

  /**
   * Calculates inventory skew in basis points according to blueprint §21.1.
   * When PUSD is low (bchUsdMicros < evmUsdMicros), skew is positive:
   * this widens the spread on forward swaps and narrows it on reverse swaps.
   * Capped at ±skewMaxBps.
   */
  calculateSkewBps(
    bchUsdMicros: bigint,
    evmUsdMicros: bigint,
    skewMaxBps: number = 50,
  ): number {
    const total = bchUsdMicros + evmUsdMicros;
    if (total === 0n) return 0;
    const ratio = Number(evmUsdMicros - bchUsdMicros) / Number(total);
    const rawSkew = Math.round(ratio * skewMaxBps);
    return Math.max(-skewMaxBps, Math.min(skewMaxBps, rawSkew));
  }

  getInventoryView(params: {
    bchInventory: bigint;
    bchExposure: bigint;
    evmInventory: bigint;
    evmExposure: bigint;
    skewMaxBps: number;
    nowSeconds: number;
    assets?: InventoryAssetView[] | undefined;
    bchUsdMicros?: bigint | undefined;
    evmUsdMicros?: bigint | undefined;
  }): InventoryView {
    const bchReserved = this.getActiveReservationsForAsset(
      'PUSD',
      params.nowSeconds,
    );
    const evmReserved = this.getActiveReservationsForAsset(
      'USDC',
      params.nowSeconds,
    );

    const bchAvailable = this.getAvailableLiquidity(
      'PUSD',
      params.bchInventory,
      params.bchExposure,
      params.nowSeconds,
    );
    const evmAvailable = this.getAvailableLiquidity(
      'USDC',
      params.evmInventory,
      params.evmExposure,
      params.nowSeconds,
    );

    // Convert PUSD (2 decimals) to USD micros (x10,000)
    const bchUsdMicros = params.bchUsdMicros ?? params.bchInventory * 10_000n;
    // EVM USDC is already 6 decimals (USD micros)
    const evmUsdMicros = params.evmUsdMicros ?? params.evmInventory;

    const skewBps = this.calculateSkewBps(
      bchUsdMicros,
      evmUsdMicros,
      params.skewMaxBps,
    );

    const assets = params.assets ?? [
      {
        chain: 'bch',
        symbol: 'PUSD',
        balance: params.bchInventory.toString(),
        reserved: bchReserved.toString(),
        exposure: params.bchExposure.toString(),
        available: bchAvailable.toString(),
      },
      {
        chain: 'base',
        symbol: 'USDC',
        balance: params.evmInventory.toString(),
        reserved: evmReserved.toString(),
        exposure: params.evmExposure.toString(),
        available: evmAvailable.toString(),
      },
    ];

    return {
      assets,
      skewBps,
      skewMaxBps: params.skewMaxBps,
      timestamp: params.nowSeconds,
    };
  }

  reserveQuote(params: {
    quoteId: string;
    userAddress: string;
    userIp: string;
    asset: string;
    amount: bigint;
    amountMicros?: bigint | undefined;
    currentInventory: bigint;
    openExposure: bigint;
    nowSeconds: number;
    ttlSeconds?: number;
    dryRun?: boolean | undefined;
  }):
    | { success: true }
    | {
        success: false;
        reason: string;
        /** In token base units when `maxAmountUnit` is 'token', in USD micros when it is 'usdMicros'. */
        maxAmount: bigint;
        maxAmountUnit: 'token' | 'usdMicros';
      } {
    const {
      quoteId,
      userAddress,
      userIp,
      asset,
      amount,
      amountMicros,
      currentInventory,
      openExposure,
      nowSeconds,
      ttlSeconds = QUOTE_TTL_S,
      dryRun = false,
    } = params;

    this.pruneExpired(nowSeconds);

    // A new quote from the same address for the same asset replaces the earlier one: a person
    // retyping an amount must not fill their own limit with quotes they have abandoned.
    const normAddress = userAddress.toLowerCase();
    const normAsset = asset.toLowerCase();
    const superseded = [...this.reservations.values()].filter(
      (res) =>
        res.quoteId !== quoteId &&
        res.userAddress.toLowerCase() === normAddress &&
        res.asset.toLowerCase() === normAsset,
    );
    const sumOf = (items: typeof superseded, field: 'amount' | 'micros') =>
      items.reduce(
        (total, res) =>
          total +
          (field === 'amount' ? res.amount : (res.amountMicros ?? res.amount)),
        0n,
      );

    const available =
      this.getAvailableLiquidity(
        asset,
        currentInventory,
        openExposure,
        nowSeconds,
      ) + sumOf(superseded, 'amount');

    if (amount > available) {
      return {
        success: false,
        reason: `Insufficient liquidity: requested ${amount}, available ${available}`,
        maxAmount: available,
        maxAmountUnit: 'token',
      };
    }

    const effectiveMicros = amountMicros ?? amount;
    const addrReserved =
      this.getActiveReservationsForAddress(userAddress, nowSeconds) -
      sumOf(superseded, 'micros');
    if (addrReserved + effectiveMicros > this.maxReservedPerAddress) {
      return {
        success: false,
        reason: `Address active reservation cap exceeded: active reservations $${(Number(addrReserved) / 1e6).toFixed(2)} + requested $${(Number(effectiveMicros) / 1e6).toFixed(2)} exceeds cap of $${(Number(this.maxReservedPerAddress) / 1e6).toFixed(2)}`,
        maxAmount:
          this.maxReservedPerAddress > addrReserved
            ? this.maxReservedPerAddress - addrReserved
            : 0n,
        maxAmountUnit: 'usdMicros',
      };
    }

    const ipReserved =
      this.getActiveReservationsForIp(userIp, nowSeconds) -
      sumOf(
        superseded.filter((res) => res.userIp === userIp),
        'micros',
      );
    if (ipReserved + effectiveMicros > this.maxReservedPerIp) {
      return {
        success: false,
        reason: `IP active reservation cap exceeded: active reservations $${(Number(ipReserved) / 1e6).toFixed(2)} + requested $${(Number(effectiveMicros) / 1e6).toFixed(2)} exceeds cap of $${(Number(this.maxReservedPerIp) / 1e6).toFixed(2)}`,
        maxAmount:
          this.maxReservedPerIp > ipReserved
            ? this.maxReservedPerIp - ipReserved
            : 0n,
        maxAmountUnit: 'usdMicros',
      };
    }

    if (dryRun) {
      return { success: true };
    }

    for (const res of superseded) this.reservations.delete(res.quoteId);

    this.reservations.set(quoteId, {
      quoteId,
      userAddress,
      userIp,
      asset,
      amount,
      amountMicros: effectiveMicros,
      reservedUntil: nowSeconds + ttlSeconds,
    });

    return { success: true };
  }

  releaseReservation(quoteId: string): boolean {
    return this.reservations.delete(quoteId);
  }

  onUserLockSeen(quoteId: string): void {
    this.releaseReservation(quoteId);
  }

  getActiveReservationCount(nowSeconds: number): number {
    this.pruneExpired(nowSeconds);
    return this.reservations.size;
  }
}
