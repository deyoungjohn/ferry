import { decodeEventLog, getAddress } from 'viem';
import type { AbiEvent, Address, Log, PublicClient } from 'viem';
import type { EvmAssetConfig, EvmChainId, Hex32, TxRef } from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import { fetchLogsChunked } from './logs.js';

export type ChainLockRole = 'sender' | 'recipient' | 'both';
export type ChainLockStatus = 'locked' | 'claimed' | 'refunded';

export interface ChainLockActivity {
  lockId: Hex32;
  role: ChainLockRole;
  status: ChainLockStatus;
  sender: Address;
  recipient: Address;
  token: Address;
  asset?: EvmAssetConfig | undefined;
  amount: bigint;
  hashLock: Hex32;
  deadline: number;
  lockedAt: number;
  lockBlockNumber: bigint;
  lockTx: TxRef;
  claimTx?: TxRef | undefined;
  secret?: Hex32 | undefined;
  refundTx?: TxRef | undefined;
}

export interface FetchChainLocksParams {
  client: PublicClient;
  htlc: Address;
  user: Address;
  chain?: EvmChainId | undefined;
  assets?: readonly EvmAssetConfig[] | undefined;
  fromBlock?: bigint | undefined;
  toBlock?: bigint | undefined;
  /** Earliest block to scan (e.g., contract deployBlock from config). Defaults to 0n. */
  deployBlock?: bigint | undefined;
  /** Number of blocks per backward window when fromBlock is omitted. Defaults to 10_000n. */
  windowSize?: bigint | undefined;
  /** Maximum block range per eth_getLogs request. */
  maxRange?: bigint | undefined;
  /** Upper block bound when scanning Claimed/Refunded events for discovered locks. */
  settleToBlock?: bigint | undefined;
}

export interface FetchChainLocksResult {
  locks: ChainLockActivity[];
  fromBlock: bigint;
  toBlock: bigint;
  nextToBlock: bigint | null;
  hasMore: boolean;
}

const DEFAULT_WINDOW_SIZE = 10_000n;
const LOCK_ID_BATCH_SIZE = 50;
const ZERO_TX: Hex32 = `0x${'00'.repeat(32)}`;

const lockedAbiEvent = ferryHtlcAbi.find(
  (item) => item.type === 'event' && item.name === 'Locked',
)! as AbiEvent;
const claimedAbiEvent = ferryHtlcAbi.find(
  (item) => item.type === 'event' && item.name === 'Claimed',
)! as AbiEvent;
const refundedAbiEvent = ferryHtlcAbi.find(
  (item) => item.type === 'event' && item.name === 'Refunded',
)! as AbiEvent;

interface DecodedLockedLog {
  lockId: Hex32;
  sender: Address;
  recipient: Address;
  token: Address;
  amount: bigint;
  hashLock: Hex32;
  deadline: number;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex32;
}

