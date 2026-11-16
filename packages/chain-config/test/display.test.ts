import { describe, expect, it } from 'vitest';
import { loadChainDisplay } from '../src/index.js';

describe('loadChainDisplay', () => {
  it('lists every chain with display fields and no RPC URLs or addresses', () => {
    const display = loadChainDisplay({
      env: { ENABLED_ROUTES: 'usdc:base,usdt:bnb' },
    });
    expect(display.network).toBe('mainnet');
    expect(display.chains).toHaveLength(6);

    const base = display.chains.find((chain) => chain.id === 'base');
    expect(base).toMatchObject({
      name: 'Base',
      chainId: 8453,
      explorerUrl: 'https://basescan.org',
      tokenSymbols: ['USDC'],
      enabled: true,
      disabledReason: null,
      priceSource: 'Chainlink USDC/USD',
    });

    const bnb = display.chains.find((chain) => chain.id === 'bnb');
    expect(bnb).toMatchObject({
      tokenSymbols: ['USDT'],
      enabled: true,
      disabledReason: null,
      priceSource: 'Chainlink USDT/USD',
    });

    const robinhood = display.chains.find((chain) => chain.id === 'robinhood');
    expect(robinhood).toMatchObject({
      tokenSymbols: [],
      enabled: false,
      disabledReason: 'No canonical USDC or USDT route',
      priceSource: 'Fallback (no route)',
    });

    const serialized = JSON.stringify(display);
    expect(serialized).not.toContain('https://mainnet.base.org');
    expect(serialized).not.toContain('https://bsc-rpc.publicnode.com');
    expect(serialized).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  it('reports a disabled reason for a chain with no route switched on', () => {
    const display = loadChainDisplay({ env: {} });
    const base = display.chains.find((chain) => chain.id === 'base');
    expect(base?.enabled).toBe(false);
    expect(base?.disabledReason).toBe('usdc:base: route not enabled');

    const bnb = display.chains.find((chain) => chain.id === 'bnb');
    expect(bnb?.enabled).toBe(false);
    expect(bnb?.disabledReason).toContain(
      'usdc:bnb: token address is reported',
    );
    expect(bnb?.disabledReason).toContain('usdt:bnb: route not enabled');
  });

  it('uses the selected network and the fallback source on testnet', () => {
    const display = loadChainDisplay({
      env: { FERRY_NETWORK: 'testnet', ENABLED_ROUTES: 'usdc:base' },
    });
    expect(display.network).toBe('testnet');
    const base = display.chains.find((chain) => chain.id === 'base');
    expect(base?.chainId).toBe(84532);
    expect(base?.enabled).toBe(true);
    expect(base?.priceSource).toBe('Issuer/independent fallback');
  });
});
