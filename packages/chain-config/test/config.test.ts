import { describe, expect, it } from 'vitest';
import {
  EnabledRoutesError,
  NetworkConfigurationError,
  PREDICTED_FERRY_HTLC_ADDRESS,
  RouteConfigurationError,
  loadChainConfig,
  loadChainData,
  type ChainConfigData,
} from '../src/index.js';

function config() {
  return loadChainConfig({ env: {} });
}

describe('loadChainConfig', () => {
  it('loads route-capable chains and the full fact set with no routes enabled by default', () => {
    const loaded = config();
    expect(loaded.network).toBe('mainnet');
    expect(loaded.chains).toHaveLength(12);
    expect(loaded.facts).toHaveLength(6);
    expect(loaded.coreChains).toHaveLength(6);
    expect(loaded.routes).toHaveLength(9);
    expect(loaded.enabledRoutes).toEqual([]);
    expect(loaded.routes.every((route) => !route.enabled)).toBe(true);
  });

  it('keeps the rich chain view compatible with the deploy scripts', () => {
    const base = config().chains.find(
      (chain) => chain.id === 'base' && chain.network === 'mainnet',
    );
    expect(base?.create2Factory.address).toBe(
      '0x4e59b44847b379578588920cA78FbF26c0B4956C',
    );
    expect(base?.rpcUrls).toHaveLength(3);
  });

  it('returns core-shaped chain configs with the predicted HTLC address', () => {
    const base = config().coreChains.find((chain) => chain.id === 'base');
    expect(base).toMatchObject({
      chainId: 8453,
      explorerUrl: 'https://basescan.org',
      nativeGas: 'ETH',
      finality: { fast: 10, safe: 'safe' },
      htlcAddress: PREDICTED_FERRY_HTLC_ADDRESS,
      relayCostUsd: 0,
      assets: [
        {
          symbol: 'USDC',
          decimals: 6,
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          permit: true,
        },
      ],
    });
    expect(base?.deployBlock).toBeUndefined();
    expect(base?.rpcUrls).toHaveLength(3);
  });

  it('exposes deployment and price-feed facts separately from the core shape', () => {
    const base = config().facts.find((chain) => chain.id === 'base');
    expect(base).toMatchObject({
      name: 'Base',
      network: 'mainnet',
      deployment: {
        htlcAddress: null,
        deployBlock: null,
        relayCostUsd: null,
        predictedHtlcAddress: PREDICTED_FERRY_HTLC_ADDRESS,
        status: 'unavailable',
      },
    });
    expect(base?.priceFeeds).toEqual([
      expect.objectContaining({
        asset: 'USDC',
        pair: 'USDC/USD',
        source: 'Chainlink',
        decimals: 8,
        heartbeatSeconds: 86400,
      }),
    ]);
  });

  it('enables a verified route when asked', () => {
    const loaded = loadChainConfig({ env: { ENABLED_ROUTES: 'usdc:base' } });
    expect(loaded.enabledRoutes).toEqual(['usdc:base']);
    expect(
      loaded.routes.find((route) => route.key === 'usdc:base'),
    ).toMatchObject({ enabled: true, reasons: [] });
  });

  it('enables multiple verified routes in the caller order', () => {
    const loaded = loadChainConfig({
      env: { ENABLED_ROUTES: 'usdc:arbitrum,usdc:base' },
    });
    expect(loaded.enabledRoutes).toEqual(['usdc:arbitrum', 'usdc:base']);
    expect(
      loaded.routes.filter((route) => route.enabled).map((route) => route.key),
    ).toEqual(['usdc:base', 'usdc:arbitrum']);
  });

  it('omits unverified assets from the core-shaped chain configs', () => {
    const bnb = config().coreChains.find((chain) => chain.id === 'bnb');
    expect(bnb?.assets.map((asset) => asset.symbol)).toEqual(['USDT']);
    const testnet = loadChainConfig({ env: { FERRY_NETWORK: 'testnet' } });
    expect(testnet.coreChains.some((chain) => chain.id === 'bnb')).toBe(false);
  });

  it('enables the 18-decimal USDT route on BNB Chain', () => {
    const loaded = loadChainConfig({ env: { ENABLED_ROUTES: 'usdt:bnb' } });
    const route = loaded.routes.find((item) => item.key === 'usdt:bnb');
    expect(route?.enabled).toBe(true);
    const bnb = loaded.coreChains.find((chain) => chain.id === 'bnb');
    expect(bnb?.assets.find((asset) => asset.symbol === 'USDT')).toMatchObject({
      decimals: 18,
      permit: false,
    });
  });

  it('enables the USDG route on Robinhood Chain', () => {
    const loaded = loadChainConfig({
      env: { ENABLED_ROUTES: 'usdg:robinhood' },
    });
    const route = loaded.routes.find((item) => item.key === 'usdg:robinhood');
    expect(route?.enabled).toBe(true);
    const robinhood = loaded.coreChains.find(
      (chain) => chain.id === 'robinhood',
    );
    expect(
      robinhood?.assets.find((asset) => asset.symbol === 'USDG'),
    ).toMatchObject({
      decimals: 6,
      permit: true,
      address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    });
  });

  it('refuses to enable a route whose token address is not canonical', () => {
    expect(() =>
      loadChainConfig({ env: { ENABLED_ROUTES: 'usdc:bnb' } }),
    ).toThrow(RouteConfigurationError);
    try {
      loadChainConfig({ env: { ENABLED_ROUTES: 'usdc:bnb' } });
    } catch (error) {
      expect(error).toBeInstanceOf(RouteConfigurationError);
      expect((error as RouteConfigurationError).reasons).toContain(
        'token address is reported',
      );
    }
  });

  it('rejects a route that is not defined', () => {
    expect(() =>
      loadChainConfig({ env: { ENABLED_ROUTES: 'usdt:base' } }),
    ).toThrow(/Route "usdt:base" is not defined/);
    expect(() =>
      loadChainConfig({ env: { ENABLED_ROUTES: 'usdc:robinhood' } }),
    ).toThrow(/Route "usdc:robinhood" is not defined/);
  });

  it('rejects a malformed ENABLED_ROUTES value', () => {
    expect(() => loadChainConfig({ env: { ENABLED_ROUTES: 'usdc' } })).toThrow(
      EnabledRoutesError,
    );
    expect(() =>
      loadChainConfig({ env: { ENABLED_ROUTES: 'usdc:base,' } }),
    ).toThrow(EnabledRoutesError);
  });

  it('selects the network from FERRY_NETWORK and keeps the same route keys', () => {
    const loaded = loadChainConfig({
      env: { FERRY_NETWORK: 'testnet', ENABLED_ROUTES: 'usdc:base' },
    });
    expect(loaded.network).toBe('testnet');
    expect(loaded.enabledRoutes).toEqual(['usdc:base']);
    expect(
      loaded.coreChains.find((chain) => chain.id === 'base')?.chainId,
    ).toBe(84532);
    expect(
      loaded.facts.find((chain) => chain.id === 'base')?.priceFeeds,
    ).toEqual([]);
  });

  it('lets an explicit network option override FERRY_NETWORK', () => {
    const loaded = loadChainConfig({
      env: { FERRY_NETWORK: 'testnet' },
      network: 'mainnet',
    });
    expect(loaded.network).toBe('mainnet');
  });

  it('rejects an invalid FERRY_NETWORK value', () => {
    expect(() =>
      loadChainConfig({ env: { FERRY_NETWORK: 'staging' } }),
    ).toThrow(NetworkConfigurationError);
  });

  it('cannot be flipped on by the environment when decimals are unverified', () => {
    const data = structuredClone(loadChainData()) as ChainConfigData;
    data.chains.base.mainnet.tokens[0]!.verification.decimals.status =
      'reported';
    expect(() =>
      loadChainConfig({
        data,
        env: { ENABLED_ROUTES: 'usdc:base' },
      }),
    ).toThrow(/token decimals are reported/);
  });

  it('cannot be flipped on by the environment when the domain is unverified', () => {
    const data = structuredClone(loadChainData()) as ChainConfigData;
    data.chains.base.mainnet.tokens[0]!.verification.eip712.status = 'reported';
    expect(() =>
      loadChainConfig({
        data,
        env: { ENABLED_ROUTES: 'usdc:base' },
      }),
    ).toThrow(/EIP-712 domain is reported/);
  });

  it('cannot be flipped on by the environment when finality is unverified', () => {
    const data = structuredClone(loadChainData()) as ChainConfigData;
    data.chains.base.mainnet.finality.evidence.status = 'reported';
    expect(() =>
      loadChainConfig({
        data,
        env: { ENABLED_ROUTES: 'usdc:base' },
      }),
    ).toThrow(/finality policy is reported/);
  });
});
