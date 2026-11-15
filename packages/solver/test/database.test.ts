import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SolverDatabase } from '../src/db/database.js';

describe('SolverDatabase Persistence and Invariants', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles.splice(0)) {
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(f + suffix)) {
          fs.unlinkSync(f + suffix);
        }
      }
    }
  });

  function getTempDbPath(): string {
    const p = path.join(
      process.cwd(),
      `test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    tempFiles.push(p);
    return p;
  }

  it('refuses to open a database newer than the code supports', () => {
    const dbPath = getTempDbPath();
    const first = new SolverDatabase(dbPath);
    first.close();

    // Bump user_version to 999
    const raw = new Database(dbPath);
    raw.pragma('user_version = 999');
    raw.close();

    expect(() => new SolverDatabase(dbPath)).toThrow(
      /Database schema v999 is newer than this solver supports/i,
    );
  });

  it('rejects millisecond timestamp on write via saveOrder', () => {
    const db = new SolverDatabase();
    const msTimestamp = 1793208015079; // > 1e11

    expect(() =>
      db.saveOrder({
        id: 'ord-ms-test',
        direction: 'COUNTER_TO_BCH',
        status: 'QUOTED',
        userCounterAddress: '0xuser',
        lockId: '0xlock',
        termsJson: '{}',
        hashLock: '0xhash',
        createdAt: msTimestamp,
        updatedAt: Math.floor(Date.now() / 1000),
      }),
    ).toThrow(/must be in Unix seconds.*appears to be in milliseconds/i);
  });

  it('rejects millisecond timestamp on direct SQL insert via SQLite CHECK constraint', () => {
    const db = new SolverDatabase();
    const msTimestamp = 1793208015079;

    expect(() => {
      db.db
        .prepare(
          `INSERT INTO orders (id, direction, status, user_counter_address, lock_id, terms_json, hash_lock, created_at, updated_at)
           VALUES ('ord-sql-ms', 'COUNTER_TO_BCH', 'QUOTED', '0xuser', '0xlock', '{}', '0xhash', ?, ?)`,
        )
        .run(msTimestamp, Math.floor(Date.now() / 1000));
    }).toThrow(/CHECK constraint failed/i);
  });

  it('executes write-ahead action flow: recordIntent -> recordBroadcast -> recordFinal', () => {
    const db = new SolverDatabase();
    const orderId = 'order-wa-1';
    const action = 'SOLVER_LOCK';

    // 1. Write-ahead Intent
    db.recordIntent(orderId, action, {
      txid: 'txid_initial',
      txHex: '010000000100hex',
    });

    const pending = db.getAction(orderId, action);
    expect(pending).not.toBeNull();
    expect(pending?.status).toBe('PENDING');
    expect(pending?.txid).toBe('txid_initial');
    expect(JSON.parse(pending!.intentPayload).txHex).toBe('010000000100hex');

    // 2. Broadcast
    db.recordBroadcast(orderId, action, 'txid_broadcast');
    const broadcasted = db.getAction(orderId, action);
    expect(broadcasted?.status).toBe('BROADCAST');
    expect(broadcasted?.txid).toBe('txid_broadcast');

    // 3. Final / Confirmed
    db.recordFinal(orderId, action, 'txid_broadcast');
    const confirmed = db.getAction(orderId, action);
    expect(confirmed?.status).toBe('CONFIRMED');
    expect(confirmed?.txid).toBe('txid_broadcast');
  });

  it('enforces idempotency via unique constraint on (orderId, action)', () => {
    const db = new SolverDatabase();
    const orderId = 'order-idempotent-1';
    const action = 'SOLVER_CLAIM';

    db.recordIntent(orderId, action, {
      txid: 'first_txid',
      txHex: 'first_hex',
    });

    // Recording intent again updates the existing row rather than duplicating
    db.recordIntent(orderId, action, {
      txid: 'updated_txid',
      txHex: 'updated_hex',
    });

    const actions = db.listActionsForOrder(orderId);
    expect(actions.length).toBe(1);
    expect(actions[0]?.txid).toBe('updated_txid');
  });

  it('supports firstSeenAtMs naming and preserves millisecond precision', () => {
    const db = new SolverDatabase();
    const orderId = 'order-ms-unit-named';
    const nowSec = Math.floor(Date.now() / 1000);
    const msValue = 1793208039987;

    db.saveOrder({
      id: orderId,
      direction: 'BCH_TO_COUNTER',
      status: 'USER_LOCK_SEEN',
      userCounterAddress: '0x1234',
      lockId: '0xlock1234',
      termsJson: '{}',
      hashLock: '0xhash1234',
      firstSeenAtMs: msValue,
      createdAt: nowSec,
      updatedAt: nowSec,
    });

    const saved = db.getOrder(orderId);
    expect(saved?.firstSeenAtMs).toBe(msValue);
    expect(saved?.createdAt).toBe(nowSec);
  });
});
