import { useAppKit } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clearSession } from '@wizardconnect/dapp';
import { useWizardConnect } from '@wizardconnect/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
  WagmiProvider,
} from 'wagmi';
import {
  NETWORK_PROFILE,
  REOWN_PROJECT_ID,
  WIZARD_RELAY_URLS,
} from '../config';
import { plainWalletMessage } from '@ferry/user-flow';
import { BchPairingDialog } from '../../components/BchPairingDialog';
import { WalletContext } from './context';
import { wagmiConfig } from './evm-config';
import { validateBchAddressPrefix } from './chain';
import { useBchReconnectTimeout } from './reconnect-timeout';
import { revokeAccountAccess } from './revoke';
import { wizardSignParams } from './wizard-sign';
import { addressFromPubkey } from '../bch/address';
import { scanFundingAddresses } from './funding-scan';
import {
  clearRememberedBchWallet,
  readRememberedBchWallet,
  saveRememberedBchWallet,
  type RememberedBchWallet,
} from './remembered';
import type { WizardConnectSignRequest } from '@ferry/htlc-bch';
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
  const {
    address,
    chainId,
    connector,
    isConnected,
    isConnecting,
    isReconnecting,
  } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { open } = useAppKit();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

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
      // Taken before disconnecting: afterwards the connector no longer hands it out.
      const provider = await connector?.getProvider?.().catch(() => null);
      await disconnectAsync();
      await revokeAccountAccess(provider);
      setPendingRequest(null);
      setPromptHelp(null);
    },
    switchChain: async (target: number) => {
      await switchChainAsync({ chainId: target });
    },
    cancelPendingRequest,
    signTypedData: async (params: TypedDataDefinition) => {
      if (params.primaryType === 'RecoveryKey') {
        setPendingRequest('Sign the Ferry recovery message');
        setPromptHelp(
          'Sign the Ferry recovery message to enable key-based swap recovery on any device without files',
        );
      } else {
        setPendingRequest(
          params.primaryType === 'Permit'
            ? 'Sign the token permit'
            : 'Sign the lock intent',
        );
      }
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
        setError(
          plainWalletMessage(cause).replace(/ Nothing was locked\.$/, ''),
        );
        throw cause;
      } finally {
        clearTimeout(timer);
        evmAbortRef.current = null;
        setPendingRequest(null);
        setPromptHelp(null);
      }
    },
    sendTransaction: async (tx) => {
      setPendingRequest('Confirm the transaction in your wallet');
      const controller = new AbortController();
      evmAbortRef.current = controller;
      try {
        const hash = await sendTransactionAsync({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          chainId: tx.chainId,
        } as never);
        return hash as Hex;
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error(
            'Request cancelled. Nothing was sent to the network.',
            { cause },
          );
        }
        setError(
          plainWalletMessage(cause).replace(/ Nothing was locked\.$/, ''),
        );
        throw cause;
      } finally {
        evmAbortRef.current = null;
        setPendingRequest(null);
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
  const wizard = useWizardConnect({
    dappName: 'Ferry',
    ...(WIZARD_RELAY_URLS.length > 0
      ? { relayUrls: [...WIZARD_RELAY_URLS] }
      : {}),
  });
  const connectRef = useRef(wizard.connect);
  const connectStartedAt = useRef(0);
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
  const [userStarted, setUserStarted] = useState(startFresh);
  const [dialogOpen, setDialogOpen] = useState(startFresh);
  const [pairingFailed, setPairingFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<string | null>(null);

  // Cleared only by a completed connection: a pairing can pass through "disconnected" (a relay
  // reconnect) and back to "connecting" while its QR is on screen.
  useEffect(() => {
    if (wizard.state === 'connected') {
      setUserStarted(false);
      setDialogOpen(false);
      setPairingFailed(false);
      setFailureReason(null);
    }
  }, [wizard.state]);

  const reconnectTimedOut = useBchReconnectTimeout(
    wizard.state,
    () => wizard.disconnect(),
    8000,
    // Never while a pairing link (the QR) exists: it waits for the scan.
    !userStarted && !wizard.uri,
  );

  // Detect failed or dropped pairings
  useEffect(() => {
    if (!userStarted) return;
    if (wizard.error) {
      setPairingFailed(true);
      setFailureReason(wizard.error);
    } else if (wizard.state === 'disconnected') {
      setPairingFailed(true);
      setFailureReason(
        'The pairing connection was dropped. The wallet or relay disconnected.',
      );
    } else if (reconnectTimedOut) {
      setPairingFailed(true);
      setFailureReason('Pairing attempt timed out. The relay was unreachable.');
    }
  }, [userStarted, wizard.state, wizard.error, reconnectTimedOut]);

  const showQrAgain = useCallback(() => {
    setPairingFailed(false);
    setFailureReason(null);
    setUserStarted(true);
    setDialogOpen(true);
    connectStartedAt.current = Date.now();
    // Clear active relay session and re-initiate fresh pairing without leaving dialog
    void Promise.resolve(wizard.disconnect()).then(() => {
      try {
        const ok = wizard.connect();
        if (!ok && wizard.error) {
          setPairingFailed(true);
          setFailureReason(wizard.error);
        }
      } catch (err) {
        setPairingFailed(true);
        setFailureReason(
          err instanceof Error ? err.message : 'Connection failed at once.',
        );
      }
    });
  }, [wizard]);

  const reconnectWallet = useCallback(() => {
    setPairingFailed(false);
    setFailureReason(null);
    clearRememberedBchWallet();
    setRemembered(null);
    setUserStarted(true);
    setDialogOpen(true);
    onRestart();
  }, [onRestart]);

  const signAbort = useRef<AbortController | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [promptHelp, setPromptHelp] = useState<string | null>(null);
  const [prefixError, setPrefixError] = useState<string | null>(null);

  const [remembered, setRemembered] = useState<RememberedBchWallet | null>(() =>
    readRememberedBchWallet(),
  );

  // Derive the address from the wallet's first public key. The key can arrive a moment after the
  // wallet reports ready, so it is read again every 200 ms for up to 10 seconds; reading it once
  // at the event left a paired wallet without an address.
  const [derived, setDerived] = useState<BchAddressInfo | null>(null);
  useEffect(() => {
    if (wizard.state !== 'connected' || !wizard.manager) {
      setDerived(null);
      return;
    }
    const manager = wizard.manager;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (stopped) return;
      try {
        const pubkey = manager.getPubkey(0, 0n);
        if (pubkey) {
          setDerived({ ...addressFromPubkey(pubkey), index: 0 });
          return;
        }
      } catch {
        // not there yet
      }
      tries += 1;
      if (tries < 50) timer = setTimeout(attempt, 200);
    };
    attempt();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
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
    pairingFailed,
    pendingRequest,
    promptHelp,
    showQrAgain,
    reconnectWallet,
    connect: () => {
      setPrefixError(null);
      setPairingFailed(false);
      setFailureReason(null);
      setUserStarted(true);
      setDialogOpen(true);
      connectStartedAt.current = Date.now();
      // Normal case: open the QR dialog directly. A stale restored
      // attempt needs the clear-and-remount path to offer fresh QR, and so does a session the
      // library calls connected but that never gave an address (connect would be ignored).
      if (
        wizard.state === 'connecting' ||
        wizard.state === 'reconnecting' ||
        (wizard.state === 'connected' && !address)
      ) {
        onRestart();
        return;
      }
      try {
        const ok = wizard.connect();
        if (!ok && wizard.error) {
          setPairingFailed(true);
          setFailureReason(wizard.error);
        }
      } catch (err) {
        setPairingFailed(true);
        setFailureReason(
          err instanceof Error ? err.message : 'Connection failed at once.',
        );
      }
    },
    disconnect: async () => {
      setPrefixError(null);
      setPairingFailed(false);
      setFailureReason(null);
      setDialogOpen(false);
      setUserStarted(false);
      setPendingRequest(null);
      setPromptHelp(null);
      await wizard.disconnect();
    },
    cancelPendingRequest: () => {
      if (scanAbort.current) {
        scanAbort.current.abort('Cancelled in Ferry');
        scanAbort.current = null;
      }
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
      const manager = wizard.manager;
      if (!manager) return [];
      const scanResult = await scanFundingAddresses({
        getPubkey: (childIndex, index) => manager.getPubkey(childIndex, index),
        startIndex: address.index ?? 0,
        sessionKey: address.address ?? wizard.walletName ?? undefined,
      });
      return scanResult.utxos;
    },
    listFundingAddresses: async () => {
      const manager = wizard.manager;
      if (!manager) return [];
      setPendingRequest("Checking your wallet's addresses…");
      const controller = new AbortController();
      scanAbort.current = controller;
      try {
        const scanResult = await scanFundingAddresses({
          getPubkey: (childIndex, index) =>
            manager.getPubkey(childIndex, index),
          startIndex: address?.index ?? 0,
          signal: controller.signal,
          sessionKey: address?.address ?? wizard.walletName ?? undefined,
          onProgress: (p) => setPendingRequest(p.message),
        });
        if (scanResult.message) {
          setPromptHelp(scanResult.message);
        }
        return scanResult.addresses;
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error(
            'Request cancelled. Nothing was sent to the network.',
            { cause },
          );
        }
        throw cause;
      } finally {
        scanAbort.current = null;
        setPendingRequest(null);
      }
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
    signWizardRequest: async (request: WizardConnectSignRequest) => {
      if (!wizard.manager) {
        throw new Error('Connect a WizardConnect wallet first');
      }
      setPendingRequest(
        request.transaction.userPrompt ?? 'Sign the Bitcoin Cash lock',
      );
      const controller = new AbortController();
      signAbort.current = controller;
      const timer = setTimeout(() => {
        setPromptHelp('Is your phone asleep? Nothing was sent to the network.');
      }, 8000);
      try {
        const response = await wizard.manager.signTransaction(
          wizardSignParams(request) as never,
          { signal: controller.signal },
        );
        return response.signedTransaction;
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

  const dialog = (
    <BchPairingDialog
      open={dialogOpen && wizard.state !== 'connected'}
      onClose={() => {
        if (Date.now() - connectStartedAt.current < 1200) return;
        setDialogOpen(false);
        setUserStarted(false);
        setPairingFailed(false);
        setFailureReason(null);
        void wizard.disconnect();
      }}
      uri={wizard.uri}
      qrUri={wizard.qrUri}
      state={wizard.state}
      pairingFailed={pairingFailed}
      failureReason={failureReason}
      onShowQrAgain={showQrAgain}
      onReconnect={reconnectWallet}
    />
  );

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
