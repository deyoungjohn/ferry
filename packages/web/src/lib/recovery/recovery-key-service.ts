import {
  deriveRecoveryRoot,
  evmLockId,
  EVM_RECOVERY_KEY_TYPED_DATA,
  RECOVERY_SCAN_GAP,
  swapCancelHashAt,
  swapCancelKeyAt,
  swapHashLockAt,
  swapSecretAt,
  swapTagAt,
  type Hex32,
} from '@ferry/core';
import type { EvmChainPort } from '@ferry/user-flow';
import { bytesToHex, type Address, type Hex } from 'viem';
import type { EvmWallet } from '../wallet/types';

const DB_NAME = 'ferry_recovery_db';
const STORE_NAME = 'kv';
const MEMORY_STORE = new Map<string, string>();

/**
 * Key-value browser storage backing the recovery keys and indices.
 * Tries IndexedDB first, falls back to localStorage, then in-memory fallback.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const browserRecoveryStorage: KeyValueStore = {
  async get(key: string): Promise<string | null> {
    const db = await openIdb();
    if (db) {
      try {
        return await new Promise<string | null>((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(key);
          req.onsuccess = () => resolve((req.result as string) ?? null);
          req.onerror = () => resolve(null);
        });
      } catch {
        // Fall back to localStorage
      }
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // In-memory fallback
    }
    return MEMORY_STORE.get(key) ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    const db = await openIdb();
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        return;
      } catch {
        // Fall back to localStorage
      }
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // In-memory fallback
    }
    MEMORY_STORE.set(key, value);
  },

  async remove(key: string): Promise<void> {
    const db = await openIdb();
    if (db) {
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        });
      } catch {
        // Fall back to localStorage
      }
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // In-memory fallback
    }
    MEMORY_STORE.delete(key);
  },
};

/**
 * Check whether an address is a contract wallet (has deployed code or EIP-7702 delegation).
 */
export async function isContractWallet(
  client:
    | {
        getBytecode?: (args: { address: Address }) => Promise<Hex | undefined>;
        getCode?: (args: { address: Address }) => Promise<Hex | undefined>;
      }
    | null
    | undefined,
  address: Address,
): Promise<boolean> {
  if (!client) return false;
  try {
    const fn = client.getBytecode ?? client.getCode;
    if (!fn) return false;
    const code = await fn({ address });
    return Boolean(code && code !== '0x' && code !== '0x0');
  } catch {
    return false;
  }
}

export interface RecoveryRootResult {
  readonly root: Hex32 | null;
  readonly isContract: boolean;
}

/**
 * Get the stored recovery root for an EVM wallet address, or prompt the wallet once
 * to sign EVM_RECOVERY_KEY_TYPED_DATA and derive the root.
 * Contract wallets (code on address) fall back to random per-swap secrets.
 */
export async function getOrDeriveRecoveryRoot(
  wallet: EvmWallet,
  options?: {
    store?: KeyValueStore;
    chainClient?: {
      getBytecode?: (args: { address: Address }) => Promise<Hex | undefined>;
      getCode?: (args: { address: Address }) => Promise<Hex | undefined>;
    };
  },
): Promise<RecoveryRootResult> {
  const store = options?.store ?? browserRecoveryStorage;
  const address = wallet.address?.toLowerCase() as Address | undefined;
  if (!address) {
    throw new Error('EVM wallet is not connected.');
  }

  // 1. Check if previously marked as contract wallet
  const contractFlag = await store.get(`ferry.recovery.contract.${address}`);
  if (contractFlag === 'true') {
    return { root: null, isContract: true };
  }

  // 2. Check if root already stored in browser
  const existingRoot = await store.get(`ferry.recovery.root.${address}`);
  if (
    existingRoot &&
    existingRoot.startsWith('0x') &&
    existingRoot.length === 66
  ) {
    return { root: existingRoot as Hex32, isContract: false };
  }

  // 3. Check if contract wallet via chain client
  if (options?.chainClient) {
    const isContract = await isContractWallet(options.chainClient, address);
    if (isContract) {
      await store.set(`ferry.recovery.contract.${address}`, 'true');
      return { root: null, isContract: true };
    }
  }

  // 4. EOA: Ask wallet to sign EVM_RECOVERY_KEY_TYPED_DATA
  const signature = await wallet.signTypedData(
    EVM_RECOVERY_KEY_TYPED_DATA as never,
  );
  const root = deriveRecoveryRoot(signature);
  await store.set(`ferry.recovery.root.${address}`, root);
  return { root, isContract: false };
}

/**
 * Scan on-chain locks to find the next unused swap index n for this wallet root.
 * Stops after RECOVERY_SCAN_GAP consecutive absent locks.
 * Bounded by a timeout (default 5s); falls back to a random index well above
 * scan range on timeout/error.
 */
