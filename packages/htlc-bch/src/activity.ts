import {
  binToHex,
  decodeTransactionBCH,
  hexToBin,
  sha256,
  type Transaction,
} from '@bitauth/libauth';
import { internalToDisplayCategory } from './byte-order.js';
import { parseHtlcSpendInput, type HtlcSpendInfo } from './parse.js';

/** Minimal Electrum (Fulcrum) RPC interface needed by the BCH activity reader. */
export interface BchElectrum {
  request<T>(method: string, params: readonly unknown[]): Promise<T>;
}

export type BchActivityState = 'received' | 'locked' | 'claimed' | 'refunded';

export interface BchActivityItem {
  /** Txid of the covenant funding transaction (the order's BCH lock). */
  readonly key: string;
  readonly direction: 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER';
  readonly state: BchActivityState;
  readonly tokenAmount: bigint;
  readonly category: string;
  readonly hashLock: string | null;
  readonly time: number;
  readonly txs: ReadonlyArray<{
    readonly label: string;
    readonly hash: string;
  }>;
}

interface VerboseTx {
  readonly hex: string;
  readonly time?: number;
  readonly blocktime?: number;
}

interface HistoryRow {
  readonly tx_hash: string;
  readonly height: number;
}

export interface ActivityOrderLike {
  readonly orderId: string;
  readonly createdAt: number;
  readonly direction:
    'EVM_TO_BCH' | 'BCH_TO_EVM' | 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER';
  readonly hashLock: string;
  readonly txHashes?: readonly string[];
}

export interface ActivityChainLockLike {
  readonly id: string;
  readonly hashLock: string;
  readonly lockedAt: number;
  readonly role: 'sender' | 'counterparty';
}

export interface MergedActivityEntry {
  readonly key: string;
  readonly createdAt: number;
  readonly direction: 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER';
  readonly bch: BchActivityItem | null;
  readonly order: ActivityOrderLike | null;
  readonly chain: ActivityChainLockLike | null;
}

const ROW_BATCH = 8;
const P2SH32_PREFIX = 0xaa;

function scripthash(lockingBytecode: Uint8Array): string {
  return binToHex(sha256.hash(lockingBytecode).reverse());
}

function isP2sh32(bytecode: Uint8Array): boolean {
  return (
    bytecode.length === 35 &&
    bytecode[0] === P2SH32_PREFIX &&
    bytecode[1] === 0x20 &&
    bytecode[34] === 0x87
  );
}

function normalizeHex(hex: string): string {
  return hex.replace(/^0x/i, '').toLowerCase();
}

function normalizeHashLock(hash: string): string {
  return `0x${normalizeHex(hash)}`;
}

export interface FetchBchActivityOptions {
  readonly electrum: BchElectrum;
  readonly userLockingBytecode: string | Uint8Array;
  readonly categories: readonly string[];
  readonly limit: number;
  readonly nowSeconds?: number;
}

export interface BchActivityResult {
  readonly items: BchActivityItem[];
  readonly totalTransactions: number;
  readonly readTransactions: number;
}

/**
 * Rebuild a user's Ferry swap history from Bitcoin Cash alone.
 * Reads history rows in batches of 8, parses revealed HTLC redeem scripts
 * for claims/refunds, and follows the user's P2SH32 covenant funding outputs
 * to their spends.
 */
