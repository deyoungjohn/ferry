export interface LiquidityReservation {
  id: string;
  address: string;
  amount: bigint;
  expiresAt: number;
}

export interface ReservationLedgerPolicy {
  ttlSeconds: number;
  maxReservedPerAddress: bigint;
}

export type ReserveLiquidityResult =
  | {
      ok: true;
      ledger: LiquidityReservation[];
      reservation: LiquidityReservation;
    }
  | {
      ok: false;
      reason: 'INSUFFICIENT_LIQUIDITY' | 'ADDRESS_CAP_EXCEEDED';
      available: bigint;
      addressRemaining: bigint;
    };

function assertNonNegativeBigInt(value: bigint, name: string): void {
  if (value < 0n) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function assertPositiveSeconds(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer in seconds`);
  }
}

export function pruneExpiredReservations(
  ledger: readonly LiquidityReservation[],
  nowSeconds: number,
): LiquidityReservation[] {
  assertPositiveSeconds(nowSeconds, 'nowSeconds');
  return ledger.filter((entry) => entry.expiresAt > nowSeconds);
}

export function reservedByAddress(
  ledger: readonly LiquidityReservation[],
  address: string,
  nowSeconds: number,
): bigint {
  const normalized = address.toLowerCase();
  let total = 0n;
  for (const entry of pruneExpiredReservations(ledger, nowSeconds)) {
    if (entry.address.toLowerCase() === normalized) {
      assertNonNegativeBigInt(entry.amount, 'reservation.amount');
      total += entry.amount;
    }
  }
  return total;
}

export function availableLiquidity(
  inventory: bigint,
  exposure: bigint,
  reservations: bigint | readonly LiquidityReservation[],
  floor = 0n,
  nowSeconds?: number,
): bigint {
  assertNonNegativeBigInt(inventory, 'inventory');
  assertNonNegativeBigInt(exposure, 'exposure');
  assertNonNegativeBigInt(floor, 'floor');

  let reservedTotal = 0n;
  if (typeof reservations === 'bigint') {
    assertNonNegativeBigInt(reservations, 'reservations');
    reservedTotal = reservations;
  } else {
    const active =
      nowSeconds !== undefined
        ? pruneExpiredReservations(reservations, nowSeconds)
        : reservations;
    for (const entry of active) {
      assertNonNegativeBigInt(entry.amount, 'reservation.amount');
      reservedTotal += entry.amount;
    }
  }

  const committed = exposure + reservedTotal + floor;
  return inventory > committed ? inventory - committed : 0n;
}

export function tryReserveLiquidity(
  ledger: readonly LiquidityReservation[],
  request: { id: string; address: string; amount: bigint },
  inventory: bigint,
  exposure: bigint,
  floor: bigint,
  policy: ReservationLedgerPolicy,
  nowSeconds: number,
): ReserveLiquidityResult {
  assertNonNegativeBigInt(request.amount, 'request.amount');
  if (request.amount === 0n) {
    throw new RangeError('request.amount must be positive');
  }
  assertPositiveSeconds(policy.ttlSeconds, 'policy.ttlSeconds');
  assertNonNegativeBigInt(
    policy.maxReservedPerAddress,
    'policy.maxReservedPerAddress',
  );

  const active = pruneExpiredReservations(ledger, nowSeconds);
  const available = availableLiquidity(inventory, exposure, active, floor);
  const currentForAddress = reservedByAddress(
    active,
    request.address,
    nowSeconds,
  );
  const addressRemaining =
    policy.maxReservedPerAddress > currentForAddress
      ? policy.maxReservedPerAddress - currentForAddress
      : 0n;

  if (request.amount > available) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_LIQUIDITY',
      available,
      addressRemaining,
    };
  }

  if (request.amount > addressRemaining) {
    return {
      ok: false,
      reason: 'ADDRESS_CAP_EXCEEDED',
      available,
      addressRemaining,
    };
  }

  const reservation: LiquidityReservation = {
    id: request.id,
    address: request.address.toLowerCase(),
    amount: request.amount,
    expiresAt: nowSeconds + policy.ttlSeconds,
  };

  return {
    ok: true,
    ledger: [...active, reservation],
    reservation,
  };
}
