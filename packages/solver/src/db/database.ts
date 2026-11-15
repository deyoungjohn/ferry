import DatabaseConstructor, {
  type Database as DatabaseType,
} from 'better-sqlite3';
import type { ActionIntent, ActionRecord, OrderRecord } from './types.js';

export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_VALID_UNIX_SECONDS = 100_000_000_000; // ~year 5138

export function assertSecondsTimestamp(ts: number, fieldName: string): number {
  if (ts >= MAX_VALID_UNIX_SECONDS) {
    throw new Error(
      `Timestamp for ${fieldName} must be in Unix seconds (received: ${ts}; appears to be in milliseconds)`,
    );
  }
  return Math.floor(ts);
}

export class SolverDatabase {
  public readonly db: DatabaseType;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  private initTables(): void {
    const tableExists = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'",
      )
      .get();

    if (!tableExists) {
      this.db.exec(`
        CREATE TABLE orders (
          id TEXT PRIMARY KEY,
          direction TEXT NOT NULL,
          status TEXT NOT NULL,
          user_counter_address TEXT NOT NULL,
          lock_id TEXT NOT NULL,
          terms_json TEXT NOT NULL,
          hash_lock TEXT NOT NULL,
          secret TEXT,
          secret_source TEXT,
          user_lock_txid TEXT,
          solver_lock_txid TEXT,
          user_claim_txid TEXT,
          solver_claim_txid TEXT,
          solver_refund_txid TEXT,
          lane TEXT DEFAULT 'safe',
          fast_opt_in INTEGER DEFAULT 0,
          first_seen_at_ms INTEGER,
          needs_attention INTEGER NOT NULL DEFAULT 0,
          rejection_reason TEXT,
          created_at INTEGER NOT NULL CHECK (created_at < 100000000000),
          updated_at INTEGER NOT NULL CHECK (updated_at < 100000000000)
        );

        CREATE TABLE actions (
          order_id TEXT NOT NULL,
          action TEXT NOT NULL,
          status TEXT NOT NULL,
          intent_payload TEXT NOT NULL,
          txid TEXT,
          created_at INTEGER NOT NULL CHECK (created_at < 100000000000),
          updated_at INTEGER NOT NULL CHECK (updated_at < 100000000000),
          PRIMARY KEY (order_id, action)
        );

        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_lock_id ON orders(lock_id);
        CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
      `);

      this.db.pragma(`user_version = ${SUPPORTED_SCHEMA_VERSION}`);
      return;
    }

