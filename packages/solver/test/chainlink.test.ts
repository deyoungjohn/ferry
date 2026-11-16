import { describe, expect, it } from 'vitest';
import {
  ChainlinkPriceSource,
  type ChainlinkReader,
  type ChainlinkRound,
} from '../src/pricing/chainlink.js';
import { PriceUnavailableError } from '../src/pricing/price-source.js';
import type { ChainFactView } from '@ferry/chain-config';

describe('ChainlinkPriceSource', () => {
  const dummyChain: ChainFactView = {
    id: 'base',
    name: 'Base',
    network: 'testnet',
    chainId: 84532,
    rpcUrls: ['https://sepolia.base.org'],
    rpcEndpoints: [
      {
        url: 'https://sepolia.base.org',
        host: 'sepolia.base.org',
        source: 'public',
        maxLogRange: 50000,
      },
    ],
    explorerUrl: 'https://sepolia.basescan.org',
    activityLog: {
      minRange: 1000,
      available: true,
      endpoints: [],
    },
    nativeGas: 'ETH',
    finality: { fast: 1, safe: 'finalized', status: 'verified' },
    create2Factory: {
      address: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
      hasCode: true,
    },
    htlcAddress: '0x8b968625F983420B571C102eC0b57F7e509c916e',
    relayCostUsd: 0.05,
    deployment: {
      htlcAddress: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      deployBlock: 123456,
      relayCostUsd: 0.05,
      predictedHtlcAddress: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      status: 'verified',
    },
    assets: [
      {
        symbol: 'USDC',
        decimals: 6,
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        name: 'USD Coin',
        version: '2',
        domainSeparator: null,
        permit: true,
        nonces: true,
        issuer: 'Circle',
        nativeOrBridged: 'native',
        verified: true,
        notes: null,
      },
    ],
    priceFeeds: [
      {
        asset: 'USDC',
        pair: 'USDC/USD',
        source: 'Chainlink',
        address: '0xd30e2101a97dcbBcBC6A60447A977e208b088A58',
        decimals: 8,
        deviationThresholdPercent: 0.25,
        heartbeatSeconds: 86400,
        sampleAnswer: '100000000',
        sampleUpdatedAt: 1700000000,
        sampleReadAt: '2026-11-16',
        evidence: {
          status: 'verified',
          source: 'Chainlink registry',
          date: '2026-11-16',
        },
      },
    ],
    notes: null,
  };

  it('reads price and scales to USD micros', async () => {
    const now = 1700001000;
    const fakeReader: ChainlinkReader = {
      decimals: async () => 8,
      latestRoundData: async (): Promise<ChainlinkRound> => ({
        roundId: 100n,
        answer: 100020000n, // $1.00020000 (8 decimals)
        startedAt: BigInt(now - 60),
        updatedAt: BigInt(now - 60),
        answeredInRound: 100n,
      }),
    };

    const source = new ChainlinkPriceSource({
      chain: dummyChain,
      reader: fakeReader,
      nowSeconds: () => now,
    });

    const reading = await source.getPrice('USDC');
    expect(reading.usdPrice).toBe(1_000_200n);
    expect(reading.source).toBe('chainlink:base:usdc/usd');
    expect(reading.asOf).toBe(now - 60);
    expect(reading.heartbeatSeconds).toBe(86400);
  });

  it('refuses stale price reading outside heartbeat + margin', async () => {
    const now = 1700000000;
    const staleTime = now - (86400 + 301); // 1 second beyond 5-minute margin
    const fakeReader: ChainlinkReader = {
      decimals: async () => 8,
      latestRoundData: async (): Promise<ChainlinkRound> => ({
        roundId: 100n,
        answer: 100000000n,
        startedAt: BigInt(staleTime),
        updatedAt: BigInt(staleTime),
        answeredInRound: 100n,
      }),
    };

    const source = new ChainlinkPriceSource({
      chain: dummyChain,
      reader: fakeReader,
      nowSeconds: () => now,
    });

    await expect(source.getPrice('USDC')).rejects.toThrow(
      PriceUnavailableError,
    );
  });

  it('throws on non-positive price answer', async () => {
    const now = 1700000000;
    const fakeReader: ChainlinkReader = {
      decimals: async () => 8,
      latestRoundData: async (): Promise<ChainlinkRound> => ({
        roundId: 100n,
        answer: 0n,
        startedAt: BigInt(now - 10),
        updatedAt: BigInt(now - 10),
        answeredInRound: 100n,
      }),
    };

    const source = new ChainlinkPriceSource({
      chain: dummyChain,
      reader: fakeReader,
      nowSeconds: () => now,
    });

    await expect(source.getPrice('USDC')).rejects.toThrow(
      PriceUnavailableError,
    );
  });
});
