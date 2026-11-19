import { parseAbi, type Address, type PublicClient } from 'viem';
import type {
  AssetSymbol,
  ChainConfig,
  ChainFactView,
  ChainId,
  PriceFeedFacts,
} from '@ferry/chain-config';
import {
  PriceUnavailableError,
  type AssetPriceReading,
  type PriceSource,
} from './price-source.js';

export const DEFAULT_HEARTBEAT_MARGIN_SECONDS = 300; // 5 minute margin

const chainlinkAggregatorAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

export interface ChainlinkRound {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

export interface ChainlinkReader {
  decimals(feed: Address): Promise<number>;
  latestRoundData(feed: Address): Promise<ChainlinkRound>;
}

export function viemChainlinkReader(client: PublicClient): ChainlinkReader {
  return {
    async decimals(feed: Address): Promise<number> {
      const result = await client.readContract({
        address: feed,
        abi: chainlinkAggregatorAbi,
        functionName: 'decimals',
      });
      return Number(result);
    },
    async latestRoundData(feed: Address): Promise<ChainlinkRound> {
      const result = await client.readContract({
        address: feed,
        abi: chainlinkAggregatorAbi,
        functionName: 'latestRoundData',
      });
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = result;
      return {
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
      };
    },
  };
}

export interface ChainlinkPriceSourceOptions {
  chain: ChainFactView;
  reader: ChainlinkReader;
  nowSeconds?: () => number;
  heartbeatMarginSeconds?: number;
}

function normalizeAsset(asset: string): AssetSymbol {
  const symbol = asset.toUpperCase();
  if (symbol === 'USDC' || symbol === 'USDT' || symbol === 'USDG')
    return symbol as AssetSymbol;
  throw new PriceUnavailableError(`Unsupported EVM stablecoin asset ${asset}`);
}

export class ChainlinkPriceSource implements PriceSource {
  private readonly nowSeconds: () => number;
  private readonly heartbeatMarginSeconds: number;

  constructor(private readonly options: ChainlinkPriceSourceOptions) {
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.heartbeatMarginSeconds =
      options.heartbeatMarginSeconds ?? DEFAULT_HEARTBEAT_MARGIN_SECONDS;
  }

  async getPrice(asset: string): Promise<AssetPriceReading> {
    const symbol = normalizeAsset(asset);
    const feed = this.options.chain.priceFeeds.find(
      (item) => item.asset === symbol,
    );
    if (!feed) {
      throw new PriceUnavailableError(
        `No Chainlink feed for ${symbol} on ${this.options.chain.id}`,
      );
    }

    const feedAddress = feed.address as Address;
    const decimals = await this.options.reader.decimals(feedAddress);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new PriceUnavailableError(
        `Invalid Chainlink decimals for ${feed.pair} on ${this.options.chain.id}`,
      );
    }
    if (decimals !== feed.decimals) {
      throw new PriceUnavailableError(
        `Chainlink decimals for ${feed.pair} on ${this.options.chain.id} changed from ${feed.decimals} to ${decimals}`,
      );
    }

    const round = await this.options.reader.latestRoundData(feedAddress);
    this.assertCompleteRound(round, feed);
    const asOf = Number(round.updatedAt);
    if (!Number.isSafeInteger(asOf) || asOf <= 0) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} has no timestamp`,
      );
    }

    const now = this.nowSeconds();
    const age = now - asOf;
    const maxAge = feed.heartbeatSeconds + this.heartbeatMarginSeconds;
    if (age < 0 || age > maxAge) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} is stale (${age}s old, max ${maxAge}s)`,
      );
    }

    const divisor = 10n ** BigInt(decimals);
    const usdPrice = (round.answer * 1_000_000n) / divisor;
    if (usdPrice <= 0n) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} has a non-positive price`,
      );
    }

    return {
      usdPrice,
      source: `chainlink:${this.options.chain.id}:${feed.pair.toLowerCase()}`,
      asOf,
      heartbeatSeconds: feed.heartbeatSeconds,
    };
  }

  private assertCompleteRound(
    round: ChainlinkRound,
    feed: PriceFeedFacts,
  ): void {
    if (round.roundId <= 0n) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} has no completed round`,
      );
    }
    if (round.answeredInRound < round.roundId) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} round is not complete`,
      );
    }
    if (round.answer <= 0n) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} answer is not positive`,
      );
    }
    if (round.updatedAt <= 0n) {
      throw new PriceUnavailableError(
        `Chainlink ${feed.pair} on ${this.options.chain.id} has no update time`,
      );
    }
  }
}

export function chainlinkSourceFromConfig(
  config: ChainConfig,
  chain: ChainId,
  client: PublicClient,
  options: {
    nowSeconds?: () => number;
    heartbeatMarginSeconds?: number;
  } = {},
): ChainlinkPriceSource {
  const chainFacts = config.facts.find((item) => item.id === chain);
  if (!chainFacts) {
    throw new PriceUnavailableError(`No chain config for ${chain}`);
  }
  return new ChainlinkPriceSource({
    chain: chainFacts,
    reader: viemChainlinkReader(client),
    ...options,
  });
}
