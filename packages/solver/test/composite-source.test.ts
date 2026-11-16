import { describe, expect, it } from 'vitest';
import { RoutePriceSource } from '../src/pricing/composite-source.js';
import { PriceUnavailableError } from '../src/pricing/price-source.js';
import { loadChainConfig } from '@ferry/chain-config';

describe('RoutePriceSource (Composite Pricing)', () => {
  const chainConfig = loadChainConfig({ network: 'testnet' });

  it('retrieves price for BCH assets and checks peg guard', async () => {
    const now = 1700000000;
    const fakeBchSource = {
      async getPrice(asset: string) {
        if (asset === 'PUSD') {
          return {
            usdPrice: 1_000_000n,
            source: 'cauldron-test',
            asOf: now,
          };
        }
        throw new Error('Not found');
      },
    };

    const source = new RoutePriceSource({
      chainConfig,
      bchSource: fakeBchSource,
      nowSeconds: () => now,
    });

    const reading = await source.getPrice('PUSD');
    expect(reading.usdPrice).toBe(1_000_000n);
    expect(reading.source).toBe('cauldron-test');
  });

  it('refuses price when peg guard deviation exceeds tolerance', async () => {
    const now = 1700000000;
    const fakeBchSource = {
      async getPrice() {
        return {
          usdPrice: 950_000n, // $0.95 (5% deviation)
          source: 'cauldron-test',
          asOf: now,
        };
      },
    };

    const source = new RoutePriceSource({
      chainConfig,
      bchSource: fakeBchSource,
      nowSeconds: () => now,
      pegToleranceUsdMicros: 20_000n, // 2%
    });

    await expect(source.getPrice('PUSD')).rejects.toThrow(
      PriceUnavailableError,
    );
  });

  it('delegates to EVM price sources for USDC/USDT', async () => {
    const now = 1700000000;
    const fakeEvmSource = {
      async getPrice(asset: string) {
        return {
          usdPrice: 999_900n,
          source: `chainlink:base:${asset.toLowerCase()}`,
          asOf: now,
        };
      },
    };

    const source = new RoutePriceSource({
      chainConfig,
      evmSources: new Map([['base', fakeEvmSource]]),
      nowSeconds: () => now,
    });

    const reading = await source.getPrice('USDC', 'base');
    expect(reading.usdPrice).toBe(999_900n);
    expect(reading.source).toBe('chainlink:base:usdc');
  });

  it('throws PriceUnavailableError when route source is missing', async () => {
    const source = new RoutePriceSource({
      chainConfig,
      nowSeconds: () => 1700000000,
    });

    await expect(source.getPrice('USDC', 'non-existent-chain')).rejects.toThrow(
      PriceUnavailableError,
    );
  });
});
