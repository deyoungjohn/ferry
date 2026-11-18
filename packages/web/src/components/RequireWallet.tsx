import { useContext, type ReactNode } from 'react';
import { WalletContext } from '../lib/wallet/context';
import { requestWalletSheet } from '../lib/site';

interface RequireWalletProps {
  /** What the visitor is about to use, for the message. */
  feature: string;
  children: ReactNode;
}

/** Shows its children only when at least one wallet is connected. */
export function RequireWallet({ feature, children }: RequireWalletProps) {
  const wallets = useContext(WalletContext);
  const connected =
    wallets?.evm.status === 'connected' || wallets?.bch.status === 'connected';

  if (connected) return <>{children}</>;

  return (
    <section
      aria-labelledby="wallet-gate-title"
      className="mx-auto mt-16 max-w-md px-4"
    >
      <div
        data-testid="wallet-gate"
        className="rounded-card border border-hairline bg-surface-1/60 p-8 text-center"
      >
        <h1
          id="wallet-gate-title"
          className="text-xl font-semibold tracking-[-0.02em] text-text"
        >
          Connect a wallet to use {feature}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          Ferry never holds your money. Your wallet signs each step, so connect
          one to continue. You can read how it works without connecting.
        </p>
        <button
          type="button"
          onClick={requestWalletSheet}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-pill bg-lime px-6 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
        >
          Connect wallet
        </button>
      </div>
    </section>
  );
}