export async function scanNextIndex(
  address: Address,
  root: Hex32,
  chains: readonly EvmChainPort[],
  options?: {
    store?: KeyValueStore;
    timeoutMs?: number;
    gap?: number;
  },
): Promise<number> {
  const store = options?.store ?? browserRecoveryStorage;
  const normalizedAddr = address.toLowerCase();

  // If already known in store, return it
  const stored = await store.get(`ferry.recovery.index.${normalizedAddr}`);
  if (stored !== null) {
    const parsed = parseInt(stored, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const gap = options?.gap ?? RECOVERY_SCAN_GAP;
  const timeoutMs = options?.timeoutMs ?? 5000;

  // On a timeout, carry on just after the last used index the scan has seen so far: an index
  // far above would never be found by a recovery scan, and the solver refuses a reused one.
  let maxUsedSoFar = -1;

  const scanPromise = (async () => {
    let maxUsed = -1;
    let consecutiveMisses = 0;
    let n = 0;

    while (consecutiveMisses < gap) {
      const hashLock = swapHashLockAt(root, n);
      const lockId = evmLockId(normalizedAddr, hashLock);

      // Check lockId across all provided chains in parallel
      const states = await Promise.all(
        chains.map((chain) =>
          chain.getLock(lockId).catch(() => ({ status: 'absent' as const })),
        ),
      );

      const isUsed = states.some((s) => s.status !== 'absent');
      if (isUsed) {
        maxUsed = n;
        maxUsedSoFar = n;
        consecutiveMisses = 0;
      } else {
        consecutiveMisses += 1;
      }
      n += 1;
    }

    return maxUsed >= 0 ? maxUsed + 1 : 0;
  })();

  const timeoutPromise = new Promise<number>((resolve) => {
    setTimeout(() => resolve(maxUsedSoFar + 1), timeoutMs);
  });

  try {
    const nextIndex = await Promise.race([scanPromise, timeoutPromise]);
    await store.set(
      `ferry.recovery.index.${normalizedAddr}`,
      String(nextIndex),
    );
    return nextIndex;
  } catch {
    await store.set(
      `ferry.recovery.index.${normalizedAddr}`,
      String(maxUsedSoFar + 1),
    );
    return maxUsedSoFar + 1;
  }
}

/**
 * Creates a secret generator for a connected EVM wallet:
 * - If contract wallet: returns random 32 bytes
 * - If EOA: derives/retrieves root, gets/scans next index, advances index, returns swapSecretAt(root, n)
 */
export function createWalletSecretGenerator(
  wallet: EvmWallet,
  options?: {
    chains?: readonly EvmChainPort[];
    store?: KeyValueStore;
    chainClient?: {
      getBytecode?: (args: { address: Address }) => Promise<Hex | undefined>;
      getCode?: (args: { address: Address }) => Promise<Hex | undefined>;
    };
  },
): SecretGenerator {
  const store = options?.store ?? browserRecoveryStorage;

  const generate: SecretGenerator = async (): Promise<Hex32> => {
    generate.lastTag = undefined;
    generate.lastCancelKey = undefined;
    generate.lastCancelHash = undefined;
    const { root, isContract } = await getOrDeriveRecoveryRoot(wallet, options);
    if (isContract || !root || !wallet.address) {
      // Contract wallet fallback: random secret
      const random = new Uint8Array(32);
      crypto.getRandomValues(random);
      return bytesToHex(random) as Hex32;
    }

    const addr = wallet.address.toLowerCase();
    let currentIndex: number;

    const storedIndex = await store.get(`ferry.recovery.index.${addr}`);
    if (storedIndex !== null) {
      currentIndex = parseInt(storedIndex, 10);
      if (Number.isNaN(currentIndex) || currentIndex < 0) {
        currentIndex = 0;
      }
    } else if (options?.chains && options.chains.length > 0) {
      currentIndex = await scanNextIndex(wallet.address, root, options.chains, {
        store,
      });
    } else {
      currentIndex = 0;
    }

    // Advance index before returning secret
    await store.set(`ferry.recovery.index.${addr}`, String(currentIndex + 1));
    generate.lastTag = swapTagAt(root, currentIndex);
    generate.lastCancelKey = swapCancelKeyAt(root, currentIndex);
    generate.lastCancelHash = swapCancelHashAt(root, currentIndex);
    return swapSecretAt(root, currentIndex);
  };
  return generate;
}

/**
 * For reverse swaps without connected EVM wallet:
 * Retrieve or create a random rescue root kept in browser storage.
 */
export async function getOrCreateRescueRoot(
  store: KeyValueStore = browserRecoveryStorage,
): Promise<Hex32> {
  const existing = await store.get('ferry.rescue.root');
  if (existing && existing.startsWith('0x') && existing.length === 66) {
    return existing as Hex32;
  }
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const root = bytesToHex(random) as Hex32;
  await store.set('ferry.rescue.root', root);
  await store.set('ferry.rescue.index', '0');
  return root;
}

/** A secret source that also remembers the recovery tag and cancel key of the secret it gave last. */
export type SecretGenerator = (() => Promise<Hex32>) & {
  lastTag?: `0x${string}` | undefined;
  lastCancelKey?: Hex32 | undefined;
  lastCancelHash?: Hex32 | undefined;
};

/**
 * Secret generator for reverse swaps without connected EVM wallet.
 */
export function createRescueSecretGenerator(
  store: KeyValueStore = browserRecoveryStorage,
): SecretGenerator {
  const generate: SecretGenerator = async (): Promise<Hex32> => {
    generate.lastTag = undefined;
    generate.lastCancelKey = undefined;
    generate.lastCancelHash = undefined;
    const root = await getOrCreateRescueRoot(store);
    const stored = await store.get('ferry.rescue.index');
    let idx = stored !== null ? parseInt(stored, 10) : 0;
    if (Number.isNaN(idx) || idx < 0) idx = 0;

    await store.set('ferry.rescue.index', String(idx + 1));
    generate.lastTag = swapTagAt(root, idx);
    generate.lastCancelKey = swapCancelKeyAt(root, idx);
    generate.lastCancelHash = swapCancelHashAt(root, idx);
    return swapSecretAt(root, idx);
  };
  return generate;
}

export async function isRescueKeySaved(
  store: KeyValueStore = browserRecoveryStorage,
): Promise<boolean> {
  const val = await store.get('ferry.rescue.saved');
  return val === 'true';
}

export async function markRescueKeySaved(
  store: KeyValueStore = browserRecoveryStorage,
): Promise<void> {
  await store.set('ferry.rescue.saved', 'true');
}
