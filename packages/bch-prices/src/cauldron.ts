import { z } from 'zod';
import {
  BCH_MAINNET_TOKEN_CATEGORIES,
  BCH_TOKEN_DECIMALS,
  BchPriceUnavailableError,
  SATS_PER_BCH,
  fetchJsonWithTimeout,
  usdMicrosToDecimal,
  type AssetPriceReading,
  type BchStableToken,
  type BrowserPriceReader,
  type BrowserPriceReading,
  type FetchLike,
  type PriceSource,
} from './types.js';

export const DEFAULT_CAULDRON_INDEXER_URL = 'https://indexer.cauldron.quest';

export interface CauldronPoolReserve {
  readonly sats: bigint;
  readonly tokens: bigint;
  readonly poolId?: string;
  readonly txid?: string;
  readonly txPos?: number;
}

export interface CauldronSpotResult {
  readonly usdPrice: bigint;
  readonly source: string;
  readonly asOf: number;
  readonly sats: bigint;
  readonly tokens: bigint;
  readonly poolCount: number;
  readonly bchPerTokenSats: bigint;
}

export interface ElectrumPoolUtxo {
  readonly tx_hash: string;
  readonly tx_pos: number;
  readonly value: number;
  readonly height?: number;
  readonly token_data?: {
    readonly category: string;
    readonly amount: string | number;
  };
}

/** Minimal Electrum quorum client interface matching BchQuorumClient. */
export interface ElectrumPriceClient {
  listUnspent(
    scriptHash: string,
    tokenFilter?: 'include_tokens' | 'tokens_only' | 'exclude_tokens',
  ): Promise<readonly ElectrumPoolUtxo[]>;
}

const CauldronActivePoolsSchema = z.object({
  active: z.array(
    z.object({
      pool_id: z.string(),
      txid: z.string(),
      tx_pos: z.number().int().nonnegative(),
      sats: z.union([
        z.number().int().nonnegative(),
        z.string().regex(/^\d+$/),
      ]),
      tokens: z.union([
        z.number().int().nonnegative(),
        z.string().regex(/^\d+$/),
      ]),
      token_id: z.string(),
    }),
  ),
});

/**
 * Pure reserve-to-price conversion using integer BigInt math:
 * - bchPerTokenSats = (sats * 10^tokenDecimals) / tokens
 * - usdPriceMicros  = (sats * bchUsdMicros * 10^tokenDecimals) / (tokens * 10^8)
 */
export function computeCauldronSpotFromReserves(params: {
  readonly sats: bigint;
  readonly tokens: bigint;
  readonly tokenDecimals: number;
  readonly bchUsdMicros: bigint;
}): { readonly bchPerTokenSats: bigint; readonly usdPriceMicros: bigint } {
  if (params.sats <= 0n || params.tokens <= 0n) {
    throw new BchPriceUnavailableError(
      'Cauldron pool reserves must be positive',
    );
  }
  if (params.bchUsdMicros <= 0n) {
    throw new BchPriceUnavailableError('BCH/USD price must be positive');
  }
  if (
    !Number.isInteger(params.tokenDecimals) ||
    params.tokenDecimals < 0 ||
    params.tokenDecimals > 18
  ) {
    throw new RangeError(
      `Invalid tokenDecimals: ${String(params.tokenDecimals)}`,
    );
  }

  const tokenScale = 10n ** BigInt(params.tokenDecimals);
  const bchPerTokenSats = (params.sats * tokenScale) / params.tokens;
  const usdPriceMicros =
    (params.sats * params.bchUsdMicros * tokenScale) /
    (params.tokens * SATS_PER_BCH);

  if (usdPriceMicros <= 0n) {
    throw new BchPriceUnavailableError(
      'Computed Cauldron USD price rounded to zero',
    );
  }

  return { bchPerTokenSats, usdPriceMicros };
}

