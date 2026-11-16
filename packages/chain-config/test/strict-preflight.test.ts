import { describe, expect, it } from 'vitest';
import { loadChainConfig } from '../src/index.js';
import {
  evaluateStrictPreflight,
  type BchBalanceResult,
  type EvmBalanceResult,
  type PreflightAddresses,
  type RoutePreflightResult,
} from '../src/preflight.js';

const SOLVER = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BCH =
  'bitcoincash:pdl8y563h887re3r8g4sv76y29jt6vhtpzy9fc8qshmc8x30zjunj7cqx5ee3';

function setup() {
  const config = loadChainConfig({
    env: { ENABLED_ROUTES: 'usdc:base' },
  });
  const route = config.routes.find((item) => item.key === 'usdc:base')!;
  const result: RoutePreflightResult = {
    route,
    host: 'base-rpc.publicnode.com',
    cap: 50_000,
    htlc: 'ok',
    factory: 'ok',
    token: 'ok',
    feed: 'ok',
    activity: 'ok',
    decision: 'GO',
  };
  const addresses: PreflightAddresses = {
    evm: [SOLVER],
    bch: [BCH],
    deployerEvm: SOLVER,
    solverEvm: SOLVER,
    solverBch: BCH,
  };
  const evm: EvmBalanceResult = {
    byAddress: new Map([
      [
        SOLVER,
        [
          {
            chainId: 'base',
            native: 1n,
            assets: new Map([['USDC', 15_000_000n]]),
            error: null,
          },
        ],
      ],
    ]),
    errors: [],
  };
  const bch: BchBalanceResult = {
    byAddress: new Map([[BCH, { sats: 500_000n, pusd: 1_500n, musd: 0n }]]),
    hostsOk: 2,
    hostsTotal: 2,
    errors: [],
  };
  return { config, result, addresses, evm, bch };
}

describe('evaluateStrictPreflight', () => {
  it('passes when the route and Minimum-tier balances are ready', () => {
    const { config, result, addresses, evm, bch } = setup();
    expect(
      evaluateStrictPreflight(config, [result], addresses, evm, bch),
    ).toEqual({ ok: true, issues: [] });
  });

  it('fails when the HTLC, feed or activity check is not ready', () => {
    const { config, result, addresses, evm, bch } = setup();
    const notReady: RoutePreflightResult = {
      ...result,
      htlc: 'not deployed',
      feed: 'fallback',
      activity: 'FAIL',
      decision: 'NO-GO',
    };
    const strict = evaluateStrictPreflight(
      config,
      [notReady],
      addresses,
      evm,
      bch,
    );
    expect(strict.ok).toBe(false);
    expect(strict.issues.join('; ')).toMatch(/HTLC/);
    expect(strict.issues.join('; ')).toMatch(/price feed/);
    expect(strict.issues.join('; ')).toMatch(/activity/);
  });

  it('fails below the stablecoin, gas, PUSD or BCH floors', () => {
    const { config, result, addresses } = setup();
    const lowEvm: EvmBalanceResult = {
      byAddress: new Map([
        [
          SOLVER,
          [
            {
              chainId: 'base',
              native: 0n,
              assets: new Map([['USDC', 14_000_000n]]),
              error: null,
            },
          ],
        ],
      ]),
      errors: [],
    };
    const lowBch: BchBalanceResult = {
      byAddress: new Map([[BCH, { sats: 1_000n, pusd: 1_400n, musd: 0n }]]),
      hostsOk: 2,
      hostsTotal: 2,
      errors: [],
    };
    const strict = evaluateStrictPreflight(
      config,
      [result],
      addresses,
      lowEvm,
      lowBch,
    );
    expect(strict.ok).toBe(false);
    expect(strict.issues.join('; ')).toMatch(/USDC is below/);
    expect(strict.issues.join('; ')).toMatch(/native gas is zero/);
    expect(strict.issues.join('; ')).toMatch(/PUSD is below/);
    expect(strict.issues.join('; ')).toMatch(/BCH fee balance is below/);
  });

  it('fails when the funded addresses are absent', () => {
    const { config, result, evm, bch } = setup();
    const addresses: PreflightAddresses = {
      evm: [],
      bch: [],
      deployerEvm: null,
      solverEvm: null,
      solverBch: null,
    };
    const strict = evaluateStrictPreflight(
      config,
      [result],
      addresses,
      evm,
      bch,
    );
    expect(strict.ok).toBe(false);
    expect(strict.issues.join('; ')).toMatch(/no solver EVM address/);
    expect(strict.issues.join('; ')).toMatch(/no solver BCH address/);
  });

  it('fails when no route is enabled', () => {
    const config = loadChainConfig({ env: {} });
    const strict = evaluateStrictPreflight(
      config,
      [],
      {
        evm: [],
        bch: [],
        deployerEvm: null,
        solverEvm: null,
        solverBch: null,
      },
      { byAddress: new Map(), errors: [] },
      {
        byAddress: new Map(),
        hostsOk: 0,
        hostsTotal: 0,
        errors: [],
      },
    );
    expect(strict.ok).toBe(false);
    expect(strict.issues).toContain('no routes are enabled');
  });
});
