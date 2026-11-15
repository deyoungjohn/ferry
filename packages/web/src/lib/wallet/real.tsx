import { useAppKit } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clearSession } from '@wizardconnect/dapp';
import { WizardConnectQRDialog, useWizardConnect } from '@wizardconnect/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  bytesToHex,
  hexToBytes,
  sha256,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from 'viem';
import {
  useAccount,
  useDisconnect,
  useSignTypedData,
  WagmiProvider,
} from 'wagmi';
import { NETWORK_PROFILE, REOWN_PROJECT_ID } from '../config';
import { WalletContext } from './context';
import { wagmiConfig } from './evm-config';
import { validateBchAddressPrefix } from './chain';
import { wizardConnectTheme } from './wizard-theme';
import { useBchReconnectTimeout } from './reconnect-timeout';
import { addressFromPubkey } from '../bch/address';
import {
  clearRememberedBchWallet,
  readRememberedBchWallet,
  saveRememberedBchWallet,
  type RememberedBchWallet,
} from './remembered';
import type {
  BchAddressInfo,
  BchSignTransactionRequest,
  BchSignedTransaction,
  BchUtxo,
  BchWallet,
  EvmWallet,
} from './types';

const queryClient = new QueryClient();

function useRealEvmWallet(): EvmWallet {
  const { address, chainId, isConnected, isConnecting, isReconnecting } =
    useAccount();
  const { disconnectAsync } = useDisconnect();
  const { open } = useAppKit();
  const { signTypedDataAsync } = useSignTypedData();

  const [error, setError] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [promptHelp, setPromptHelp] = useState<string | null>(null);
  const evmAbortRef = useRef<AbortController | null>(null);

  const cancelPendingRequest = () => {
    if (evmAbortRef.current) {
      evmAbortRef.current.abort('Cancelled in Ferry');
      evmAbortRef.current = null;
    }
    setPendingRequest(null);
    setPromptHelp(null);
  };

  return {
    status: !REOWN_PROJECT_ID
      ? 'unavailable'
      : isConnected
        ? 'connected'
        : isConnecting || isReconnecting
          ? 'connecting'
          : 'disconnected',
    address: (address as Address) ?? null,
    chainId,
    error:
      error ??
      (!REOWN_PROJECT_ID
        ? 'EVM wallet connection requires a Reown Project ID (VITE_REOWN_PROJECT_ID)'
        : null),
    pendingRequest,
    promptHelp,
    connect: () => {
      if (!REOWN_PROJECT_ID) {
        setError(
          'EVM wallet connection requires a Reown Project ID (VITE_REOWN_PROJECT_ID)',
        );
        return;
      }
      setError(null);
      void open();
    },
    disconnect: async () => {
      await disconnectAsync();
      setPendingRequest(null);
      setPromptHelp(null);
    },
    cancelPendingRequest,
    signTypedData: async (params: TypedDataDefinition) => {
      setPendingRequest(
        params.primaryType === 'Permit'
          ? 'Sign the token permit'
          : 'Sign the lock intent',
      );
      const controller = new AbortController();
      evmAbortRef.current = controller;

      const timer = setTimeout(() => {
        setPromptHelp('Is your phone asleep? Nothing was sent to the network.');
      }, 8000);

      try {
        const signature = await signTypedDataAsync(params as never);
        return signature as Hex;
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error(
            'Request cancelled. Nothing was sent to the network.',
            { cause },
          );
        }
        setError(cause instanceof Error ? cause.message : 'Signature rejected');
        throw cause;
      } finally {
        clearTimeout(timer);
        evmAbortRef.current = null;
        setPendingRequest(null);
        setPromptHelp(null);
      }
    },
    readTokenBalance: async () => 0n,
    refundLock: async () => '0x' as Hex,
    claimLock: async () => '0x' as Hex,
  };
}

function txidOf(txHex: string): string {
  const cleanHex = txHex.startsWith('0x') ? txHex : `0x${txHex}`;
  const first = hexToBytes(sha256(cleanHex as Hex));
  const second = hexToBytes(sha256(first));
  second.reverse();
  return bytesToHex(second).slice(2);
}

