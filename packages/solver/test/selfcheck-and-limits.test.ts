import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { sha256 } from 'viem';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { SolverConfigSchema, loadConfigFromEnv } from '../src/config.js';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { InventoryReader } from '../src/pricing/inventory-reader.js';
import { runSelfCheck } from '../src/ops/selfcheck.js';
import { buildActiveRoutes } from '../src/ops/routes-config.js';

describe('B4-10: Limits, Self-Check, and Refusal Reasons with Numbers', () => {
  const solverEvmKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const solverAccount = privateKeyToAccount(solverEvmKey);
  const operatorToken = 'test-operator-token-32-chars-long-secret!';

  describe('1. Reservation Caps Configuration and Validation', () => {
    it('defaults reservation caps to min(2 * MAX_SWAP_USD_MICROS, MAX_EXPOSURE_USD_MICROS)', () => {
      const config = SolverConfigSchema.parse({
        maxSwapUsdMicros: 1_000_000n, // $1
        maxExposureUsdMicros: 50_000_000n, // $50
      });
      expect(config.reservationCapPerAddressUsdMicros).toBeUndefined();
      expect(config.reservationCapPerIpUsdMicros).toBeUndefined();

      // Calculation logic
      const defaultCap =
        config.maxSwapUsdMicros * 2n < config.maxExposureUsdMicros
          ? config.maxSwapUsdMicros * 2n
          : config.maxExposureUsdMicros;
      expect(defaultCap).toBe(2_000_000n); // $2
    });

    it('loads custom reservation caps from environment variables', () => {
      const config = loadConfigFromEnv({
        ALLOW_DEV_KEYS: '1',
        RESERVATION_CAP_PER_ADDRESS_USD_MICROS: '5000000',
        RESERVATION_CAP_PER_IP_USD_MICROS: '10000000',
      });
      expect(config.reservationCapPerAddressUsdMicros).toBe(5_000_000n);
      expect(config.reservationCapPerIpUsdMicros).toBe(10_000_000n);
    });

    it('validates that custom reservation caps must be positive', () => {
      expect(() =>
        SolverConfigSchema.parse({
          reservationCapPerAddressUsdMicros: 0n,
        }),
      ).toThrow(/RESERVATION_CAP_PER_ADDRESS_USD_MICROS must be positive/);

      expect(() =>
        SolverConfigSchema.parse({
          reservationCapPerIpUsdMicros: -100n,
        }),
      ).toThrow(/RESERVATION_CAP_PER_IP_USD_MICROS must be positive/);
    });

    it('logs effective reservation policy at startup with custom caps', async () => {
      const logs: Array<{ msg: string; obj: Record<string, unknown> }> = [];
      const mockLogger = {
        info: (obj: Record<string, unknown>, msg?: string) => {
          logs.push({ msg: msg ?? '', obj });
        },
        warn: () => {},
        error: () => {},
        debug: () => {},
        trace: () => {},
        fatal: () => {},
        child: () => mockLogger,
      };

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        maxSwapUsdMicros: 1_000_000n,
        reservationCapPerAddressUsdMicros: 3_000_000n,
        reservationCapPerIpUsdMicros: 4_000_000n,
      });

      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: true,
          ageSeconds: 10,
        }),
        listUnspent: async () => [],
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1000, ageSeconds: 2 }),
        getTokenBalance: async () => 100_000_000n,
        getNativeBalance: async () => 1_000_000_000_000_000_000n,
        assets: [],
      } as unknown as EvmChainAdapter;

      const db = new SolverDatabase(':memory:');
      const engine = new SolverEngine(
        db,
        {
          getTip: async () => ({ height: 1, hash: '' }),
          isQuorumHealthy: () => true,
          isQuotingEnabled: () => true,
          broadcast: async () => '',
          isOnChain: async () => true,
          getScriptHashHistory: async () => [],
          waitForDoubleSpendProof: async () => ({ hasProof: false }),
        },
        {
          getTip: async () => ({ height: 1, finalized: true }),
          getLock: async () => ({ status: 'none' as const }),
          isFinal: async () => true,
          broadcast: async () => '',
          isOnChain: async () => true,
        },
      );

      const priceSource = new MockPriceSource();
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'mock',
        asOf: Math.floor(Date.now() / 1000),
      });
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'mock',
        asOf: Math.floor(Date.now() / 1000),
      });

      const server = buildServer({
        config,
        db,
        evmAdapter: fakeEvm,
        bchClient: fakeBch,
        engine,
        priceSource,
        logger: mockLogger as unknown as import('pino').Logger,
      });

      const policyLog = logs.find(
        (l) => l.msg === 'Effective solver policy configured',
      );
      expect(policyLog).toBeDefined();
      expect(policyLog?.obj.reservationCapPerAddressUsd).toBe('3.00');
      expect(policyLog?.obj.reservationCapPerIpUsd).toBe('4.00');
      expect(policyLog?.obj.maxSwapUsd).toBe('1.00');

      await server.close();
      db.close();
    });
  });

  describe('2. Refusal Reasons Carry Stated Numbers', () => {
    let server: FastifyInstance;
    let db: SolverDatabase;
    let fakeBch: BchQuorumClient;
    let fakeEvm: EvmChainAdapter;
    let mockPrices: MockPriceSource;
    let bchTipAge = 10;
    let bchSats = 50_000n;
    let pusdAtoms = 10_000n;
    let evmNativeWei = 1_000_000_000_000_000_000n;
    let evmUsdcUnits = 100_000_000n;
    let engine: SolverEngine;

    beforeEach(() => {
      bchTipAge = 10;
      bchSats = 50_000n;
      pusdAtoms = 10_000n;
      evmNativeWei = 1_000_000_000_000_000_000n;
      evmUsdcUnits = 100_000_000n;

      fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: bchTipAge <= 7200,
          isLivenessHealthy: bchTipAge <= 60,
          ageSeconds: bchTipAge,
        }),
        listUnspent: async () => [
          {
            height: 330000,
            tx_hash: '11'.repeat(32),
            tx_pos: 0,
            value: Number(bchSats),
            token_data: {
              category:
                'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
              amount: pusdAtoms.toString(),
            },
          },
        ],
      } as unknown as BchQuorumClient;

      fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1000, ageSeconds: 2, stale: false }),
        getTokenBalance: async () => evmUsdcUnits,
        getNativeBalance: async () => evmNativeWei,
        assets: [],
      } as unknown as EvmChainAdapter;

      mockPrices = new MockPriceSource();
      mockPrices.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: Math.floor(Date.now() / 1000),
      });
      mockPrices.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: Math.floor(Date.now() / 1000),
      });

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        minSwapUsdMicros: 1_000_000n, // $1.00 min
        maxSwapUsdMicros: 50_000_000n, // $50.00 max
        bchCarrySats: 3000n,
        bchMaxFeeSats: 1500n,
      });

      db = new SolverDatabase(':memory:');
      engine = new SolverEngine(
        db,
        {
          getTip: async () => ({ height: 1, hash: '' }),
          isQuorumHealthy: () => true,
          isQuotingEnabled: () => true,
          broadcast: async () => '',
          isOnChain: async () => true,
          getScriptHashHistory: async () => [],
          waitForDoubleSpendProof: async () => ({ hasProof: false }),
        },
        {
          getTip: async () => ({ height: 1, finalized: true }),
          getLock: async () => ({ status: 'none' as const }),
          isFinal: async () => true,
          broadcast: async () => '',
          isOnChain: async () => true,
        },
      );

      server = buildServer({
        config,
        db,
        evmAdapter: fakeEvm,
        bchClient: fakeBch,
        engine,
        priceSource: mockPrices,
      });
    });

    afterEach(async () => {
      await server.close();
      db.close();
    });

    it('refuses quote below minimum swap with plain message stating both numbers', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '500000', // $0.50
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x01'),
          dryRun: true,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.reason).toBe('ROUTE_DISABLED');
      expect(body.message).toMatch(
        /Amount \$0\.50 is below minimum swap of \$1\.00/,
      );
    });

    it('refuses quote over maximum swap with plain message stating both numbers', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '60000000', // $60.00 (max is $50.00)
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x01'),
          dryRun: true,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.reason).toBe('OVER_MAX_SWAP');
      expect(body.maxAmount).toBe('50.00');
      expect(body.message).toMatch(
        /Amount \$60\.00 exceeds maximum swap of \$50\.00/,
      );
    });

    it('refuses quote on stale BCH tip stating tip height, age and limit', async () => {
      bchTipAge = 10000; // > 7200s
      const res = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '1000000', // $1.00
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x01'),
          dryRun: true,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(body.maxAmount).toBe('0');
      expect(body.message).toMatch(
        /Bitcoin Cash node tip is stale or unhealthy \(tip: 330000, age: 10000s, max: 7200s\)/,
      );
    });

    it('refuses quote when solver BCH fee balance is below required sats for gas', async () => {
      bchSats = 1000n; // below carry (3000) + fee (1500) = 4500
      const res = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '1000000', // $1.00
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x01'),
          dryRun: true,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(body.maxAmount).toBe('0');
      expect(body.message).toMatch(
        /Solver BCH fee balance \(1000 sats\) is below required 4500 sats \(carry: 3000, fee: 1500\)/,
      );
    });

    it('refuses reverse quote when solver native EVM gas is 0 wei', async () => {
      evmNativeWei = 0n; // No gas on Base
      const res = await server.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'BCH_TO_EVM',
          bchToken: 'PUSD',
          amountIn: '100', // 1.00 PUSD
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x01'),
          dryRun: true,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(body.maxAmount).toBe('0');
      expect(body.message).toMatch(
        /Solver native gas balance on Base is 0 wei; requires native gas for counter-lock/,
      );
    });

    it('refuses quote when reservation cap is exceeded stating numbers', async () => {
      // Create server with low address reservation cap of $1.50
      const lowCapConfig = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        reservationCapPerAddressUsdMicros: 1_500_000n, // $1.50
      });
      const lowCapServer = buildServer({
        config: lowCapConfig,
        db,
        evmAdapter: fakeEvm,
        bchClient: fakeBch,
        engine,
        priceSource: mockPrices,
      });

      // One quote above the cap is refused with the numbers. (A second quote from the same
      // address would replace the first, so the cap is about one swap at a time.)
      const over = await lowCapServer.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          amountIn: '2000000', // $2.00
          userEvmAddress: '0x2222222222222222222222222222222222222222',
          userBchLockingBytecode:
            '0x76a914111111111111111111111111111111111111111188ac',
          hashLock: sha256('0x02'),
        },
      });
      expect(over.statusCode).toBe(422);
      const body2 = JSON.parse(over.body);
      expect(body2.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(body2.message).toMatch(
        /Address active reservation cap exceeded: active reservations \$0\.00 \+ requested \$1\.9[89] exceeds cap of \$1\.50/,
      );
      // The limit is shown as a plain amount of the token, not raw units.
      expect(body2.maxAmount).toBe('1.5');

      await lowCapServer.close();
    });
  });

  describe('3. Read-Only Self-Check Execution', () => {
    it('passes selfcheck when solver is funded and healthy', async () => {
      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        maxSwapUsdMicros: 1_000_000n, // $1.00
      });

      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 5,
        }),
        listUnspent: async () => [
          {
            height: 330000,
            tx_hash: '11'.repeat(32),
            tx_pos: 0,
            value: 50000,
            token_data: {
              category:
                'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
              amount: '5000', // 50.00 PUSD
            },
          },
        ],
        close: () => {},
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1234, ageSeconds: 1, stale: false }),
        getTokenBalance: async () => 100_000_000n, // 100 USDC
        getNativeBalance: async () => 500_000_000_000_000_000n, // 0.5 ETH
        assets: [],
      } as unknown as EvmChainAdapter;

      const mockPrices = new MockPriceSource();
      mockPrices.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: Math.floor(Date.now() / 1000),
      });
      mockPrices.setPrice('MUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: Math.floor(Date.now() / 1000),
      });
      mockPrices.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: Math.floor(Date.now() / 1000),
      });

      const evmAdapters = new Map<string, EvmChainAdapter>([['base', fakeEvm]]);
      const routesContext = buildActiveRoutes(config);

      const db = new SolverDatabase(':memory:');
      const reader = new InventoryReader({
        config,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        evmAdapters,
        solverEvmAddress: solverAccount.address,
      });

      const report = await runSelfCheck({
        config,
        bchClient: fakeBch,
        inventoryReader: reader,
        priceSource: mockPrices,
        evmAdapters,
        routesContext,
        db,
      });

      expect(report.passed).toBe(true);
      expect(report.output).toContain('Effective Policy:');
      expect(report.output).toContain('Reservation Cap (Addr): $2.00');
      expect(report.output).toContain('BCH PUSD:      50.00 PUSD');
      expect(report.output).toContain('native gas 0.500000');
      expect(report.output).toMatch(
        /ACCEPTED: pay 1\.00 USDC -> receive 0\.9[89] PUSD/,
      );
      expect(report.output).toContain(
        'ACCEPTED: pay 1.00 PUSD -> receive 0.99 USDC',
      );
      expect(report.output).toContain(
        'OVERALL VERDICT: READY FOR $1 SWAP (PASS)',
      );

      // Verify no keys leaked
      expect(report.output).not.toContain(solverEvmKey);
      expect(report.output).not.toContain(operatorToken);

      db.close();
    });

    it('fails selfcheck when route refuses $1 quote due to missing funds', async () => {
      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        maxSwapUsdMicros: 1_000_000n,
      });

      const unfundedBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 5,
        }),
        listUnspent: async () => [], // 0 PUSD, 0 sats
        close: () => {},
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1234, ageSeconds: 1, stale: false }),
        getTokenBalance: async () => 0n,
        getNativeBalance: async () => 0n,
        assets: [],
      } as unknown as EvmChainAdapter;

      const mockPrices = new MockPriceSource();
      mockPrices.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: Math.floor(Date.now() / 1000),
      });
      mockPrices.setPrice('MUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: Math.floor(Date.now() / 1000),
      });
      mockPrices.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: Math.floor(Date.now() / 1000),
      });

      const evmAdapters = new Map<string, EvmChainAdapter>([['base', fakeEvm]]);
      const routesContext = buildActiveRoutes(config);

      const db = new SolverDatabase(':memory:');
      const reader = new InventoryReader({
        config,
        bchClient: unfundedBch,
        evmAdapter: fakeEvm,
        evmAdapters,
        solverEvmAddress: solverAccount.address,
      });

      const report = await runSelfCheck({
        config,
        bchClient: unfundedBch,
        inventoryReader: reader,
        priceSource: mockPrices,
        evmAdapters,
        routesContext,
        db,
      });

      expect(report.passed).toBe(false);
      expect(report.output).toContain('[FAIL]');
      expect(report.output).toContain('REFUSED');
      expect(report.output).toContain(
        'OVERALL VERDICT: NOT READY - ONE OR MORE ROUTES REFUSED (FAIL)',
      );

      db.close();
    });
  });
});