export function aggregateCauldronPools(pools: readonly CauldronPoolReserve[]): {
  readonly sats: bigint;
  readonly tokens: bigint;
  readonly poolCount: number;
} {
  let sats = 0n;
  let tokens = 0n;
  let poolCount = 0;

  for (const pool of pools) {
    if (pool.sats > 0n && pool.tokens > 0n) {
      sats += pool.sats;
      tokens += pool.tokens;
      poolCount += 1;
    }
  }

  if (poolCount === 0 || sats <= 0n || tokens <= 0n) {
    throw new BchPriceUnavailableError(
      'No active Cauldron pools with reserves',
    );
  }

  return { sats, tokens, poolCount };
}

export async function fetchCauldronActivePools(
  tokenCategory: string,
  options: {
    readonly baseUrl?: string;
    readonly fetch?: FetchLike;
    readonly timeoutMs?: number;
  } = {},
): Promise<readonly CauldronPoolReserve[]> {
  const baseUrl = (options.baseUrl ?? DEFAULT_CAULDRON_INDEXER_URL).replace(
    /\/+$/,
    '',
  );
  const url = `${baseUrl}/cauldron/pool/active?token=${encodeURIComponent(tokenCategory.toLowerCase())}`;
  const raw = await fetchJsonWithTimeout({
    url,
    ...(options.fetch !== undefined ? { fetchFn: options.fetch } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  const parsed = CauldronActivePoolsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BchPriceUnavailableError(
      'Unexpected Cauldron indexer active-pools response',
    );
  }
  return parsed.data.active
    .filter((p) => BigInt(p.sats) > 0n && BigInt(p.tokens) > 0n)
    .map((p) => ({
      sats: BigInt(p.sats),
      tokens: BigInt(p.tokens),
      poolId: p.pool_id,
      txid: p.txid,
      txPos: p.tx_pos,
    }));
}

export interface ReadCauldronSpotOptions {
  readonly scriptHashes: readonly string[];
  readonly tokenCategory: string;
  readonly tokenDecimals?: number;
  readonly bchUsdMicros: bigint;
  readonly nowSeconds?: () => number;
  readonly sourceLabel?: string;
}

/**
 * Trust-minimized on-chain Cauldron spot reader using an Electrum / BchQuorumClient.
 * Queries pool script hashes directly via `listUnspent(scriptHash, 'tokens_only')`.
 */
export async function readCauldronSpot(
  electrumClient: ElectrumPriceClient,
  options: ReadCauldronSpotOptions,
): Promise<CauldronSpotResult> {
  if (options.scriptHashes.length === 0) {
    throw new BchPriceUnavailableError(
      'At least one Cauldron pool scriptHash is required',
    );
  }

  const targetCategory = options.tokenCategory.toLowerCase();
  const utxoLists = await Promise.all(
    options.scriptHashes.map((sh) =>
      electrumClient.listUnspent(sh, 'tokens_only'),
    ),
  );

  const reserves: CauldronPoolReserve[] = [];
  for (const utxos of utxoLists) {
    for (const utxo of utxos) {
      if (
        utxo.token_data !== undefined &&
        utxo.token_data.category.toLowerCase() === targetCategory &&
        utxo.value > 0
      ) {
        const tokens = BigInt(utxo.token_data.amount);
        const sats = BigInt(utxo.value);
        if (sats > 0n && tokens > 0n) {
          reserves.push({
            sats,
            tokens,
            txid: utxo.tx_hash,
            txPos: utxo.tx_pos,
          });
        }
      }
    }
  }

  const agg = aggregateCauldronPools(reserves);
  const tokenDecimals = options.tokenDecimals ?? 2;
  const spot = computeCauldronSpotFromReserves({
    sats: agg.sats,
    tokens: agg.tokens,
    tokenDecimals,
    bchUsdMicros: options.bchUsdMicros,
  });
  const asOf = Math.floor((options.nowSeconds ?? (() => Date.now() / 1000))());

  return {
    usdPrice: spot.usdPriceMicros,
    source: options.sourceLabel ?? 'cauldron',
    asOf,
    sats: agg.sats,
    tokens: agg.tokens,
    poolCount: agg.poolCount,
    bchPerTokenSats: spot.bchPerTokenSats,
  };
}

export interface CauldronSpotReaderOptions {
  readonly bchUsdSource: PriceSource;
  readonly tokenCategories?: Readonly<Partial<Record<BchStableToken, string>>>;
  readonly tokenDecimals?: Readonly<Partial<Record<BchStableToken, number>>>;
  readonly indexerUrl?: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly nowSeconds?: () => number;
  readonly sourceLabel?: string;
}

export class CauldronSpotReader {
  private readonly bchUsdSource: PriceSource;
  private readonly categories: Readonly<Record<BchStableToken, string>>;
  private readonly decimals: Readonly<Record<BchStableToken, number>>;
  private readonly indexerUrl: string | undefined;
  private readonly fetchFn: FetchLike | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly nowSeconds: () => number;
  private readonly sourceLabel: string;

  constructor(options: CauldronSpotReaderOptions) {
    this.bchUsdSource = options.bchUsdSource;
    this.categories = {
      PUSD: options.tokenCategories?.PUSD ?? BCH_MAINNET_TOKEN_CATEGORIES.PUSD,
      MUSD: options.tokenCategories?.MUSD ?? BCH_MAINNET_TOKEN_CATEGORIES.MUSD,
    };
    this.decimals = {
      PUSD: options.tokenDecimals?.PUSD ?? BCH_TOKEN_DECIMALS.PUSD,
      MUSD: options.tokenDecimals?.MUSD ?? BCH_TOKEN_DECIMALS.MUSD,
    };
    this.indexerUrl = options.indexerUrl;
    this.fetchFn = options.fetch;
    this.timeoutMs = options.timeoutMs;
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.sourceLabel = options.sourceLabel ?? 'cauldron';
  }

  async readSpot(token: BchStableToken): Promise<CauldronSpotResult> {
    const category = this.categories[token];
    const [pools, bchReading] = await Promise.all([
      fetchCauldronActivePools(category, {
        ...(this.indexerUrl !== undefined ? { baseUrl: this.indexerUrl } : {}),
        ...(this.fetchFn !== undefined ? { fetch: this.fetchFn } : {}),
        ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
      }),
      this.bchUsdSource.getPrice('BCH'),
    ]);

    const agg = aggregateCauldronPools(pools);
    const spot = computeCauldronSpotFromReserves({
      sats: agg.sats,
      tokens: agg.tokens,
      tokenDecimals: this.decimals[token],
      bchUsdMicros: bchReading.usdPrice,
    });

    return {
      usdPrice: spot.usdPriceMicros,
      source: this.sourceLabel,
      asOf: Math.min(Math.floor(this.nowSeconds()), bchReading.asOf),
      sats: agg.sats,
      tokens: agg.tokens,
      poolCount: agg.poolCount,
      bchPerTokenSats: spot.bchPerTokenSats,
    };
  }
}

export function createCauldronPriceSource(
  options: CauldronSpotReaderOptions,
): PriceSource {
  const reader = new CauldronSpotReader(options);
  return {
    async getPrice(asset: string): Promise<AssetPriceReading> {
      const upper = asset.toUpperCase();
      if (upper !== 'PUSD' && upper !== 'MUSD') {
        throw new BchPriceUnavailableError(
          `CauldronPriceSource only supports PUSD and MUSD, got ${asset}`,
        );
      }
      const spot = await reader.readSpot(upper);
      return {
        usdPrice: spot.usdPrice,
        source: spot.source,
        asOf: spot.asOf,
      };
    },
  };
}

export function createCauldronBrowserPriceReader(
  options: CauldronSpotReaderOptions,
): BrowserPriceReader {
  const source = createCauldronPriceSource(options);
  return {
    async readPrice(asset: string): Promise<BrowserPriceReading> {
      const reading = await source.getPrice(asset);
      return {
        asset: asset.toUpperCase(),
        usdPrice: usdMicrosToDecimal(reading.usdPrice),
        source: reading.source,
        asOf: reading.asOf,
      };
    },
  };
}