function useRealBchWallet(
  onRestart: () => void,
  startFresh: boolean,
): { wallet: BchWallet; dialog: ReactNode } {
  const wizard = useWizardConnect({ dappName: 'Ferry' });
  const connectRef = useRef(wizard.connect);
  const startedFresh = useRef(false);

  useEffect(() => {
    connectRef.current = wizard.connect;
  }, [wizard.connect]);

  useEffect(() => {
    if (!startFresh || startedFresh.current) return;
    startedFresh.current = true;
    const timer = window.setTimeout(() => connectRef.current(), 0);
    return () => {
      startedFresh.current = false;
      window.clearTimeout(timer);
    };
  }, [startFresh]);

  // A pairing the user started waits for the scan; only a restored session is
  // dropped by the 8s limit.
  const [userStarted, setUserStarted] = useState(false);
  useEffect(() => {
    if (wizard.state === 'connected' || wizard.state === 'disconnected') {
      setUserStarted(false);
    }
  }, [wizard.state]);

  const reconnectTimedOut = useBchReconnectTimeout(
    wizard.state,
    () => wizard.disconnect(),
    8000,
    !userStarted,
  );

  const signAbort = useRef<AbortController | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [promptHelp, setPromptHelp] = useState<string | null>(null);
  const [prefixError, setPrefixError] = useState<string | null>(null);

  const [remembered, setRemembered] = useState<RememberedBchWallet | null>(() =>
    readRememberedBchWallet(),
  );

  // Derive address from wizard connect manager
  const derived = useMemo<BchAddressInfo | null>(() => {
    if (wizard.state !== 'connected' || !wizard.manager) return null;
    try {
      const pubkey = wizard.manager.getPubkey(0, 0n);
      if (!pubkey) return null;
      return addressFromPubkey(pubkey);
    } catch {
      return null;
    }
  }, [wizard.state, wizard.manager]);

  const address = derived ?? remembered?.address ?? null;

  // Prefix validation on connected address
  useEffect(() => {
    if (address) {
      const check = validateBchAddressPrefix(
        address.address,
        NETWORK_PROFILE.bch.prefix,
      );
      if (!check.ok) {
        setPrefixError(check.error ?? 'Prefix mismatch');
      } else {
        setPrefixError(null);
      }
    }
  }, [address]);

  // Persist remembered wallet
  useEffect(() => {
    if (wizard.state !== 'connected' || !derived || prefixError) return;
    const next = saveRememberedBchWallet(wizard.walletName, derived);
    setRemembered(next);
  }, [derived, wizard.state, wizard.walletName, prefixError]);

  const wallet: BchWallet = {
    status: prefixError
      ? 'disconnected'
      : wizard.state === 'connected' && address
        ? 'connected'
        : !reconnectTimedOut &&
            (wizard.state === 'connecting' || wizard.state === 'reconnecting')
          ? 'connecting'
          : remembered
            ? 'offline'
            : 'disconnected',
    address: prefixError ? null : address,
    error: prefixError ?? wizard.error,
    walletName: wizard.walletName ?? remembered?.name ?? null,
    pairing: wizard.state === 'connecting' && wizard.uri !== null,
    pendingRequest,
    promptHelp,
    connect: () => {
      setPrefixError(null);
      setUserStarted(true);
      // Normal case: open the QR dialog directly. A stale restored
      // attempt needs the clear-and-remount path to offer fresh QR.
      if (wizard.state === 'connecting' || wizard.state === 'reconnecting') {
        onRestart();
        return;
      }
      wizard.connect();
    },
    disconnect: async () => {
      setPrefixError(null);
      setPendingRequest(null);
      setPromptHelp(null);
      await wizard.disconnect();
    },
    cancelPendingRequest: () => {
      if (signAbort.current) {
        signAbort.current.abort('Cancelled in Ferry');
        signAbort.current = null;
      }
      setPendingRequest(null);
      setPromptHelp(null);
    },
    setAddress: (next) => {
      const check = validateBchAddressPrefix(
        next.address,
        NETWORK_PROFILE.bch.prefix,
      );
      if (!check.ok) {
        setPrefixError(check.error ?? 'Invalid network prefix');
        return;
      }
      setPrefixError(null);
      setRemembered(saveRememberedBchWallet(wizard.walletName, next));
    },
    forget: () => {
      clearRememberedBchWallet();
      setRemembered(null);
      setPrefixError(null);
      void wizard.disconnect();
    },
    listUtxos: async (): Promise<readonly BchUtxo[]> => {
      if (!address) throw new Error('Connect a BCH wallet first');
      return [];
    },
    signTransaction: async (
      request: BchSignTransactionRequest,
    ): Promise<BchSignedTransaction> => {
      if (!wizard.manager) {
        throw new Error('Connect a WizardConnect wallet first');
      }
      setPendingRequest(request.userPrompt ?? 'Sign the BCH transaction');
      const controller = new AbortController();
      signAbort.current = controller;

      const timer = setTimeout(() => {
        setPromptHelp('Is your phone asleep? Nothing was sent to the network.');
      }, 8000);

      try {
        const response = await wizard.manager.signTransaction(
          {
            transaction: {
              transaction: request.transaction,
              sourceOutputs: request.sourceOutputs,
              ...(request.broadcast !== undefined
                ? { broadcast: request.broadcast }
                : {}),
              ...(request.userPrompt !== undefined
                ? { userPrompt: request.userPrompt }
                : {}),
            } as never,
            inputPaths: [],
          },
          { signal: controller.signal },
        );
        const txHex = response.signedTransaction;
        return { txHex, txid: txidOf(txHex) };
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error(
            'Request cancelled. Nothing was sent to the network. Start again when your wallet is awake.',
            { cause },
          );
        }
        throw cause;
      } finally {
        clearTimeout(timer);
        signAbort.current = null;
        setPendingRequest(null);
        setPromptHelp(null);
      }
    },
    broadcastTransaction: async () => '',
    transactionExists: async () => false,
  };

  const dialog =
    wizard.uri && wizard.qrUri ? (
      <WizardConnectQRDialog
        show={wizard.state === 'connecting'}
        onClose={() => {
          void wizard.disconnect();
        }}
        uri={wizard.uri}
        qrUri={wizard.qrUri}
        title="Connect a BCH wallet"
        subtitle="Scan with Selene, Paytaca or another WizardConnect wallet"
        theme={wizardConnectTheme}
      />
    ) : null;

  return { wallet, dialog };
}

