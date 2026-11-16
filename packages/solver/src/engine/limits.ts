export interface ActiveOrderExposureInput {
  status: string;
  amountUsdMicros: bigint;
}

/**
 * Calculates total solver open exposure in USD micros.
 *
 * Invariant: Unfunded quotes (status === 'QUOTED') do NOT count toward exposure
 * until the user's lock has been seen on chain. Terminal orders also do not count.
 */
export function calculateOpenExposureUsdMicros(
  orders: ReadonlyArray<ActiveOrderExposureInput>,
): bigint {
  let total = 0n;
  for (const order of orders) {
    if (
      order.status === 'QUOTED' ||
      order.status === 'DONE' ||
      order.status === 'EXPIRED' ||
      order.status === 'REJECTED' ||
      order.status === 'SOLVER_REFUNDED'
    ) {
      continue;
    }
    total += order.amountUsdMicros;
  }
  return total;
}

export function isExposureWithinCap(
  currentExposureUsdMicros: bigint,
  additionalAmountUsdMicros: bigint,
  maxExposureUsdMicros: bigint,
): boolean {
  return (
    currentExposureUsdMicros + additionalAmountUsdMicros <= maxExposureUsdMicros
  );
}

export function isInventoryAboveFloor(
  currentBalance: bigint,
  amountToLock: bigint,
  inventoryFloor: bigint,
): boolean {
  if (currentBalance < amountToLock) return false;
  return currentBalance - amountToLock >= inventoryFloor;
}

export interface UnfundedQuoteInput {
  userAddress: string;
  status: string;
  quoteExpiry: number;
}

export function countUnfundedQuotesByAddress(
  quotes: ReadonlyArray<UnfundedQuoteInput>,
  userAddress: string,
  nowSeconds: number,
): number {
  const normAddress = userAddress.toLowerCase();
  let count = 0;
  for (const q of quotes) {
    if (
      q.status === 'QUOTED' &&
      q.quoteExpiry > nowSeconds &&
      q.userAddress.toLowerCase() === normAddress
    ) {
      count++;
    }
  }
  return count;
}

export function countGlobalUnfundedQuotes(
  quotes: ReadonlyArray<UnfundedQuoteInput>,
  nowSeconds: number,
): number {
  let count = 0;
  for (const q of quotes) {
    if (q.status === 'QUOTED' && q.quoteExpiry > nowSeconds) {
      count++;
    }
  }
  return count;
}

export function isUnfundedQuoteAllowed(
  addressUnfundedCount: number,
  globalUnfundedCount: number,
  caps: { maxPerAddress: number; maxGlobal: number },
): boolean {
  return (
    addressUnfundedCount < caps.maxPerAddress &&
    globalUnfundedCount < caps.maxGlobal
  );
}
