import { createPublicClient, http, type Address } from 'viem';
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

export const FRY1_MAGIC = new TextEncoder().encode('FRY1');

export interface Fry1Terms {
  tag: Uint8Array;
  token: 1 | 2;
  tokenAmount: bigint;
  refundHeight: number;
  maxFee: number;
  recipientLockingBytecode: Uint8Array;
  refundLockingBytecode: Uint8Array;
}

function readUintLE(bytes: Uint8Array, offset: number, length: number): bigint {
  let value = 0n;
  for (let i = 0; i < length; i += 1) {
    value |= BigInt(bytes[offset + i]!) << BigInt(8 * i);
  }
  return value;
}

function writeUintLE(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Number((value >> BigInt(8 * i)) & 0xffn);
  }
  return bytes;
}

export function encodeTermsOutput(input: Fry1Terms): `0x${string}` {
  if (input.tag.length !== 8) throw new Error('FRY1 tag must be 8 bytes');
  if (
    input.recipientLockingBytecode.length > 255 ||
    input.refundLockingBytecode.length > 255
  ) {
    throw new Error('FRY1 locking bytecode is too long');
  }
  const bytes = Uint8Array.from([
    ...FRY1_MAGIC,
    1,
    ...input.tag,
    input.token,
    ...writeUintLE(input.tokenAmount, 8),
    ...writeUintLE(BigInt(input.refundHeight), 4),
    ...writeUintLE(BigInt(input.maxFee), 4),
    input.recipientLockingBytecode.length,
    ...input.recipientLockingBytecode,
    input.refundLockingBytecode.length,
    ...input.refundLockingBytecode,
  ]);
  if (bytes.length > 220)
    throw new Error('FRY1 terms output exceeds 220 bytes');
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

export function parseTermsOutput(hex: string): Fry1Terms {
  const bytes = Uint8Array.from(Buffer.from(hex.replace(/^0x/i, ''), 'hex'));
  if (bytes.length < 24 || bytes.length > 220) {
    throw new Error('FRY1 terms output has an invalid length');
  }
  for (let i = 0; i < 4; i += 1) {
    if (bytes[i] !== FRY1_MAGIC[i]) throw new Error('Not a FRY1 terms output');
  }
  if (bytes[4] !== 1) throw new Error('Unsupported FRY1 version');
  const tag = Uint8Array.from(bytes.slice(5, 13));
  const token = bytes[13];
  if (token !== 1 && token !== 2) throw new Error('Unknown FRY1 token');
  const tokenAmount = readUintLE(bytes, 14, 8);
  const refundHeight = Number(readUintLE(bytes, 22, 4));
  const maxFee = Number(readUintLE(bytes, 26, 4));
  let offset = 30;
  const recipientLength = bytes[offset++];
  if (recipientLength === undefined)
    throw new Error('Missing recipient length');
  const recipientLockingBytecode = Uint8Array.from(
    bytes.slice(offset, offset + recipientLength),
  );
  offset += recipientLength;
  const refundLength = bytes[offset++];
  if (refundLength === undefined) throw new Error('Missing refund length');
  const refundLockingBytecode = Uint8Array.from(
    bytes.slice(offset, offset + refundLength),
  );
  if (
    recipientLockingBytecode.length !== recipientLength ||
    refundLockingBytecode.length !== refundLength
  ) {
    throw new Error('Truncated FRY1 terms output');
  }
  return {
    tag,
    token,
    tokenAmount,
    refundHeight,
    maxFee,
    recipientLockingBytecode,
    refundLockingBytecode,
  };
}

export interface BchFry1Tx {
  txid: string;
  outputs: readonly { lockingBytecode: string }[];
}

export function scanBchFry1Transactions(input: {
  root: Hex32;
  transactions: readonly BchFry1Tx[];
  gap?: number;
  maxIndex?: number;
}): {
  swaps: { index: number; txid: string; terms: Fry1Terms }[];
  scanned: number;
} {
  const gap = input.gap ?? RECOVERY_SCAN_GAP;
  const maxIndex = input.maxIndex ?? 500;
  const swaps: { index: number; txid: string; terms: Fry1Terms }[] = [];
  let misses = 0;
  let scanned = 0;
  for (let index = 0; index < maxIndex && misses < gap; index += 1) {
    scanned += 1;
    const tag = Buffer.from(swapTagAt(input.root, index).slice(2), 'hex');
    let found = false;
    for (const tx of input.transactions) {
      for (const output of tx.outputs) {
        const body = output.lockingBytecode.replace(/^0x/i, '');
        try {
          const terms = parseTermsOutput(body);
          if (Buffer.from(terms.tag).equals(tag)) {
            swaps.push({ index, txid: tx.txid, terms });
            found = true;
          }
        } catch {
          // not a FRY1 output
        }
      }
    }
    misses = found ? 0 : misses + 1;
  }
  return { swaps, scanned };
}
