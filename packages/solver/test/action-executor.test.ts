import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { SolverDatabase } from '../src/db/database.js';
import {
  ActionExecutor,
  defaultValidateSecret,
} from '../src/executor/action-executor.js';
import type { ChainPort } from '../src/executor/types.js';

describe('ActionExecutor (executeOrAdopt)', () => {
  let db: SolverDatabase;

  const validSecret =
    '0x112233445566778899001122334455667788990011223344556677889900aabb';
  const secretBytes = Buffer.from(validSecret.slice(2), 'hex');
  const validHashLock = `0x${crypto.createHash('sha256').update(secretBytes).digest('hex')}`;

  beforeEach(() => {
    db = new SolverDatabase();
  });

  function createTestOrder(id = 'ord-1') {
    const now = Math.floor(Date.now() / 1000);
    db.saveOrder({
      id,
      direction: 'COUNTER_TO_BCH',
      status: 'USER_LOCK_FINAL',
      userCounterAddress: '0xuser',
      lockId: '0xlock',
      termsJson: '{}',
      hashLock: validHashLock,
      secret: validSecret,
      createdAt: now,
      updatedAt: now,
    });
  }

  it('persists write-ahead intent BEFORE broadcasting and records broadcast on success', async () => {
    createTestOrder('ord-1');
    let intentExistedDuringBroadcast = false;

    const fakeChainPort: ChainPort = {
      broadcast: vi.fn().mockImplementation(async () => {
        const action = db.getAction('ord-1', 'SOLVER_LOCK');
        if (action && action.status === 'PENDING') {
          intentExistedDuringBroadcast = true;
        }
        return 'broadcast_success';
      }),
      isOnChain: vi.fn().mockResolvedValue(false),
    };

    const executor = new ActionExecutor(db, fakeChainPort);
    const result = await executor.executeOrAdopt({
      orderId: 'ord-1',
      actionType: 'SOLVER_LOCK',
      buildTx: async () => ({
        txid: 'txid_lock_1',
        txHex: '010000lockhex',
      }),
    });

    expect(intentExistedDuringBroadcast).toBe(true);
    expect(result.txid).toBe('txid_lock_1');
    expect(result.adopted).toBe(false);

    const action = db.getAction('ord-1', 'SOLVER_LOCK');
    expect(action?.status).toBe('BROADCAST');
    expect(action?.txid).toBe('txid_lock_1');
  });

  describe('Ambiguous Node Errors', () => {
    const ambiguousMessages = [
      '16: bad-txns-inputs-missingorspent (missing inputs)',
      'txn-mempool-conflict',
      'Transaction conflict detected in mempool',
      'bad-txns-already-in-block already in block chain',
      'inputs already spent',
    ];

    for (const msg of ambiguousMessages) {
      it(`counts as success when "${msg}" occurs AND exact txid is found on chain`, async () => {
        createTestOrder('ord-ambig-win');

        const fakeChainPort: ChainPort = {
          broadcast: vi.fn().mockRejectedValue(new Error(msg)),
          isOnChain: vi.fn().mockImplementation(async (txid: string) => {
            return txid === 'txid_ambig_test';
          }),
        };

        const executor = new ActionExecutor(db, fakeChainPort);
        const result = await executor.executeOrAdopt({
          orderId: 'ord-ambig-win',
          actionType: 'SOLVER_LOCK',
          buildTx: async () => ({
            txid: 'txid_ambig_test',
            txHex: '020000ambighex',
          }),
        });

        expect(result.adopted).toBe(true);
        expect(result.txid).toBe('txid_ambig_test');
        const action = db.getAction('ord-ambig-win', 'SOLVER_LOCK');
        expect(action?.status).toBe('BROADCAST');
      });

      it(`never counts as success when "${msg}" occurs and exact txid is NOT on chain`, async () => {
        createTestOrder('ord-ambig-fail');

        const fakeChainPort: ChainPort = {
          broadcast: vi.fn().mockRejectedValue(new Error(msg)),
          isOnChain: vi.fn().mockResolvedValue(false), // NOT on chain!
        };

        const executor = new ActionExecutor(db, fakeChainPort);
        await expect(
          executor.executeOrAdopt({
            orderId: 'ord-ambig-fail',
            actionType: 'SOLVER_LOCK',
            buildTx: async () => ({
              txid: 'txid_ambig_fail',
              txHex: '020000ambighex',
            }),
          }),
        ).rejects.toThrow(/Ambiguous node error/);

        // Must NOT record as broadcast
        const action = db.getAction('ord-ambig-fail', 'SOLVER_LOCK');
        expect(action).toBeNull();

        // Must mark order needs_attention
        const order = db.getOrder('ord-ambig-fail');
        expect(order?.needsAttention).toBe(true);
        expect(order?.rejectionReason).toContain('Ambiguous node error');
      });
    }
  });

  describe('Unknown Outcome Errors', () => {
    const unknownOutcomeMessages = [
      'Connection timed out after 5000ms',
      'socket hang up',
      'read ECONNRESET',
      'connect ECONNREFUSED 127.0.0.1:50004',
      'websocket is not open: readyState 3 (CLOSED)',
      'closed socket during transmission',
    ];

    for (const msg of unknownOutcomeMessages) {
      it(`keeps write-ahead intent when "${msg}" occurs and txid is NOT on chain`, async () => {
        createTestOrder('ord-unknown-fail');

        const fakeChainPort: ChainPort = {
          broadcast: vi.fn().mockRejectedValue(new Error(msg)),
          isOnChain: vi.fn().mockResolvedValue(false),
        };

        const executor = new ActionExecutor(db, fakeChainPort);
        await expect(
          executor.executeOrAdopt({
            orderId: 'ord-unknown-fail',
            actionType: 'SOLVER_LOCK',
            buildTx: async () => ({
              txid: 'txid_unknown_pending',
              txHex: '020000unknownhex',
            }),
          }),
        ).rejects.toThrow(msg);

        // Invariant: A write-ahead record is deleted ONLY when the outcome is known!
        // For unknown outcome (timeout/socket closed), the intent must remain in DB for retry
        const action = db.getAction('ord-unknown-fail', 'SOLVER_LOCK');
        expect(action).not.toBeNull();
        expect(action?.status).toBe('PENDING');
        expect(action?.txid).toBe('txid_unknown_pending');

        // Should not be flagged with terminal attention yet
        const order = db.getOrder('ord-unknown-fail');
        expect(order?.needsAttention).toBeFalsy();
      });

      it(`adopts transaction when "${msg}" occurs but txid IS found on chain`, async () => {
        createTestOrder('ord-unknown-adopted');

        const fakeChainPort: ChainPort = {
          broadcast: vi.fn().mockRejectedValue(new Error(msg)),
          isOnChain: vi.fn().mockResolvedValue(true),
        };

        const executor = new ActionExecutor(db, fakeChainPort);
        const result = await executor.executeOrAdopt({
          orderId: 'ord-unknown-adopted',
          actionType: 'SOLVER_LOCK',
          buildTx: async () => ({
            txid: 'txid_unknown_adopted',
            txHex: '020000adoptedhex',
          }),
        });

        expect(result.adopted).toBe(true);
        expect(result.txid).toBe('txid_unknown_adopted');
        const action = db.getAction('ord-unknown-adopted', 'SOLVER_LOCK');
        expect(action?.status).toBe('BROADCAST');
      });
    }
  });

  describe('Resumed Broadcast Error Handling', () => {
    it('definitively rejected resumed broadcast deletes intent and flags order (not recorded as broadcast)', async () => {
      createTestOrder('ord-resumed-reject');

      // Pre-seed write-ahead intent
      db.recordIntent('ord-resumed-reject', 'SOLVER_LOCK', {
        txid: 'txid_resumed_bad',
        txHex: '020000badresumed',
      });

      const fakeChainPort: ChainPort = {
        broadcast: vi
          .fn()
          .mockRejectedValue(
            new Error('16: mandatory-script-verify-flag-failed'),
          ),
        isOnChain: vi.fn().mockResolvedValue(false),
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      await expect(
        executor.executeOrAdopt({
          orderId: 'ord-resumed-reject',
          actionType: 'SOLVER_LOCK',
          buildTx: async () => {
            throw new Error('should not build new tx');
          },
        }),
      ).rejects.toThrow(/mandatory-script-verify-flag-failed/);

      // Must NOT be marked as BROADCAST
      const action = db.getAction('ord-resumed-reject', 'SOLVER_LOCK');
      expect(action).toBeNull();

      // Must be flagged as needs_attention
      const order = db.getOrder('ord-resumed-reject');
      expect(order?.needsAttention).toBe(true);
      expect(order?.rejectionReason).toContain('Node rejected broadcast');
    });

    it('resumed broadcast with unknown outcome keeps intent in DB when not on chain', async () => {
      createTestOrder('ord-resumed-unknown');

      db.recordIntent('ord-resumed-unknown', 'SOLVER_LOCK', {
        txid: 'txid_resumed_timeout',
        txHex: '020000timeoutexisting',
      });

      const fakeChainPort: ChainPort = {
        broadcast: vi
          .fn()
          .mockRejectedValue(new Error('ETIMEDOUT connection timed out')),
        isOnChain: vi.fn().mockResolvedValue(false),
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      await expect(
        executor.executeOrAdopt({
          orderId: 'ord-resumed-unknown',
          actionType: 'SOLVER_LOCK',
          buildTx: async () => {
            throw new Error('should not build');
          },
        }),
      ).rejects.toThrow(/ETIMEDOUT/);

      // Intent must remain in DB for next retry
      const action = db.getAction('ord-resumed-unknown', 'SOLVER_LOCK');
      expect(action).not.toBeNull();
      expect(action?.status).toBe('PENDING');

      const order = db.getOrder('ord-resumed-unknown');
      expect(order?.needsAttention).toBeFalsy();
    });
  });

  describe('Stale-action rebuild policy', () => {
    it('does not rebuild if tx is seen on quorum nodes', async () => {
      createTestOrder('ord-stale-quorum');
      const actionType = 'SOLVER_CLAIM';

      // Seed an action that is older than 3 minutes (e.g. 250s)
      const now = Math.floor(Date.now() / 1000);
      db.recordIntent('ord-stale-quorum', actionType, {
        txid: 'tx_old_quorum',
        txHex: 'hex_old',
      });
      db.recordBroadcast('ord-stale-quorum', actionType, 'tx_old_quorum');
      db.db
        .prepare('UPDATE actions SET updated_at = ? WHERE order_id = ?')
        .run(now - 250, 'ord-stale-quorum');

      let buildCalled = false;
      const fakeChainPort: ChainPort = {
        broadcast: vi.fn().mockResolvedValue('ok'),
        isOnChain: vi.fn().mockResolvedValue(false),
        checkTxAcrossQuorum: vi.fn().mockResolvedValue({
          found: true,
          totalConnected: 2,
        }),
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      const result = await executor.executeOrAdopt({
        orderId: 'ord-stale-quorum',
        actionType,
        buildTx: async () => {
          buildCalled = true;
          return { txid: 'rebuilt_bad', txHex: 'rebuilt_hex' };
        },
      });

      expect(buildCalled).toBe(false);
      expect(result.txid).toBe('tx_old_quorum');
      expect(result.adopted).toBe(false);
    });

    it('adopts alternative spend from history when stale action inputs are spent', async () => {
      createTestOrder('ord-stale-alt');
      const actionType = 'SOLVER_LOCK';

      const now = Math.floor(Date.now() / 1000);
      db.recordIntent('ord-stale-alt', actionType, {
        txid: 'tx_old_lock',
        txHex: 'hex_old',
        inputs: [{ txid: 'input_1', vout: 0 }],
      });
      db.recordBroadcast('ord-stale-alt', actionType, 'tx_old_lock');
      db.db
        .prepare('UPDATE actions SET updated_at = ? WHERE order_id = ?')
        .run(now - 700, 'ord-stale-alt'); // older than 10 minutes

      let buildCalled = false;
      const fakeChainPort: ChainPort = {
        broadcast: vi.fn().mockResolvedValue('ok'),
        isOnChain: vi.fn().mockResolvedValue(false),
        checkTxAcrossQuorum: vi.fn().mockResolvedValue({
          found: false,
          totalConnected: 2,
        }),
        isInputSpent: vi.fn().mockResolvedValue(true), // input was spent
        findAlternativeSpend: vi.fn().mockResolvedValue('tx_winning_spend_123'),
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      const result = await executor.executeOrAdopt({
        orderId: 'ord-stale-alt',
        actionType,
        buildTx: async () => {
          buildCalled = true;
          return { txid: 'rebuilt_bad', txHex: 'rebuilt_hex' };
        },
      });

      expect(buildCalled).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.txid).toBe('tx_winning_spend_123');
    });

    it('refuses blind rebuild when inputs are spent by conflicting spend', async () => {
      createTestOrder('ord-stale-conflict');
      const actionType = 'SOLVER_LOCK';

      const now = Math.floor(Date.now() / 1000);
      db.recordIntent('ord-stale-conflict', actionType, {
        txid: 'tx_old_lock',
        txHex: 'hex_old',
        inputs: [{ txid: 'input_conflict', vout: 0 }],
      });
      db.recordBroadcast('ord-stale-conflict', actionType, 'tx_old_lock');
      db.db
        .prepare('UPDATE actions SET updated_at = ? WHERE order_id = ?')
        .run(now - 700, 'ord-stale-conflict');

      let buildCalled = false;
      const fakeChainPort: ChainPort = {
        broadcast: vi.fn().mockResolvedValue('ok'),
        isOnChain: vi.fn().mockResolvedValue(false),
        checkTxAcrossQuorum: vi.fn().mockResolvedValue({
          found: false,
          totalConnected: 2,
        }),
        isInputSpent: vi.fn().mockResolvedValue(true),
        findAlternativeSpend: vi.fn().mockResolvedValue(null), // no adopted spend found
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      await expect(
        executor.executeOrAdopt({
          orderId: 'ord-stale-conflict',
          actionType,
          buildTx: async () => {
            buildCalled = true;
            return { txid: 'rebuilt_bad', txHex: 'rebuilt_hex' };
          },
        }),
      ).rejects.toThrow(/inputs spent by conflicting transaction/);

      expect(buildCalled).toBe(false);
      const order = db.getOrder('ord-stale-conflict');
      expect(order?.needsAttention).toBe(true);
    });

    it('rebuilds cleanly when inputs are still unspent after stale timeout', async () => {
      createTestOrder('ord-stale-unspent');
      const actionType = 'SOLVER_LOCK';

      const now = Math.floor(Date.now() / 1000);
      db.recordIntent('ord-stale-unspent', actionType, {
        txid: 'tx_old_lock',
        txHex: 'hex_old',
        inputs: [{ txid: 'input_unspent', vout: 0 }],
      });
      db.recordBroadcast('ord-stale-unspent', actionType, 'tx_old_lock');
      db.db
        .prepare('UPDATE actions SET updated_at = ? WHERE order_id = ?')
        .run(now - 700, 'ord-stale-unspent');

      let buildCalled = false;
      const fakeChainPort: ChainPort = {
        broadcast: vi.fn().mockResolvedValue('tx_fresh_rebuilt'),
        isOnChain: vi.fn().mockResolvedValue(false),
        checkTxAcrossQuorum: vi.fn().mockResolvedValue({
          found: false,
          totalConnected: 2,
        }),
        isInputSpent: vi.fn().mockResolvedValue(false), // still unspent!
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      const result = await executor.executeOrAdopt({
        orderId: 'ord-stale-unspent',
        actionType,
        buildTx: async () => {
          buildCalled = true;
          return { txid: 'tx_fresh_rebuilt', txHex: 'hex_fresh' };
        },
      });

      expect(buildCalled).toBe(true);
      expect(result.txid).toBe('tx_fresh_rebuilt');
      expect(result.adopted).toBe(false);
    });
  });

  describe('Secret validation invariant', () => {
    it('refuses execution when secret does not match hash lock', async () => {
      createTestOrder('ord-bad-secret');

      const fakeChainPort: ChainPort = {
        broadcast: vi.fn().mockResolvedValue('ok'),
        isOnChain: vi.fn().mockResolvedValue(false),
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      const wrongSecret =
        '0x2222222222222222222222222222222222222222222222222222222222222222';

      await expect(
        executor.executeOrAdopt({
          orderId: 'ord-bad-secret',
          actionType: 'SOLVER_CLAIM',
          secret: wrongSecret,
          hashLock: validHashLock,
          buildTx: async () => ({ txid: 'bad', txHex: 'bad' }),
        }),
      ).rejects.toThrow(
        /Invalid secret.*sha256\(secret\) does not (match|equal) hashLock/,
      );
    });

    it('refuses all-zero or empty fallback secret', async () => {
      createTestOrder('ord-zero-secret');

      const fakeChainPort: ChainPort = {
        broadcast: vi.fn().mockResolvedValue('ok'),
        isOnChain: vi.fn().mockResolvedValue(false),
      };

      const executor = new ActionExecutor(db, fakeChainPort);
      const zeroSecret =
        '0x0000000000000000000000000000000000000000000000000000000000000000';

      await expect(
        executor.executeOrAdopt({
          orderId: 'ord-zero-secret',
          actionType: 'SOLVER_CLAIM',
          secret: zeroSecret,
          hashLock: validHashLock,
          buildTx: async () => ({ txid: 'bad', txHex: 'bad' }),
        }),
      ).rejects.toThrow(/Invalid secret/);

      expect(defaultValidateSecret('', validHashLock)).toBe(false);
      expect(defaultValidateSecret(zeroSecret, validHashLock)).toBe(false);
      expect(defaultValidateSecret(validSecret, validHashLock)).toBe(true);
    });
  });
});
