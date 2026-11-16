import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { SolverDatabase } from '../src/db/database.js';
import { SolverEngine, stringifyTerms } from '../src/engine/runner.js';
import type {
  BchChainPort,
  EvmChainPort,
  EvmLockState,
} from '../src/engine/types.js';
import { ActionExecutor } from '../src/executor/action-executor.js';
import type { ChainPort } from '../src/executor/types.js';
import { BchQuorumClient } from '../src/bch/quorum-client.js';
import type {
  ElectrumTransport,
  ServerFeatures,
} from '../src/bch/transport.js';
import {
  MockPriceSource,
  PRICE_MAX_AGE_S,
} from '../src/pricing/price-source.js';
import { LiquidityManager } from '../src/pricing/liquidity.js';
import { QuoteBuilder } from '../src/pricing/quote-builder.js';
import { parseOrderTerms } from '@ferry/core';

function sha256Hex(hexWithoutPrefix: string): `0x${string}` {
  return `0x${crypto.createHash('sha256').update(Buffer.from(hexWithoutPrefix, 'hex')).digest('hex')}` as `0x${string}`;
}

const defaultSecret =
  '0x112233445566778899001122334455667788990011223344556677889900aabb' as const;
const defaultHashLock = sha256Hex(defaultSecret.slice(2));

