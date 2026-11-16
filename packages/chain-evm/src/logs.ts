import { decodeEventLog, getAddress } from 'viem';
import type { AbiEvent, Address, Log, PublicClient } from 'viem';
import type {
  EvmAssetConfig,
  EvmChainId,
  Hex32,
  LockEvent,
  TxRef,
} from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';

export interface ChunkedLogOptions {
  maxRange?: bigint | undefined;
  maxChunks?: number | undefined;
  event?: AbiEvent | undefined;
  args?: Record<string, unknown> | undefined;
}

const DEFAULT_MAX_LOG_RANGE = 10_000n;
const DEFAULT_MAX_LOG_CHUNKS = 2_000;
const ZERO_TX: Hex32 = `0x${'00'.repeat(32)}`;

export async function fetchLogsChunked(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
  options?: ChunkedLogOptions,
): Promise<Log[]> {
  if (fromBlock > toBlock) return [];
  const maxRange = options?.maxRange ?? DEFAULT_MAX_LOG_RANGE;
  if (maxRange <= 0n) {
    throw new Error(`maxRange must be positive, got ${maxRange}`);
  }
  const totalBlocks = toBlock - fromBlock + 1n;
  const estimatedChunks = (totalBlocks + maxRange - 1n) / maxRange;
  const maxChunks = options?.maxChunks ?? DEFAULT_MAX_LOG_CHUNKS;
  if (estimatedChunks > BigInt(maxChunks)) {
    throw new Error(
      `Log scan of ${totalBlocks} blocks with maxRange=${maxRange} requires ${estimatedChunks} chunks, exceeding limit ${maxChunks}; narrow the block range or use an RPC with a larger eth_getLogs cap`,
    );
  }
  const results: Log[] = [];

  const fetchRange = async (start: bigint, end: bigint): Promise<void> => {
    try {
      const logs = options?.event
        ? await client.getLogs({
            address,
            event: options.event,
            args: options.args,
            fromBlock: start,
            toBlock: end,
          })
        : await client.getLogs({
            address,
            fromBlock: start,
            toBlock: end,
          });
      results.push(...logs);
    } catch (err) {
      if (start >= end) {
        throw err;
      }
      const mid = start + (end - start) / 2n;
      await fetchRange(start, mid);
      await fetchRange(mid + 1n, end);
    }
  };

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkEnd =
      cursor + maxRange - 1n < toBlock ? cursor + maxRange - 1n : toBlock;
    await fetchRange(cursor, chunkEnd);
    cursor = chunkEnd + 1n;
  }

  return results;
}

export function decodeHtlcLog(
  log: Log,
  chain: EvmChainId,
  assets: readonly EvmAssetConfig[],
): LockEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: ferryHtlcAbi,
      data: log.data,
      topics: log.topics,
    });
    const eventId = `${log.blockHash ?? ZERO_TX}:${log.logIndex ?? 0}`;
    const tx: TxRef = {
      chain,
      txId: (log.transactionHash ?? ZERO_TX) as Hex32,
    };
    const removed = log.removed ?? false;

    if (decoded.eventName === 'Locked') {
      const args = decoded.args as {
        id: Hex32;
        sender: Address;
        recipient: Address;
        token: Address;
        amount: bigint;
        hashLock: Hex32;
        deadline: bigint;
      };
      const normalizedToken = getAddress(args.token).toLowerCase();
      const asset = assets.find((a) => a.address === normalizedToken);
      if (!asset) {
        return null;
      }
      return {
        eventId,
        lockId: args.id,
        tx,
        removed,
        type: 'Locked',
        lock: {
          owner: args.sender.toLowerCase(),
          recipient: args.recipient.toLowerCase(),
          asset,
          amount: args.amount,
          hashLock: args.hashLock,
          deadline: Number(args.deadline),
        },
      };
    }

    if (decoded.eventName === 'Claimed') {
      const args = decoded.args as { id: Hex32; secret: Hex32 };
      return {
        eventId,
        lockId: args.id,
        tx,
        removed,
        type: 'Claimed',
        secret: args.secret,
      };
    }

    if (decoded.eventName === 'Refunded') {
      const args = decoded.args as { id: Hex32 };
      return {
        eventId,
        lockId: args.id,
        tx,
        removed,
        type: 'Refunded',
      };
    }

    return null;
  } catch {
    return null;
  }
}
