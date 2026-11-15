import { describe, expect, it } from 'vitest';
import {
  EnabledRoutesError,
  RouteConfigurationError,
  loadChainConfig,
  loadChainData,
  type ChainConfigData,
} from '../src/index.js';

function config() {
  return loadChainConfig({ env: {} });
}

describe('loadChainConfig', () => {
  it('loads all six chains on mainnet and testnet with no routes enabled by default', () => {
    const loaded = config();
    expect(loaded.chains).toHaveLength(12);
    expect(loaded.routes).toHaveLength(8);
    expect(loaded.enabledRoutes).toEqual([]);
    expect(loaded.routes.every((route) => !route.enabled)).toBe(true);
  });

  it('exposes the chain fields from the blueprint shape', () => {
    const base = config().chains.find(
      (chain) => chain.id === 'base' && chain.network === 'mainnet',
    );
    expect(base).toMatchObject({
      chainId: 8453,
      explorerUrl: 'https://basescan.org',
      nativeGas: 'ETH',
      finality: { fast: 10, safe: 'safe', status: 'verified' },
      create2Factory: {
        address: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
        hasCode: true,
      },
    });
    expect(base?.rpcUrls).toHaveLength(2);
    expect(base?.assets[0]).toMatchObject({
      symbol: 'USDC',
      decimals: 6,
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      permit: true,
      verified: true,
    });
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

  it('enables the 18-decimal USDT route on BNB Chain', () => {
    const loaded = loadChainConfig({ env: { ENABLED_ROUTES: 'usdt:bnb' } });
    const route = loaded.routes.find((item) => item.key === 'usdt:bnb');
    expect(route?.enabled).toBe(true);
    const bnb = loaded.chains.find(
      (chain) => chain.id === 'bnb' && chain.network === 'mainnet',
    );
    expect(bnb?.assets.find((asset) => asset.symbol === 'USDT')).toMatchObject({
      decimals: 18,
      permit: false,
      verified: true,
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