    const currentVersion = this.db.pragma('user_version', {
      simple: true,
    }) as number;
    if (currentVersion > SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        `Database schema v${currentVersion} is newer than this solver supports (v${SUPPORTED_SCHEMA_VERSION}); refusing to open it with older code.`,
      );
    }
  }

  recordIntent(
    orderId: string,
    action: string,
    intent: ActionIntent | string,
  ): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'created_at');
    const payloadStr =
      typeof intent === 'string'
        ? intent
        : JSON.stringify(intent, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v,
          );

    let parsedTxid: string | null = null;
    if (typeof intent !== 'string' && intent.txid) {
      parsedTxid = intent.txid;
    } else {
      try {
        const parsed = JSON.parse(payloadStr);
        if (parsed.txid) parsedTxid = parsed.txid;
      } catch {
        // payload is not json
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO actions (order_id, action, status, intent_payload, txid, created_at, updated_at)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
      ON CONFLICT(order_id, action) DO UPDATE SET
        intent_payload = excluded.intent_payload,
        txid = COALESCE(excluded.txid, actions.txid),
        updated_at = excluded.updated_at
    `);
    stmt.run(orderId, action, payloadStr, parsedTxid, now, now);
  }

  recordBroadcast(orderId: string, action: string, txid: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    const stmt = this.db.prepare(`
      UPDATE actions 
      SET status = 'BROADCAST', txid = ?, updated_at = ?
      WHERE order_id = ? AND action = ?
    `);
    stmt.run(txid, now, orderId, action);
  }

  recordFinal(orderId: string, action: string, txid?: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    const stmt = this.db.prepare(`
      UPDATE actions 
      SET status = 'CONFIRMED', txid = COALESCE(?, txid), updated_at = ?
      WHERE order_id = ? AND action = ?
    `);
    stmt.run(txid ?? null, now, orderId, action);
  }

  recordFailed(orderId: string, action: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    const stmt = this.db.prepare(`
      UPDATE actions 
      SET status = 'FAILED', updated_at = ?
      WHERE order_id = ? AND action = ?
    `);
    stmt.run(now, orderId, action);
  }

  getAction(orderId: string, action: string): ActionRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM actions WHERE order_id = ? AND action = ?',
    );
    const row = stmt.get(orderId, action) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      orderId: row.order_id as string,
      action: row.action as string,
      status: row.status as ActionRecord['status'],
      intentPayload: row.intent_payload as string,
      txid: (row.txid as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  listActionsForOrder(orderId: string): ActionRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM actions WHERE order_id = ? ORDER BY created_at ASC',
    );
    const rows = stmt.all(orderId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      orderId: row.order_id as string,
      action: row.action as string,
      status: row.status as ActionRecord['status'],
      intentPayload: row.intent_payload as string,
      txid: (row.txid as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  deleteAction(orderId: string, action: string): void {
    this.db
      .prepare('DELETE FROM actions WHERE order_id = ? AND action = ?')
      .run(orderId, action);
  }

  saveOrder(order: OrderRecord): void {
    assertSecondsTimestamp(order.createdAt, 'order.createdAt');
    assertSecondsTimestamp(order.updatedAt, 'order.updatedAt');

    const stmt = this.db.prepare(`
      INSERT INTO orders (
        id, direction, status, user_counter_address, lock_id, terms_json, hash_lock, secret, secret_source,
        user_lock_txid, solver_lock_txid, user_claim_txid, solver_claim_txid,
        solver_refund_txid, lane, fast_opt_in, first_seen_at_ms, needs_attention, rejection_reason, created_at, updated_at
      ) VALUES (
        @id, @direction, @status, @user_counter_address, @lock_id, @terms_json, @hash_lock, @secret, @secret_source,
        @user_lock_txid, @solver_lock_txid, @user_claim_txid, @solver_claim_txid,
        @solver_refund_txid, @lane, @fast_opt_in, @first_seen_at_ms, @needs_attention, @rejection_reason, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        secret = excluded.secret,
        secret_source = excluded.secret_source,
        user_lock_txid = excluded.user_lock_txid,
        solver_lock_txid = excluded.solver_lock_txid,
        user_claim_txid = excluded.user_claim_txid,
        solver_claim_txid = excluded.solver_claim_txid,
        solver_refund_txid = excluded.solver_refund_txid,
        lane = excluded.lane,
        fast_opt_in = excluded.fast_opt_in,
        first_seen_at_ms = COALESCE(excluded.first_seen_at_ms, orders.first_seen_at_ms),
        needs_attention = excluded.needs_attention,
        rejection_reason = excluded.rejection_reason,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: order.id,
      direction: order.direction,
      status: order.status,
      user_counter_address: order.userCounterAddress.toLowerCase(),
      lock_id: order.lockId.toLowerCase(),
      terms_json: order.termsJson,
      hash_lock: order.hashLock.toLowerCase(),
      secret: order.secret ?? null,
      secret_source: order.secretSource ?? null,
      user_lock_txid: order.userLockTxId ?? null,
      solver_lock_txid: order.solverLockTxId ?? null,
      user_claim_txid: order.userClaimTxId ?? null,
      solver_claim_txid: order.solverClaimTxId ?? null,
      solver_refund_txid: order.solverRefundTxId ?? null,
      lane: order.lane ?? 'safe',
      fast_opt_in: order.fastOptIn ? 1 : 0,
      first_seen_at_ms: order.firstSeenAtMs ?? null,
      needs_attention: order.needsAttention ? 1 : 0,
      rejection_reason: order.rejectionReason ?? null,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    });
  }

  getOrder(id: string): OrderRecord | null {
    const stmt = this.db.prepare('SELECT * FROM orders WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      direction: row.direction as OrderRecord['direction'],
      status: row.status as string,
      userCounterAddress: row.user_counter_address as string,
      lockId: row.lock_id as string,
      termsJson: row.terms_json as string,
      hashLock: row.hash_lock as string,
      secret: (row.secret as string) || undefined,
      secretSource: (row.secret_source as string) || undefined,
      userLockTxId: (row.user_lock_txid as string) || undefined,
      solverLockTxId: (row.solver_lock_txid as string) || undefined,
      userClaimTxId: (row.user_claim_txid as string) || undefined,
      solverClaimTxId: (row.solver_claim_txid as string) || undefined,
      solverRefundTxId: (row.solver_refund_txid as string) || undefined,
      lane: (row.lane as 'safe' | 'fast') || 'safe',
      fastOptIn: Boolean(row.fast_opt_in),
      firstSeenAtMs: (row.first_seen_at_ms as number) || undefined,
      needsAttention: Boolean(row.needs_attention),
      rejectionReason: (row.rejection_reason as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  markNeedsAttention(orderId: string, reason?: string): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE orders
      SET needs_attention = 1,
          rejection_reason = COALESCE(rejection_reason, ?),
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(reason ?? 'Action requires operator attention', now, orderId);
  }

  listNonTerminalOrders(): OrderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM orders 
      WHERE status NOT IN ('DONE', 'EXPIRED', 'REJECTED', 'REFUNDED', 'SOLVER_REFUNDED')
    `);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      direction: row.direction as OrderRecord['direction'],
      status: row.status as string,
      userCounterAddress: row.user_counter_address as string,
      lockId: row.lock_id as string,
      termsJson: row.terms_json as string,
      hashLock: row.hash_lock as string,
      secret: (row.secret as string) || undefined,
      secretSource: (row.secret_source as string) || undefined,
      userLockTxId: (row.user_lock_txid as string) || undefined,
      solverLockTxId: (row.solver_lock_txid as string) || undefined,
      userClaimTxId: (row.user_claim_txid as string) || undefined,
      solverClaimTxId: (row.solver_claim_txid as string) || undefined,
      solverRefundTxId: (row.solver_refund_txid as string) || undefined,
      lane: (row.lane as 'safe' | 'fast') || 'safe',
      fastOptIn: Boolean(row.fast_opt_in),
      firstSeenAtMs: (row.first_seen_at_ms as number) || undefined,
      needsAttention: Boolean(row.needs_attention),
      rejectionReason: (row.rejection_reason as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  close(): void {
    this.db.close();
  }
}
