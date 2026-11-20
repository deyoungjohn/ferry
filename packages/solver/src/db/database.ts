import DatabaseConstructor, {
  type Database as DatabaseType,
} from 'better-sqlite3';
import type { CancelSendLinkQuota } from '@ferry/core/api';
import type {
  ActionIntent,
  ActionRecord,
  OrderRecord,
  PayLinkRecord,
} from './types.js';

export const SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_VALID_UNIX_SECONDS = 100_000_000_000; // ~year 5138
export const DAILY_CANCELLATION_LIMIT = 2;
export const MONTHLY_CANCELLATION_LIMIT = 10;
export const ROLLING_24H_SECONDS = 86_400;
export const ROLLING_30D_SECONDS = 30 * 86_400;

export function assertSecondsTimestamp(ts: number, fieldName: string): number {
  if (ts >= MAX_VALID_UNIX_SECONDS) {
    throw new Error(
      `Timestamp for ${fieldName} must be in Unix seconds (received: ${ts}; appears to be in milliseconds)`,
    );
  }
  return Math.floor(ts);
}

export function toSeconds(ts: number | null | undefined): number {
  if (ts === null || ts === undefined || isNaN(ts)) return 0;
  return Math.floor(ts);
}

/** 2026-11-19 04:00 UTC: the first swaps after this moment count towards the median time. */
const MEDIAN_COUNTS_FROM = 1795060800;

/** Amounts are stored in the terms as decimal strings, with a trailing "n" for a bigint ("1000000n"). */
function termsBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    const cleaned = value.replace(/n$/, '');
    return /^\d+$/.test(cleaned) ? BigInt(cleaned) : 0n;
  }
  return 0n;
}

/** A recorded transaction id, or undefined when it is missing or the all-zero placeholder. */
function realTxId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const bare = value.replace(/^0x/, '');
  return /^[0-9a-fA-F]{64}$/.test(bare) && !/^0+$/.test(bare)
    ? bare
    : undefined;
}

