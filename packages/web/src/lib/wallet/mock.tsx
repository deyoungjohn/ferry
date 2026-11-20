import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Address, Hex, TypedDataDefinition } from 'viem';
import { cashAddressToLockingBytecode } from '@ferry/core';
import { NETWORK_PROFILE } from '../config';
import { WalletContext } from './context';
import { validateBchAddressPrefix } from './chain';
import type {
  BchAddressInfo,
  BchSignTransactionRequest,
  BchSignedTransaction,
  BchUtxo,
  BchWallet,
  BchWalletConnectOptions,
  EvmWallet,
  WalletStatus,
} from './types';

// Deterministic mock test addresses
export const MOCK_EVM_ADDRESS: Address =
  '0x71C95911E9A5D330f4D621842EC243EE1343292e';

// Valid chipnet address with bchtest: prefix
export const MOCK_BCH_CHIPNET_ADDRESS =
  'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk';

// Mainnet address with bitcoincash: prefix (used for mismatch testing)
export const MOCK_BCH_MAINNET_ADDRESS =
  'bitcoincash:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zye3kwllue';

function getMockBchAddress(addr = MOCK_BCH_CHIPNET_ADDRESS): BchAddressInfo {
  let lockingBytecode: `0x${string}`;
  try {
    lockingBytecode = cashAddressToLockingBytecode(addr);
  } catch {
    lockingBytecode =
      '0x76a914000000000000000000000000000000000000000088ac' as `0x${string}`;
  }
  return {
    address: addr,
    lockingBytecode,
    tokenAware: true,
  };
}

export interface MockWalletProviderProps {
  readonly children: ReactNode;
  readonly defaultEvmConnected?: boolean;
  readonly defaultBchConnected?: boolean;
  readonly asleepDelayMs?: number;
}

