import { parseAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import type { ChainLock, ChainLockState } from './types';

export const lockedEvent = parseAbiItem(
  'event Locked(bytes32 indexed id, address indexed sender, address indexed recipient, address token, uint256 amount, bytes32 hashLock, uint64 deadline)',
);
export const claimedEvent = parseAbiItem(
  'event Claimed(bytes32 indexed id, bytes32 secret)',
);
export const refundedEvent = parseAbiItem('event Refunded(bytes32 indexed id)');

const MIN_CHUNK = 200n;
const MAX_CHUNK = 50_000n;
const PARALLEL = 4;

export async function scanRange<T>(
  fetch: (from: bigint, to: bigint) => Promise<readonly T[]>,
  from: bigint,
  to: bigint,
): Promise<T[]> {
  const out: T[] = [];
  let chunk = MAX_CHUNK;
  let cursor = from;
  while (cursor <= to) {
    const batch: Array<[bigint, bigint]> = [];
    let start = cursor;
    for (let i = 0; i < PARALLEL && start <= to; i += 1) {
      const end = start + chunk - 1n > to ? to : start + chunk - 1n;
      batch.push([start, end]);
      start = end + 1n;
    }
    try {
      const results = await Promise.all(batch.map(([a, b]) => fetch(a, b)));
      for (const rows of results) out.push(...rows);
      cursor = start;
    } catch (cause) {
      if (chunk <= MIN_CHUNK) throw cause;
      chunk = chunk / 2n < MIN_CHUNK ? MIN_CHUNK : chunk / 2n;
    }
  }
  return out;
}

export interface FetchChainLocksOptions {
  client: PublicClient;
  htlcAddress: Address;
  userAddress: Address;
  fromBlock: bigint;
  toBlock: bigint;
}

export async function fetchChainLocks({
  client,
  htlcAddress,
  userAddress,
  fromBlock,
  toBlock,
}: FetchChainLocksOptions): Promise<ChainLock[]> {
  const user = userAddress.toLowerCase() as Address;

  const [senderLogs, recipientLogs] = await Promise.all([
    scanRange(
      (from, to) =>
        client.getLogs({
          address: htlcAddress,
          event: lockedEvent,
          args: { sender: user },
          fromBlock: from,
          toBlock: to,
        }),
      fromBlock,
      toBlock,
    ),
    scanRange(
      (from, to) =>
        client.getLogs({
          address: htlcAddress,
          event: lockedEvent,
          args: { recipient: user },
          fromBlock: from,
          toBlock: to,
        }),
      fromBlock,
      toBlock,
    ),
  ]);

  const allLocked = [
    ...senderLogs.map((log) => ({ log, role: 'sender' as const })),
    ...recipientLogs.map((log) => ({ log, role: 'recipient' as const })),
  ];

  if (allLocked.length === 0) return [];

  const lockIds = allLocked.map(({ log }) => log.args.id as Hex);

  const [claimedLogs, refundedLogs] = await Promise.all([
    scanRange(
      (from, to) =>
        client.getLogs({
          address: htlcAddress,
          event: claimedEvent,
          args: { id: lockIds },
          fromBlock: from,
          toBlock: to,
        }),
      fromBlock,
      toBlock,
    ),
    scanRange(
      (from, to) =>
        client.getLogs({
          address: htlcAddress,
          event: refundedEvent,
          args: { id: lockIds },
          fromBlock: from,
          toBlock: to,
        }),
      fromBlock,
      toBlock,
    ),
  ]);

  const claimed = new Set(
    claimedLogs.map((l) => (l.args.id as string).toLowerCase()),
  );
  const refunded = new Set(
    refundedLogs.map((l) => (l.args.id as string).toLowerCase()),
  );

  const locks: ChainLock[] = [];
  for (const { log, role } of allLocked) {
    const id = log.args.id as Hex;
    const lowerId = id.toLowerCase();
    let state: ChainLockState = 'locked';
    if (claimed.has(lowerId)) state = 'claimed';
    else if (refunded.has(lowerId)) state = 'refunded';

    locks.push({
      id,
      role,
      token:
        (log.args.token as Address) ||
        '0x0000000000000000000000000000000000000000',
      amount: log.args.amount as bigint,
      hashLock: log.args.hashLock as Hex,
      deadline: BigInt(log.args.deadline ?? 0),
      blockNumber: log.blockNumber,
      lockedAt: Math.floor(Date.now() / 1000),
      lockTx: log.transactionHash,
      state,
    });
  }

  return locks.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}
