export const USD_MICROS_SCALE = 1_000_000n;
export const SATS_PER_BCH = 100_000_000n;

/** Mainnet CashTokens category IDs (display order, 2 decimals). */
export const BCH_MAINNET_TOKEN_CATEGORIES = {
  PUSD: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
  MUSD: 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
} as const;

export const BCH_TOKEN_DECIMALS = {
  PUSD: 2,
  MUSD: 2,
} as const;

export type BchStableToken = keyof typeof BCH_MAINNET_TOKEN_CATEGORIES;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Matches @ferry/solver PriceSource reading shape. */
export interface AssetPriceReading {
  readonly usdPrice: bigint;
  readonly source: string;
  readonly asOf: number;
  readonly heartbeatSeconds?: number | undefined;
}

/** Matches @ferry/solver PriceSource port. */
export interface PriceSource {
  getPrice(asset: string): Promise<AssetPriceReading>;
}

/** Matches @ferry/web PriceReading shape. */
export interface BrowserPriceReading {
  readonly asset: string;
  readonly usdPrice: string;
  readonly source: string;
  readonly asOf: number;
}

/** Matches @ferry/web PriceReader port. */
export interface BrowserPriceReader {
  readPrice(asset: string): Promise<BrowserPriceReading>;
}

export class BchPriceUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'BchPriceUnavailableError';
  }
}

/**
 * Parse a positive decimal USD string (e.g. "0.99801856" or "205.755")
 * into rounded-down integer USD micros (1_000_000n = $1.000000).
 */
export function decimalUsdToMicros(decimal: string): bigint {
  const trimmed = decimal.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    throw new RangeError(`Invalid USD decimal string: ${decimal}`);
  }
  const whole = BigInt(match[1]!);
  const fracRaw = match[2] ?? '';
  const frac6 = fracRaw.slice(0, 6).padEnd(6, '0');
  const micros = whole * USD_MICROS_SCALE + BigInt(frac6);
  if (micros <= 0n) {
    throw new RangeError(`Expected positive USD price, got: ${decimal}`);
  }
  return micros;
}

/** Format integer USD micros as a 6-decimal USD string (e.g. 998018n -> "0.998018"). */
export function usdMicrosToDecimal(usdMicros: bigint): string {
  if (usdMicros < 0n) {
    throw new RangeError(`Expected non-negative usdMicros, got ${usdMicros}`);
  }
  const whole = usdMicros / USD_MICROS_SCALE;
  const frac = (usdMicros % USD_MICROS_SCALE).toString().padStart(6, '0');
  return `${whole.toString()}.${frac}`;
}

export async function fetchJsonWithTimeout(params: {
  url: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}): Promise<unknown> {
  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new TypeError('A fetch implementation is required');
  }
  const timeoutMs = params.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(params.url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    throw new BchPriceUnavailableError(`Failed to fetch ${params.url}`, error);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new BchPriceUnavailableError(
      `HTTP ${response.status} from ${params.url}`,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new BchPriceUnavailableError(
      `Invalid JSON from ${params.url}`,
      error,
    );
  }
}
