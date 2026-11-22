import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { sha256 } from 'viem';
import {
  HealthResponseSchema,
  ChainsResponseSchema,
  StatsResponseSchema,
  QuoteRefusalSchema,
} from '@ferry/core';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { InventoryReader } from '../src/pricing/inventory-reader.js';

describe('Real Inventory, Dry-Run Quotes, Health Tips, and Policy Authority (B4-09)', () => {
  const solverEvmKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const solverAccount = privateKeyToAccount(solverEvmKey);
  const operatorToken = 'test-operator-token-32-chars-long-secret!';

  describe('1. Inventory Reader Unit Tests', () => {
    it('reads and sums CashTokens PUSD, MUSD, and BCH sats from listunspent', async () => {
      const mockUtxos = [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 54600,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '5000', // 50.00 PUSD (2 decimals)
          },
        },
        {
          height: 330000,
          tx_hash: '22'.repeat(32),
          tx_pos: 1,
          value: 10000,
          token_data: {
            category:
              '0xc99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
            amount: '2500', // 25.00 MUSD (2 decimals)
          },
        },
        {
          height: 330000,
          tx_hash: '33'.repeat(32),
          tx_pos: 0,
          value: 200000, // pure sats
        },
      ];

      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          ageSeconds: 10,
        }),
        listUnspent: async () => mockUtxos,
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1000, ageSeconds: 2 }),
        getTokenBalance: async () => 75_000_000n, // 75 USDC (6 decimals)
        getNativeBalance: async () => 500_000_000_000_000_000n, // 0.5 ETH
        assets: [],
      } as unknown as EvmChainAdapter;

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        tipMaxAgeBchSeconds: 7200,
        tipMaxAgeBaseSeconds: 60,
      });

      const reader = new InventoryReader({
        config,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        solverEvmAddress: solverAccount.address,
        solverBchScriptHash: 'mock-script-hash',
        cacheTtlSeconds: 4,
      });

      const bchInv = await reader.getBchInventory();
      expect(bchInv.pusd).toBe(5000n); // 50.00 PUSD
      expect(bchInv.musd).toBe(2500n); // 25.00 MUSD
      expect(bchInv.sats).toBe(264600n); // 54600 + 10000 + 200000

      const evmInv = await reader.getEvmInventory('base');
      expect(evmInv.nativeWei).toBe(500_000_000_000_000_000n);

      const pusdBal = await reader.getAssetInventory({ asset: 'PUSD' });
      expect(pusdBal).toBe(5000n);

      const musdBal = await reader.getAssetInventory({ asset: 'MUSD' });
      expect(musdBal).toBe(2500n);
    });

    it('caches balance readings within TTL and re-fetches when cache expires', async () => {
      let callCount = 0;
      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: true,
          ageSeconds: 10,
        }),
        listUnspent: async () => {
          callCount++;
          return [];
        },
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1000, ageSeconds: 2 }),
        assets: [],
      } as unknown as EvmChainAdapter;

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
      });

      const reader = new InventoryReader({
        config,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        solverEvmAddress: solverAccount.address,
        solverBchScriptHash: 'mock-script-hash',
        cacheTtlSeconds: 2,
      });

      await reader.getBchInventory();
      await reader.getBchInventory();
      expect(callCount).toBe(1); // Cached

      reader.clearCache();
      await reader.getBchInventory();
      expect(callCount).toBe(2);
    });

    it('throws when BCH tip is stale or unhealthy', async () => {
      const fakeBch = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock': 330000 },
          isQuorumHealthy: false, // Unhealthy
          ageSeconds: 10,
        }),
        listUnspent: async () => [],
      } as unknown as BchQuorumClient;

      const fakeEvm = {
        id: 'base',
        getTip: async () => ({ height: 1000, ageSeconds: 2 }),
        assets: [],
      } as unknown as EvmChainAdapter;

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
      });

      const reader = new InventoryReader({
        config,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        solverEvmAddress: solverAccount.address,
      });

      await expect(reader.getBchInventory()).rejects.toThrow(
        /BCH node tip is stale or unhealthy/,
      );
    });

    it('throws when EVM tip is stale or age exceeds maximum', async () => {
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
        getTip: async () => ({ height: 1000, ageSeconds: 120 }), // max is 60s
        assets: [],
      } as unknown as EvmChainAdapter;

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        tipMaxAgeBaseSeconds: 60,
      });

      const reader = new InventoryReader({
        config,
        bchClient: fakeBch,
        evmAdapter: fakeEvm,
        solverEvmAddress: solverAccount.address,
      });

      await expect(reader.getEvmInventory('base')).rejects.toThrow(
        /EVM node tip for chain base is stale or unhealthy/,
      );
    });
  });

  describe('2. End-to-End Server Integration: Fake Chains (Unfunded, Partly Funded, Funded)', () => {
    let db: SolverDatabase;
    let engine: SolverEngine;
    let priceSource: MockPriceSource;
    let currentBchUtxos: Array<{
      height: number;
      tx_hash: string;
      tx_pos: number;
      value: number;
      token_data?: { category: string; amount: string };
    }> = [];
    const bchTipAge = 10;
    let bchQuorumHealthy = true;
    const evmTipAge = 5;

    let app: FastifyInstance;
    let inventoryReader: InventoryReader;

    beforeAll(async () => {
      db = new SolverDatabase(':memory:');
      const now = Math.floor(Date.now() / 1000);

      priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });
      priceSource.setPrice('MUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });

      const fakeBchClient = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock1': 330000, 'wss://mock2': 330000 },
          isQuorumHealthy: bchQuorumHealthy,
          isLivenessHealthy: bchQuorumHealthy,
          ageSeconds: bchTipAge,
          lastConfirmedAt: now - bchTipAge,
          quotingAllowed: true,
          quotingState: bchQuorumHealthy ? 'HEALTHY' : 'SPLIT_TIP',
        }),
        listUnspent: async () => currentBchUtxos,
        getHistory: async () => [],
        broadcast: async () => '0xmock-broadcast',
        subscribeScriptHash: async () => {},
        unsubscribeScriptHash: async () => {},
        close: () => {},
      } as unknown as BchQuorumClient;

      const fakeEvmAdapter = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 100_000_000n, // 100 USDC
        getNativeBalance: async () => 1_000_000_000_000_000_000n,
        getTip: async () => ({
          height: 1234567,
          ageSeconds: evmTipAge,
          stale: evmTipAge > 60,
        }),
        getLock: async () => ({ status: 'absent' }),
        isFinal: async () => true,
        assets: [],
      } as unknown as EvmChainAdapter;

      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        network: 'testnet',
        tipMaxAgeBchSeconds: 7200,
        tipMaxAgeBaseSeconds: 60,
        maxSwapUsdMicros: 50_000_000n, // $50 max
        spreadBps: 40,
        fixedFeeUsdMicros: 0n,
      });

      inventoryReader = new InventoryReader({
        config,
        bchClient: fakeBchClient,
        evmAdapter: fakeEvmAdapter,
        solverEvmAddress: solverAccount.address,
        solverBchScriptHash: 'mock-script-hash',
        cacheTtlSeconds: 4,
      });

      engine = new SolverEngine(
        db,
        {
          isQuorumHealthy: () => true,
          isQuotingEnabled: () => true,
          getTip: async () => ({ height: 330000, hash: '00'.repeat(32) }),
          broadcast: async (tx: string) => tx,
          isOnChain: async () => true,
          getScriptHashHistory: async () => [],
        },
        {
          getTip: async () => ({ height: 100, finalized: true }),
          getLock: async () => ({ status: 'none', amount: 0n }),
          isFinal: async () => true,
          broadcast: async (tx) => tx,
          isOnChain: async () => true,
        },
        config,
      );

      app = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource,
        inventoryReader,
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      db.close();
    });

    it('unfunded wallet: refuses quote with typed INSUFFICIENT_LIQUIDITY and maxAmount 0', async () => {
      inventoryReader.clearCache();
      currentBchUtxos = []; // Empty wallet

      const hashLock = sha256(('0x' + 'aa'.repeat(32)) as `0x${string}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '25000000', // $25
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const refusal = res.json();
      expect(refusal.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(refusal.maxAmount).toBe('0');
      expect(refusal.asset).toBe('PUSD');
      QuoteRefusalSchema.parse(refusal);
    });

    it('partly funded wallet: quotes within available balance, refuses when exceeding available with real maximum', async () => {
      inventoryReader.clearCache();
      // Wallet holds 50 PUSD (5000 atoms)
      currentBchUtxos = [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '5000', // 50.00 PUSD
          },
        },
      ];

      // Request $20 swap (needs ~19.92 PUSD) -> succeeds
      const hashLock1 = sha256(('0x' + 'b1'.repeat(32)) as `0x${string}`);
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '20000000', // $20
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock: hashLock1,
          lane: 'safe',
        },
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().terms.bchTokenAmount).toBe('1991');

      // Request another $40 swap (needs ~39.84 PUSD, but only ~30.08 PUSD remaining after 19.92 reservation) -> refuses
      const hashLock2 = sha256(('0x' + 'b2'.repeat(32)) as `0x${string}`);
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '40000000', // $40
          userEvmAddress: '0x9999999999999999999999999999999999999999',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock: hashLock2,
          lane: 'safe',
        },
      });
      expect(res2.statusCode).toBe(422);
      const refusal = res2.json();
      expect(refusal.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(refusal.maxAmount).toBe('30.09'); // Real maximum remaining (5000 - 1991 = 3009 units of 0.01)
      expect(refusal.asset).toBe('PUSD');
      QuoteRefusalSchema.parse(refusal);
    });

    it('stale BCH tip: refuses quote with typed INSUFFICIENT_LIQUIDITY and maxAmount 0', async () => {
      inventoryReader.clearCache();
      bchQuorumHealthy = false; // Quorum degraded

      const hashLock = sha256(('0x' + 'cc'.repeat(32)) as `0x${string}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '10000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const refusal = res.json();
      expect(refusal.reason).toBe('INSUFFICIENT_LIQUIDITY');
      expect(refusal.maxAmount).toBe('0');
      QuoteRefusalSchema.parse(refusal);

      bchQuorumHealthy = true; // Restore
      inventoryReader.clearCache();
    });

    it('dry-run quote returns valid quote without reserving liquidity or writing DB', async () => {
      inventoryReader.clearCache();
      currentBchUtxos = [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '50000', // 500 PUSD
          },
        },
      ];

      const hashLock = sha256(('0x' + 'dd'.repeat(32)) as `0x${string}`);
      const dryRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '15000000', // $15
          userEvmAddress: '0x1234567890123456789012345678901234567890',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
          dryRun: true,
        },
      });

      expect(dryRes.statusCode).toBe(200);
      const dryBody = dryRes.json();
      expect(dryBody.orderId).toBeDefined();
      expect(dryBody.terms).toBeDefined();
      expect(dryBody.signature).toBeDefined();

      // Check DB: order must NOT be saved
      const savedOrder = db.getOrder(dryBody.orderId);
      expect(savedOrder).toBeNull();
    });

    it('GET /v1/health returns tips (bchHeight, evmBlocks) and tipAges (bchSeconds, evmSeconds)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      HealthResponseSchema.parse(body);

      expect(body.tips).toBeDefined();
      expect(body.tips.bchHeight).toBe(330000);
      expect(body.tips.evmBlocks).toBeDefined();
      expect(body.tips.evmBlocks.base).toBe(1234567);

      expect(body.tipAges).toBeDefined();
      expect(body.tipAges.bchSeconds).toBe(bchTipAge);
      expect(body.tipAges.evmSeconds).toBeDefined();
      expect(body.tipAges.evmSeconds.base).toBe(evmTipAge);
    });

    it('GET /v1/chains reports every enabled route with enabled: true', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/chains',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      ChainsResponseSchema.parse(body);

      expect(body.chains).toBeInstanceOf(Array);
      const baseChain = body.chains.find(
        (c: { chainId: number; name: string; enabled: boolean }) =>
          c.name.toLowerCase().includes('base') ||
          c.chainId === 84532 ||
          c.chainId === 8453,
      );
      expect(baseChain).toBeDefined();
      expect(baseChain.enabled).toBe(true);
    });

    it('GET /v1/operator/inventory reports real inventory, reserved amounts, and exposure', async () => {
      inventoryReader.clearCache();
      currentBchUtxos = [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '50000',
          },
        },
      ];

      const res = await app.inject({
        method: 'GET',
        url: '/v1/operator/inventory',
        headers: { authorization: `Bearer ${operatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.assets).toBeInstanceOf(Array);
      expect(body.assets.length).toBeGreaterThanOrEqual(5);

      const pusd = body.assets.find(
        (a: { symbol: string }) => a.symbol === 'PUSD',
      );
      expect(pusd).toBeDefined();
      expect(pusd.balance).toBe('50000');
      expect(typeof pusd.reserved).toBe('string');
      expect(typeof pusd.available).toBe('string');

      const musd = body.assets.find(
        (a: { symbol: string }) => a.symbol === 'MUSD',
      );
      expect(musd).toBeDefined();

      const bch = body.assets.find(
        (a: { symbol: string }) => a.symbol === 'BCH',
      );
      expect(bch).toBeDefined();

      const usdc = body.assets.find(
        (a: { symbol: string }) => a.symbol === 'USDC',
      );
      expect(usdc).toBeDefined();

      expect(typeof body.skewBps).toBe('number');
      expect(typeof body.skewMaxBps).toBe('number');
    });

    it('GET /v1/liquidity reports real inventory with 2 decimals for both PUSD and MUSD', async () => {
      inventoryReader.clearCache();
      currentBchUtxos = [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '50000',
          },
        },
      ];

      const res = await app.inject({
        method: 'GET',
        url: '/v1/liquidity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.routes).toBeInstanceOf(Array);

      const pusdRoute = body.routes.find(
        (r: { asset: string }) => r.asset === 'PUSD',
      );
      expect(pusdRoute).toBeDefined();
      expect(pusdRoute.decimals).toBe(2);
      expect(pusdRoute.inventory).toBe('50000');

      const musdRoute = body.routes.find(
        (r: { asset: string }) => r.asset === 'MUSD',
      );
      expect(musdRoute).toBeDefined();
      expect(musdRoute.decimals).toBe(2); // MUSD has 2 decimals, not 8!
    });

    it('subtracts from a route only what the solver still has to lock from that inventory', async () => {
      inventoryReader.clearCache();
      currentBchUtxos = [
        {
          height: 330000,
          tx_hash: '12'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '50000',
          },
        },
      ];
      const now = Math.floor(Date.now() / 1000);
      const save = (
        id: string,
        direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
        status: 'USER_LOCK_FINAL' | 'SOLVER_LOCK_SEEN',
        bchToken: string,
        bchTokenAmount: string,
      ) =>
        db.saveOrder({
          id: ('0x' + id.repeat(32)) as `0x${string}`,
          direction,
          status,
          userCounterAddress: '0x' + '11'.repeat(20),
          lockId: ('0x' + id.repeat(32)) as `0x${string}`,
          termsJson: JSON.stringify({
            bchToken,
            bchTokenAmount: `${bchTokenAmount}n`,
            evmAmount: '13030000n',
            evmChainId: 5042,
            evmToken: '0x3600000000000000000000000000000000000000',
            evmDeadline: `${now + 3600}n`,
          }),
          hashLock: ('0x' + id.repeat(32)) as `0x${string}`,
          createdAt: now,
          updatedAt: now,
        });
      // Out of Bitcoin Cash on Arc, solver already locked: owes nothing more from any inventory.
      save('e1', 'BCH_TO_EVM', 'SOLVER_LOCK_SEEN', 'PUSD', '1303');
      // Into Bitcoin Cash as PUSD, solver already locked: already out of the PUSD inventory.
      save('e2', 'EVM_TO_BCH', 'SOLVER_LOCK_SEEN', 'PUSD', '1303');
      // Into Bitcoin Cash as PUSD, user locked, solver not yet: owed from the PUSD inventory only.
      save('e3', 'EVM_TO_BCH', 'USER_LOCK_FINAL', 'PUSD', '700');
      const res = await app.inject({ method: 'GET', url: '/v1/liquidity' });
      const body = res.json();
      const route = (asset: string) =>
        body.routes.find((r: { asset: string }) => r.asset === asset);
      expect(route('PUSD').exposure).toBe('700');
      expect(BigInt(route('PUSD').available)).toBe(
        50000n - 700n - BigInt(route('PUSD').reserved),
      );
      expect(route('MUSD').exposure).toBe('0');
    });
  });

  describe('3. Policy Authority (MAX_SWAP_USD_MICROS=1000000)', () => {
    let app: FastifyInstance;
    let db: SolverDatabase;

    beforeAll(async () => {
      db = new SolverDatabase(':memory:');
      const now = Math.floor(Date.now() / 1000);

      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now,
      });

      const fakeBchClient = {
        getQuorumStatus: () => ({
          quorumTip: 330000,
          tips: { 'wss://mock1': 330000 },
          isQuorumHealthy: true,
          ageSeconds: 10,
        }),
        listUnspent: async () => [
          {
            height: 330000,
            tx_hash: '11'.repeat(32),
            tx_pos: 0,
            value: 100000,
            token_data: {
              category:
                'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
              amount: '1000000', // 10,000 PUSD
            },
          },
        ],
      } as unknown as BchQuorumClient;

      const fakeEvmAdapter = {
        id: 'base',
        address: solverAccount.address,
        getTokenBalance: async () => 100_000_000n,
        getNativeBalance: async () => 1_000_000_000_000_000_000n,
        getTip: async () => ({ height: 1234567, ageSeconds: 5 }),
        assets: [],
      } as unknown as EvmChainAdapter;

      // Maintainer set MAX_SWAP_USD_MICROS=1000000 ($1.00)
      const config = SolverConfigSchema.parse({
        solverEvmPrivateKey: solverEvmKey,
        operatorToken,
        maxSwapUsdMicros: 1_000_000n, // $1.00 max swap!
        minSwapUsdMicros: 1_000_000n, // $1.00 min swap
      });

      const engine = new SolverEngine(
        db,
        {
          isQuorumHealthy: () => true,
          isQuotingEnabled: () => true,
          getTip: async () => ({ height: 330000, hash: '00'.repeat(32) }),
          broadcast: async (tx: string) => tx,
          isOnChain: async () => true,
          getScriptHashHistory: async () => [],
        },
        {
          getTip: async () => ({ height: 100, finalized: true }),
          getLock: async () => ({ status: 'none', amount: 0n }),
          isFinal: async () => true,
          broadcast: async (tx) => tx,
          isOnChain: async () => true,
        },
        config,
      );

      app = buildServer({
        config,
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource,
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      db.close();
    });

    it('GET /v1/stats reflects maxUsd: 1.00 authoritative policy', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/stats',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      StatsResponseSchema.parse(body);

      expect(body.quotePolicy).toBeDefined();
      expect(body.quotePolicy.maxUsd).toBe('1.00');
      expect(body.quotePolicy.minUsd).toBe('1.00');
    });

    it('POST /v1/quotes refuses swaps over $1.00 with OVER_MAX_SWAP and maxAmount: 1.00', async () => {
      const hashLock = sha256(('0x' + 'ee'.repeat(32)) as `0x${string}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '2000000', // $2.00 exceeds $1.00 max!
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const refusal = res.json();
      expect(refusal.reason).toBe('OVER_MAX_SWAP');
      expect(refusal.maxAmount).toBe('1.00');
      expect(refusal.message).toBe(
        'Amount $2.00 exceeds maximum swap of $1.00',
      );
      QuoteRefusalSchema.parse(refusal);
    });

    it('POST /v1/quotes accepts swaps at or below $1.00', async () => {
      const hashLock = sha256(('0x' + 'ff'.repeat(32)) as `0x${string}`);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          amountIn: '1000000', // $1.00 exactly at max
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().orderId).toBeDefined();
    });
  });
});
