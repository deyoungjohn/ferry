import {
  useState,
  useEffect,
  lazy,
  Suspense,
  useMemo,
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

  if (!activated) {
    return (
      <WalletContext.Provider value={inertValue}>
        {children}
      </WalletContext.Provider>
    );
  }

  return (
    <Suspense fallback={<WalletLoading />}>
      <RealWalletProvider>{children}</RealWalletProvider>
    </Suspense>
  );
}
