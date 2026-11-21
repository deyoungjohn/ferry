import { bytesToHex, createPublicClient, http, type Address } from 'viem';
import {
  deriveRecoveryRoot,
  evmLockId,
  RECOVERY_SCAN_GAP,
  swapHashLockAt,
  swapTagAt,
  type Hex32,
  type LockChainStatus,
} from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  parseTermsOutput,
  rebuildCovenantFromTerms,
  type ParsedTermsOutput,
} from '@ferry/htlc-bch';

export interface WalletChain {
  chainId: number;
  name: string;
  rpcUrls: readonly string[];
  htlcAddresses: readonly string[];
}

export interface WalletEvmSwap {
  index: number;
  chainId: number;
  chainName: string;
  lockId: Hex32;
  hashLock: Hex32;
  status: LockChainStatus;
  htlcAddress: Address;
  evmDeadline: bigint | null;
}

export interface WalletEvmScanResult {
  swaps: WalletEvmSwap[];
  scanned: number;
  errors: { chain: string; message: string }[];
}

export type LockReader = (input: {
  chain: WalletChain;
  htlcAddress: Address;
  lockId: Hex32;
}) => Promise<{ status: LockChainStatus; evmDeadline?: bigint } | null>;

const STATE_MAP: Record<number, LockChainStatus> = {
  0: 'none',
  1: 'locked',
  2: 'claimed',
  3: 'refunded',
};

