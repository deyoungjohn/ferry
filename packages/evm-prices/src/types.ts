export const DEFAULT_PRICE_MAX_AGE_SECONDS = 30;
export const DEFAULT_HEARTBEAT_MARGIN_SECONDS = 300;

export interface AssetPriceReading {
  usdPrice: bigint;
  source: string;
  asOf: number;
  heartbeatSeconds?: number | undefined;
}

export interface PriceSource {
  getPrice(asset: string): Promise<AssetPriceReading>;
}

export class PriceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceUnavailableError';
  }
}

export function assertFreshPrice(
  reading: AssetPriceReading,
  nowSeconds: number,
  defaultMaxAgeSeconds = DEFAULT_PRICE_MAX_AGE_SECONDS,
): void {
  if (reading.usdPrice <= 0n) {
    throw new PriceUnavailableError(
      `Invalid price reading for source ${reading.source}`,
    );
  }
  const maxAllowedAge = reading.heartbeatSeconds
    ? reading.heartbeatSeconds + DEFAULT_HEARTBEAT_MARGIN_SECONDS
    : defaultMaxAgeSeconds;
  const age = nowSeconds - reading.asOf;
  if (age < 0 || age > maxAllowedAge) {
    throw new PriceUnavailableError(
      `Price from ${reading.source} is stale (${age}s old, max allowed ${maxAllowedAge}s)`,
    );
  }
}
