import type { BchActivityItem, ChainLock, ActivityEntry } from './types';

function normalizeHash(hash: string): string {
  return `0x${hash.replace(/^0x/i, '').toLowerCase()}`;
}

const BCH_STATE_LABEL: Readonly<Record<BchActivityItem['state'], string>> = {
  received: 'PUSD received',
  claimed: 'PUSD locked and claimed by solver',
  refunded: 'PUSD refunded to your wallet',
  locked: 'PUSD locked, waiting for solver',
};

const CHAIN_STATE_LABEL: Readonly<Record<ChainLock['state'], string>> = {
  locked: 'USDC locked on EVM',
  claimed: 'USDC claimed on EVM',
  refunded: 'USDC refunded on EVM',
};

export function mergeActivity(sources: {
  readonly bch: readonly BchActivityItem[];
  readonly locks: readonly ChainLock[];
}): ActivityEntry[] {
  const locksByHash = new Map<string, ChainLock>();
  for (const lock of sources.locks) {
    locksByHash.set(normalizeHash(lock.hashLock), lock);
  }

  const usedLocks = new Set<string>();
  const entries: ActivityEntry[] = [];

  for (const item of sources.bch) {
    const hashLock = item.hashLock ? normalizeHash(item.hashLock) : null;
    let matchingLock: ChainLock | null = null;
    if (hashLock && locksByHash.has(hashLock)) {
      matchingLock = locksByHash.get(hashLock)!;
      usedLocks.add(matchingLock.id);
    }

    const bchAmount = Number(item.tokenAmount) / 100;
    const counterAmount = matchingLock
      ? Number(matchingLock.amount) / 1_000_000
      : bchAmount;

    const amountDisplay =
      item.direction === 'BCH_TO_COUNTER'
        ? `${bchAmount.toFixed(2)} PUSD → ${counterAmount.toFixed(2)} USDC`
        : `${counterAmount.toFixed(2)} USDC → ${bchAmount.toFixed(2)} PUSD`;

    entries.push({
      key: item.key,
      createdAt: item.time,
      direction: item.direction,
      bch: item,
      chain: matchingLock,
      ...(hashLock ? { hashLock } : {}),
      statusLabel: BCH_STATE_LABEL[item.state],
      amountDisplay,
    });
  }

  for (const lock of sources.locks) {
    if (usedLocks.has(lock.id)) continue;
    const counterAmount = Number(lock.amount) / 1_000_000;
    const bchAmount = counterAmount; // 1:1 nominal
    const direction =
      lock.role === 'sender' ? 'COUNTER_TO_BCH' : 'BCH_TO_COUNTER';
    const amountDisplay =
      direction === 'COUNTER_TO_BCH'
        ? `${counterAmount.toFixed(2)} USDC → ${bchAmount.toFixed(2)} PUSD`
        : `${bchAmount.toFixed(2)} PUSD → ${counterAmount.toFixed(2)} USDC`;

    entries.push({
      key: lock.id,
      createdAt: lock.lockedAt,
      direction,
      bch: null,
      chain: lock,
      hashLock: normalizeHash(lock.hashLock),
      statusLabel: CHAIN_STATE_LABEL[lock.state],
      amountDisplay,
    });
  }

  return entries.sort((a, b) => b.createdAt - a.createdAt);
}
