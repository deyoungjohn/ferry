import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { SolverDatabase } from '../src/db/database.js';
import {
  orderRecordToSolverOrder,
  stringifyTerms,
  type SolverEngine,
} from '../src/engine/runner.js';
import type {
  BchChainPort,
  EvmChainPort,
  EvmLockState,
} from '../src/engine/types.js';
import { parseOrderTerms } from '@ferry/core';
import { newTestEngine } from './support/test-engine.js';
import { buildServer } from '../src/api/server.js';
import { loadConfigFromEnv } from '../src/config.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';

function sha256Hex(hexWithoutPrefix: string): `0x${string}` {
  return `0x${crypto.createHash('sha256').update(Buffer.from(hexWithoutPrefix, 'hex')).digest('hex')}` as `0x${string}`;
}

const defaultSecret =
  '0x112233445566778899001122334455667788990011223344556677889900aabb' as const;
const defaultHashLock = sha256Hex(defaultSecret.slice(2));

describe('Solver Early Release and Automatic Refund Keeper', () => {
  const makeTerms = (overrides = {}) =>
    parseOrderTerms({
      version: 1,
      direction: 'EVM_TO_BCH',
      bchToken: 'PUSD',
      bchTokenCategory: `0x${'aa'.repeat(32)}`,
      bchTokenAmount: 2485n,
      evmAmount: 25000000n,
      evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      evmChainId: 8453,
      evmHtlc: '0xfC28c2596C553353578a5a444d2316514009DAdF',
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
      quoteId: 'test-quote-fwd',
      quoteExpiry: Math.floor(Date.now() / 1000) + 300,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.000',
            source: 'cauldron',
            asOf: Math.floor(Date.now() / 1000),
          },
          {
            asset: 'USDC',
            usdPrice: '1.000',
            source: 'chainlink',
            asOf: Math.floor(Date.now() / 1000),
          },
        ],
        spreadBps: 40,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
      ...overrides,
    });

  it('early-releases user EVM lock when timing invariant F fails', async () => {
    const db = new SolverDatabase(':memory:');
    const terms = makeTerms({
      // bchRefundHeight equal to tip -> remainingBlocks <= 0 -> invariant F fails immediately
      bchRefundHeight: 330000,
    });

    db.saveOrder({
      id: 'ord-timing-fail',
      direction: 'EVM_TO_BCH',
      status: 'USER_LOCK_FINAL',
      userCounterAddress: terms.userEvmAddress,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      userLockTxId: '0x' + '11'.repeat(32),
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    });

    const releaseMock = vi.fn().mockResolvedValue({
      txid: '0x' + 'aa'.repeat(32),
      txHex: '0x' + 'aa'.repeat(32),
    });

    const bchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x0' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'bch_ok',
      isOnChain: async () => false,
      getScriptHashHistory: async () => [],
    };

    const evmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async () => 'evm_ok',
      isOnChain: async (txid) => txid === '0x' + 'aa'.repeat(32),
      release: releaseMock,
    };

    const engine = newTestEngine(db, bchPort, evmPort);
    await engine.reconcileOrders();

    expect(releaseMock).toHaveBeenCalledTimes(1);

    const order = db.getOrder('ord-timing-fail');
    expect(order?.status).toBe('RELEASED');
    expect(order?.solverRefundTxId).toBe('0x' + 'aa'.repeat(32));
    expect(order?.rejectionReason).toContain('Timing invariant F failed');
  });

  it('early-releases user EVM lock when quote expires before BCH lock', async () => {
    const db = new SolverDatabase(':memory:');
    const terms = makeTerms({
      quoteExpiry: Math.floor(Date.now() / 1000) - 10, // already expired
    });

    db.saveOrder({
      id: 'ord-expired-quote',
      direction: 'EVM_TO_BCH',
      status: 'USER_LOCK_FINAL',
      userCounterAddress: terms.userEvmAddress,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      userLockTxId: '0x' + '11'.repeat(32),
      createdAt: Math.floor(Date.now() / 1000) - 60,
      updatedAt: Math.floor(Date.now() / 1000) - 60,
    });

    const releaseMock = vi.fn().mockResolvedValue({
      txid: '0x' + 'bb'.repeat(32),
      txHex: '0x' + 'bb'.repeat(32),
    });

    const bchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x0' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'bch_ok',
      isOnChain: async () => false,
      getScriptHashHistory: async () => [],
    };

    const evmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async () => 'evm_ok',
      isOnChain: async (txid) => txid === '0x' + 'bb'.repeat(32),
      release: releaseMock,
    };

    const engine = newTestEngine(db, bchPort, evmPort);
    await engine.reconcileOrders();

    expect(releaseMock).toHaveBeenCalledTimes(1);

    const order = db.getOrder('ord-expired-quote');
    expect(order?.status).toBe('RELEASED');
    expect(order?.solverRefundTxId).toBe('0x' + 'bb'.repeat(32));
    expect(order?.rejectionReason).toContain('after the quote expired');
  });

  it('does not release a lock that was made in time just because the chain was slow to finalize it', async () => {
    const db = new SolverDatabase(':memory:');
    const nowSec = Math.floor(Date.now() / 1000);
    // The quote lapsed 10 seconds ago; the user locked 10 minutes ago, well inside it.
    const terms = makeTerms({ quoteExpiry: nowSec - 10 });
    db.saveOrder({
      id: 'ord-slow-chain',
      direction: 'EVM_TO_BCH',
      status: 'USER_LOCK_FINAL',
      userCounterAddress: terms.userEvmAddress,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      userLockTxId: '0x' + '11'.repeat(32),
      createdAt: nowSec - 700,
      updatedAt: nowSec - 700,
    });
    const releaseMock = vi.fn();
    const bchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x0' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'bch_ok',
      isOnChain: async () => false,
      getScriptHashHistory: async () => [],
    };
    const evmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: 'locked' }),
      isFinal: async () => true,
      broadcast: async () => 'evm_ok',
      isOnChain: async () => false,
      release: releaseMock,
      getLockEvidence: async () => ({
        confirmations: 50,
        ageSeconds: 600,
        finalized: true,
      }),
    };
    const engine = newTestEngine(db, bchPort, evmPort);
    await engine.reconcileOrders();
    expect(releaseMock).not.toHaveBeenCalled();
    expect(db.getOrder('ord-slow-chain')?.status).not.toBe('RELEASED');
  });

  it('exposes txids.evmRefund and status RELEASED via GET /v1/orders/:id', async () => {
    const db = new SolverDatabase(':memory:');
    const terms = makeTerms({ evmChainId: 84532 });
    const orderId = '0x' + 'ee'.repeat(32);

    db.saveOrder({
      id: orderId,
      direction: 'EVM_TO_BCH',
      status: 'RELEASED',
      userCounterAddress: terms.userEvmAddress,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      userLockTxId: '0x' + '11'.repeat(32),
      solverRefundTxId: '0x' + 'cc'.repeat(32),
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    });

    const config = loadConfigFromEnv({
      NETWORK: 'testnet',
      ALLOW_DEV_KEYS: '1',
      BASE_FERRY_HTLC_ADDRESS: terms.evmHtlc,
    });

    const app = buildServer({
      config,
      db,
      evmAdapter: {
        id: 'base',
        getTip: async () => ({ height: 100, ageSeconds: 1, stale: false }),
      } as unknown as EvmChainAdapter,
      bchClient: {
        isHealthy: () => true,
        getQuorumStatus: () => ({
          isQuorumHealthy: true,
          isLivenessHealthy: true,
          quorumTip: 330000,
          ageSeconds: 1,
        }),
      } as unknown as BchQuorumClient,
      engine: { isQuotingEnabled: () => true } as unknown as SolverEngine,
      priceSource: new MockPriceSource(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe('RELEASED');
    expect(body.txids.evmRefund).toBe('0x' + 'cc'.repeat(32));

    await app.close();
  });

  it('automatic refund keeper finds expired EVM lock and refunds it idempotently', async () => {
    const db = new SolverDatabase(':memory:');
    const now = Math.floor(Date.now() / 1000);
    const terms = makeTerms({
      evmDeadline: now - 100, // deadline passed
    });

    db.saveOrder({
      id: 'ord-keeper-refund',
      direction: 'EVM_TO_BCH',
      status: 'USER_LOCK_SEEN',
      userCounterAddress: terms.userEvmAddress,
      lockId: terms.hashLock,
      termsJson: stringifyTerms(terms),
      hashLock: terms.hashLock,
      userLockTxId: '0x' + '11'.repeat(32),
      createdAt: now - 200,
      updatedAt: now - 200,
    });

    const refundMock = vi.fn().mockResolvedValue({
      txid: '0x' + 'dd'.repeat(32),
      txHex: '0x' + 'dd'.repeat(32),
    });

    const bchPort: BchChainPort = {
      getTip: async () => ({ height: 330000, hash: '0x0' }),
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      broadcast: async () => 'bch_ok',
      isOnChain: async () => false,
      getScriptHashHistory: async () => [],
    };

    let lockStatus: EvmLockState['status'] = 'locked';
    const evmPort: EvmChainPort = {
      getTip: async () => ({ height: 1000, finalized: true }),
      getLock: async () => ({ status: lockStatus }),
      isFinal: async () => true,
      broadcast: async () => 'evm_ok',
      isOnChain: async (txid) => txid === '0x' + 'dd'.repeat(32),
      refund: refundMock,
    };

    const engine = newTestEngine(db, bchPort, evmPort);

    // Pass 1: keeper runs and refunds expired lock
    await engine.runRefundKeeper();
    expect(refundMock).toHaveBeenCalledTimes(1);

    const order = db.getOrder('ord-keeper-refund');
    expect(order?.status).toBe('SOLVER_REFUNDED');
    expect(order?.solverRefundTxId).toBe('0x' + 'dd'.repeat(32));

    // Pass 2: idempotent: running keeper again does NOT re-call refund
    lockStatus = 'refunded';
    await engine.runRefundKeeper();
    expect(refundMock).toHaveBeenCalledTimes(1);
  });

  describe('Early release on the Bitcoin Cash side (reverse swaps: BCH_TO_EVM)', () => {
    const makeReverseTerms = (overrides = {}) =>
      parseOrderTerms({
        version: 1,
        direction: 'BCH_TO_EVM',
        bchToken: 'PUSD',
        bchTokenCategory: `0x${'aa'.repeat(32)}`,
        bchTokenAmount: 2500n,
        evmAmount: 25000000n,
        evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        evmChainId: 8453,
        evmHtlc: '0xfC28c2596C553353578a5a444d2316514009DAdF',
        userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
        userBchLockingBytecode:
          '0x76a914000000000000000000000000000000000000000088ac',
        solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
        solverBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        hashLock: defaultHashLock,
        evmDeadline: Math.floor(Date.now() / 1000) + 7200,
        bchRefundHeight: 330036,
        bchCarrySats: 3000n,
        bchMaxFee: 1500n,
        quoteId: 'test-quote-rev',
        quoteExpiry: Math.floor(Date.now() / 1000) + 300,
        pricing: {
          refs: [
            {
              asset: 'PUSD',
              usdPrice: '1.000',
              source: 'cauldron',
              asOf: Math.floor(Date.now() / 1000),
            },
            {
              asset: 'USDC',
              usdPrice: '1.000',
              source: 'chainlink',
              asOf: Math.floor(Date.now() / 1000),
            },
          ],
          spreadBps: 40,
          fixedFeeBase: 0n,
          rounding: 'floor',
        },
        ...overrides,
      });

    it('early-releases user BCH lock when timing invariant R fails in reverse swaps', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms({
        // remainingBlocks = 330005 - 330000 = 5 < 12 -> Timing invariant R fails!
        bchRefundHeight: 330005,
      });

      db.saveOrder({
        id: 'ord-rev-timing-fail',
        direction: 'BCH_TO_EVM',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        userLockTxId: '11'.repeat(32),
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });

      const releaseMock = vi.fn().mockResolvedValue({
        txid: 'release_bch_tx_01',
        txHex: '01000000...',
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x0' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'release_bch_tx_01',
        isOnChain: async (txid) => txid === 'release_bch_tx_01',
        getScriptHashHistory: async () => [],
        buildRelease: releaseMock,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };

      const engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      expect(releaseMock).toHaveBeenCalledTimes(1);

      const order = db.getOrder('ord-rev-timing-fail');
      expect(order?.status).toBe('RELEASED');
      expect(order?.solverRefundTxId).toBe('release_bch_tx_01');
      expect(order?.rejectionReason).toContain('Timing invariant R failed');
    });

    it('early-releases user BCH lock when quote expires before EVM lock', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms({
        quoteExpiry: Math.floor(Date.now() / 1000) - 10, // expired
      });

      db.saveOrder({
        id: 'ord-rev-expired-quote',
        direction: 'BCH_TO_EVM',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        userLockTxId: '22'.repeat(32),
        createdAt: Math.floor(Date.now() / 1000) - 60,
        updatedAt: Math.floor(Date.now() / 1000) - 60,
      });

      const releaseMock = vi.fn().mockResolvedValue({
        txid: 'release_bch_tx_02',
        txHex: '01000000...',
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x0' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'release_bch_tx_02',
        isOnChain: async (txid) => txid === 'release_bch_tx_02',
        getScriptHashHistory: async () => [],
        buildRelease: releaseMock,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };

      const engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      expect(releaseMock).toHaveBeenCalledTimes(1);

      const order = db.getOrder('ord-rev-expired-quote');
      expect(order?.status).toBe('RELEASED');
      expect(order?.solverRefundTxId).toBe('release_bch_tx_02');
      expect(order?.rejectionReason).toContain('after the quote expired');
    });

    it('never releases the user BCH lock when the EVM counter-lock call fails: it may have been sent', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms();

      db.saveOrder({
        id: 'ord-rev-evm-fail',
        direction: 'BCH_TO_EVM',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        userLockTxId: '33'.repeat(32),
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });

      const releaseMock = vi.fn().mockResolvedValue({
        txid: 'release_bch_tx_03',
        txHex: '01000000...',
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x0' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'release_bch_tx_03',
        isOnChain: async (txid) => txid === 'release_bch_tx_03',
        getScriptHashHistory: async () => [],
        buildRelease: releaseMock,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
        lock: vi
          .fn()
          .mockRejectedValue(new Error('Out of EVM inventory or gas')),
      };

      const engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      expect(releaseMock).not.toHaveBeenCalled();

      const order = db.getOrder('ord-rev-evm-fail');
      expect(order?.status).toBe('USER_LOCK_FINAL');
    });

    it('refuses an early release when a solver EVM lock with the same hash exists on chain', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms();
      db.saveOrder({
        id: 'ord-rev-onchain',
        direction: 'BCH_TO_EVM',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        userLockTxId: '44'.repeat(32),
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });
      const releaseMock = vi.fn();
      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x0' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'x',
        isOnChain: async () => false,
        getScriptHashHistory: async () => [],
        buildRelease: releaseMock,
      };
      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({
          status: 'locked',
          txid: '0x' + '55'.repeat(32),
        }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };
      const engine = newTestEngine(db, bchPort, evmPort);
      await expect(
        engine.earlyReleaseUserBchLock(
          orderRecordToSolverOrder(db.getOrder('ord-rev-onchain')!),
          'test',
        ),
      ).rejects.toThrow(/solver EVM lock exists/);
      expect(releaseMock).not.toHaveBeenCalled();
    });

    it('early-releases user BCH lock when DSProof is detected on 0-conf fast-lane lock', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms();

      db.saveOrder({
        id: 'ord-rev-dsproof',
        direction: 'BCH_TO_EVM',
        status: 'QUOTED',
        lane: 'fast',
        fastOptIn: true,
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });

      const releaseMock = vi.fn().mockResolvedValue({
        txid: 'release_bch_tx_04',
        txHex: '01000000...',
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x0' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'release_bch_tx_04',
        isOnChain: async (txid) => txid === 'release_bch_tx_04',
        getScriptHashHistory: async () => [
          { tx_hash: '44'.repeat(32), height: 0 },
        ],
        waitForDoubleSpendProof: async () => ({ hasProof: true }),
        buildRelease: releaseMock,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };

      const engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      expect(releaseMock).toHaveBeenCalledTimes(1);

      const order = db.getOrder('ord-rev-dsproof');
      expect(order?.status).toBe('RELEASED');
      expect(order?.solverRefundTxId).toBe('release_bch_tx_04');
      expect(order?.rejectionReason).toContain('Double-spend proof detected');
    });

    it('STRICT INVARIANT: NEVER early-releases user BCH lock once solver EVM lock has been broadcast', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms();

      db.saveOrder({
        id: 'ord-rev-safe-guard',
        direction: 'BCH_TO_EVM',
        status: 'SOLVER_LOCK_SEEN',
        solverLockTxId: '0x' + 'aa'.repeat(32),
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        userLockTxId: '55'.repeat(32),
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });

      const releaseMock = vi.fn();
      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x0' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: async () => 'bch_ok',
        isOnChain: async () => false,
        getScriptHashHistory: async () => [],
        buildRelease: releaseMock,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'locked' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => true,
      };

      const engine = newTestEngine(db, bchPort, evmPort);
      const record = db.getOrder('ord-rev-safe-guard')!;
      const order = orderRecordToSolverOrder(record);

      await expect(
        engine.earlyReleaseUserBchLock(order, 'Attempted release after lock'),
      ).rejects.toThrow(/Safety violation: refusing early release/);

      expect(releaseMock).not.toHaveBeenCalled();
    });

    it('exposes txids.bchRefund and status RELEASED via GET /v1/orders/:id for reverse swap', async () => {
      const db = new SolverDatabase(':memory:');
      const terms = makeReverseTerms({ evmChainId: 84532 });
      const orderId = '0x' + 'ff'.repeat(32);
      const bchRefundTx = '99'.repeat(32);

      db.saveOrder({
        id: orderId,
        direction: 'BCH_TO_EVM',
        status: 'RELEASED',
        userCounterAddress: terms.userBchLockingBytecode,
        lockId: terms.hashLock,
        termsJson: stringifyTerms(terms),
        hashLock: terms.hashLock,
        userLockTxId: '11'.repeat(32),
        solverRefundTxId: bchRefundTx,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });

      const config = loadConfigFromEnv({
        NETWORK: 'testnet',
        ALLOW_DEV_KEYS: '1',
        BASE_FERRY_HTLC_ADDRESS: terms.evmHtlc,
      });

      const app = buildServer({
        config,
        db,
        evmAdapter: {
          id: 'base',
          getTip: async () => ({ height: 100, ageSeconds: 1, stale: false }),
        } as unknown as EvmChainAdapter,
        bchClient: {
          isHealthy: () => true,
          getQuorumStatus: () => ({
            isQuorumHealthy: true,
            isLivenessHealthy: true,
            quorumTip: 330000,
            ageSeconds: 1,
          }),
        } as unknown as BchQuorumClient,
        engine: { isQuotingEnabled: () => true } as unknown as SolverEngine,
        priceSource: new MockPriceSource(),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/${orderId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe('RELEASED');
      expect(body.txids.bchRefund).toBe('0x' + bchRefundTx);
      expect(body.txids.evmRefund).toBeUndefined();

      await app.close();
    });
  });
});