export async function fetchBchActivity({
  electrum,
  userLockingBytecode,
  categories,
  limit,
  nowSeconds = Math.floor(Date.now() / 1000),
}: FetchBchActivityOptions): Promise<BchActivityResult> {
  const userBytes =
    typeof userLockingBytecode === 'string'
      ? hexToBin(normalizeHex(userLockingBytecode))
      : userLockingBytecode;
  const userHex = binToHex(userBytes);
  const knownCategories = new Set(categories.map(normalizeHex));
  const txCache = new Map<string, { tx: Transaction; time: number }>();

  async function loadTx(
    txid: string,
  ): Promise<{ tx: Transaction; time: number }> {
    const cached = txCache.get(txid);
    if (cached) return cached;
    const verbose = await electrum.request<VerboseTx>(
      'blockchain.transaction.get',
      [txid, true],
    );
    const decoded = decodeTransactionBCH(hexToBin(verbose.hex));
    if (typeof decoded === 'string') {
      throw new Error(`Failed to decode BCH transaction ${txid}: ${decoded}`);
    }
    const loaded = {
      tx: decoded,
      time: verbose.blocktime ?? verbose.time ?? nowSeconds,
    };
    txCache.set(txid, loaded);
    return loaded;
  }

  const history = await electrum.request<HistoryRow[]>(
    'blockchain.scripthash.get_history',
    [scripthash(userBytes)],
  );
  const newest = limit > 0 ? history.slice(-limit) : [];
  const items = new Map<string, BchActivityItem>();

  function putItem(item: BchActivityItem): void {
    const previous = items.get(item.key);
    if (!previous) {
      items.set(item.key, item);
      return;
    }
    const seen = new Set(previous.txs.map((tx) => tx.hash));
    items.set(item.key, {
      ...item,
      hashLock: item.hashLock ?? previous.hashLock,
      time: Math.max(item.time, previous.time),
      txs: [...previous.txs, ...item.txs.filter((tx) => !seen.has(tx.hash))],
    });
  }

  async function readRow(row: HistoryRow): Promise<void> {
    const { tx, time } = await loadTx(row.tx_hash);
    let spendsCovenant = false;

    for (const input of tx.inputs) {
      const info = parseHtlcSpendInput(input.unlockingBytecode);
      if (!info) continue;
      spendsCovenant = true;
      const category = internalToDisplayCategory(info.params.tokenCategory);
      const lockTxid = binToHex(input.outpointTransactionHash);
      const recipient = binToHex(info.params.recipientLockingBytecode);
      const refundTo = binToHex(info.params.refundLockingBytecode);

      if (info.path === 'claim' && recipient === userHex) {
        putItem({
          key: lockTxid,
          direction: 'COUNTER_TO_BCH',
          state: 'received',
          tokenAmount: info.params.tokenAmount,
          category,
          hashLock: binToHex(info.params.hashLock),
          time,
          txs: [
            { label: 'Solver lock', hash: lockTxid },
            { label: 'Your claim', hash: row.tx_hash },
          ],
        });
      } else if (info.path === 'refund' && refundTo === userHex) {
        putItem({
          key: lockTxid,
          direction: 'BCH_TO_COUNTER',
          state: 'refunded',
          tokenAmount: info.params.tokenAmount,
          category,
          hashLock: binToHex(info.params.hashLock),
          time,
          txs: [
            { label: 'Your lock', hash: lockTxid },
            { label: 'Refund', hash: row.tx_hash },
          ],
        });
      }
    }

    if (spendsCovenant) return;

    for (const [vout, output] of tx.outputs.entries()) {
      if (!isP2sh32(output.lockingBytecode) || !output.token) continue;
      const category = binToHex(output.token.category);
      if (!knownCategories.has(category)) continue;

      const covenantHistory = await electrum.request<HistoryRow[]>(
        'blockchain.scripthash.get_history',
        [scripthash(output.lockingBytecode)],
      );
      let spend: { info: HtlcSpendInfo; hash: string; time: number } | null =
        null;
      for (const other of covenantHistory) {
        if (other.tx_hash === row.tx_hash) continue;
        const loaded = await loadTx(other.tx_hash);
        for (const input of loaded.tx.inputs) {
          if (
            binToHex(input.outpointTransactionHash) !== row.tx_hash ||
            input.outpointIndex !== vout
          ) {
            continue;
          }
          const info = parseHtlcSpendInput(input.unlockingBytecode);
          if (info) {
            spend = { info, hash: other.tx_hash, time: loaded.time };
          }
        }
      }

      const txs = [{ label: 'Your lock', hash: row.tx_hash }];
      if (spend) {
        txs.push({
          label: spend.info.path === 'claim' ? 'Solver claim' : 'Refund',
          hash: spend.hash,
        });
      }
      putItem({
        key: row.tx_hash,
        direction: 'BCH_TO_COUNTER',
        state: spend
          ? spend.info.path === 'claim'
            ? 'claimed'
            : 'refunded'
          : 'locked',
        tokenAmount: output.token.amount,
        category,
        hashLock: spend ? binToHex(spend.info.params.hashLock) : null,
        time: spend ? Math.max(time, spend.time) : time,
        txs,
      });
    }
  }

  for (let start = 0; start < newest.length; start += ROW_BATCH) {
    await Promise.all(newest.slice(start, start + ROW_BATCH).map(readRow));
  }

  return {
    items: [...items.values()].sort((a, b) => b.time - a.time),
    totalTransactions: history.length,
    readTransactions: newest.length,
  };
}

