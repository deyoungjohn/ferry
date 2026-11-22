import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deriveRecoveryRoot,
  evmLockId,
  swapSecretAt,
  swapHashLockAt,
  EVM_RECOVERY_KEY_TYPED_DATA,
} from '@ferry/core';
import type { EvmChainPort } from '@ferry/user-flow';
import type { Address, Hex } from 'viem';
import type { EvmWallet } from '../lib/wallet/types';
import {
  getOrDeriveRecoveryRoot,
  createWalletSecretGenerator,
  scanNextIndex,
  getOrCreateRescueRoot,
  createRescueSecretGenerator,
  isRescueKeySaved,
  markRescueKeySaved,
  isContractWallet,
  type KeyValueStore,
} from '../lib/recovery/recovery-key-service';

function createMockStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: vi.fn((k: string) => Promise.resolve(map.get(k) ?? null)),
    set: vi.fn((k: string, v: string) => {
      map.set(k, v);
      return Promise.resolve();
    }),
    remove: vi.fn((k: string) => {
      map.delete(k);
      return Promise.resolve();
    }),
  };
}

describe('RecoveryKeyService', () => {
  const testAddress: Address = '0x1111111111111111111111111111111111111111';
  // 65-byte mock signature
  const testSignature: Hex =
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1b';

  let mockWallet: EvmWallet;
  let mockStore: KeyValueStore;

  beforeEach(() => {
    mockStore = createMockStore();
    mockWallet = {
      status: 'connected',
      address: testAddress,
      chainId: 8453,
      error: null,
      pendingRequest: null,
      promptHelp: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signTypedData: vi.fn(async (params) => {
        expect(params).toEqual(EVM_RECOVERY_KEY_TYPED_DATA);
        return testSignature;
      }),
      readTokenBalance: vi.fn(async () => 0n),
      refundLock: vi.fn(async () => '0x0' as Hex),
      claimLock: vi.fn(async () => '0x0' as Hex),
    };
  });

  it('secrets equal swapSecretAt for the wallet signature', async () => {
    const expectedRoot = deriveRecoveryRoot(testSignature);
    const expectedSecret0 = swapSecretAt(expectedRoot, 0);
    const expectedSecret1 = swapSecretAt(expectedRoot, 1);

    const result = await getOrDeriveRecoveryRoot(mockWallet, {
      store: mockStore,
    });
    expect(result.isContract).toBe(false);
    expect(result.root).toBe(expectedRoot);

    // Wallet is prompted once
    expect(mockWallet.signTypedData).toHaveBeenCalledTimes(1);

    // Call again: should read from store without re-prompting
    const cached = await getOrDeriveRecoveryRoot(mockWallet, {
      store: mockStore,
    });
    expect(cached.root).toBe(expectedRoot);
    expect(mockWallet.signTypedData).toHaveBeenCalledTimes(1);

    // Secret generator creates secrets matching swapSecretAt
    const generator = createWalletSecretGenerator(mockWallet, {
      store: mockStore,
    });
    const secret0 = await generator();
    const secret1 = await generator();

    expect(secret0).toBe(expectedSecret0);
    expect(secret1).toBe(expectedSecret1);
  });

  it('index advances on every quote', async () => {
    const generator = createWalletSecretGenerator(mockWallet, {
      store: mockStore,
    });

    const s0 = await generator();
    const s1 = await generator();
    const s2 = await generator();

    const storedIndex = await mockStore.get(
      `ferry.recovery.index.${testAddress.toLowerCase()}`,
    );
    expect(storedIndex).toBe('3');

    const root = deriveRecoveryRoot(testSignature);
    expect(s0).toBe(swapSecretAt(root, 0));
    expect(s1).toBe(swapSecretAt(root, 1));
    expect(s2).toBe(swapSecretAt(root, 2));
  });

  it('falls back to random secrets and per-swap file for contract wallets', async () => {
    const mockClient = {
      getBytecode: vi.fn(async () => '0xef0100delegationcode' as Hex),
    };

    expect(await isContractWallet(mockClient, testAddress)).toBe(true);

    const result = await getOrDeriveRecoveryRoot(mockWallet, {
      store: mockStore,
      chainClient: mockClient,
    });

    expect(result.isContract).toBe(true);
    expect(result.root).toBeNull();
    // Did NOT prompt wallet to sign
    expect(mockWallet.signTypedData).not.toHaveBeenCalled();

    // Secret generator produces random 32-byte secret
    const generator = createWalletSecretGenerator(mockWallet, {
      store: mockStore,
      chainClient: mockClient,
    });

    const randSecret1 = await generator();
    const randSecret2 = await generator();

    expect(randSecret1).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(randSecret2).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(randSecret1).not.toBe(randSecret2);
  });

  it('scans on-chain locks and stops after RECOVERY_SCAN_GAP misses', async () => {
    const root = deriveRecoveryRoot(testSignature);
    const usedIndices = new Set([0, 1, 2, 5]);

    const usedLockIds = new Set(
      [...usedIndices].map((idx) =>
        evmLockId(testAddress, swapHashLockAt(root, idx)).toLowerCase(),
      ),
    );

    const mockChain: EvmChainPort = {
      buildUserLock: vi.fn(),
      waitForReceipt: vi.fn(),
      getBlockTimestamp: vi.fn(),
      getLock: vi.fn(async (lockId) => {
        if (usedLockIds.has(lockId.toLowerCase())) {
          return { status: 'locked' } as never;
        }
        return { status: 'absent' };
      }) as never,
    };

    const nextIdx = await scanNextIndex(testAddress, root, [mockChain], {
      store: mockStore,
      gap: 20,
    });

    // Highest used was 5, so next index is 6
    expect(nextIdx).toBe(6);

    const saved = await mockStore.get(
      `ferry.recovery.index.${testAddress.toLowerCase()}`,
    );
    expect(saved).toBe('6');
  });

  it('on a scan timeout continues from the last used index seen, never a far random index', async () => {
    const root = deriveRecoveryRoot(testSignature);
    const hangingChain: EvmChainPort = {
      buildUserLock: vi.fn(),
      waitForReceipt: vi.fn(),
      getBlockTimestamp: vi.fn(),
      getLock: vi.fn(() => new Promise(() => undefined)) as never, // never resolves
    };

    const nextIdx = await scanNextIndex(testAddress, root, [hangingChain], {
      store: mockStore,
      timeoutMs: 50,
    });

    // Nothing was seen before the timeout: start at 0, inside the range recovery scans.
    expect(nextIdx).toBe(0);
  });

  it('manages rescue root for reverse swaps without connected EVM wallet', async () => {
    expect(await isRescueKeySaved(mockStore)).toBe(false);

    const rescueRoot1 = await getOrCreateRescueRoot(mockStore);
    expect(rescueRoot1).toMatch(/^0x[0-9a-f]{64}$/i);

    const rescueRoot2 = await getOrCreateRescueRoot(mockStore);
    expect(rescueRoot2).toBe(rescueRoot1);

    const generator = createRescueSecretGenerator(mockStore);
    const sec0 = await generator();
    const sec1 = await generator();

    expect(sec0).toBe(swapSecretAt(rescueRoot1, 0));
    expect(sec1).toBe(swapSecretAt(rescueRoot1, 1));

    await markRescueKeySaved(mockStore);
    expect(await isRescueKeySaved(mockStore)).toBe(true);
  });
});

describe('wallets that refuse a typed message without a chain id', () => {
  const memoryStore = () => {
    const map = new Map<string, string>();
    return {
      get: async (k: string) => map.get(k) ?? null,
      set: async (k: string, v: string) => void map.set(k, v),
      remove: async (k: string) => void map.delete(k),
    };
  };
  const wallet = (error: Error) =>
    ({
      address: '0x1111111111111111111111111111111111111111',
      signTypedData: async () => {
        throw error;
      },
    }) as never;

  it('falls back to a per-swap secret on "Provided chainId NaN must match the active chainId"', async () => {
    const result = await getOrDeriveRecoveryRoot(
      wallet(
        new Error(
          'An unknown RPC error occurred. Details: Provided chainId "NaN" must match the active chainId "8453"',
        ),
      ),
      { store: memoryStore() },
    );
    expect(result.root).toBeNull();
  });

  it('still stops when the person cancels', async () => {
    let outcome: 'stopped' | 'fell back' = 'fell back';
    try {
      await getOrDeriveRecoveryRoot(
        wallet(new Error('User rejected the request.')),
        { store: memoryStore() },
      );
    } catch {
      outcome = 'stopped';
    }
    expect(outcome).toBe('stopped');
  });
});