export function MockWalletProvider({
  children,
  defaultEvmConnected = false,
  defaultBchConnected = false,
  asleepDelayMs = 5000,
}: MockWalletProviderProps) {
  // EVM wallet state
  const [evmStatus, setEvmStatus] = useState<WalletStatus>(
    defaultEvmConnected ? 'connected' : 'disconnected',
  );
  const [evmError, setEvmError] = useState<string | null>(null);
  const [evmPending, setEvmPending] = useState<string | null>(null);
  const [evmPromptHelp, setEvmPromptHelp] = useState<string | null>(null);
  const evmAbortRef = useRef<AbortController | null>(null);

  // BCH wallet state
  const [bchStatus, setBchStatus] = useState<WalletStatus>(
    defaultBchConnected ? 'connected' : 'disconnected',
  );
  const [bchError, setBchError] = useState<string | null>(null);
  const [bchAddress, setBchAddress] = useState<BchAddressInfo | null>(
    defaultBchConnected ? getMockBchAddress() : null,
  );
  const [bchWalletName, setBchWalletName] = useState<string | null>(
    defaultBchConnected ? 'Paytaca (Mock)' : null,
  );
  const [bchPairing, setBchPairing] = useState<boolean>(false);
  const [bchPending, setBchPending] = useState<string | null>(null);
  const [bchPromptHelp, setBchPromptHelp] = useState<string | null>(null);
  const bchAbortRef = useRef<AbortController | null>(null);

  // Cancel EVM pending request
  const cancelEvmPending = useCallback(() => {
    if (evmAbortRef.current) {
      evmAbortRef.current.abort('Cancelled by user');
      evmAbortRef.current = null;
    }
    setEvmPending(null);
    setEvmPromptHelp(null);
  }, []);

  // Cancel BCH pending request
  const cancelBchPending = useCallback(() => {
    if (bchAbortRef.current) {
      bchAbortRef.current.abort('Cancelled by user');
      bchAbortRef.current = null;
    }
    setBchPending(null);
    setBchPromptHelp(null);
  }, []);

  const evm = useMemo<EvmWallet>(
    () => ({
      status: evmStatus,
      address: evmStatus === 'connected' ? MOCK_EVM_ADDRESS : null,
      chainId: 84532,
      error: evmError,
      pendingRequest: evmPending,
      promptHelp: evmPromptHelp,
      connect: () => {
        setEvmError(null);
        setEvmStatus('connected');
      },
      disconnect: async () => {
        setEvmStatus('disconnected');
        setEvmPending(null);
        setEvmPromptHelp(null);
      },
      cancelPendingRequest: cancelEvmPending,
      signTypedData: async (params: TypedDataDefinition) => {
        if (params.primaryType === 'RecoveryKey') {
          setEvmPending('Sign the Ferry recovery message');
          setEvmPromptHelp(
            'Sign the Ferry recovery message to enable key-based swap recovery on any device without files',
          );
        } else {
          setEvmPending(
            params.primaryType === 'Permit'
              ? 'Sign the USDC permit'
              : 'Sign the lock intent',
          );
        }
        const controller = new AbortController();
        evmAbortRef.current = controller;

        const timer = setTimeout(() => {
          setEvmPromptHelp(
            'Is your phone asleep? Nothing was sent to the network.',
          );
        }, asleepDelayMs);

        return new Promise<Hex>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(
              new Error('Request cancelled. Nothing was sent to the network.'),
            );
          });
        });
      },
      readTokenBalance: async () => 100_000_000n, // $100.00 USDC
      refundLock: async () =>
        '0xmockrefund11111111111111111111111111111111111111111111111111111111' as Hex,
      claimLock: async () =>
        '0xmockclaim11111111111111111111111111111111111111111111111111111111' as Hex,
    }),
    [
      evmStatus,
      evmError,
      evmPending,
      evmPromptHelp,
      cancelEvmPending,
      asleepDelayMs,
    ],
  );

  const bch = useMemo<BchWallet>(
    () => ({
      status: bchStatus,
      address: bchStatus === 'connected' ? bchAddress : null,
      error: bchError,
      walletName: bchWalletName,
      pairing: bchPairing,
      pendingRequest: bchPending,
      promptHelp: bchPromptHelp,
      connect: (options?: BchWalletConnectOptions) => {
        setBchError(null);

        // Prefix validation check
        const targetAddress = options?.simulatePrefixMismatch
          ? MOCK_BCH_MAINNET_ADDRESS
          : (options?.address ?? MOCK_BCH_CHIPNET_ADDRESS);

        const check = validateBchAddressPrefix(
          targetAddress,
          NETWORK_PROFILE.bch.prefix,
        );

        if (!check.ok) {
          setBchError(check.error ?? 'Wallet network prefix mismatch');
          setBchStatus('disconnected');
          setBchAddress(null);
          return;
        }

        const info = getMockBchAddress(targetAddress);
        setBchAddress(info);
        setBchWalletName('Paytaca (Mock)');
        setBchStatus('connected');
        setBchPairing(false);
      },
      disconnect: async () => {
        setBchStatus('disconnected');
        setBchAddress(null);
        setBchWalletName(null);
        setBchPending(null);
        setBchPromptHelp(null);
        setBchPairing(false);
      },
      cancelPendingRequest: cancelBchPending,
      setAddress: (addr) => {
        const check = validateBchAddressPrefix(
          addr.address,
          NETWORK_PROFILE.bch.prefix,
        );
        if (!check.ok) {
          setBchError(check.error ?? 'Invalid network prefix');
          return;
        }
        setBchAddress(addr);
      },
      forget: () => {
        setBchStatus('disconnected');
        setBchAddress(null);
        setBchWalletName(null);
      },
      listUtxos: async (): Promise<readonly BchUtxo[]> => {
        return [
          {
            txid: 'mockbchatxid1111111111111111111111111111111111111111111111111111',
            vout: 0,
            satoshis: 50_000n,
            lockingBytecode: (bchAddress?.lockingBytecode ??
              '0x76a914000000000000000000000000000000000000000088ac') as `0x${string}`,
          },
        ];
      },
      signTransaction: async (request: BchSignTransactionRequest) => {
        setBchPending(request.userPrompt ?? 'Sign the BCH transaction');
        const controller = new AbortController();
        bchAbortRef.current = controller;

        const timer = setTimeout(() => {
          setBchPromptHelp(
            'Is your phone asleep? Nothing was sent to the network.',
          );
        }, asleepDelayMs);

        return new Promise<BchSignedTransaction>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(
              new Error('Request cancelled. Nothing was sent to the network.'),
            );
          });
        });
      },
      broadcastTransaction: async () =>
        'mockbchatxid2222222222222222222222222222222222222222222222222222',
      transactionExists: async () => true,
    }),
    [
      bchStatus,
      bchAddress,
      bchError,
      bchWalletName,
      bchPairing,
      bchPending,
      bchPromptHelp,
      cancelBchPending,
      asleepDelayMs,
    ],
  );

  return (
    <WalletContext.Provider value={{ evm, bch, usingMocks: true }}>
      {children}
    </WalletContext.Provider>
  );
}
