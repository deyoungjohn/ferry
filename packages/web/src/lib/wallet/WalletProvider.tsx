import {
  useState,
  useEffect,
  lazy,
  Suspense,
  useMemo,
  useContext,
  type ReactNode,
} from 'react';
const MockWalletProvider = lazy(async () => {
  const module = await import('./mock');
  return { default: module.MockWalletProvider };
});
import { WalletContext } from './context';
import type { WalletSet } from './types';
import type { Hex } from 'viem';

const RealWalletProvider = lazy(async () => {
  const module = await import('./real');
  return { default: module.RealWalletProvider };
});

function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes('wagmi') ||
          key.includes('wizardconnect') ||
          key.includes('appkit') ||
          key.includes('@w3m'))
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function useMockMode(): boolean {
  if (
    import.meta.env?.VITE_MOCK === '1' ||
    import.meta.env?.VITE_USE_MOCKS === '1'
  )
    return true;
  return false;
}

function WalletLoading() {
  return (
    <div className="grid min-h-[40px] place-items-center" role="status">
      <span className="text-xs text-text-muted">Loading wallet...</span>
    </div>
  );
}

export function WalletProvider({ children }: { readonly children: ReactNode }) {
  const mock = useMockMode();
  const [activated, setActivated] = useState<boolean>(() => {
    if (mock) return true;
    return hasStoredSession();
  });

  useEffect(() => {
    function handleActivate() {
      setActivated(true);
    }
    window.addEventListener('ferry:activate-wallets', handleActivate);
    return () => {
      window.removeEventListener('ferry:activate-wallets', handleActivate);
    };
  }, []);

  const [real, setReal] = useState<WalletSet | null>(null);
  // Created once: a new element each render would re-render the host and loop through the bridge.
  const realHost = useMemo(
    () => (
      <RealWalletProvider>
        <WalletBridge onValue={setReal} />
      </RealWalletProvider>
    ),
    [],
  );

  const inertValue: WalletSet = useMemo(() => {
    return {
      evm: {
        status: 'disconnected',
        address: null,
        chainId: undefined,
        error: null,
        pendingRequest: null,
        connect: () => {
          setActivated(true);
        },
        disconnect: async () => {},
        signTypedData: async () => {
          setActivated(true);
          throw new Error('Wallet not activated');
        },
        readTokenBalance: async () => 0n,
        refundLock: async () => '0x' as Hex,
        claimLock: async () => '0x' as Hex,
      },
      bch: {
        status: 'disconnected',
        address: null,
        error: null,
        walletName: null,
        pendingRequest: null,
        connect: () => {
          setActivated(true);
        },
        disconnect: async () => {},
        cancelPendingRequest: () => {},
        setAddress: () => {},
        listUtxos: async () => [],
        signTransaction: async () => {
          setActivated(true);
          throw new Error('Wallet not activated');
        },
        broadcastTransaction: async () => '',
        transactionExists: async () => false,
      },
      usingMocks: false,
    };
  }, []);

  if (mock) {
    return (
      <Suspense fallback={<WalletLoading />}>
        <MockWalletProvider>{children}</MockWalletProvider>
      </Suspense>
    );
  }

  // One stable tree. The real wallet code is rendered BESIDE the page and hands its value up
  // through a bridge; swapping the page's own parent would unmount and remount the whole page
  // (and close the Connect dialog the moment it opened).
  return (
    <WalletContext.Provider
      value={activated ? (real ?? inertValue) : inertValue}
    >
      {children}
      {activated && <Suspense fallback={null}>{realHost}</Suspense>}
    </WalletContext.Provider>
  );
}

/** Reads the real wallet value from inside the real provider and passes it up. */
function WalletBridge({
  onValue,
}: {
  readonly onValue: (value: WalletSet) => void;
}) {
  const value = useContext(WalletContext);
  useEffect(() => {
    if (value) onValue(value);
  }, [value, onValue]);
  return null;
}
