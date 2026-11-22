import { hexToBin, binToHex, sha256 as libauthSha256 } from '@bitauth/libauth';
import {
  FulcrumClient,
  type ElectrumHistoryItem,
  type ElectrumUtxo,
  type ElectrumFirstUse,
} from '@ferry/htlc-bch';
import { addressFromPubkey } from '../bch/address';
import { DEFAULT_MAINNET_FULCRUM } from '../live/bch-chain';
import { createBchReader, type BchReader } from '../live/bch-reader';
import type { BchUtxo } from './types';

export const DEFAULT_GAP_LIMIT = 20;
export const DEFAULT_MAX_ADDRESSES = 2000;
export const DEFAULT_BATCH_SIZE = 20;
export const DEFAULT_MAX_SENSIBLE_INPUTS = 40;

export type BranchName = 'receive' | 'change';

export interface FundingAddressItem {
  readonly lockingBytecodeHex: string;
  readonly derivationPath: readonly [BranchName, number];
}

export interface FundingScanResult {
  readonly addresses: readonly FundingAddressItem[];
  readonly utxos: readonly BchUtxo[];
  readonly searched: number;
  readonly capReached: boolean;
  readonly message?: string | null;
}

export type FulcrumClientLike = Pick<
  FulcrumClient,
  'connect' | 'close' | 'listUnspent'
> & {
  getHistory?: (scriptHash: string) => Promise<ElectrumHistoryItem[]>;
  getFirstUse?: (scriptHash: string) => Promise<ElectrumFirstUse | null>;
};

export interface FundingScanOptions {
  readonly getPubkey: (
    childIndex: number,
    index: bigint,
  ) => Uint8Array | undefined;
  readonly startIndex?: number | undefined;
  readonly urls?: readonly string[] | undefined;
  readonly solverUrl?: string | undefined;
  readonly reader?: BchReader | undefined;
  readonly createClient?: ((url: string) => FulcrumClientLike) | undefined;
  readonly gapLimit?: number | undefined;
  readonly maxAddresses?: number | undefined;
  readonly batchSize?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?:
    ((progress: { message: string; scanned: number }) => void) | undefined;
  readonly sessionKey?: string | undefined;
  readonly neededSatoshis?: bigint | undefined;
  readonly maxInputs?: number | undefined;
}

/** The Electrum script hash of a locking bytecode: SHA-256, byte-reversed, in hex. */
export function scriptHashOf(lockingBytecodeHex: string): string {
  const clean = lockingBytecodeHex.replace(/^0x/, '');
  return binToHex(libauthSha256.hash(hexToBin(clean)).reverse());
}

function rowToUtxo(
  row: ElectrumUtxo,
  lockingBytecodeHex: string,
  derivationPath: readonly [BranchName, number],
): BchUtxo {
  return {
    txid: row.tx_hash,
    vout: row.tx_pos,
    satoshis: BigInt(row.value),
    lockingBytecode: `0x${lockingBytecodeHex}`,
    ...(row.token_data
      ? {
          token: {
            category: row.token_data.category,
            amount: BigInt(row.token_data.amount),
          },
          ...(row.token_data.nft
            ? {
                nft: {
                  ...(row.token_data.nft.capability
                    ? { capability: row.token_data.nft.capability }
                    : {}),
                  ...(row.token_data.nft.commitment !== undefined
                    ? { commitment: row.token_data.nft.commitment }
                    : {}),
                },
              }
            : {}),
        }
      : {}),
    lockingBytecodeHex,
    derivationPath,
  } as BchUtxo;
}

/**
 * A short cache so calls made together (a quote, then the lock) scan once. It lives 30 seconds:
 * a wallet receives on new addresses (a swap's payout, a fresh receive address), and a longer
 * cache never saw them.
 */
export const FUNDING_SCAN_CACHE_MS = 30_000;
const sessionScanCache = new Map<
  string,
  { readonly at: number; readonly result: FundingScanResult }
>();

/** Clears the session scan cache (useful for tests and wallet disconnects). */
export function clearFundingScanCache(): void {
  sessionScanCache.clear();
}

/**
 * Checks if a required satoshi amount can be met with a sensible number of inputs.
 * If more than maxInputs (default 40) would be needed, throws or returns plain words guidance.
 */
