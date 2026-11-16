import { describe, expect, it } from 'vitest';
import { loadChainConfig } from '@ferry/chain-config';
import {
  ChainlinkPriceSource,
  PriceUnavailableError,
  type ChainlinkReader,
  type ChainlinkRound,
} from '../src/index.js';

const NOW = 1_800_000_000;
const chain = loadChainConfig({ env: {} }).facts.find(
  (item) => item.id === 'base',
)!;

function reader(round: ChainlinkRound, decimals = 8): ChainlinkReader {
  return {
    async decimals() {
      return decimals;
    },
    async latestRoundData() {
      return round;
    },
  };
}

function round(overrides: Partial<ChainlinkRound> = {}): ChainlinkRound {
  return {
    roundId: 1n,
    answer: 99_976_000n,
    startedAt: BigInt(NOW - 120),
    updatedAt: BigInt(NOW - 60),
    answeredInRound: 1n,
    ...overrides,
  };
}

function source(
  roundValue: ChainlinkRound,
  decimals = 8,
): ChainlinkPriceSource {
  return new ChainlinkPriceSource({
    chain,
    reader: reader(roundValue, decimals),
    nowSeconds: () => NOW,
  });
}

describe('ChainlinkPriceSource', () => {
  it('returns the solver-shaped reading with USD micros', async () => {
    await expect(source(round()).getPrice('USDC')).resolves.toEqual({
      usdPrice: 999_760n,
      source: 'chainlink:base:usdc/usd',
      asOf: NOW - 60,
      heartbeatSeconds: 86_400,
    });
  });

  it('handles fewer than six decimals', async () => {
    const chain6 = structuredClone(chain);
    chain6.priceFeeds[0]!.decimals = 6;
    const source6 = new ChainlinkPriceSource({
      chain: chain6,
      reader: reader(round({ answer: 999_760n }), 6),
      nowSeconds: () => NOW,
    });
    await expect(source6.getPrice('USDC')).resolves.toMatchObject({
      usdPrice: 999_760n,
    });
  });

  it('rejects a stale round beyond heartbeat plus margin', async () => {
    await expect(
      source(round({ updatedAt: BigInt(NOW - 86_400 - 301) })).getPrice('USDC'),
    ).rejects.toThrow(/stale/);
  });

  it('rejects a future-dated round', async () => {
    await expect(
      source(round({ updatedAt: BigInt(NOW + 1) })).getPrice('USDC'),
    ).rejects.toThrow(/stale/);
  });

  it('rejects a non-positive answer', async () => {
    await expect(
      source(round({ answer: -1n })).getPrice('USDC'),
    ).rejects.toThrow(/not positive/);
  });

  it('rejects an incomplete round', async () => {
    await expect(
      source(round({ answeredInRound: 0n })).getPrice('USDC'),
    ).rejects.toThrow(/not complete/);
  });

  it('rejects a zero round id', async () => {
    await expect(
      source(round({ roundId: 0n })).getPrice('USDC'),
    ).rejects.toThrow(/no completed round/);
  });

  it('rejects a feed whose decimals changed', async () => {
    await expect(source(round(), 6).getPrice('USDC')).rejects.toThrow(
      /decimals/,
    );
  });

  it('rejects an asset with no feed', async () => {
    await expect(source(round()).getPrice('USDT')).rejects.toThrow(
      PriceUnavailableError,
    );
  });

  it('rejects an unsupported asset', async () => {
    await expect(source(round()).getPrice('DAI')).rejects.toThrow(
      /Unsupported/,
    );
  });
});
