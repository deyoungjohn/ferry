import { describe, expect, it } from 'vitest';
import {
  buildActiveRoutes,
  checkRouteReadiness,
} from '../src/ops/routes-config.js';
import { loadConfigFromEnv } from '../src/config.js';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import type { SolverEngine } from '../src/engine/runner.js';

describe('Operator Routes and Readiness Checks (B4-06)', () => {
  it('buildActiveRoutes derives routes from facts and filters by eligibility and htlcAddress', () => {
    const config = loadConfigFromEnv({
      NETWORK: 'testnet',
      ALLOW_DEV_KEYS: '1',
      BASE_FERRY_HTLC_ADDRESS: '0x8b968625F983420B571C102eC0b57F7e509c916e',
    });

    const routesContext = buildActiveRoutes(config);
    expect(routesContext.routes.length).toBeGreaterThan(0);

    const baseUsdc = routesContext.routes.find((r) => r.key === 'usdc:base');
    expect(baseUsdc).toBeDefined();
    expect(baseUsdc?.enabled).toBe(true);
    expect(baseUsdc?.htlcAddress).toBe(
      '0x8b968625F983420B571C102eC0b57F7e509c916e',
    );
  });

  it('GET /v1/operator/routes enforces bearer authentication', async () => {
    const config = loadConfigFromEnv({
      NETWORK: 'testnet',
      ALLOW_DEV_KEYS: '1',
      OPERATOR_TOKEN: 'operator-secret-token-min-32-chars-long',
    });
    const db = new SolverDatabase(':memory:');
    const fakeEvmAdapter = {
      id: 'base',
      getTip: async () => ({ height: 12345, ageSeconds: 10, stale: false }),
    } as unknown as EvmChainAdapter;
    const fakeBchClient = {
      getQuorumStatus: () => ({
        isQuorumHealthy: true,
        quorumTip: 200000,
        liveServers: 2,
        totalServers: 2,
        ageSeconds: 5,
      }),
    } as unknown as BchQuorumClient;
    const fakeEngine = { stop: () => {} } as unknown as SolverEngine;
    const priceSource = new MockPriceSource(
      new Map([
        [
          'usdc',
          {
            usdPrice: 1_000_000n,
            source: 'chainlink-base',
            asOf: Math.floor(Date.now() / 1000),
          },
        ],
      ]),
    );

    const app = buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      engine: fakeEngine,
      priceSource,
    });

    // Unauthenticated
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/v1/operator/routes',
    });
    expect(resNoAuth.statusCode).toBe(401);

    // Wrong token
    const resBadAuth = await app.inject({
      method: 'GET',
      url: '/v1/operator/routes',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(resBadAuth.statusCode).toBe(401);

    // Valid token
    const resOk = await app.inject({
      method: 'GET',
      url: '/v1/operator/routes',
      headers: { authorization: `Bearer ${config.operatorToken}` },
    });
    expect(resOk.statusCode).toBe(200);
    const body = resOk.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.routes)).toBe(true);
    expect(body.routes.length).toBeGreaterThan(0);
    expect(body.routes[0].checks).toHaveProperty('htlcCodePresent');
    expect(body.routes[0].checks).toHaveProperty('rpcReachable');
    expect(body.routes[0].checks).toHaveProperty('priceFresh');
    expect(body.routes[0].checks).toHaveProperty('inventoryAboveFloor');
    expect(body.routes[0].checks).toHaveProperty('quorumHealthy');
  });

  it('evaluates checkRouteReadiness properly across criteria', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fakeEvmAdapter = {
      id: 'base',
      getTip: async () => ({ height: 12345, ageSeconds: 10, stale: false }),
    } as unknown as EvmChainAdapter;
    const fakeBchClient = {
      getQuorumStatus: () => ({
        isQuorumHealthy: true,
        quorumTip: 200000,
        liveServers: 2,
        totalServers: 2,
        ageSeconds: 5,
      }),
    } as unknown as BchQuorumClient;
    const priceSource = new MockPriceSource(
      new Map([
        [
          'usdc',
          {
            usdPrice: 1_000_000n,
            source: 'chainlink-base',
            asOf: now,
          },
        ],
      ]),
    );

    const route = {
      key: 'USDC:base',
      chain: 'base' as const,
      asset: 'USDC' as const,
      htlcAddress: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      deployBlock: 123000,
      logMaxRange: 50000,
      finality: { fast: 1, safe: 'finalized' as const, status: 'verified' },
      eligible: true,
      enabled: true,
      reasons: [],
    };

    const readiness = await checkRouteReadiness({
      route,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      priceSource,
    });

    expect(readiness.route).toBe('USDC:base');
    expect(readiness.status).toBe('green');
    expect(readiness.checks.htlcCodePresent.status).toBe('green');
    expect(readiness.checks.rpcReachable.status).toBe('green');
    expect(readiness.checks.priceFresh.status).toBe('green');
    expect(readiness.checks.inventoryAboveFloor.status).toBe('green');
    expect(readiness.checks.quorumHealthy.status).toBe('green');
  });
});