export function assertSensibleInputs(
  utxos: readonly BchUtxo[],
  neededSatoshis: bigint,
  maxInputs = DEFAULT_MAX_SENSIBLE_INPUTS,
): void {
  if (neededSatoshis <= 0n) return;
  // Sort descending to find the maximum possible amount within maxInputs
  const sorted = [...utxos].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
  const topInputs = sorted.slice(0, maxInputs);
  const totalTop = topInputs.reduce((sum, u) => sum + u.satoshis, 0n);

  if (totalTop < neededSatoshis) {
    const totalAll = sorted.reduce((sum, u) => sum + u.satoshis, 0n);
    if (totalAll >= neededSatoshis) {
      throw new Error(
        'Your funds are spread over many small outputs; send them to one address first.',
      );
    }
  }
}

/**
 * Executes a gap-limit scan starting at the connected address index and expanding
 * forward and backward along both receive and change branches.
 *
 * - Pipelined queries over one connection per server
 * - Merges answers so lagging servers do not hide outputs
 * - Stops each direction after 20 consecutive unused addresses
 * - Hard cap on total requests with a clear message
 * - Remembers scan in session cache
 * - Cancellable via AbortSignal
 * - Sorts outputs biggest first
 */
export async function scanFundingAddresses(
  options: FundingScanOptions,
): Promise<FundingScanResult> {
  const {
    getPubkey,
    startIndex = 0,
    urls = DEFAULT_MAINNET_FULCRUM,
    solverUrl,
    reader: providedReader,
    createClient = (url: string) => new FulcrumClient(url),
    gapLimit = DEFAULT_GAP_LIMIT,
    maxAddresses = DEFAULT_MAX_ADDRESSES,
    batchSize = DEFAULT_BATCH_SIZE,
    signal,
    onProgress,
    sessionKey,
    neededSatoshis,
    maxInputs = DEFAULT_MAX_SENSIBLE_INPUTS,
  } = options;

  // 1. Check session cache
  const kept = sessionKey ? sessionScanCache.get(sessionKey) : undefined;
  if (kept && Date.now() - kept.at < FUNDING_SCAN_CACHE_MS) {
    const cached = kept.result;
    if (neededSatoshis !== undefined) {
      assertSensibleInputs(cached.utxos, neededSatoshis, maxInputs);
    }
    return cached;
  }

  signal?.throwIfAborted();
  onProgress?.({ message: "Checking your wallet's addresses…", scanned: 0 });

  const reader =
    providedReader ??
    createBchReader({
      solverUrl:
        solverUrl ??
        (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
          ?.split(',')[0]
          ?.trim(),
      fallbackUrls: urls,
      createClient,
    });

  const foundAddresses: FundingAddressItem[] = [];
  const foundUtxos: BchUtxo[] = [];
  const seenUtxoKeys = new Set<string>();
  const seenAddressKeys = new Set<string>();
  let totalScanned = 0;
  let capReached = false;
  let capMessage: string | null = null;

  const branches: readonly [BranchName, number][] = [
    ['receive', 0],
    ['change', 1],
  ];

  for (const [branch, childIndex] of branches) {
    signal?.throwIfAborted();
    if (capReached) break;

    // Directions: Forward (startIndex -> ...) and Backward (startIndex - 1 -> 0)
    const directions: Array<{
      name: 'forward' | 'backward';
      nextIndex: number;
      step: number;
      min?: number;
    }> = [
      { name: 'forward', nextIndex: startIndex, step: 1 },
      ...(startIndex > 0
        ? [
            {
              name: 'backward' as const,
              nextIndex: startIndex - 1,
              step: -1,
              min: 0,
            },
          ]
        : []),
    ];

    for (const dir of directions) {
      signal?.throwIfAborted();
      if (capReached) break;
      let consecutiveUnused = 0;

      while (consecutiveUnused < gapLimit && !capReached) {
        signal?.throwIfAborted();

        // Prepare batch indices
        const batchIndices: number[] = [];
        for (let i = 0; i < batchSize; i++) {
          const idx = dir.nextIndex;
          if (dir.min !== undefined && idx < dir.min) break;
          batchIndices.push(idx);
          dir.nextIndex += dir.step;
        }

        if (batchIndices.length === 0) break;

        // Derive addresses for batch
        const batchAddresses: Array<{
          index: number;
          derivationPath: readonly [BranchName, number];
          lockingBytecodeHex: string;
          scriptHash: string;
        }> = [];

        for (const idx of batchIndices) {
          if (totalScanned >= maxAddresses) {
            capReached = true;
            capMessage = `Address scan reached the limit of ${maxAddresses.toLocaleString()} addresses. Some funds on higher addresses may not be visible.`;
            break;
          }
          const pubkey = getPubkey(childIndex, BigInt(idx));
          if (!pubkey) continue;
          totalScanned++;
          const lockingBytecodeHex = addressFromPubkey(
            pubkey,
          ).lockingBytecode.replace(/^0x/, '');
          const scriptHash = scriptHashOf(lockingBytecodeHex);
          batchAddresses.push({
            index: idx,
            derivationPath: [branch, idx],
            lockingBytecodeHex,
            scriptHash,
          });
        }

        if (batchAddresses.length === 0) break;

        onProgress?.({
          message: "Checking your wallet's addresses…",
          scanned: totalScanned,
        });

        const used = await Promise.all(
          batchAddresses.map(async (addr) => ({
            addr,
            used: (await reader.getHistory(addr.scriptHash)).length > 0,
          })),
        );
        const usedAddresses = used
          .filter((item) => item.used)
          .map((item) => item.addr);
        const utxosByHash =
          usedAddresses.length > 0
            ? await reader.getUtxosMany(
                usedAddresses.map((addr) => addr.scriptHash),
              )
            : new Map<string, readonly ElectrumUtxo[]>();

        const batchResults = used.map(({ addr, used: isUsed }) => ({
          addr,
          isUsed,
          utxos: utxosByHash.get(addr.scriptHash) ?? [],
        }));

        signal?.throwIfAborted();

        // Process batch results in sequential address order
        for (const res of batchResults) {
          const { addr, isUsed, utxos } = res;

          if (isUsed) {
            consecutiveUnused = 0;
            const addrKey = `${branch}:${addr.index}`;
            if (!seenAddressKeys.has(addrKey)) {
              seenAddressKeys.add(addrKey);
              foundAddresses.push({
                lockingBytecodeHex: addr.lockingBytecodeHex,
                derivationPath: addr.derivationPath,
              });
            }
            for (const u of utxos) {
              const utxoKey = `${u.tx_hash}:${u.tx_pos}`;
              if (!seenUtxoKeys.has(utxoKey)) {
                seenUtxoKeys.add(utxoKey);
                foundUtxos.push(
                  rowToUtxo(u, addr.lockingBytecodeHex, addr.derivationPath),
                );
              }
            }
          } else {
            consecutiveUnused++;
            if (consecutiveUnused >= gapLimit) {
              break;
            }
          }
        }
      }
    }
  }
  // If no used addresses were found, include at least the start address
  if (foundAddresses.length === 0) {
    const pub = getPubkey(0, BigInt(startIndex));
    if (pub) {
      foundAddresses.push({
        lockingBytecodeHex: addressFromPubkey(pub).lockingBytecode.replace(
          /^0x/,
          '',
        ),
        derivationPath: ['receive', startIndex],
      });
    }
  }

  // Sort UTXOs largest-first (token amounts descending, then satoshis descending)
  foundUtxos.sort((a, b) => {
    if (a.token && b.token && a.token.category === b.token.category) {
      if (b.token.amount !== a.token.amount) {
        return b.token.amount > a.token.amount ? 1 : -1;
      }
    }
    if (b.satoshis !== a.satoshis) {
      return b.satoshis > a.satoshis ? 1 : -1;
    }
    return a.txid.localeCompare(b.txid);
  });

  // Verify sensible inputs constraint
  if (neededSatoshis !== undefined) {
    assertSensibleInputs(foundUtxos, neededSatoshis, maxInputs);
  }

  const result: FundingScanResult = {
    addresses: foundAddresses,
    utxos: foundUtxos,
    searched: totalScanned,
    capReached,
    message: capMessage,
  };

  if (sessionKey) {
    sessionScanCache.set(sessionKey, { at: Date.now(), result });
  }

  return result;
}
