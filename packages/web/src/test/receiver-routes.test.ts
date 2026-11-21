import { describe, expect, it } from 'vitest';
import type { LiquidityResponse } from '@ferry/core/api';
import {
  atomsToUsd,
  evaluateReceiverRoutes,
  findAlternativeRoutes,
  parseRouteKey,
} from '../lib/send/receiver-routes';

describe('receiver-routes helpers', () => {
  const mockLiquidity: LiquidityResponse = {
    asOf: 1700000000,
    routes: [
      {
        route: 'usdc:base',
        asset: 'USDC',
        decimals: 6,
        available: '5000000', // 5 USD
        inventory: '5000000',
        exposure: '0',
        reserved: '0',
      },
      {
        route: 'usdc:arbitrum',
        asset: 'USDC',
        decimals: 6,
        available: '50000000', // 50 USD
        inventory: '50000000',
        exposure: '0',
        reserved: '0',
      },
      {
        route: 'usdt:polygon',
        asset: 'USDT',
        decimals: 6,
        available: '100000000', // 100 USD
        inventory: '100000000',
        exposure: '0',
        reserved: '0',
      },
    ],
  };

  it('parses route keys correctly', () => {
    expect(parseRouteKey('usdc:base')).toEqual({
      asset: 'USDC',
      chain: 'base',
    });
    expect(parseRouteKey('usdt:arbitrum-one')).toEqual({
      asset: 'USDT',
      chain: 'arbitrum-one',
    });
  });

  it('converts atoms to USD accurately', () => {
    expect(atomsToUsd('25000000', 6)).toBe(25);
    expect(atomsToUsd('10500000', 6)).toBe(10.5);
  });

  it('evaluates routes and flags liquidity availability for given amount', () => {
    const routes = evaluateReceiverRoutes(mockLiquidity, 20); // requires 20 USD
    expect(routes).toHaveLength(3);

    const base = routes.find((r) => r.routeKey === 'usdc:base');
    expect(base?.hasLiquidity).toBe(false); // 5 < 20

    const arb = routes.find((r) => r.routeKey === 'usdc:arbitrum');
    expect(arb?.hasLiquidity).toBe(true); // 50 >= 20

    const poly = routes.find((r) => r.routeKey === 'usdt:polygon');
    expect(poly?.hasLiquidity).toBe(true); // 100 >= 20
  });

  it('finds alternative routes when current route lacks liquidity', () => {
    const alternatives = findAlternativeRoutes(mockLiquidity, 'usdc:base', 20);
    expect(alternatives).toHaveLength(2);
    // Highest available first
    expect(alternatives[0]?.routeKey).toBe('usdt:polygon');
    expect(alternatives[1]?.routeKey).toBe('usdc:arbitrum');
  });
});