function decodeLockedLog(log: Log): DecodedLockedLog | null {
  if (log.removed) return null;
  try {
    const decoded = decodeEventLog({
      abi: ferryHtlcAbi,
      eventName: 'Locked',
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as {
      id: Hex32;
      sender: Address;
      recipient: Address;
      token: Address;
      amount: bigint;
      hashLock: Hex32;
      deadline: bigint;
    };
    return {
      lockId: args.id,
      sender: getAddress(args.sender),
      recipient: getAddress(args.recipient),
      token: getAddress(args.token),
      amount: args.amount,
      hashLock: args.hashLock,
      deadline: Number(args.deadline),
      blockNumber: log.blockNumber ?? 0n,
      logIndex: log.logIndex ?? 0,
      txHash: (log.transactionHash ?? ZERO_TX) as Hex32,
    };
  } catch {
    return null;
  }
}

export async function fetchChainLocks(
  params: FetchChainLocksParams,
): Promise<FetchChainLocksResult> {
  const { client } = params;
  const htlc = getAddress(params.htlc);
  const user = getAddress(params.user);
  const chain: EvmChainId = params.chain ?? 'base';
  const assets = params.assets ?? [];
  const floorBlock = params.deployBlock ?? 0n;
  const windowSize =
    params.windowSize && params.windowSize > 0n
      ? params.windowSize
      : DEFAULT_WINDOW_SIZE;

  const latestBlock =
    params.toBlock === undefined || params.settleToBlock === undefined
      ? await client.getBlockNumber()
      : undefined;

  const effectiveToBlock = params.toBlock ?? latestBlock!;
  if (effectiveToBlock < floorBlock) {
    return {
      locks: [],
      fromBlock: floorBlock,
      toBlock: effectiveToBlock,
      nextToBlock: null,
      hasMore: false,
    };
  }

  let effectiveFromBlock: bigint;
  if (params.fromBlock !== undefined) {
    effectiveFromBlock =
      params.fromBlock < floorBlock ? floorBlock : params.fromBlock;
  } else {
    const candidate = effectiveToBlock - windowSize + 1n;
    effectiveFromBlock = candidate < floorBlock ? floorBlock : candidate;
  }

  if (effectiveFromBlock > effectiveToBlock) {
    return {
      locks: [],
      fromBlock: effectiveFromBlock,
      toBlock: effectiveToBlock,
      nextToBlock: null,
      hasMore: false,
    };
  }

  const hasMore = effectiveFromBlock > floorBlock;
  const nextToBlock = hasMore ? effectiveFromBlock - 1n : null;

  const [senderLogs, recipientLogs] = await Promise.all([
    fetchLogsChunked(client, htlc, effectiveFromBlock, effectiveToBlock, {
      maxRange: params.maxRange,
      event: lockedAbiEvent,
      args: { sender: user },
    }),
    fetchLogsChunked(client, htlc, effectiveFromBlock, effectiveToBlock, {
      maxRange: params.maxRange,
      event: lockedAbiEvent,
      args: { recipient: user },
    }),
  ]);

  const lockedById = new Map<Hex32, DecodedLockedLog>();
  for (const log of [...senderLogs, ...recipientLogs]) {
    const decoded = decodeLockedLog(log);
    if (decoded && !lockedById.has(decoded.lockId)) {
      lockedById.set(decoded.lockId, decoded);
    }
  }

  if (lockedById.size === 0) {
    return {
      locks: [],
      fromBlock: effectiveFromBlock,
      toBlock: effectiveToBlock,
      nextToBlock,
      hasMore,
    };
  }

  const lockIds = [...lockedById.keys()];
  const settleToBlock =
    params.settleToBlock ??
    (latestBlock !== undefined && latestBlock >= effectiveToBlock
      ? latestBlock
      : effectiveToBlock);

  const claimedById = new Map<Hex32, { txHash: Hex32; secret: Hex32 }>();
  const refundedById = new Map<Hex32, { txHash: Hex32 }>();

  for (let i = 0; i < lockIds.length; i += LOCK_ID_BATCH_SIZE) {
    const batch = lockIds.slice(i, i + LOCK_ID_BATCH_SIZE);
    const [claimedLogs, refundedLogs] = await Promise.all([
      fetchLogsChunked(client, htlc, effectiveFromBlock, settleToBlock, {
        maxRange: params.maxRange,
        event: claimedAbiEvent,
        args: { id: batch },
      }),
      fetchLogsChunked(client, htlc, effectiveFromBlock, settleToBlock, {
        maxRange: params.maxRange,
        event: refundedAbiEvent,
        args: { id: batch },
      }),
    ]);

    for (const log of claimedLogs) {
      if (log.removed) continue;
      try {
        const decoded = decodeEventLog({
          abi: ferryHtlcAbi,
          eventName: 'Claimed',
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as { id: Hex32; secret: Hex32 };
        claimedById.set(args.id, {
          txHash: (log.transactionHash ?? ZERO_TX) as Hex32,
          secret: args.secret,
        });
      } catch {
        // Ignore undecodable logs
      }
    }

    for (const log of refundedLogs) {
      if (log.removed) continue;
      try {
        const decoded = decodeEventLog({
          abi: ferryHtlcAbi,
          eventName: 'Refunded',
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as { id: Hex32 };
        refundedById.set(args.id, {
          txHash: (log.transactionHash ?? ZERO_TX) as Hex32,
        });
      } catch {
        // Ignore undecodable logs
      }
    }
  }

  const uniqueBlocks = [
    ...new Set([...lockedById.values()].map((entry) => entry.blockNumber)),
  ];
  const blockTimestampByNumber = new Map<bigint, number>();
  await Promise.all(
    uniqueBlocks.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      blockTimestampByNumber.set(blockNumber, Number(block.timestamp));
    }),
  );

  const assetByAddress = new Map(
    assets.map((asset) => [asset.address.toLowerCase(), asset]),
  );

  const locks: ChainLockActivity[] = [...lockedById.values()]
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber > b.blockNumber ? -1 : 1;
      }
      return b.logIndex - a.logIndex;
    })
    .map((entry) => {
      const isSender = entry.sender === user;
      const isRecipient = entry.recipient === user;
      const role: ChainLockRole =
        isSender && isRecipient ? 'both' : isSender ? 'sender' : 'recipient';

      const claimed = claimedById.get(entry.lockId);
      const refunded = refundedById.get(entry.lockId);

      const status: ChainLockStatus = claimed
        ? 'claimed'
        : refunded
          ? 'refunded'
          : 'locked';

      return {
        lockId: entry.lockId,
        role,
        status,
        sender: entry.sender,
        recipient: entry.recipient,
        token: entry.token,
        asset: assetByAddress.get(entry.token.toLowerCase()),
        amount: entry.amount,
        hashLock: entry.hashLock,
        deadline: entry.deadline,
        lockedAt: blockTimestampByNumber.get(entry.blockNumber) ?? 0,
        lockBlockNumber: entry.blockNumber,
        lockTx: { chain, txId: entry.txHash },
        ...(claimed
          ? {
              claimTx: { chain, txId: claimed.txHash },
              secret: claimed.secret,
            }
          : {}),
        ...(refunded && !claimed
          ? {
              refundTx: { chain, txId: refunded.txHash },
            }
          : {}),
      };
    });

  return {
    locks,
    fromBlock: effectiveFromBlock,
    toBlock: effectiveToBlock,
    nextToBlock,
    hasMore,
  };
}
