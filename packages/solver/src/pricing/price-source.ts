export const PRICE_MAX_AGE_S = 30; // 30 seconds max staleness
export const DEFAULT_PEG_TOLERANCE_USD_MICROS = 20_000n; // 2% tolerance ($0.02)

export interface AssetPriceReading {
  usdPrice: bigint; // Price in USD micros (1,000,000 = $1.000000)
  source: string; // Source identifier (e.g. 'cauldron', 'paryon', 'chainlink-base-0.3%')
  asOf: number; // Unix timestamp in seconds
  heartbeatSeconds?: number | undefined; // Optional SLA heartbeat for feeds (e.g. Chainlink)
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

/**
 * Validates price freshness against PRICE_MAX_AGE_S or feed heartbeat plus margin.
 * Stale or future-dated readings throw PriceUnavailableError.
 */
export function assertFreshPrice(
  reading: AssetPriceReading,
  nowSeconds: number,
  defaultMaxAgeSeconds = PRICE_MAX_AGE_S,
): void {
  if (!reading || reading.usdPrice <= 0n) {
    throw new PriceUnavailableError(
      `Invalid price reading for source ${reading?.source ?? 'unknown'}`,
    );
  }
  // For Chainlink feeds, accept answer within heartbeat plus 5 minute margin
  const maxAllowedAge = reading.heartbeatSeconds
    ? reading.heartbeatSeconds + 300
    : defaultMaxAgeSeconds;

  const age = nowSeconds - reading.asOf;
  if (age < 0 || age > maxAllowedAge) {
    throw new PriceUnavailableError(
      `Price from ${reading.source} is stale (${age}s old, max allowed ${maxAllowedAge}s)`,
    );
  }
}

/**
 * Mock / fake price source for hermetic tests.
 */
export class MockPriceSource implements PriceSource {
  constructor(
    private readonly prices: Map<string, AssetPriceReading> = new Map(),
  ) {}

  setPrice(asset: string, reading: AssetPriceReading): void {
    this.prices.set(asset.toLowerCase(), reading);
  }

  async getPrice(asset: string): Promise<AssetPriceReading> {
    const reading = this.prices.get(asset.toLowerCase());
    if (!reading) {
      throw new PriceUnavailableError(`No price available for asset ${asset}`);
    }
    return reading;
  }
}