describe('Chaos & Failure Tests (Blueprint §11.3)', () => {
  const dummyForwardTerms = parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 2485n,
    evmAmount: 25000000n,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    evmChainId: 8453,
    evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode:
      '0x76a914000000000000000000000000000000000000000088ac',
    solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
    solverBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    hashLock: defaultHashLock,
    evmDeadline: Math.floor(Date.now() / 1000) + 86400,
    bchRefundHeight: 330036,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'chaos-quote-fwd',
    quoteExpiry: Math.floor(Date.now() / 1000) + 300,
    pricing: {
      refs: [
        {
          asset: 'PUSD',
          usdPrice: '1.000',
          source: 'cauldron',
          asOf: Math.floor(Date.now() / 1000) - 10,
        },
      ],
      spreadBps: 50,
      fixedFeeBase: 0n,
      rounding: 'floor',
    },
  });

  const dummyReverseTerms = parseOrderTerms({
    ...dummyForwardTerms,
    direction: 'BCH_TO_EVM',
    evmDeadline: Math.floor(Date.now() / 1000) + 21600,
    bchRefundHeight: 330144,
    quoteId: 'chaos-quote-rev',
  });

  // 1. Kill process at each state and restart -> asserting terminal state and no duplicate broadcast
  describe('1. Kill process at each state and restart (CH-01)', () => {
    it('forward swap reaches terminal DONE state without duplicate broadcast when killed at each transition', async () => {
      const db = new SolverDatabase(':memory:');
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'chaos-fwd-order',
        direction: 'EVM_TO_BCH',
        status: 'QUOTED',
        userCounterAddress: dummyForwardTerms.userEvmAddress,
        lockId: dummyForwardTerms.hashLock,
        termsJson: stringifyTerms(dummyForwardTerms),
        hashLock: defaultHashLock,
        createdAt: now,
        updatedAt: now,
      });

      let evmLockState: EvmLockState = { status: 'none' };
      let evmIsFinal = false;
      let bchHistory: Array<{ tx_hash: string; height: number }> = [];
      let bchOnChain = false;
      let evmOnChain = false;

      const bchBroadcasts: string[] = [];
      const evmBroadcasts: string[] = [];

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async (hex: string) => {
          bchBroadcasts.push(hex);
          bchOnChain = true;
          return 'bch_txid_fwd';
        },
        isOnChain: async () => bchOnChain,
        getScriptHashHistory: async () => bchHistory,
        extractSecretFromSpend: async () => defaultSecret,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => evmLockState,
        isFinal: async () => evmIsFinal,
        broadcast: async (hex: string) => {
          evmBroadcasts.push(hex);
          evmOnChain = true;
          return 'evm_txid_claim';
        },
        isOnChain: async () => evmOnChain,
      };

      // State: QUOTED -> Kill & restart
      let engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-fwd-order')?.status).toBe('QUOTED');
      engine.stop();

      // User locks on EVM -> Kill & restart
      evmLockState = { status: 'locked', txid: 'evm_lock_tx' };
      evmIsFinal = false;
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-fwd-order')?.status).toBe('USER_LOCK_SEEN');
      engine.stop();

      // EVM lock finalizes -> Solver counter-locks on BCH
      evmIsFinal = true;
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-fwd-order')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(bchBroadcasts.length).toBe(1);
      engine.stop();

      // Crash & restart during SOLVER_LOCK_SEEN -> reconciliation must NOT rebroadcast
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-fwd-order')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(bchBroadcasts.length).toBe(1);
      engine.stop();

      // User claims BCH revealing secret -> Solver claims EVM
      bchHistory = [{ tx_hash: 'bch_user_claim', height: 330005 }];
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-fwd-order')?.status).toBe('DONE');
      expect(evmBroadcasts.length).toBe(1);
      engine.stop();

      // Post-terminal restart -> stays DONE, no rebroadcasts
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-fwd-order')?.status).toBe('DONE');
      expect(bchBroadcasts.length).toBe(1);
      expect(evmBroadcasts.length).toBe(1);
      engine.stop();
      db.close();
    });

    it('reverse swap reaches terminal DONE state without duplicate broadcast when killed at each transition', async () => {
      const db = new SolverDatabase(':memory:');
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'chaos-rev-order',
        direction: 'BCH_TO_EVM',
        status: 'QUOTED',
        userCounterAddress: dummyReverseTerms.userEvmAddress,
        lockId: dummyReverseTerms.hashLock,
        termsJson: stringifyTerms(dummyReverseTerms),
        hashLock: defaultHashLock,
        createdAt: now,
        updatedAt: now,
      });

      let bchHistory: Array<{ tx_hash: string; height: number }> = [];
      let evmLockState: EvmLockState = { status: 'none' };
      let bchOnChain = false;
      let evmOnChain = false;

      const bchBroadcasts: string[] = [];
      const evmBroadcasts: string[] = [];

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async (hex: string) => {
          bchBroadcasts.push(hex);
          bchOnChain = true;
          return 'bch_claim_tx';
        },
        isOnChain: async () => bchOnChain,
        getScriptHashHistory: async () => bchHistory,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => evmLockState,
        isFinal: async () => true,
        broadcast: async (hex: string) => {
          evmBroadcasts.push(hex);
          evmOnChain = true;
          return 'evm_lock_tx';
        },
        isOnChain: async () => evmOnChain,
      };

      // State: QUOTED -> Kill & restart
      let engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-rev-order')?.status).toBe('QUOTED');
      engine.stop();

      // User locks on BCH with 10 confirmations -> Solver locks on EVM
      bchHistory = [{ tx_hash: 'bch_user_lock_final', height: 329980 }];
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-rev-order')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(evmBroadcasts.length).toBe(1);
      engine.stop();

      // Crash & restart during SOLVER_LOCK_SEEN -> reconciliation must NOT rebroadcast
      evmLockState = { status: 'locked', txid: 'evm_lock_tx' };
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-rev-order')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(evmBroadcasts.length).toBe(1);
      engine.stop();

      // User claims EVM revealing secret -> Solver claims BCH
      evmLockState = {
        status: 'claimed',
        txid: 'evm_user_claim_tx',
        secret: defaultSecret,
      };
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-rev-order')?.status).toBe('DONE');
      expect(bchBroadcasts.length).toBe(1);
      engine.stop();

      // Post-terminal restart -> stays DONE, no rebroadcasts
      engine = new SolverEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('chaos-rev-order')?.status).toBe('DONE');
      expect(evmBroadcasts.length).toBe(1);
      expect(bchBroadcasts.length).toBe(1);
      engine.stop();
      db.close();
    });
  });

  // 2. RPC down mid-swap -> asserting terminal state / retry and no duplicate broadcast
  describe('2. RPC down mid-swap (CH-02)', () => {
    it('handles transient RPC failure without duplicate broadcast or intent loss, then resumes to terminal state', async () => {
      const db = new SolverDatabase(':memory:');
      const orderId = 'order-rpc-down-test';
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: orderId,
        direction: 'EVM_TO_BCH',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: '0xuser',
        lockId: '0xlock',
        termsJson: stringifyTerms(dummyForwardTerms),
        hashLock: defaultHashLock,
        createdAt: now,
        updatedAt: now,
      });

      let rpcHealthy = false;
      let broadcastAttempts = 0;
      const chainBroadcasts: string[] = [];

      const chainPort: ChainPort = {
        broadcast: async (hex: string) => {
          broadcastAttempts++;
          if (!rpcHealthy) {
            // Transient network / RPC timeout
            throw new Error('connect ECONNREFUSED 127.0.0.1:8545');
          }
          chainBroadcasts.push(hex);
          return 'txid_recovered';
        },
        isOnChain: async () => chainBroadcasts.length > 0,
      };

      const executor = new ActionExecutor(db, chainPort);

      // Attempt 1: RPC is DOWN
      await expect(
        executor.executeOrAdopt({
          orderId,
          actionType: 'SOLVER_LOCK',
          buildTx: async () => ({
            txid: 'txid_recovered',
            txHex: '0100000001dummy_bytes',
          }),
        }),
      ).rejects.toThrow('ECONNREFUSED');

      // Intent MUST remain recorded in SQLite as PENDING (unknown outcome)
      const actionAfterFail = db.getAction(orderId, 'SOLVER_LOCK');
      expect(actionAfterFail).not.toBeNull();
      expect(actionAfterFail?.status).toBe('PENDING');
      expect(chainBroadcasts.length).toBe(0);

      // Attempt 2: RPC RECOVERS
      rpcHealthy = true;
      const result = await executor.executeOrAdopt({
        orderId,
        actionType: 'SOLVER_LOCK',
        buildTx: async () => ({
          txid: 'txid_recovered',
          txHex: '0100000001dummy_bytes',
        }),
      });

      expect(result.txid).toBe('txid_recovered');
      expect(chainBroadcasts.length).toBe(1);
      expect(broadcastAttempts).toBe(2);

      // Final action record is BROADCAST
      const actionFinal = db.getAction(orderId, 'SOLVER_LOCK');
      expect(actionFinal?.status).toBe('BROADCAST');

      // Attempt 3: Idempotent rerun must NOT broadcast again
      const result3 = await executor.executeOrAdopt({
        orderId,
        actionType: 'SOLVER_LOCK',
        buildTx: async () => ({
          txid: 'txid_recovered',
          txHex: '0100000001dummy_bytes',
        }),
      });

      expect(result3.txid).toBe('txid_recovered');
      expect(chainBroadcasts.length).toBe(1); // STILL 1! No duplicate broadcast!
      db.close();
    });
  });

  // 3. Electrum server lying (genesis mismatch)
  describe('3. Electrum server lying (genesis mismatch)', () => {
    it('drops server with genesis mismatch and disables quoting when healthy servers fall below threshold', async () => {
      // Mock transport for server 1 (lying server with wrong genesis)
      const lyingTransport: ElectrumTransport = {
        url: 'wss://lying-node:50004',
        connect: async () => {},
        close: () => {},
        isConnected: () => true,
        getGenesisHash: () =>
          '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f', // mainnet genesis instead of chipnet!
        fetchFeatures: async (): Promise<ServerFeatures> => ({
          genesis_hash:
            '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
          server_version: 'MockLyingServer 1.0',
          protocol_min: '1.4',
          protocol_max: '1.6',
        }),
        request: async <T>() => ({}) as T,
        getTip: () => ({
          height: 330000,
          timestamp: Math.floor(Date.now() / 1000),
        }),
        getLastConfirmedAt: () => Math.floor(Date.now() / 1000),
        ping: async () => true,
      };

      // Mock transport for server 2 (honest chipnet server)
      const honestTransport: ElectrumTransport = {
        url: 'wss://honest-chipnet:50004',
        connect: async () => {},
        close: () => {},
        isConnected: () => true,
        getGenesisHash: () =>
          '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b', // chipnet genesis
        fetchFeatures: async (): Promise<ServerFeatures> => ({
          genesis_hash:
            '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
          server_version: 'MockHonestServer 1.0',
          protocol_min: '1.4',
          protocol_max: '1.6',
        }),
        request: async <T>() => ({}) as T,
        getTip: () => ({
          height: 330000,
          timestamp: Math.floor(Date.now() / 1000),
        }),
        getLastConfirmedAt: () => Math.floor(Date.now() / 1000),
        ping: async () => true,
      };

      // Client configured for chipnet with 1 honest and 1 lying server
      const client = new BchQuorumClient([honestTransport, lyingTransport], {
        network: 'chipnet',
      });

      await client.connect();

      // The lying server MUST be dropped
      expect(client.getDroppedTransports().length).toBe(1);
      expect(client.getDroppedTransports()[0]?.url).toBe(
        'wss://lying-node:50004',
      );

      // Only the honest server remains active
      expect(client.getActiveTransports().length).toBe(1);
      expect(client.getActiveTransports()[0]?.url).toBe(
        'wss://honest-chipnet:50004',
      );

      client.close();

      // Case B: ONLY lying server provided -> throws and refuses connection
      const lyingOnlyClient = new BchQuorumClient([lyingTransport], {
        network: 'chipnet',
      });

      await expect(lyingOnlyClient.connect()).rejects.toThrow(
        /All servers failed genesis verification/,
      );
      lyingOnlyClient.close();
    });
  });

  // 4. Price source stale -> refuses quote with typed refusal, no order created
  describe('4. Price source stale', () => {
    it('refuses quote with PRICE_UNAVAILABLE when price source is stale, creating no order', async () => {
      const now = 1700000000;
      const priceSource = new MockPriceSource();
      priceSource.setPrice('USDC', {
        usdPrice: 1_000_000n,
        source: 'chainlink',
        asOf: now,
      });
      // PUSD price is stale (older than PRICE_MAX_AGE_S = 30s)
      priceSource.setPrice('PUSD', {
        usdPrice: 1_000_000n,
        source: 'cauldron',
        asOf: now - (PRICE_MAX_AGE_S + 10),
      });

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager, {
        spreadBps: 40,
        fixedFeeUsdMicros: 0n,
      });

      const quoteResult = await quoteBuilder.buildQuote({
        quoteId: 'stale-price-quote',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xAlice',
        userIp: '1.2.3.4',
        currentInventory: 100_000_000n,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: dummyForwardTerms,
      });

      expect(quoteResult.ok).toBe(false);
      if (!quoteResult.ok) {
        expect(quoteResult.reason).toBe('PRICE_UNAVAILABLE');
      }
    });
  });

  // 5. Reservation race -> two simultaneous quotes for remaining inventory, second refused
  describe('5. Reservation race', () => {
    it('refuses second simultaneous quote when first reserves remaining inventory, stating maximum available', async () => {
      const now = 1700000000;
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

      const liquidityManager = new LiquidityManager();
      const quoteBuilder = new QuoteBuilder(priceSource, liquidityManager, {
        spreadBps: 40,
        fixedFeeUsdMicros: 0n,
      });

      // Total available inventory is exactly 3000 PUSD ($30.00)
      const currentInventory = 3000n;

      // Quote 1 requests 2500 PUSD ($25.00) -> succeeds and reserves 2500 PUSD
      const q1 = await quoteBuilder.buildQuote({
        quoteId: 'race-q1',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xAlice',
        userIp: '1.1.1.1',
        currentInventory,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: dummyForwardTerms,
      });

      expect(q1.ok).toBe(true);

      // Quote 2 requests 2500 PUSD concurrently -> only 500 PUSD remains unreserved
      const q2 = await quoteBuilder.buildQuote({
        quoteId: 'race-q2',
        direction: 'EVM_TO_BCH',
        payAsset: 'USDC',
        receiveAsset: 'PUSD',
        amountIn: 25_000_000n,
        userAddress: '0xBob',
        userIp: '2.2.2.2',
        currentInventory,
        openExposure: 0n,
        nowSeconds: now,
        termsTemplate: dummyForwardTerms,
      });

      expect(q2.ok).toBe(false);
      if (!q2.ok) {
        expect(q2.reason).toBe('INSUFFICIENT_LIQUIDITY');
        // Refusal states remaining available amount (510 cents)
        expect(Number(q2.maxAmount)).toBeLessThanOrEqual(515);
      }
    });
  });
});
