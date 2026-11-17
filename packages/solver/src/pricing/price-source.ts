export const PRICE_MAX_AGE_S = 30; // 30 seconds max staleness
export const DEFAULT_PEG_TOLERANCE_USD_MICROS = 10_000n; // 1% tolerance ($0.01 = 10,000 micros)
export const DEFAULT_SOURCE_DISAGREEMENT_WARN_USD_MICROS = 10_000n; // 1% warning threshold
export const DEFAULT_SOURCE_DISAGREEMENT_REFUSE_USD_MICROS = 20_000n; // 2% refusal threshold
export const DEFAULT_PARYON_MAX_AGE_SECONDS = 7200; // 2 hours default max age for secondary Paryon stats
export const DEFAULT_CAULDRON_MAX_AGE_SECONDS = 300; // 5 minutes max age for primary Cauldron spot

export interface AssetPriceReading {
  usdPrice: bigint; // Price in USD micros (1,000,000 = $1.000000)
  source: string; // Source identifier (e.g. 'cauldron', 'paryon', 'chainlink-base-0.3%')
  asOf: number; // Unix timestamp in seconds
  heartbeatSeconds?: number | undefined; // Optional SLA heartbeat for feeds (e.g. Chainlink)
  role?: 'primary' | 'secondary' | undefined;
}

export interface SecondaryPriceReading {
  usdPrice: bigint;
  source: string;
  asOf: number;
  available: boolean;
  status: 'ok' | 'warn' | 'refuse' | 'unavailable';
  disagreementMicros?: bigint | undefined;
  disagreementPct?: string | undefined;
  refusalRule?: string | undefined;
  reason?: string | undefined;
}

export interface DetailedAssetPriceReading extends AssetPriceReading {
  primary: AssetPriceReading;
  secondary?: SecondaryPriceReading | undefined;
}

export interface PriceSource {
  getPrice(asset: string, chainId?: string): Promise<AssetPriceReading>;
  getDetailedPrice?(
    asset: string,
    chainId?: string,
  ): Promise<DetailedAssetPriceReading>;
}

export function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

export function formatUsdMicrosToDecimal(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
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
    private readonly secondaryPrices: Map<
      string,
      SecondaryPriceReading
    > = new Map(),
  ) {}

  setPrice(asset: string, reading: AssetPriceReading): void {
    this.prices.set(asset.toLowerCase(), reading);
  }

  setSecondaryPrice(asset: string, reading: SecondaryPriceReading): void {
    this.secondaryPrices.set(asset.toLowerCase(), reading);
  }

  async getPrice(asset: string): Promise<AssetPriceReading> {
    const reading = this.prices.get(asset.toLowerCase());
    if (!reading) {
      throw new PriceUnavailableError(`No price available for asset ${asset}`);
    }
    return reading;
  }

  async getDetailedPrice(asset: string): Promise<DetailedAssetPriceReading> {
    const primary = await this.getPrice(asset);
    const secondary = this.secondaryPrices.get(asset.toLowerCase());
    return {
      ...primary,
      primary,
      secondary,
      role: 'primary',
    };
  }
}
