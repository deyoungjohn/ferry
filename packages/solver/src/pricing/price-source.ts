export const PRICE_MAX_AGE_S = 30; // 30 seconds max staleness
export const DEFAULT_PEG_TOLERANCE_USD_MICROS = 20_000n; // 2% tolerance ($0.02)

export interface AssetPriceReading {
  usdPrice: bigint; // Price in USD micros (1,000,000 = $1.000000)
  source: string; // Source identifier (e.g. 'cauldron', 'paryon', 'chainlink')
  asOf: number; // Unix timestamp in seconds
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
 * Validates price freshness against PRICE_MAX_AGE_S.
 * Stale or future-dated readings throw PriceUnavailableError.
 */
export function assertFreshPrice(
  reading: AssetPriceReading,
  nowSeconds: number,
  maxAgeSeconds = PRICE_MAX_AGE_S,
): void {
  if (!reading || reading.usdPrice <= 0n) {
    throw new PriceUnavailableError(
      `Invalid price reading for source ${reading?.source ?? 'unknown'}`,
    );
  }
  const age = nowSeconds - reading.asOf;
  if (age < 0 || age > maxAgeSeconds) {
    throw new PriceUnavailableError(
      `Price from ${reading.source} is stale (${age}s old, max allowed ${maxAgeSeconds}s)`,
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
