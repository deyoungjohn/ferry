import {
  DEFAULT_HEARTBEAT_MARGIN_SECONDS,
  DEFAULT_PRICE_MAX_AGE_SECONDS,
  PriceUnavailableError,
  type AssetPriceReading,
  type PriceSource,
} from './types.js';

export interface HttpPricePayload {
  usdPrice: bigint;
  asOf: number;
  heartbeatSeconds?: number | undefined;
}

export type HttpPriceParser = (
  body: unknown,
  asset: string,
) => HttpPricePayload | Promise<HttpPricePayload>;

export interface HttpPriceSourceOptions {
  url: string;
  source: string;
  parse: HttpPriceParser;
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
  maxAgeSeconds?: number;
  timeoutMs?: number;
}

export class HttpPriceSource implements PriceSource {
  private readonly fetchImpl: typeof fetch;
  private readonly nowSeconds: () => number;
  private readonly maxAgeSeconds: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpPriceSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_PRICE_MAX_AGE_SECONDS;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getPrice(asset: string): Promise<AssetPriceReading> {
    const url = this.options.url.replaceAll(
      '{asset}',
      encodeURIComponent(asset),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as unknown;
      const payload = await this.options.parse(body, asset);
      if (payload.usdPrice <= 0n) {
        throw new PriceUnavailableError(
          `Invalid price from ${this.options.source}`,
        );
      }
      if (!Number.isSafeInteger(payload.asOf) || payload.asOf <= 0) {
        throw new PriceUnavailableError(
          `No valid timestamp from ${this.options.source}`,
        );
      }
      const maxAge = payload.heartbeatSeconds
        ? payload.heartbeatSeconds + DEFAULT_HEARTBEAT_MARGIN_SECONDS
        : this.maxAgeSeconds;
      const age = this.nowSeconds() - payload.asOf;
      if (age < 0 || age > maxAge) {
        throw new PriceUnavailableError(
          `Price from ${this.options.source} is stale (${age}s old, max ${maxAge}s)`,
        );
      }
      return {
        usdPrice: payload.usdPrice,
        source: this.options.source,
        asOf: payload.asOf,
        ...(payload.heartbeatSeconds !== undefined
          ? { heartbeatSeconds: payload.heartbeatSeconds }
          : {}),
      };
    } catch (error) {
      if (error instanceof PriceUnavailableError) throw error;
      throw new PriceUnavailableError(
        `${this.options.source} price unavailable`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