const unavailableEvm: EvmWallet = {
  status: 'unavailable',
  address: null,
  error:
    'EVM wallet connection requires a Reown Project ID (VITE_REOWN_PROJECT_ID)',
  pendingRequest: null,
  connect: () => undefined,
  disconnect: async () => undefined,
  signTypedData: async () => {
    throw new Error('Wallet connect needs a Reown project ID');
  },
  readTokenBalance: async () => 0n,
  refundLock: async () => '0x' as Hex,
  claimLock: async () => '0x' as Hex,
};

function BchWalletSession({
  evm,
  startFresh,
  onRestart,
  children,
}: {
  readonly evm: EvmWallet;
  readonly startFresh: boolean;
  readonly onRestart: () => void;
  readonly children: ReactNode;
}) {
  const { wallet: bch, dialog } = useRealBchWallet(onRestart, startFresh);

  return (
    <WalletContext.Provider value={{ evm, bch, usingMocks: false }}>
      {children}
      {dialog}
    </WalletContext.Provider>
  );
}

export function BchWalletHost({
  evm,
  children,
}: {
  readonly evm: EvmWallet;
  readonly children: ReactNode;
}) {
  const [nonce, setNonce] = useState(0);
  const [startFresh, setStartFresh] = useState(false);
  const restart = () => {
    clearSession();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('wizardconnect-session');
    }
    setStartFresh(true);
    setNonce((current) => current + 1);
  };

  return (
    <BchWalletSession
      key={nonce}
      evm={evm}
      startFresh={startFresh}
      onRestart={restart}
    >
      {children}
    </BchWalletSession>
  );
}

function ConfiguredWalletSet({ children }: { readonly children: ReactNode }) {
  const evm = useRealEvmWallet();
  return <BchWalletHost evm={evm}>{children}</BchWalletHost>;
}

function UnconfiguredWalletSet({ children }: { readonly children: ReactNode }) {
  return <BchWalletHost evm={unavailableEvm}>{children}</BchWalletHost>;
}

export function RealWalletProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {REOWN_PROJECT_ID ? (
          <ConfiguredWalletSet>{children}</ConfiguredWalletSet>
        ) : (
          <UnconfiguredWalletSet>{children}</UnconfiguredWalletSet>
        )}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