describe('quote lifetime', () => {
  it('defaults to five minutes and follows QUOTE_TTL_SECONDS (it used to be fixed at 60 seconds)', () => {
    const base = {
      ALLOW_DEV_KEYS: '1',
      OPERATOR_TOKEN: 'a'.repeat(32),
    };
    expect(loadConfigFromEnv(base).quoteTtlSeconds).toBe(300);
    expect(
      loadConfigFromEnv({ ...base, QUOTE_TTL_SECONDS: '120' }).quoteTtlSeconds,
    ).toBe(120);
  });
});

describe('an engine whose on-chain actions are not real yet', () => {
  it('quotes nothing and moves no order', async () => {
    const { SolverEngine } = await import('../src/engine/runner.js');
    const { SolverDatabase } = await import('../src/db/database.js');
    const db = new SolverDatabase(':memory:');
    const bch = {
      getTip: async () => ({ height: 1, hash: '' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => {
        throw new Error('must not broadcast');
      },
      isOnChain: async () => true,
      getScriptHashHistory: async () => [],
    };
    const evm = {
      getTip: async () => ({ height: 1, finalized: true }),
      getLock: async () => {
        throw new Error('must not read');
      },
      isFinal: async () => true,
      broadcast: async () => '',
      isOnChain: async () => true,
    };
    const ready = new SolverEngine(db, bch as never, evm as never, {});
    expect(ready.isQuotingEnabled()).toBe(true);
    const notReady = new SolverEngine(db, bch as never, evm as never, {
      executionReady: false,
    });
    expect(notReady.isQuotingEnabled()).toBe(false);
    // Stepping an order does nothing (no chain call, no state change).
    await expect(
      notReady.stepOrder({ id: '0xabc' } as never),
    ).resolves.toBeUndefined();
  });
});
