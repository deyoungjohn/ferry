import { z } from 'zod';
import {
  BchPriceUnavailableError,
  decimalUsdToMicros,
  fetchJsonWithTimeout,
  type AssetPriceReading,
  type FetchLike,
  type PriceSource,
} from './types.js';

export const DEFAULT_PARYON_STATS_URL = 'https://mainnet-v1.paryonusd.com';

export const ParyonStatsSchema = z.object({
  period: z.number().int().nonnegative().optional(),
  timeSnapshot: z.string().min(1),
  pusdUsdPrice: z.string().regex(/^\d+(?:\.\d+)?$/),
  bchUsdPrice: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .optional(),
  oracleBchUsdPrice: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .optional(),
  cauldronPusdLiquidity: z.string().optional(),
  cauldronBchLiquidity: z.string().optional(),
  cauldronPricePerToken: z.string().optional(),
});

export type ParyonStats = z.infer<typeof ParyonStatsSchema>;

export interface ParyonClientOptions {
  readonly url?: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly nowSeconds?: () => number;
}

export class ParyonStatsClient {
  private readonly url: string;
  private readonly fetchFn: FetchLike | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly nowSeconds: () => number;

  constructor(options: ParyonClientOptions = {}) {
    this.url = options.url ?? DEFAULT_PARYON_STATS_URL;
    this.fetchFn = options.fetch;
    this.timeoutMs = options.timeoutMs;
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async fetchStats(): Promise<ParyonStats> {
    const raw = await fetchJsonWithTimeout({
      url: this.url,
      ...(this.fetchFn !== undefined ? { fetchFn: this.fetchFn } : {}),
      ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
    });
    const parsed = ParyonStatsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BchPriceUnavailableError('Unexpected Paryon stats response');
    }
    return parsed.data;
  }

  async readPusdPrice(): Promise<AssetPriceReading> {
    const stats = await this.fetchStats();
    const parsedMs = Date.parse(stats.timeSnapshot);
    const asOf = Number.isFinite(parsedMs)
      ? Math.floor(parsedMs / 1000)
      : Math.floor(this.nowSeconds());
    return {
      usdPrice: decimalUsdToMicros(stats.pusdUsdPrice),
      source: 'paryon',
      asOf,
    };
  }
}

export function createParyonPriceSource(
  options: ParyonClientOptions = {},
): PriceSource {
  const client = new ParyonStatsClient(options);
  return {
    async getPrice(asset: string): Promise<AssetPriceReading> {
      if (asset.toUpperCase() !== 'PUSD') {
        throw new BchPriceUnavailableError(
          `ParyonPriceSource only supports PUSD, got ${asset}`,
        );
      }
      return client.readPusdPrice();
    },
  };
}