export async function defaultWalletLockReader(input: {
  chain: WalletChain;
  htlcAddress: Address;
  lockId: Hex32;
}): Promise<{ status: LockChainStatus; evmDeadline?: bigint } | null> {
  const failures: string[] = [];
  for (const url of input.chain.rpcUrls) {
    try {
      const client = createPublicClient({
        // One try per endpoint, 8 seconds: the next endpoint is the retry.
        transport: http(url, { timeout: 8_000, retryCount: 0 }),
        cacheTime: 0,
      });
      const tuple = (await client.readContract({
        address: input.htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'locks',
        args: [input.lockId],
      })) as readonly unknown[];
      const status = STATE_MAP[Number(tuple[6])] ?? 'none';
      const deadline = tuple[5];
      return {
        status,
        ...(typeof deadline === 'bigint' ? { evmDeadline: deadline } : {}),
      };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `No EVM endpoint answered for ${input.chain.name}. ${failures.join('; ')}`,
  );
}

export async function scanEvmRoot(input: {
  root: Hex32;
  owner: Address;
  chains: readonly WalletChain[];
  gap?: number;
  maxIndex?: number;
  readLock?: LockReader;
  /** Indexes read at the same time (default 8). */
  concurrency?: number;
  /** Called after each window: indexes read so far and swaps found. */
  onProgress?: (progress: { scanned: number; found: number }) => void;
}): Promise<WalletEvmScanResult> {
  const gap = input.gap ?? RECOVERY_SCAN_GAP;
  const maxIndex = input.maxIndex ?? 500;
  const readLock = input.readLock ?? defaultWalletLockReader;
  const concurrency = Math.max(1, input.concurrency ?? 8);
  const swaps: WalletEvmSwap[] = [];
  const errors: { chain: string; message: string }[] = [];
  // A chain that fails three times in a row is skipped for the rest of the scan (and reported),
  // so one slow public endpoint cannot hold the whole scan.
  const failuresInARow = new Map<number, number>();
  const skipped = new Set<number>();
  let misses = 0;
  let scanned = 0;

  /** Every chain and contract for one index, at the same time; the first lock found wins. */
  const readIndex = async (index: number): Promise<WalletEvmSwap | null> => {
    const hashLock = swapHashLockAt(input.root, index);
    const lockId = evmLockId(input.owner, hashLock) as Hex32;
    const attempts = input.chains.flatMap((chain) =>
      skipped.has(chain.chainId)
        ? []
        : chain.htlcAddresses.map(async (raw) => {
            const htlcAddress = raw as Address;
            try {
              const result = await readLock({ chain, htlcAddress, lockId });
              failuresInARow.set(chain.chainId, 0);
              if (result && result.status !== 'none') {
                return {
                  index,
                  chainId: chain.chainId,
                  chainName: chain.name,
                  lockId,
                  hashLock,
                  status: result.status,
                  htlcAddress,
                  evmDeadline: result.evmDeadline ?? null,
                } satisfies WalletEvmSwap;
              }
            } catch (error) {
              const count = (failuresInARow.get(chain.chainId) ?? 0) + 1;
              failuresInARow.set(chain.chainId, count);
              if (count >= 3 && !skipped.has(chain.chainId)) {
                skipped.add(chain.chainId);
                errors.push({
                  chain: chain.name,
                  message:
                    error instanceof Error ? error.message : String(error),
                });
              }
            }
            return null;
          }),
    );
    const results = await Promise.all(attempts);
    return results.find((item) => item !== null) ?? null;
  };

  for (let start = 0; start < maxIndex && misses < gap; start += concurrency) {
    const indexes: number[] = [];
    for (let i = start; i < Math.min(maxIndex, start + concurrency); i += 1) {
      indexes.push(i);
    }
    const window = await Promise.all(indexes.map((i) => readIndex(i)));
    // Count misses in index order, so the stopping rule is the same as reading one by one.
    for (const found of window) {
      if (misses >= gap) break;
      scanned += 1;
      if (found) {
        swaps.push(found);
        misses = 0;
      } else {
        misses += 1;
      }
    }
    input.onProgress?.({ scanned, found: swaps.length });
  }

  return { swaps, scanned, errors };
}

export async function scanEvmSignature(input: {
  signature: `0x${string}` | Uint8Array;
  owner: Address;
  chains: readonly WalletChain[];
  gap?: number;
  maxIndex?: number;
  readLock?: LockReader;
  concurrency?: number;
  onProgress?: (progress: { scanned: number; found: number }) => void;
}): Promise<WalletEvmScanResult> {
  const root = deriveRecoveryRoot(input.signature);
  return scanEvmRoot({
    root,
    owner: input.owner,
    chains: input.chains,
    ...(input.gap !== undefined ? { gap: input.gap } : {}),
    ...(input.maxIndex !== undefined ? { maxIndex: input.maxIndex } : {}),
    ...(input.readLock !== undefined ? { readLock: input.readLock } : {}),
    ...(input.concurrency !== undefined
      ? { concurrency: input.concurrency }
      : {}),
    ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
  });
}

export interface BchFry1Tx {
  txid: string;
  outputs: readonly { lockingBytecode: string }[];
}

export interface BchWalletSwap {
  index: number;
  txid: string;
  terms: ParsedTermsOutput;
  lockingBytecode: string;
  address: string;
  hashLock: Hex32;
}

export function scanBchFry1Transactions(input: {
  root: Hex32;
  transactions: readonly BchFry1Tx[];
  gap?: number;
  maxIndex?: number;
  network?: 'mainnet' | 'chipnet';
}): { swaps: BchWalletSwap[]; scanned: number } {
  const gap = input.gap ?? RECOVERY_SCAN_GAP;
  const maxIndex = input.maxIndex ?? 500;
  const swaps: BchWalletSwap[] = [];
  let misses = 0;
  let scanned = 0;
  for (let index = 0; index < maxIndex && misses < gap; index += 1) {
    scanned += 1;
    const tag = swapTagAt(input.root, index);
    const hashLock = swapHashLockAt(input.root, index);
    let found = false;
    for (const tx of input.transactions) {
      for (const output of tx.outputs) {
        try {
          const terms = parseTermsOutput(output.lockingBytecode);
          if (terms.tag.toLowerCase() !== tag.toLowerCase()) continue;
          const covenant = rebuildCovenantFromTerms(terms, hashLock, {
            network: input.network ?? 'mainnet',
          });
          swaps.push({
            index,
            txid: tx.txid,
            terms,
            lockingBytecode: bytesToHex(covenant.lockingBytecode),
            address: covenant.tokenAddress,
            hashLock,
          });
          found = true;
        } catch {
          // not a FRY1 output
        }
      }
    }
    misses = found ? 0 : misses + 1;
  }
  return { swaps, scanned };
}