export class SolverDatabase {
  public readonly db: DatabaseType;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
    this.initEventTable();
  }

  /** Every change of an order's state with its time: the timeline pages show, kept for good. */
  private initEventTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS order_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        at INTEGER NOT NULL CHECK (at < 100000000000)
      );
      CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);
    `);
  }

  listOrderEvents(orderId: string): Array<{ status: string; at: number }> {
    return this.db
      .prepare(
        'SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id ASC',
      )
      .all(orderId) as Array<{ status: string; at: number }>;
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
          pay_link_id TEXT,
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

        CREATE TABLE pay_links (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          recipient_cashaddr TEXT NOT NULL,
          recipient_locking_bytecode TEXT NOT NULL,
          token TEXT NOT NULL,
          amount_out TEXT,
          min_amount_out TEXT,
          memo TEXT,
          reference TEXT,
          expires_at INTEGER,
          verified INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          owner_secret_hash TEXT,
          order_id TEXT,
          created_at INTEGER NOT NULL CHECK (created_at < 100000000000),
          updated_at INTEGER NOT NULL CHECK (updated_at < 100000000000)
        );

        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_lock_id ON orders(lock_id);
        CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
        CREATE INDEX IF NOT EXISTS idx_pay_links_recipient ON pay_links(recipient_cashaddr);
        CREATE INDEX IF NOT EXISTS idx_pay_links_status ON pay_links(status);
        CREATE INDEX IF NOT EXISTS idx_pay_links_order_id ON pay_links(order_id);

        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL CHECK (updated_at < 100000000000)
        );

        CREATE TABLE IF NOT EXISTS send_link_notes (
          order_id TEXT PRIMARY KEY,
          note TEXT NOT NULL,
          created_at INTEGER NOT NULL CHECK (created_at < 100000000000)
        );

        CREATE TABLE IF NOT EXISTS send_link_tags (
          tag TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          created_at INTEGER NOT NULL CHECK (created_at < 100000000000)
        );
        CREATE INDEX IF NOT EXISTS idx_send_link_tags_order_id ON send_link_tags(order_id);
        CREATE TABLE IF NOT EXISTS send_link_replacements (
          original_order_id TEXT PRIMARY KEY,
          replacement_order_id TEXT NOT NULL,
          switched_at INTEGER NOT NULL CHECK (switched_at < 100000000000)
        );
        CREATE INDEX IF NOT EXISTS idx_send_link_replacements_target ON send_link_replacements(replacement_order_id);

        CREATE TABLE IF NOT EXISTS send_link_orders (
          order_id TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS send_link_cancellations (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          sender_identity TEXT NOT NULL,
          cancelled_at INTEGER NOT NULL CHECK (cancelled_at < 100000000000)
        );
        CREATE INDEX IF NOT EXISTS idx_send_link_cancellations_sender ON send_link_cancellations(sender_identity, cancelled_at);
        CREATE INDEX IF NOT EXISTS idx_send_link_cancellations_order ON send_link_cancellations(order_id);

        CREATE TABLE IF NOT EXISTS send_link_cancel_hashes (
          order_id TEXT PRIMARY KEY,
          cancel_hash TEXT NOT NULL,
          spent INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL CHECK (created_at < 100000000000)
        );
        CREATE INDEX IF NOT EXISTS idx_send_link_cancel_hashes_hash ON send_link_cancel_hashes(cancel_hash);
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

    // Ensure pay_links table exists for backwards compatibility
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pay_links (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        recipient_cashaddr TEXT NOT NULL,
        recipient_locking_bytecode TEXT NOT NULL,
        token TEXT NOT NULL,
        amount_out TEXT,
        min_amount_out TEXT,
        memo TEXT,
        reference TEXT,
        expires_at INTEGER,
        verified INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        owner_secret_hash TEXT,
        order_id TEXT,
        created_at INTEGER NOT NULL CHECK (created_at < 100000000000),
        updated_at INTEGER NOT NULL CHECK (updated_at < 100000000000)
      );
      CREATE INDEX IF NOT EXISTS idx_pay_links_recipient ON pay_links(recipient_cashaddr);
      CREATE INDEX IF NOT EXISTS idx_pay_links_status ON pay_links(status);
      CREATE INDEX IF NOT EXISTS idx_pay_links_order_id ON pay_links(order_id);

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL CHECK (updated_at < 100000000000)
      );

      CREATE TABLE IF NOT EXISTS send_link_notes (
        order_id TEXT PRIMARY KEY,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL CHECK (created_at < 100000000000)
      );

      CREATE TABLE IF NOT EXISTS send_link_tags (
        tag TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        created_at INTEGER NOT NULL CHECK (created_at < 100000000000)
      );
      CREATE INDEX IF NOT EXISTS idx_send_link_tags_order_id ON send_link_tags(order_id);
      CREATE TABLE IF NOT EXISTS send_link_replacements (
        original_order_id TEXT PRIMARY KEY,
        replacement_order_id TEXT NOT NULL,
        switched_at INTEGER NOT NULL CHECK (switched_at < 100000000000)
      );
      CREATE INDEX IF NOT EXISTS idx_send_link_replacements_target ON send_link_replacements(replacement_order_id);

      CREATE TABLE IF NOT EXISTS send_link_orders (
        order_id TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS send_link_cancellations (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        sender_identity TEXT NOT NULL,
        cancelled_at INTEGER NOT NULL CHECK (cancelled_at < 100000000000)
      );
      CREATE INDEX IF NOT EXISTS idx_send_link_cancellations_sender ON send_link_cancellations(sender_identity, cancelled_at);
      CREATE INDEX IF NOT EXISTS idx_send_link_cancellations_order ON send_link_cancellations(order_id);

      CREATE TABLE IF NOT EXISTS send_link_cancel_hashes (
        order_id TEXT PRIMARY KEY,
        cancel_hash TEXT NOT NULL,
        spent INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL CHECK (created_at < 100000000000)
      );
      CREATE INDEX IF NOT EXISTS idx_send_link_cancel_hashes_hash ON send_link_cancel_hashes(cancel_hash);
    `);

    try {
      this.db.exec('ALTER TABLE pay_links ADD COLUMN owner_secret_hash TEXT;');
    } catch {
      // Column already exists
    }
  }

  /** The sender's note for a send link, kept apart from the order so the signed terms never change. */
  saveSendLinkNote(orderId: string, note: string, createdAt: number): void {
    assertSecondsTimestamp(createdAt, 'created_at');
    this.db
      .prepare(
        `INSERT INTO send_link_notes (order_id, note, created_at) VALUES (?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET note = excluded.note`,
      )
      .run(orderId, note, createdAt);
  }

  /** Marks an order as one made for a send link, so the public list of swaps leaves it out. */
  markSendLinkOrder(orderId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO send_link_orders (order_id) VALUES (?)')
      .run(orderId);
  }

  getSendLinkNote(orderId: string): string | null {
    const row = this.db
      .prepare('SELECT note FROM send_link_notes WHERE order_id = ?')
      .get(orderId) as { note: string } | undefined;
    if (row) return row.note;
    const orig = this.getOriginalSendLinkOrderId(orderId);
    if (orig && orig !== orderId) {
      const origRow = this.db
        .prepare('SELECT note FROM send_link_notes WHERE order_id = ?')
        .get(orig) as { note: string } | undefined;
      if (origRow) return origRow.note;
    }
    const active = this.resolveSendLinkOrderId(orderId);
    if (active && active !== orderId) {
      const activeRow = this.db
        .prepare('SELECT note FROM send_link_notes WHERE order_id = ?')
        .get(active) as { note: string } | undefined;
      if (activeRow) return activeRow.note;
    }
    return null;
  }

  /**
   * Save a blinded view tag for a send link order.
   * Stored beside the order, never inside its signed terms.
   */
  saveSendLinkTag(tag: string, orderId: string, createdAt: number): void {
    assertSecondsTimestamp(createdAt, 'created_at');
    const normalizedTag = tag.toLowerCase();
    this.db
      .prepare(
        `INSERT INTO send_link_tags (tag, order_id, created_at) VALUES (?, ?, ?)`,
      )
      .run(normalizedTag, orderId, createdAt);
  }

  hasSendLinkTag(tag: string): boolean {
    const normalizedTag = tag.toLowerCase();
    const row = this.db
      .prepare(`SELECT 1 FROM send_link_tags WHERE tag = ?`)
      .get(normalizedTag);
    return row !== undefined;
  }

  getSendLinkTagByOrderId(orderId: string): string | null {
    const row = this.db
      .prepare(`SELECT tag FROM send_link_tags WHERE order_id = ?`)
      .get(orderId) as { tag: string } | undefined;
    return row ? row.tag : null;
  }

  /**
   * Resolves a send link order id through its replacement chain to the active order id.
   */
  resolveSendLinkOrderId(orderId: string): string {
    let current = orderId;
    for (let i = 0; i < 10; i++) {
      const row = this.db
        .prepare(
          'SELECT replacement_order_id FROM send_link_replacements WHERE original_order_id = ?',
        )
        .get(current) as { replacement_order_id: string } | undefined;
      if (!row) {
        break;
      }
      current = row.replacement_order_id;
    }
    return current;
  }

  /**
   * Returns the original root order id that was replaced by this order, if any.
   */
  getOriginalSendLinkOrderId(replacementOrderId: string): string | null {
    let current = replacementOrderId;
    let original: string | null = null;
    for (let i = 0; i < 10; i++) {
      const row = this.db
        .prepare(
          'SELECT original_order_id FROM send_link_replacements WHERE replacement_order_id = ?',
        )
        .get(current) as { original_order_id: string } | undefined;
      if (!row) {
        break;
      }
      original = row.original_order_id;
      current = row.original_order_id;
    }
    return original;
  }

  recordSendLinkReplacement(
    originalOrderId: string,
    replacementOrderId: string,
    switchedAt: number,
  ): void {
    assertSecondsTimestamp(switchedAt, 'switched_at');
    this.db
      .prepare(
        `INSERT INTO send_link_replacements (original_order_id, replacement_order_id, switched_at)
         VALUES (?, ?, ?)
         ON CONFLICT(original_order_id) DO UPDATE SET
           replacement_order_id = excluded.replacement_order_id,
           switched_at = excluded.switched_at`,
      )
      .run(originalOrderId, replacementOrderId, switchedAt);
  }

  /**
   * Atomically verifies that no EVM lock has been broadcast or placed, transitions the
   * existing order to SUPERSEDED, records the replacement order, and links metadata.
   */
  switchSendLinkRouteAtomic(params: {
    readonly currentOrderId: string;
    readonly newOrder: OrderRecord;
    readonly switchedAt: number;
  }): { ok: true; originalOrderId: string; newOrderId: string } {
    assertSecondsTimestamp(params.switchedAt, 'switched_at');
    const runInTx = this.db.transaction(() => {
      // 1. Fetch current order with transaction-level consistency
      const currentOrder = this.getOrder(params.currentOrderId);
      if (!currentOrder) {
        throw new Error(`Order ${params.currentOrderId} not found`);
      }

      // 2. Refuse if solver has already broadcast an EVM lock or is in a post-lock status
      if (
        currentOrder.solverLockTxId ||
        currentOrder.status === 'SOLVER_LOCK_BROADCAST' ||
        currentOrder.status === 'SOLVER_LOCK_SEEN' ||
        currentOrder.status === 'SECRET_KNOWN' ||
        currentOrder.status === 'USER_CLAIM_SEEN' ||
        currentOrder.status === 'SOLVER_CLAIM_BROADCAST' ||
        currentOrder.status === 'SOLVER_CLAIM_FINAL' ||
        currentOrder.status === 'DONE' ||
        currentOrder.status === 'RELEASED' ||
        currentOrder.status === 'REFUNDED' ||
        currentOrder.status === 'SOLVER_REFUNDED'
      ) {
        const error = new Error(
          'Cannot switch route: EVM lock already broadcast',
        );
        (error as Error & { code?: string }).code = 'LOCK_ALREADY_EXISTS';
        throw error;
      }

      // 3. Check for in-flight lock action
      const lockAction = this.getAction(params.currentOrderId, 'lock');
      if (
        lockAction &&
        (lockAction.status === 'PENDING' ||
          lockAction.status === 'BROADCAST' ||
          lockAction.status === 'CONFIRMED')
      ) {
        const error = new Error(
          'Cannot switch route: solver lock is currently in-flight',
        );
        (error as Error & { code?: string }).code = 'LOCK_ALREADY_EXISTS';
        throw error;
      }

      // 4. Refuse if order has been cancelled
      if (
        currentOrder.status === 'CANCELLED' ||
        this.isOrderCancelled(params.currentOrderId)
      ) {
        const error = new Error(
          'Cannot switch route: send link has been cancelled',
        );
        (error as Error & { code?: string }).code = 'LINK_CANCELLED';
        throw error;
      }

      // 5. Insert new order record
      this.saveOrder(params.newOrder);

      // 6. Mark old order as SUPERSEDED
      this.db
        .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
        .run('SUPERSEDED', params.switchedAt, params.currentOrderId);
      this.db
        .prepare(
          'INSERT INTO order_events (order_id, status, at) VALUES (?, ?, ?)',
        )
        .run(params.currentOrderId, 'SUPERSEDED', params.switchedAt);

      // 7. Record replacement
      this.recordSendLinkReplacement(
        params.currentOrderId,
        params.newOrder.id,
        params.switchedAt,
      );

      // Also if currentOrderId was replacing an earlier order, ensure root original order points to newOrder
      const originalRoot = this.getOriginalSendLinkOrderId(
        params.currentOrderId,
      );
      if (originalRoot && originalRoot !== params.currentOrderId) {
        this.recordSendLinkReplacement(
          originalRoot,
          params.newOrder.id,
          params.switchedAt,
        );
      }

      // 8. Carry over send link tag if one was registered
      const tag = this.getSendLinkTagByOrderId(params.currentOrderId);
      if (tag) {
        this.db
          .prepare('UPDATE send_link_tags SET order_id = ? WHERE tag = ?')
          .run(params.newOrder.id, tag.toLowerCase());
      }

      // 9. Carry over send link note if one was registered
      const note = this.getSendLinkNote(params.currentOrderId);
      if (note) {
        this.saveSendLinkNote(params.newOrder.id, note, params.switchedAt);
      }

      // 10. Carry over send link cancel hash if one was registered
      const cancelHashRow = this.getSendLinkCancelHash(params.currentOrderId);
      if (cancelHashRow) {
        this.saveSendLinkCancelHash(
          params.newOrder.id,
          cancelHashRow.cancelHash,
          params.switchedAt,
        );
      }

      return {
        ok: true as const,
        originalOrderId: originalRoot ?? params.currentOrderId,
        newOrderId: params.newOrder.id,
      };
    });

    return runInTx();
  }

  /**
   * Save a cancel hash for a send link order.
   * Stored beside the order, never inside its signed terms.
   */
  saveSendLinkCancelHash(
    orderId: string,
    cancelHash: string,
    createdAt: number,
  ): void {
    assertSecondsTimestamp(createdAt, 'created_at');
    const normalizedHash = cancelHash.startsWith('0x')
      ? cancelHash.toLowerCase()
      : `0x${cancelHash.toLowerCase()}`;
    this.db
      .prepare(
        `INSERT INTO send_link_cancel_hashes (order_id, cancel_hash, spent, created_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(order_id) DO UPDATE SET cancel_hash = excluded.cancel_hash`,
      )
      .run(orderId, normalizedHash, createdAt);
  }

  getSendLinkCancelHash(orderId: string): {
    cancelHash: string;
    spent: boolean;
  } | null {
    let row = this.db
      .prepare(
        'SELECT cancel_hash as cancelHash, spent FROM send_link_cancel_hashes WHERE order_id = ?',
      )
      .get(orderId) as { cancelHash: string; spent: number } | undefined;
    if (!row) {
      const orig = this.getOriginalSendLinkOrderId(orderId);
      if (orig) {
        row = this.db
          .prepare(
            'SELECT cancel_hash as cancelHash, spent FROM send_link_cancel_hashes WHERE order_id = ?',
          )
          .get(orig) as { cancelHash: string; spent: number } | undefined;
      }
    }
    if (!row) return null;
    return {
      cancelHash: row.cancelHash,
      spent: row.spent === 1,
    };
  }

  markSendLinkCancelHashSpent(orderId: string): void {
    const activeId = this.resolveSendLinkOrderId(orderId);
    const origId = this.getOriginalSendLinkOrderId(orderId);
    const ids = Array.from(
      new Set([orderId, activeId, ...(origId ? [origId] : [])]),
    );
    for (const id of ids) {
      this.db
        .prepare(
          'UPDATE send_link_cancel_hashes SET spent = 1 WHERE order_id = ?',
        )
        .run(id);
    }
  }

  getOrdersBySendLinkTags(
    tags: string[],
  ): Array<{ tag: string; order: OrderRecord }> {
    if (tags.length === 0) return [];
    const normalizedTags = Array.from(
      new Set(tags.map((t) => t.toLowerCase())),
    );
    const placeholders = normalizedTags.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT t.tag, o.*
      FROM send_link_tags t
      JOIN orders o ON t.order_id = o.id
      WHERE t.tag IN (${placeholders})
    `);
    const rows = stmt.all(...normalizedTags) as Array<
      { tag: string } & Record<string, unknown>
    >;
    return rows.map((r) => {
      const initialOrder = this.mapOrderRow(r);
      const activeId = this.resolveSendLinkOrderId(initialOrder.id);
      if (activeId !== initialOrder.id) {
        const activeOrder = this.getOrder(activeId);
        if (activeOrder) {
          return { tag: r.tag, order: activeOrder };
        }
      }
      return {
        tag: r.tag,
        order: initialOrder,
      };
    });
  }

  /**
   * Record a send link cancellation for a sender identity.
   */
  recordSendLinkCancellation(
    orderId: string,
    senderIdentity: string,
    cancelledAt: number,
  ): void {
    assertSecondsTimestamp(cancelledAt, 'cancelled_at');
    const normalizedSender = senderIdentity.toLowerCase();
    const activeId = this.resolveSendLinkOrderId(orderId);
    const origId = this.getOriginalSendLinkOrderId(orderId);
    const ids = Array.from(
      new Set([orderId, activeId, ...(origId ? [origId] : [])]),
    );
    for (const id of ids) {
      const recordId = `cancel_${id}`;
      this.db
        .prepare(
          `INSERT INTO send_link_cancellations (id, order_id, sender_identity, cancelled_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET cancelled_at = excluded.cancelled_at`,
        )
        .run(recordId, id, normalizedSender, cancelledAt);
      const ord = this.getOrder(id);
      if (ord && ord.status !== 'CANCELLED') {
        this.db
          .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
          .run('CANCELLED', cancelledAt, id);
      }
    }
  }

  isOrderCancelled(orderId: string): boolean {
    const activeId = this.resolveSendLinkOrderId(orderId);
    const origId = this.getOriginalSendLinkOrderId(orderId);
    const ids = Array.from(
      new Set([orderId, activeId, ...(origId ? [origId] : [])]),
    );
    for (const id of ids) {
      const row = this.db
        .prepare(
          'SELECT 1 FROM send_link_cancellations WHERE order_id = ? OR id = ?',
        )
        .get(id, `cancel_${id}`);
      if (row !== undefined) return true;
      const order = this.getOrder(id);
      if (order && order.status === 'CANCELLED') return true;
    }
    return false;
  }

  getCancellationForOrder(orderId: string): {
    id: string;
    orderId: string;
    senderIdentity: string;
    cancelledAt: number;
  } | null {
    const activeId = this.resolveSendLinkOrderId(orderId);
    const origId = this.getOriginalSendLinkOrderId(orderId);
    const ids = Array.from(
      new Set([orderId, activeId, ...(origId ? [origId] : [])]),
    );
    for (const id of ids) {
      const row = this.db
        .prepare(
          'SELECT id, order_id as orderId, sender_identity as senderIdentity, cancelled_at as cancelledAt FROM send_link_cancellations WHERE order_id = ? OR id = ?',
        )
        .get(id, `cancel_${id}`) as
        | {
            id: string;
            orderId: string;
            senderIdentity: string;
            cancelledAt: number;
          }
        | undefined;
      if (row) return row;
    }
    return null;
  }

  getSendLinkCancellationQuota(
    senderIdentity: string,
    nowSeconds?: number,
  ): CancelSendLinkQuota {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    const normalizedSender = senderIdentity.toLowerCase();

    const dayWindowStart = now - ROLLING_24H_SECONDS; // 24 hours
    const monthWindowStart = now - ROLLING_30D_SECONDS; // 30 days

    const rows = this.db
      .prepare(
        `SELECT cancelled_at
         FROM send_link_cancellations
         WHERE sender_identity = ? AND cancelled_at >= ?
         ORDER BY cancelled_at ASC`,
      )
      .all(normalizedSender, monthWindowStart) as Array<{
      cancelled_at: number;
    }>;

    const monthlyUsed = rows.length;
    const dailyRows = rows.filter((r) => r.cancelled_at >= dayWindowStart);
    const dailyUsed = dailyRows.length;

    const dailyLimit = DAILY_CANCELLATION_LIMIT;
    const monthlyLimit = MONTHLY_CANCELLATION_LIMIT;

    const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
    const monthlyRemaining = Math.max(0, monthlyLimit - monthlyUsed);

    let nextAllowedAt: number | null = null;
    if (dailyRemaining === 0) {
      const oldestDaily = dailyRows[0]?.cancelled_at;
      if (oldestDaily !== undefined) {
        nextAllowedAt = oldestDaily + ROLLING_24H_SECONDS;
      }
    }
    if (monthlyRemaining === 0) {
      const oldestMonthly = rows[0]?.cancelled_at;
      if (oldestMonthly !== undefined) {
        const nextMonthly = oldestMonthly + ROLLING_30D_SECONDS;
        nextAllowedAt =
          nextAllowedAt !== null
            ? Math.max(nextAllowedAt, nextMonthly)
            : nextMonthly;
      }
    }

    return {
      dailyUsed,
      dailyLimit,
      dailyRemaining,
      monthlyUsed,
      monthlyLimit,
      monthlyRemaining,
      nextAllowedAt: nextAllowedAt ?? null,
    };
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM system_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    this.db
      .prepare(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  isQuotingPaused(): boolean {
    return this.getSetting('quoting_paused') === 'true';
  }

  setQuotingPaused(paused: boolean): void {
    this.setSetting('quoting_paused', paused ? 'true' : 'false');
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

    const parsedIntent =
      typeof intent === 'string'
        ? (JSON.parse(intent) as ActionIntent)
        : intent;

    const txid = parsedIntent.txid || null;

    const stmt = this.db.prepare(`
      INSERT INTO actions (order_id, action, status, intent_payload, txid, created_at, updated_at)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
      ON CONFLICT(order_id, action) DO UPDATE SET
        intent_payload = excluded.intent_payload,
        txid = excluded.txid,
        updated_at = excluded.updated_at
    `);
    stmt.run(orderId, action, payloadStr, txid, now, now);
  }

  recordBroadcast(orderId: string, action: string, txid: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    const stmt = this.db.prepare(`
      UPDATE actions
      SET status = 'BROADCAST',
          txid = ?,
          updated_at = ?
      WHERE order_id = ? AND action = ?
    `);
    stmt.run(txid, now, orderId, action);
  }

  recordFinal(orderId: string, action: string, txid?: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    const stmt = this.db.prepare(`
      UPDATE actions
      SET status = 'CONFIRMED',
          txid = COALESCE(?, txid),
          updated_at = ?
      WHERE order_id = ? AND action = ?
    `);
    stmt.run(txid ?? null, now, orderId, action);
  }

  recordFailed(orderId: string, action: string): void {
    const now = Math.floor(Date.now() / 1000);
    assertSecondsTimestamp(now, 'updated_at');
    const stmt = this.db.prepare(`
      UPDATE actions
      SET status = 'FAILED',
          updated_at = ?
      WHERE order_id = ? AND action = ?
    `);
    stmt.run(now, orderId, action);
  }

  getAction(orderId: string, action: string): ActionRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM actions WHERE order_id = ? AND action = ?',
    );
    const row = stmt.get(orderId, action) as
      | {
          order_id: string;
          action: string;
          status: ActionRecord['status'];
          intent_payload: string;
          txid: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      orderId: row.order_id,
      action: row.action,
      status: row.status,
      intentPayload: row.intent_payload,
      txid: row.txid ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deleteAction(orderId: string, action: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM actions WHERE order_id = ? AND action = ?',
    );
    stmt.run(orderId, action);
  }

  listActionsForOrder(orderId: string): ActionRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM actions WHERE order_id = ? ORDER BY created_at ASC',
    );
    const rows = stmt.all(orderId) as Array<{
      order_id: string;
      action: string;
      status: ActionRecord['status'];
      intent_payload: string;
      txid: string | null;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      orderId: row.order_id,
      action: row.action,
      status: row.status,
      intentPayload: row.intent_payload,
      txid: row.txid ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  saveOrder(order: OrderRecord): void {
    assertSecondsTimestamp(order.createdAt, 'order.createdAt');
    assertSecondsTimestamp(order.updatedAt, 'order.updatedAt');
    const before = this.db
      .prepare('SELECT status FROM orders WHERE id = ?')
      .get(order.id) as { status: string } | undefined;

    const stmt = this.db.prepare(`
      INSERT INTO orders (
        id, direction, status, user_counter_address, lock_id, terms_json, hash_lock, secret, secret_source,
        user_lock_txid, solver_lock_txid, user_claim_txid, solver_claim_txid,
        solver_refund_txid, lane, fast_opt_in, first_seen_at_ms, needs_attention, rejection_reason, pay_link_id, created_at, updated_at
      ) VALUES (
        @id, @direction, @status, @user_counter_address, @lock_id, @terms_json, @hash_lock, @secret, @secret_source,
        @user_lock_txid, @solver_lock_txid, @user_claim_txid, @solver_claim_txid,
        @solver_refund_txid, @lane, @fast_opt_in, @first_seen_at_ms, @needs_attention, @rejection_reason, @pay_link_id, @created_at, @updated_at
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
        pay_link_id = COALESCE(excluded.pay_link_id, orders.pay_link_id),
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
      pay_link_id: order.payLinkId ?? null,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    });
    if (before?.status !== order.status) {
      this.db
        .prepare(
          'INSERT INTO order_events (order_id, status, at) VALUES (?, ?, ?)',
        )
        .run(order.id, order.status, order.updatedAt);
    }
  }

  getOrder(id: string): OrderRecord | null {
    const stmt = this.db.prepare('SELECT * FROM orders WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapOrderRow(row);
  }

  getOrderByHashLock(hashLock: string): OrderRecord | null {
    const raw = hashLock.toLowerCase();
    const clean = raw.startsWith('0x') ? raw.slice(2) : raw;
    const withPrefix = `0x${clean}`;
    const stmt = this.db.prepare(`
      SELECT * FROM orders
      WHERE LOWER(hash_lock) = ? OR LOWER(hash_lock) = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(clean, withPrefix) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapOrderRow(row);
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

  /** Funded orders of one EVM address, newest first (quotes nobody locked against are left out). */
  listOrdersByAddress(address: string, limit = 50): OrderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM orders
      WHERE LOWER(user_counter_address) = LOWER(?)
        AND status NOT IN ('QUOTED', 'EXPIRED', 'REJECTED', 'SUPERSEDED')
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(address, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapOrderRow(row));
  }

  listNonTerminalOrders(): OrderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM orders 
      WHERE status NOT IN ('DONE', 'EXPIRED', 'REJECTED', 'RELEASED', 'REFUNDED', 'SOLVER_REFUNDED', 'SUPERSEDED')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapOrderRow(row));
  }

  listOrdersForKeeper(): OrderRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM orders
      WHERE status NOT IN ('DONE', 'RELEASED', 'SOLVER_REFUNDED', 'SUPERSEDED')
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapOrderRow(row));
  }

  getOpenExposureUsdMicros(): bigint {
    const orders = this.listNonTerminalOrders();
    let totalMicros = 0n;
    for (const order of orders) {
      if (order.status === 'QUOTED') {
        continue;
      }
      try {
        const terms = JSON.parse(order.termsJson);
        // Past its own deadline the user can refund and the solver owes nothing: no reservation.
        const nowSeconds = Math.floor(Date.now() / 1000);
        const deadline = Number(
          String(terms.evmDeadline ?? '0').replace(/n$/, ''),
        );
        const forward =
          order.direction === 'EVM_TO_BCH' ||
          order.direction === 'COUNTER_TO_BCH';
        if (forward && deadline > 0 && deadline < nowSeconds) continue;
        if (!forward && toSeconds(order.createdAt) < nowSeconds - 86_400)
          continue;
        // From the PUSD or MUSD amount (2 decimals, a cent per unit): the same for every EVM token,
        // whatever its decimals (BNB Chain's USDT has 18).
        totalMicros += termsBigInt(terms.bchTokenAmount) * 10_000n;
      } catch {
        // ignore malformed terms
      }
    }
    return totalMicros;
  }

  countUnfundedQuotesByAddress(userAddress: string, nowInput?: number): number {
    const now = nowInput ?? Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT terms_json FROM orders
      WHERE LOWER(user_counter_address) = LOWER(?)
        AND status = 'QUOTED'
    `);
    const rows = stmt.all(userAddress) as Array<{ terms_json: string }>;
    let count = 0;
    for (const row of rows) {
      try {
        const terms = JSON.parse(row.terms_json);
        if (typeof terms.quoteExpiry === 'number' && terms.quoteExpiry > now) {
          count++;
        }
      } catch {
        // ignore malformed terms
      }
    }
    return count;
  }

  countGlobalUnfundedQuotes(nowInput?: number): number {
    const now = nowInput ?? Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT terms_json FROM orders
      WHERE status = 'QUOTED'
    `);
    const rows = stmt.all() as Array<{ terms_json: string }>;
    let count = 0;
    for (const row of rows) {
      try {
        const terms = JSON.parse(row.terms_json);
        if (typeof terms.quoteExpiry === 'number' && terms.quoteExpiry > now) {
          count++;
        }
      } catch {
        // ignore malformed terms
      }
    }
    return count;
  }

  countNeedsAttentionOrders(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM orders WHERE needs_attention = 1')
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getNeedsAttentionOrdersSummary(
    nowInput: number = Math.floor(Date.now() / 1000),
  ): Array<{
    orderId: string;
    direction: 'BCH_TO_COUNTER' | 'COUNTER_TO_BCH';
    status: string;
    lane?: 'safe' | 'fast' | undefined;
    createdAt: number;
    updatedAt: number;
    ageSeconds: number;
    rejectionReason?: string | undefined;
    txIds: {
      userLockTxId?: string | undefined;
      solverLockTxId?: string | undefined;
      userClaimTxId?: string | undefined;
      solverClaimTxId?: string | undefined;
      solverRefundTxId?: string | undefined;
    };
  }> {
    const nowSec = toSeconds(nowInput);
    const stmt = this.db.prepare(
      'SELECT * FROM orders WHERE needs_attention = 1 ORDER BY updated_at DESC',
    );
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => {
      const order = this.mapOrderRow(r);
      const createdAtSec = toSeconds(order.createdAt);
      const updatedAtSec = toSeconds(order.updatedAt);
      return {
        orderId: order.id,
        direction:
          order.direction === 'BCH_TO_COUNTER' ||
          order.direction === 'BCH_TO_EVM'
            ? 'BCH_TO_COUNTER'
            : 'COUNTER_TO_BCH',
        status: order.status,
        lane: order.lane,
        createdAt: createdAtSec,
        updatedAt: updatedAtSec,
        ageSeconds: Math.max(0, nowSec - createdAtSec),
        rejectionReason: order.rejectionReason,
        txIds: {
          userLockTxId: order.userLockTxId,
          solverLockTxId: order.solverLockTxId,
          userClaimTxId: order.userClaimTxId,
          solverClaimTxId: order.solverClaimTxId,
          solverRefundTxId: order.solverRefundTxId,
        },
      };
    });
  }

  getOrderCountsByStatus(): Record<string, number> {
    const counts: Record<string, number> = {
      QUOTED: 0,
      USER_LOCK_SEEN: 0,
      USER_LOCK_FINAL: 0,
      SOLVER_LOCK_BROADCAST: 0,
      SOLVER_LOCK_SEEN: 0,
      SECRET_KNOWN: 0,
      USER_CLAIM_SEEN: 0,
      SOLVER_CLAIM_BROADCAST: 0,
      SOLVER_CLAIM_FINAL: 0,
      DONE: 0,
      EXPIRED: 0,
      REJECTED: 0,
      SOLVER_REFUNDED: 0,
    };

    const stmt = this.db.prepare(
      'SELECT status, COUNT(*) as count FROM orders GROUP BY status',
    );
    const rows = stmt.all() as Array<{ status: string; count: number }>;
    for (const r of rows) {
      if (r.status in counts) {
        counts[r.status] = r.count;
      }
    }
    return counts;
  }

  getOldestNonTerminalOrderAgeSeconds(
    nowInput: number = Math.floor(Date.now() / 1000),
  ): number | null {
    const stmt = this.db.prepare(`
      SELECT MIN(created_at) as oldest_created_at
      FROM orders
      WHERE status NOT IN ('DONE', 'EXPIRED', 'REJECTED', 'REFUNDED', 'SOLVER_REFUNDED')
    `);
    const row = stmt.get() as { oldest_created_at: number | null } | undefined;
    if (
      !row ||
      row.oldest_created_at === null ||
      row.oldest_created_at === undefined
    ) {
      return null;
    }
    const nowSec = toSeconds(nowInput);
    const oldestSec = toSeconds(row.oldest_created_at);
    return Math.max(0, nowSec - oldestSec);
  }

  getStatsSummary(
    spreadBps: number,
    fixedFeeUsdMicros: bigint,
    nowInput: number = Math.floor(Date.now() / 1000),
  ): {
    completedSwaps: number | null;
    volumeUsdMicros: bigint | null;
    medianFastSeconds: number | null;
    quotePolicy: { spreadBps: number; fixedFeeUsdMicros: bigint } | null;
    asOf: number | null;
  } {
    const stmt = this.db.prepare(`
      SELECT id, terms_json, lane, direction, created_at, updated_at,
        (pay_link_id IS NOT NULL
          OR id IN (SELECT order_id FROM send_link_orders)
          OR id IN (SELECT order_id FROM send_link_notes)
          OR id IN (SELECT order_id FROM send_link_tags)) AS is_link
      FROM orders 
      WHERE status = 'DONE'
    `);
    const rows = stmt.all() as Array<{
      terms_json: string;
      lane: string;
      created_at: number;
      updated_at: number;
      is_link: number;
      direction: string;
      id: string;
    }>;
    const legacyLinkOrders = this.legacyLinkOrderIds();

    if (rows.length === 0) {
      return {
        completedSwaps: null,
        volumeUsdMicros: null,
        medianFastSeconds: null,
        quotePolicy: {
          spreadBps,
          fixedFeeUsdMicros,
        },
        asOf: toSeconds(nowInput),
      };
    }

    let totalVolumeMicros = 0n;
    const fastDurations: number[] = [];

    for (const row of rows) {
      try {
        const terms = JSON.parse(row.terms_json);
        totalVolumeMicros += termsBigInt(terms.bchTokenAmount) * 10_000n;
      } catch {
        // ignore
      }

      // Every settled swap counts, whatever its lane: most run on the safe lane. Swaps that began
      // before MEDIAN_COUNTS_FROM ran on engine builds with known faults and are left out of the
      // median (they still count as completed swaps and in the volume).
      // A link's order waits for a person to pay or claim it, so its time is not the swap's speed.
      const isLink = Boolean(row.is_link) || legacyLinkOrders.has(row.id);
      if (!isLink && toSeconds(row.created_at) >= MEDIAN_COUNTS_FROM) {
        fastDurations.push(
          Math.max(0, toSeconds(row.updated_at) - toSeconds(row.created_at)),
        );
      }
    }

    fastDurations.sort((a, b) => a - b);
    let medianFastSeconds: number | null = null;
    if (fastDurations.length > 0) {
      const mid = Math.floor(fastDurations.length / 2);
      medianFastSeconds =
        fastDurations.length % 2 !== 0
          ? fastDurations[mid]!
          : Math.floor((fastDurations[mid - 1]! + fastDurations[mid]!) / 2);
    }

    return {
      completedSwaps: rows.length,
      volumeUsdMicros: totalVolumeMicros,
      medianFastSeconds,
      quotePolicy: {
        spreadBps,
        fixedFeeUsdMicros,
      },
      asOf: toSeconds(nowInput),
    };
  }

  /**
   * When pay link payments began to carry a mark (the first start of this code). Links made
   * before it keep the old rule (a swap to the link's recipient, token and amount), limited to
   * swaps made before it; after it a swap belongs to a link only if it carries the link's mark.
   */
  payLinkTaggingFrom(): number {
    const stored = this.getSetting('pay_link_tagging_from');
    if (stored !== null && /^\d+$/.test(stored)) return Number(stored);
    const now = Math.floor(Date.now() / 1000);
    this.setSetting('pay_link_tagging_from', String(now));
    return now;
  }

  /**
   * The orders the product already attached to a link (stored on the link when its page or the
   * list read it), for the swap lists: exactly what was shown as a link's payment, not a new guess.
   */
  private legacyLinkOrderIds(): Set<string> {
    const rows = this.db
      .prepare('SELECT order_id FROM pay_links WHERE order_id IS NOT NULL')
      .all() as Array<{ order_id: string }>;
    return new Set(rows.map((r) => r.order_id));
  }

  getRecentSwaps(limit: number = 50): Array<{
    orderId: string;
    settledAt: number;
    direction: 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER';
    counterSymbol: string;
    counterDecimals: number;
    counterAmount: bigint;
    evmChainId?: number | undefined;
    evmTokenAddress?: string | undefined;
    bchSymbol: string;
    bchDecimals: number;
    bchTokenAmount: bigint;
    durationSeconds: number;
    baseTxId: string;
    bchTxId: string;
    sourceTxId?: string | undefined;
    claimTxId?: string | undefined;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM orders 
      WHERE status = 'DONE' 
        AND pay_link_id IS NULL
        AND id NOT IN (SELECT order_id FROM send_link_orders)
        AND id NOT IN (SELECT order_id FROM send_link_notes)
        AND id NOT IN (SELECT order_id FROM send_link_tags)
      ORDER BY updated_at DESC 
      LIMIT ?
    `);
    // Payments of older links are filtered below, so read a wider window than the limit.
    const legacy = this.legacyLinkOrderIds();
    const rows = (stmt.all(limit * 4 + 200) as Record<string, unknown>[])
      .filter((r) => !legacy.has(String(r.id)))
      .slice(0, limit);
    const result: Array<{
      orderId: string;
      settledAt: number;
      direction: 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER';
      counterSymbol: string;
      counterDecimals: number;
      counterAmount: bigint;
      evmChainId?: number | undefined;
      evmTokenAddress?: string | undefined;
      bchSymbol: string;
      bchDecimals: number;
      bchTokenAmount: bigint;
      durationSeconds: number;
      baseTxId: string;
      bchTxId: string;
      sourceTxId?: string | undefined;
      claimTxId?: string | undefined;
    }> = [];

    for (const r of rows) {
      const order = this.mapOrderRow(r);
      try {
        const terms = JSON.parse(order.termsJson);
        const settledAt = toSeconds(order.updatedAt);
        const createdAt = toSeconds(order.createdAt);
        const durationSeconds = Math.max(0, settledAt - createdAt);

        const baseTxId =
          order.direction === 'COUNTER_TO_BCH'
            ? order.solverClaimTxId ||
              order.userLockTxId ||
              '0x' + '00'.repeat(32)
            : order.solverLockTxId ||
              order.userClaimTxId ||
              '0x' + '00'.repeat(32);

        const bchTxId =
          order.direction === 'COUNTER_TO_BCH'
            ? order.userClaimTxId || order.solverLockTxId || '00'.repeat(32)
            : order.solverClaimTxId || order.userLockTxId || '00'.repeat(32);

        result.push({
          orderId: order.id,
          settledAt,
          direction:
            order.direction === 'BCH_TO_COUNTER' ||
            order.direction === 'BCH_TO_EVM'
              ? 'BCH_TO_COUNTER'
              : 'COUNTER_TO_BCH',
          counterSymbol: 'USDC',
          counterDecimals: 6,
          counterAmount: termsBigInt(terms.evmAmount),
          evmChainId:
            terms.evmChainId !== undefined
              ? Number(terms.evmChainId)
              : undefined,
          evmTokenAddress:
            typeof terms.evmToken === 'string' ? terms.evmToken : undefined,
          bchSymbol: terms.bchToken || 'PUSD',
          bchDecimals: 2,
          bchTokenAmount: termsBigInt(terms.bchTokenAmount),
          durationSeconds,
          baseTxId,
          bchTxId: bchTxId.startsWith('0x') ? bchTxId.slice(2) : bchTxId,
          sourceTxId: realTxId(order.userLockTxId),
          claimTxId: realTxId(order.userClaimTxId),
        });
      } catch {
        // ignore malformed
      }
    }
    return result;
  }

  // PayLink CRUD
  savePayLink(link: PayLinkRecord): void {
    assertSecondsTimestamp(link.createdAt, 'payLink.createdAt');
    assertSecondsTimestamp(link.updatedAt, 'payLink.updatedAt');
    if (link.expiresAt !== undefined) {
      assertSecondsTimestamp(link.expiresAt, 'payLink.expiresAt');
    }

    const stmt = this.db.prepare(`
      INSERT INTO pay_links (
        id, kind, recipient_cashaddr, recipient_locking_bytecode, token,
        amount_out, min_amount_out, memo, reference, expires_at,
        verified, status, owner_secret_hash, order_id, created_at, updated_at
      ) VALUES (
        @id, @kind, @recipient_cashaddr, @recipient_locking_bytecode, @token,
        @amount_out, @min_amount_out, @memo, @reference, @expires_at,
        @verified, @status, @owner_secret_hash, @order_id, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        recipient_cashaddr = excluded.recipient_cashaddr,
        recipient_locking_bytecode = excluded.recipient_locking_bytecode,
        token = excluded.token,
        amount_out = excluded.amount_out,
        min_amount_out = excluded.min_amount_out,
        memo = excluded.memo,
        reference = excluded.reference,
        expires_at = excluded.expires_at,
        verified = excluded.verified,
        status = excluded.status,
        owner_secret_hash = COALESCE(excluded.owner_secret_hash, pay_links.owner_secret_hash),
        order_id = excluded.order_id,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: link.id,
      kind: link.kind,
      recipient_cashaddr: link.recipientCashaddr,
      recipient_locking_bytecode: link.recipientLockingBytecode.toLowerCase(),
      token: link.token,
      amount_out:
        link.amountOut !== undefined ? link.amountOut.toString() : null,
      min_amount_out:
        link.minAmountOut !== undefined ? link.minAmountOut.toString() : null,
      memo: link.memo ?? null,
      reference: link.reference ?? null,
      expires_at: link.expiresAt ?? null,
      verified: link.verified ? 1 : 0,
      status: link.status,
      owner_secret_hash: link.ownerSecretHash ?? null,
      order_id: link.orderId ?? null,
      created_at: link.createdAt,
      updated_at: link.updatedAt,
    });
  }

  /**
   * The newest swap that pays this link: a forward swap made after the link, to the link's
   * recipient script, for the link's token and (when the amount is fixed) its exact amount.
   * Quotes nobody locked against, expired and rejected orders do not count.
   */
  findOrderForPayLink(link: PayLinkRecord): OrderRecord | null {
    // The mark first: a payment that named this link.
    const marked = this.db
      .prepare(
        `SELECT * FROM orders
         WHERE pay_link_id = ?
           AND direction IN ('EVM_TO_BCH', 'COUNTER_TO_BCH')
           AND status NOT IN ('QUOTED', 'EXPIRED', 'REJECTED')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(link.id) as Record<string, unknown> | undefined;
    if (marked) return this.mapOrderRow(marked);
    // A link made before payments carried a mark keeps the old rule, for swaps made before it.
    const from = this.payLinkTaggingFrom();
    if (link.createdAt >= from) return null;
    return this.findLegacyOrderForPayLink(link, from);
  }

  private findLegacyOrderForPayLink(
    link: PayLinkRecord,
    before: number,
  ): OrderRecord | null {
    const rows = this.db
      .prepare(
        `SELECT * FROM orders
         WHERE direction IN ('EVM_TO_BCH', 'COUNTER_TO_BCH')
           AND status NOT IN ('QUOTED', 'EXPIRED', 'REJECTED')
           AND pay_link_id IS NULL
           AND created_at >= ?
           AND created_at < ?
         ORDER BY created_at DESC
         LIMIT 200`,
      )
      .all(link.createdAt - 600, before) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const order = this.mapOrderRow(row);
      try {
        const terms = JSON.parse(order.termsJson) as Record<string, unknown>;
        const recipient = String(
          terms.userBchLockingBytecode ?? '',
        ).toLowerCase();
        const token = String(terms.bchToken ?? '');
        const amount = termsBigInt(terms.bchTokenAmount);
        if (recipient !== link.recipientLockingBytecode.toLowerCase()) continue;
        if (token !== link.token) continue;
        if (link.amountOut !== undefined && amount < link.amountOut) continue;
        return order;
      } catch {
        // unreadable terms: not a match
      }
    }
    return null;
  }

  getPayLink(id: string): PayLinkRecord | null {
    const stmt = this.db.prepare('SELECT * FROM pay_links WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const link = this.mapPayLinkRow(row);
    const now = Math.floor(Date.now() / 1000);
    if (
      link.expiresAt !== undefined &&
      link.expiresAt <= now &&
      (link.status === 'open' || link.status === 'reserved')
    ) {
      this.updatePayLinkStatus(link.id, 'expired');
      link.status = 'expired';
    }
    return link;
  }

  getPayLinkByOrderId(orderId: string): PayLinkRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM pay_links WHERE order_id = ? LIMIT 1',
    );
    const row = stmt.get(orderId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapPayLinkRow(row);
  }

  listPayLinksByRecipient(recipientCashaddr: string): PayLinkRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM pay_links WHERE recipient_cashaddr = ? ORDER BY created_at DESC',
    );
    const rows = stmt.all(recipientCashaddr) as Record<string, unknown>[];
    const now = Math.floor(Date.now() / 1000);
    return rows.map((row) => {
      const link = this.mapPayLinkRow(row);
      if (
        link.expiresAt !== undefined &&
        link.expiresAt <= now &&
        (link.status === 'open' || link.status === 'reserved')
      ) {
        this.updatePayLinkStatus(link.id, 'expired');
        link.status = 'expired';
      }
      return link;
    });
  }

  updatePayLinkStatus(
    id: string,
    status: PayLinkRecord['status'],
    orderId?: string | null,
  ): void {
    const now = Math.floor(Date.now() / 1000);
    if (orderId !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE pay_links 
        SET status = ?, order_id = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, orderId, now, id);
    } else {
      const stmt = this.db.prepare(`
        UPDATE pay_links 
        SET status = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(status, now, id);
    }
  }

  private mapPayLinkRow(row: Record<string, unknown>): PayLinkRecord {
    return {
      id: row.id as string,
      kind: row.kind as 'invoice' | 'open',
      recipientCashaddr: row.recipient_cashaddr as string,
      recipientLockingBytecode: row.recipient_locking_bytecode as string,
      token: row.token as 'PUSD' | 'MUSD',
      amountOut:
        row.amount_out != null ? BigInt(row.amount_out as string) : undefined,
      minAmountOut:
        row.min_amount_out != null
          ? BigInt(row.min_amount_out as string)
          : undefined,
      memo: (row.memo as string) || undefined,
      reference: (row.reference as string) || undefined,
      expiresAt: (row.expires_at as number) || undefined,
      verified: Boolean(row.verified),
      status: row.status as PayLinkRecord['status'],
      ownerSecretHash: (row.owner_secret_hash as string) || undefined,
      orderId: (row.order_id as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private mapOrderRow(row: Record<string, unknown>): OrderRecord {
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
      payLinkId: (row.pay_link_id as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  close(): void {
    this.db.close();
  }
}
