import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import { buildServer } from '../src/api/server.js';
import { loadConfigFromEnv } from '../src/config.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverEngine } from '../src/engine/runner.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import type { BchChainPort, EvmChainPort } from '../src/engine/types.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';

describe('B4-07 Adversarial Defect Fixes (Quoting & Operator Safety)', () => {
  const solverKey =
    '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
  const operatorToken = 'op_test_token_12345678901234567890';
  const validEvmToken = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'; // Base USDC

  let db: SolverDatabase;
  let priceSource: MockPriceSource;
  let engine: SolverEngine;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    priceSource = new MockPriceSource(
      new Map([
        ['usdc', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
        ['pusd', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
      ]),
    );

    const bchPort: BchChainPort = {
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      getTip: async () => ({ height: 870_000, hash: '00'.repeat(32) }),
      broadcast: async (txHex: string) => txHex,
      isOnChain: async () => true,
      getScriptHashHistory: async () => [],
    };

    const bchClient = {
      ...bchPort,
      getQuorumStatus: () => ({
        quorumTip: 870_000,
        tips: { 'wss://node1': 870_000, 'wss://node2': 870_000 },
        isQuorumHealthy: true,
        isLivenessHealthy: true,
        ageSeconds: 5,
        lastConfirmedAt: now - 5,
        livenessAgeSeconds: 5,
        healthyServersCount: 2,
        quotingAllowed: true,
        quotingState: 'HEALTHY',
      }),
      waitForDoubleSpendProof: async () => ({ hasProof: false }),
      broadcastTransaction: async (txHex: string) => txHex,
      start: async () => {},
      stop: async () => {},
    } as unknown as BchQuorumClient;

    const evmPort: EvmChainPort = {
      getTip: async () => ({ height: 100, finalized: true }),
      getLock: async () => ({ status: 'none', amount: 0n }),
      isFinal: async () => true,
      broadcast: async (txHex) => txHex,
      isOnChain: async () => true,
    };

    const mockEvmAdapter = {
      id: 'base',
      chainId: 84532,
      getTip: async () => ({ height: 100, ageSeconds: 1 }),
      getLock: async () => ({ status: 'absent' }),
    } as unknown as EvmChainAdapter;

    const config = loadConfigFromEnv({
      ALLOW_DEV_KEYS: '1',
      OPERATOR_TOKEN: operatorToken,
      SOLVER_EVM_PRIVATE_KEY: solverKey,
      BASE_CHAIN_ID: '84532',
      BASE_FERRY_HTLC_ADDRESS: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      BASE_USDC_ADDRESS: validEvmToken,
    });

    engine = new SolverEngine(db, bchPort, evmPort, config);
    app = buildServer({
      config,
      db,
      engine,
      bchClient,
      priceSource,
      evmAdapter: mockEvmAdapter,
    });
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  describe('1. Defect 1: Unconfigured / fee-on-transfer evmToken and invalid evmChainId', () => {
    const hashLock = sha256(('0x' + '22'.repeat(32)) as `0x${string}`);

    it('refuses quote with ROUTE_DISABLED when evmToken is unconfigured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: '0x1111111111111111111111111111111111111111',
          amountIn: '2000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const json = res.json();
      expect(json.reason).toBe('ROUTE_DISABLED');
      expect(json.asset).toBe('PUSD');
    });

    it('refuses quote with ROUTE_DISABLED when evmChainId is unconfigured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 999999,
          evmToken: validEvmToken,
          amountIn: '2000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(422);
      const json = res.json();
      expect(json.reason).toBe('ROUTE_DISABLED');
      expect(json.asset).toBe('PUSD');
    });

    it('accepts quote when chain and token match configured route', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: validEvmToken,
          amountIn: '2000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.orderId).toBeDefined();
    });
  });

  describe('2. Defect 2: Kill-switch and Pause stop quoting with DB persistence', () => {
    const hashLock = sha256(('0x' + '33'.repeat(32)) as `0x${string}`);

    it('kill-switch pauses quoting, persists to DB, and returns QUOTING_PAUSED on quotes', async () => {
      // 1. Activate kill switch
      const ksRes = await app.inject({
        method: 'POST',
        url: '/v1/kill-switch',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(ksRes.statusCode).toBe(200);
      expect(ksRes.json().ok).toBe(true);
      expect(ksRes.json().quotingEnabled).toBe(false);

      // 2. Verify state is persisted in DB
      expect(db.isQuotingPaused()).toBe(true);

      // 3. Quoting should now be refused with 422 QUOTING_PAUSED
      const quoteRes = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: validEvmToken,
          amountIn: '2000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });
      expect(quoteRes.statusCode).toBe(422);
      expect(quoteRes.json().reason).toBe('QUOTING_PAUSED');

      // 4. GET /v1/health reflects quotingEnabled: false
      const healthRes = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(healthRes.json().quotingEnabled).toBe(false);

      // 5. Resume quoting
      const resumeRes = await app.inject({
        method: 'POST',
        url: '/v1/resume',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(resumeRes.statusCode).toBe(200);
      expect(resumeRes.json().quotingEnabled).toBe(true);
      expect(db.isQuotingPaused()).toBe(false);

      // 6. Quoting works again
      const quoteRes2 = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: validEvmToken,
          amountIn: '2000000',
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'safe',
        },
      });
      expect(quoteRes2.statusCode).toBe(200);

      // 7. Pause quoting via /v1/pause
      const pauseRes = await app.inject({
        method: 'POST',
        url: '/v1/pause',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
      expect(pauseRes.statusCode).toBe(200);
      expect(pauseRes.json().quotingEnabled).toBe(false);
      expect(db.isQuotingPaused()).toBe(true);

      // Clean up for subsequent tests
      await app.inject({
        method: 'POST',
        url: '/v1/resume',
        headers: { authorization: `Bearer ${operatorToken}` },
      });
    });
  });

  describe('3. Defect 3: 18-decimal amountIn handling in fast-lane', () => {
    const hashLock = sha256(('0x' + '44'.repeat(32)) as `0x${string}`);

    it('accepts $5.00 in 18 decimals on fast lane without exceeding $25 cap', async () => {
      // 5 * 10^18 base units = $5.00
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: validEvmToken,
          amountIn: (5n * 10n ** 18n).toString(),
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'fast',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.orderId).toBeDefined();
      expect(json.terms.evmAmount).toBe((5n * 10n ** 18n).toString());
    });

    it('refuses $30.00 in 18 decimals on fast lane because it exceeds $25 cap', async () => {
      // 30 * 10^18 base units = $30.00
      const res = await app.inject({
        method: 'POST',
        url: '/v1/quotes',
        payload: {
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: 84532,
          evmToken: validEvmToken,
          amountIn: (30n * 10n ** 18n).toString(),
          userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock,
          lane: 'fast',
        },
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error.code).toBe('AMOUNT_OUT_OF_RANGE');
    });
  });
});