function toActivityDirection(
  direction: ActivityOrderLike['direction'],
): 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER' {
  if (direction === 'EVM_TO_BCH' || direction === 'COUNTER_TO_BCH') {
    return 'COUNTER_TO_BCH';
  }
  return 'BCH_TO_COUNTER';
}

/**
 * Pure BCH-first activity merge: joins BCH items with saved orders and
 * counter-chain locks by normalized hashLock (or shared tx hashes).
 */
export function mergeActivity(sources: {
  readonly bch: readonly BchActivityItem[];
  readonly orders: readonly ActivityOrderLike[];
  readonly locks: readonly ActivityChainLockLike[];
}): MergedActivityEntry[] {
  const locksByHash = new Map<string, ActivityChainLockLike>();
  for (const lock of sources.locks) {
    locksByHash.set(normalizeHashLock(lock.hashLock), lock);
  }
  const usedOrders = new Set<string>();
  const usedLocks = new Set<string>();
  const entries: MergedActivityEntry[] = [];

  function takeLock(hashLock: string | null): ActivityChainLockLike | null {
    if (!hashLock) return null;
    const lock = locksByHash.get(normalizeHashLock(hashLock));
    if (!lock) return null;
    usedLocks.add(lock.id);
    return lock;
  }

  for (const item of sources.bch) {
    const hashLock = item.hashLock ? normalizeHashLock(item.hashLock) : null;
    const itemHashes = new Set(item.txs.map((tx) => tx.hash.toLowerCase()));
    const order =
      sources.orders.find((candidate) => {
        if (usedOrders.has(candidate.orderId)) return false;
        if (hashLock && normalizeHashLock(candidate.hashLock) === hashLock) {
          return true;
        }
        for (const hash of candidate.txHashes ?? []) {
          if (itemHashes.has(hash.toLowerCase())) return true;
        }
        return false;
      }) ?? null;
    if (order) usedOrders.add(order.orderId);
    const chain = takeLock(hashLock ?? (order ? order.hashLock : null));
    entries.push({
      key: item.key,
      createdAt: item.time,
      direction: item.direction,
      bch: item,
      order,
      chain,
    });
  }

  for (const order of sources.orders) {
    if (usedOrders.has(order.orderId)) continue;
    entries.push({
      key: order.orderId,
      createdAt: order.createdAt,
      direction: toActivityDirection(order.direction),
      bch: null,
      order,
      chain: takeLock(order.hashLock),
    });
  }

  for (const lock of sources.locks) {
    if (usedLocks.has(lock.id)) continue;
    entries.push({
      key: lock.id,
      createdAt: lock.lockedAt,
      direction: lock.role === 'sender' ? 'COUNTER_TO_BCH' : 'BCH_TO_COUNTER',
      bch: null,
      order: null,
      chain: lock,
    });
  }

  return entries.sort((a, b) => b.createdAt - a.createdAt);
}
