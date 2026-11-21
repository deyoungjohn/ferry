import { newTestEngine } from './support/test-engine.js';
import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { SolverDatabase } from '../src/db/database.js';
import { stringifyTerms } from '../src/engine/runner.js';
import type {
  BchChainPort,
  EvmChainPort,
  EvmLockState,
} from '../src/engine/types.js';
import { parseOrderTerms } from '@ferry/core';

function sha256Hex(hexWithoutPrefix: string): `0x${string}` {
  return `0x${crypto.createHash('sha256').update(Buffer.from(hexWithoutPrefix, 'hex')).digest('hex')}` as `0x${string}`;
}

const defaultSecret =
  '0x112233445566778899001122334455667788990011223344556677889900aabb' as const;
const defaultHashLock = sha256Hex(defaultSecret.slice(2));

describe('SolverEngine loop, kill-at-every-state, fast-lane, and quorum gating', () => {
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
    quoteId: 'test-quote-fwd',
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
  });

  function createTestDb(dbPath = ':memory:'): SolverDatabase {
    return new SolverDatabase(dbPath);
  }

  describe('Quorum status quoting gating', () => {
    it('stops quoting when quorum client reports unhealthy or insufficient nodes', () => {
      const db = createTestDb();
      let quorumHealthy = true;
      let quotingEnabled = true;

      const mockBchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => quorumHealthy,
        isQuotingEnabled: () => quotingEnabled,
        broadcast: async () => 'txid_ok',
        isOnChain: async () => true,
        getScriptHashHistory: async () => [],
      };

      const mockEvmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => true,
        broadcast: async () => 'txid_evm',
        isOnChain: async () => true,
      };

      const engine = newTestEngine(db, mockBchPort, mockEvmPort);
      expect(engine.isQuotingEnabled()).toBe(true);

      // Quorum loses health
      quorumHealthy = false;
      expect(engine.isQuotingEnabled()).toBe(false);

      // Healthy but quoting disabled by policy/nodes
      quorumHealthy = true;
      quotingEnabled = false;
      expect(engine.isQuotingEnabled()).toBe(false);
    });
  });

  describe('Stale quotes leave the polled set', () => {
    it('expires a QUOTED order ten minutes after its quote lapsed, and keeps a fresh one', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);
      const make = (id: string, hashLock: `0x${string}`, expiry: number) => {
        const terms = parseOrderTerms({
          ...dummyForwardTerms,
          hashLock,
          quoteExpiry: expiry,
        });
        db.saveOrder({
          id,
          direction: 'EVM_TO_BCH',
          status: 'QUOTED',
          userCounterAddress: terms.userEvmAddress,
          lockId: hashLock,
          termsJson: stringifyTerms(terms),
          hashLock,
          createdAt: now,
          updatedAt: now,
        });
      };
      make('ord-stale', `0x${'01'.repeat(32)}`, now - 1200);
      make('ord-fresh', `0x${'02'.repeat(32)}`, now + 200);

      const engine = newTestEngine(
        db,
        {
          getTip: async () => ({ height: 330000, hash: '0x00tip' }),
          isQuorumHealthy: () => true,
          isQuotingEnabled: () => true,
          broadcast: vi.fn(),
          isOnChain: async () => false,
          getScriptHashHistory: async () => [],
        } as unknown as BchChainPort,
        {
          getTip: async () => ({ height: 1000, finalized: true }),
          getLock: async () => ({ status: 'none' }),
          isFinal: async () => false,
          broadcast: vi.fn(),
          isOnChain: async () => false,
        } as EvmChainPort,
        {},
      );
      await engine.reconcileOrders();
      expect(db.getOrder('ord-stale')?.status).toBe('EXPIRED');
      expect(db.getOrder('ord-fresh')?.status).toBe('QUOTED');
      expect(db.listNonTerminalOrders().map((o) => o.id)).toEqual([
        'ord-fresh',
      ]);
    });
  });

  describe('Fast-lane 0-conf double-spend proof window and contested case', () => {
    it('refuses counter-lock when double-spend proof is detected (contested case)', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-fast-contested',
        direction: 'BCH_TO_COUNTER',
        status: 'QUOTED',
        userCounterAddress: dummyReverseTerms.userEvmAddress,
        lockId: dummyReverseTerms.hashLock,
        termsJson: stringifyTerms(dummyReverseTerms),
        hashLock: defaultHashLock,
        lane: 'fast',
        fastOptIn: true,
        createdAt: now,
        updatedAt: now,
      });

      const mockBchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: vi.fn().mockResolvedValue('bch_txid'),
        isOnChain: async () => false,
        getScriptHashHistory: async () => [
          { tx_hash: 'tx_bch_0conf_lock', height: 0 }, // 0-conf!
        ],
        waitForDoubleSpendProof: async () => ({
          hasProof: true, // Contested!
          proof: { dsproof_id: 'dsproof_xyz' },
        }),
      };

      const mockEvmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => false,
        broadcast: vi.fn().mockResolvedValue('evm_txid'),
        isOnChain: async () => false,
      };

      const engine = newTestEngine(db, mockBchPort, mockEvmPort, {
        dsproofWindowMs: 50,
      });

      await engine.reconcileOrders();

      const order = db.getOrder('ord-fast-contested');
      expect(order?.status).toBe('REJECTED');
      expect(order?.rejectionReason).toContain('Double-spend proof detected');
      // Solver must NEVER broadcast counter-lock on EVM
      expect(mockEvmPort.broadcast).not.toHaveBeenCalled();
    });

    it('allows counter-lock when 0-conf double-spend proof is clear after wait window', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-fast-clean',
        direction: 'BCH_TO_COUNTER',
        status: 'QUOTED',
        userCounterAddress: dummyReverseTerms.userEvmAddress,
        lockId: dummyReverseTerms.hashLock,
        termsJson: stringifyTerms(dummyReverseTerms),
        hashLock: defaultHashLock,
        lane: 'fast',
        fastOptIn: true,
        createdAt: now,
        updatedAt: now,
      });

      const mockBchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: vi.fn().mockResolvedValue('bch_txid'),
        isOnChain: async () => false,
        getScriptHashHistory: async () => [
          { tx_hash: 'tx_bch_0conf_clean', height: 0 },
        ],
        waitForDoubleSpendProof: async () => ({
          hasProof: false, // clean!
        }),
      };

      let evmOnChain = false;
      const evmBroadcastSpy = vi.fn().mockImplementation(async () => {
        evmOnChain = true;
        return 'evm_txid_lock';
      });

      const mockEvmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'none' }),
        isFinal: async () => false,
        broadcast: evmBroadcastSpy,
        isOnChain: async () => evmOnChain,
      };

      const engine = newTestEngine(db, mockBchPort, mockEvmPort, {
        dsproofWindowMs: 10,
      });

      await engine.reconcileOrders();

      const order = db.getOrder('ord-fast-clean');
      expect(order?.status).toBe('SOLVER_LOCK_SEEN');
      expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Kill-at-every-state forward swap (EVM_TO_BCH)', () => {
    it('proves order reaches DONE terminal state without duplicate broadcasts despite crashes at every step', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-fwd-chaos',
        direction: 'COUNTER_TO_BCH',
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

      const bchBroadcastSpy = vi.fn().mockImplementation(async () => {
        bchOnChain = true;
        return 'bch_txid_broadcast';
      });

      const evmBroadcastSpy = vi.fn().mockImplementation(async () => {
        evmOnChain = true;
        return 'evm_txid_broadcast';
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: bchBroadcastSpy,
        isOnChain: async () => bchOnChain,
        getScriptHashHistory: async () => bchHistory,
        extractSecretFromSpend: async () => defaultSecret,
        // The chain returns the user's claim: one output paying the recipient the token.
        getTransaction: async () => ({
          outputs: [
            {
              lockingBytecode: dummyForwardTerms.userBchLockingBytecode,
              token: {
                category: dummyForwardTerms.bchTokenCategory,
                amount: dummyForwardTerms.bchTokenAmount,
              },
            },
          ],
        }),
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => evmLockState,
        isFinal: async () => evmIsFinal,
        broadcast: evmBroadcastSpy,
        isOnChain: async () => evmOnChain,
      };

      // State 0: QUOTED, no lock yet
      let engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-fwd-chaos')?.status).toBe('QUOTED');

      // KILL & RESTART -> User locks on EVM
      engine.stop();
      evmLockState = { status: 'locked', txid: 'evm_user_lock_tx' };
      evmIsFinal = false;
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-fwd-chaos')?.status).toBe('USER_LOCK_SEEN');

      // KILL & RESTART -> EVM lock finalizes
      engine.stop();
      evmIsFinal = true;
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      // Solver locks on BCH
      expect(db.getOrder('ord-fwd-chaos')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(bchBroadcastSpy).toHaveBeenCalledTimes(1);

      // KILL & RESTART during SOLVER_LOCK_SEEN (reconciliation must NOT rebroadcast)
      engine.stop();
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-fwd-chaos')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(bchBroadcastSpy).toHaveBeenCalledTimes(1);

      // KILL & RESTART -> User claims on BCH revealing secret
      engine.stop();
      bchHistory = [{ tx_hash: 'bch_user_claim_tx', height: 330005 }];
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      // Solver claims on EVM and completes swap
      expect(db.getOrder('ord-fwd-chaos')?.status).toBe('DONE');
      expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);

      // KILL & RESTART after DONE -> order stays DONE, zero duplicate broadcasts
      engine.stop();
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-fwd-chaos')?.status).toBe('DONE');
      expect(bchBroadcastSpy).toHaveBeenCalledTimes(1);
      expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Kill-at-every-state reverse swap (BCH_TO_EVM)', () => {
    it('proves reverse order reaches DONE terminal state without duplicate broadcasts despite crashes at every step', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-rev-chaos',
        direction: 'BCH_TO_COUNTER',
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

      const evmBroadcastSpy = vi.fn().mockImplementation(async () => {
        evmOnChain = true;
        return 'evm_lock_broadcast';
      });

      const bchBroadcastSpy = vi.fn().mockImplementation(async () => {
        bchOnChain = true;
        return 'bch_claim_broadcast';
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: bchBroadcastSpy,
        isOnChain: async () => bchOnChain,
        getScriptHashHistory: async () => bchHistory,
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => evmLockState,
        isFinal: async () => true,
        broadcast: evmBroadcastSpy,
        isOnChain: async () => evmOnChain,
      };

      // State 0: QUOTED, no BCH lock yet
      let engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-rev-chaos')?.status).toBe('QUOTED');

      // KILL & RESTART -> User locks on BCH (height > 0)
      engine.stop();
      bchHistory = [{ tx_hash: 'tx_bch_user_lock', height: 330001 }];
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      // Solver counter-locks on EVM
      expect(db.getOrder('ord-rev-chaos')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);

      // KILL & RESTART during SOLVER_LOCK_SEEN
      engine.stop();
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-rev-chaos')?.status).toBe('SOLVER_LOCK_SEEN');
      expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);

      // KILL & RESTART -> User claims on EVM revealing secret
      engine.stop();
      evmLockState = {
        status: 'claimed',
        txid: 'tx_evm_user_claim',
        secret: defaultSecret,
      };
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();

      // Solver claims on BCH and completes swap
      expect(db.getOrder('ord-rev-chaos')?.status).toBe('DONE');
      expect(bchBroadcastSpy).toHaveBeenCalledTimes(1);

      // KILL & RESTART after DONE
      engine.stop();
      engine = newTestEngine(db, bchPort, evmPort);
      await engine.reconcileOrders();
      expect(db.getOrder('ord-rev-chaos')?.status).toBe('DONE');
      expect(evmBroadcastSpy).toHaveBeenCalledTimes(1);
      expect(bchBroadcastSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Engine handling of the three broadcast error classes', () => {
    it('definitive rejection halts action, deletes write-ahead intent, and flags order needs_attention', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-err-definitive',
        direction: 'COUNTER_TO_BCH',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: dummyForwardTerms.userEvmAddress,
        lockId: dummyForwardTerms.hashLock,
        termsJson: stringifyTerms(dummyForwardTerms),
        hashLock: defaultHashLock,
        createdAt: now,
        updatedAt: now,
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: vi
          .fn()
          .mockRejectedValue(
            new Error('16: mandatory-script-verify-flag-failed'),
          ),
        isOnChain: async () => false,
        getScriptHashHistory: async () => [],
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'locked' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };

      const engine = newTestEngine(db, bchPort, evmPort);
      await expect(engine.reconcileOrders()).rejects.toThrow(
        /mandatory-script-verify-flag-failed/,
      );

      // Write-ahead action must be deleted (no lingering intent for definitively rejected tx)
      const action = db.getAction('ord-err-definitive', 'SOLVER_LOCK');
      expect(action).toBeNull();

      // Order must be marked needsAttention
      const order = db.getOrder('ord-err-definitive');
      expect(order?.needsAttention).toBe(true);
      expect(order?.rejectionReason).toContain('Node rejected broadcast');
    });

    it('ambiguous error adopts action if found on chain, or flags order if not found', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-err-ambig',
        direction: 'COUNTER_TO_BCH',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: dummyForwardTerms.userEvmAddress,
        lockId: dummyForwardTerms.hashLock,
        termsJson: stringifyTerms(dummyForwardTerms),
        hashLock: defaultHashLock,
        createdAt: now,
        updatedAt: now,
      });

      let onChain = false;
      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: vi.fn().mockRejectedValue(new Error('txn-mempool-conflict')),
        isOnChain: async () => onChain,
        getScriptHashHistory: async () => [],
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'locked' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };

      // Case A: NOT on chain -> throws, deletes action, flags order
      const engine = newTestEngine(db, bchPort, evmPort);
      await expect(engine.reconcileOrders()).rejects.toThrow(
        /Ambiguous node error/,
      );
      expect(db.getAction('ord-err-ambig', 'SOLVER_LOCK')).toBeNull();
      expect(db.getOrder('ord-err-ambig')?.needsAttention).toBe(true);

      // Case B: IS on chain -> adopts and advances
      onChain = true;
      const order2 = db.getOrder('ord-err-ambig')!;
      order2.needsAttention = false;
      order2.rejectionReason = undefined;
      db.saveOrder(order2);

      await engine.reconcileOrders();
      const actionAfter = db.getAction('ord-err-ambig', 'SOLVER_LOCK');
      expect(actionAfter?.status).toBe('BROADCAST');
      expect(db.getOrder('ord-err-ambig')?.status).toBe('SOLVER_LOCK_SEEN');
    });

    it('unknown outcome keeps intent in DB and retries successfully upon reconnection', async () => {
      const db = createTestDb();
      const now = Math.floor(Date.now() / 1000);

      db.saveOrder({
        id: 'ord-err-unknown',
        direction: 'COUNTER_TO_BCH',
        status: 'USER_LOCK_FINAL',
        userCounterAddress: dummyForwardTerms.userEvmAddress,
        lockId: dummyForwardTerms.hashLock,
        termsJson: stringifyTerms(dummyForwardTerms),
        hashLock: defaultHashLock,
        createdAt: now,
        updatedAt: now,
      });

      let shouldFail = true;
      let onChain = false;

      const bchBroadcastSpy = vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          throw new Error('connect ECONNREFUSED 127.0.0.1:50004');
        }
        onChain = true;
        return 'bch_txid_recovered';
      });

      const bchPort: BchChainPort = {
        getTip: async () => ({ height: 330000, hash: '0x00tip' }),
        isQuorumHealthy: () => true,
        isQuotingEnabled: () => true,
        broadcast: bchBroadcastSpy,
        isOnChain: async () => onChain,
        getScriptHashHistory: async () => [],
      };

      const evmPort: EvmChainPort = {
        getTip: async () => ({ height: 1000, finalized: true }),
        getLock: async () => ({ status: 'locked' }),
        isFinal: async () => true,
        broadcast: async () => 'evm_ok',
        isOnChain: async () => false,
      };

      const engine = newTestEngine(db, bchPort, evmPort);

      // Pass 1: Connection refused -> throws, but KEEPS intent in DB, does NOT flag terminal failure
      await expect(engine.reconcileOrders()).rejects.toThrow(/ECONNREFUSED/);
      const pendingAction = db.getAction('ord-err-unknown', 'SOLVER_LOCK');
      expect(pendingAction).not.toBeNull();
      expect(pendingAction?.status).toBe('PENDING');
      expect(db.getOrder('ord-err-unknown')?.needsAttention).toBeFalsy();

      // Pass 2: Connection restored -> retries, succeeds, marks BROADCAST / SEEN
      shouldFail = false;
      await engine.reconcileOrders();
      const broadcastAction = db.getAction('ord-err-unknown', 'SOLVER_LOCK');
      expect(broadcastAction?.status).toBe('BROADCAST');
      expect(db.getOrder('ord-err-unknown')?.status).toBe('SOLVER_LOCK_SEEN');
    });
  });
});
