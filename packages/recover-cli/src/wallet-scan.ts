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
        transport: http(url, { timeout: 15_000 }),
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
}): Promise<WalletEvmScanResult> {
  const gap = input.gap ?? RECOVERY_SCAN_GAP;
  const maxIndex = input.maxIndex ?? 500;
  const readLock = input.readLock ?? defaultWalletLockReader;
  const swaps: WalletEvmSwap[] = [];
  const errors: { chain: string; message: string }[] = [];
  let misses = 0;
  let scanned = 0;

  for (let index = 0; index < maxIndex && misses < gap; index += 1) {
    scanned += 1;
    const hashLock = swapHashLockAt(input.root, index);
    const lockId = evmLockId(input.owner, hashLock) as Hex32;
    let found = false;
    for (const chain of input.chains) {
      for (const raw of chain.htlcAddresses) {
        const htlcAddress = raw as Address;
        try {
          const result = await readLock({ chain, htlcAddress, lockId });
          if (result && result.status !== 'none') {
            found = true;
            swaps.push({
              index,
              chainId: chain.chainId,
              chainName: chain.name,
              lockId,
              hashLock,
              status: result.status,
              htlcAddress,
              evmDeadline: result.evmDeadline ?? null,
            });
            break;
          }
        } catch (error) {
          errors.push({
            chain: chain.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (found) break;
    }
    misses = found ? 0 : misses + 1;
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
}): Promise<WalletEvmScanResult> {
  const root = deriveRecoveryRoot(input.signature);
  return scanEvmRoot({
    root,
    owner: input.owner,
    chains: input.chains,
    ...(input.gap !== undefined ? { gap: input.gap } : {}),
    ...(input.maxIndex !== undefined ? { maxIndex: input.maxIndex } : {}),
    ...(input.readLock !== undefined ? { readLock: input.readLock } : {}),
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
