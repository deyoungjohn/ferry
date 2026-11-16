import { useState } from 'react';
import { Link } from 'react-router';
import { BANNER_CONFIG, NETWORK_LABEL, IS_MAINNET } from '../lib/config';
import { GlassNav } from './GlassNav';
import { GlassPopover } from './GlassPopover';
import { WalletSheet } from './WalletSheet';
import { useWallets } from '../lib/wallet/context';
import { InfoIcon, WalletIcon } from './icons';

export function NavBar() {
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const { evm, bch } = useWallets();

  const isConnected = evm.status === 'connected' || bch.status === 'connected';

  let buttonLabel = 'Connect';
  if (evm.status === 'connected' && bch.status === 'connected') {
    buttonLabel = 'Wallets connected';
  } else if (evm.status === 'connected') {
    buttonLabel = `${evm.address?.slice(0, 6)}…`;
  } else if (bch.status === 'connected') {
    buttonLabel = `${bch.address?.address.slice(0, 10)}…`;
  }

  return (
    <GlassNav>
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <div className="flex items-center gap-8">
          <Link
            to="/"
            aria-label="Ferry home"
            className="text-[1.35rem] font-semibold tracking-[-0.04em] text-text hover:text-lime transition-colors"
          >
            Ferry<span className="text-lime">.</span>
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            <Link
              to="/pay-links"
              className="text-sm text-text-muted transition-colors hover:text-text"
            >
              Pay links
            </Link>
            <Link
              to="/activity"
              className="text-sm text-text-muted transition-colors hover:text-text"
            >
              My Activity
            </Link>
            <Link
              to="/recover"
              className="text-sm text-text-muted transition-colors hover:text-text"
            >
              Recover a swap
            </Link>
            <a
              href="/#how-it-works"
              className="text-sm text-text-muted transition-colors hover:text-text"
            >
              How it works
            </a>
            <a
              href="/#faq"
              className="text-sm text-text-muted transition-colors hover:text-text"
            >
              FAQ
            </a>
            {BANNER_CONFIG.repoUrl && (
              <a
                href={BANNER_CONFIG.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-text-muted transition-colors hover:text-text"
              >
                GitHub
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <GlassPopover
            label="Network details"
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:text-text sm:px-3"
              >
                <span
                  className="size-1.5 rounded-full bg-ok shadow-[0_0_10px_var(--ok)]"
                  aria-hidden="true"
                />
                {NETWORK_LABEL}
                <InfoIcon className="size-3 text-text-muted" />
              </button>
            }
          >
            <p className="font-medium text-text">
              Network Profile: {NETWORK_LABEL}
            </p>
            <p className="mt-1">
              {IS_MAINNET
                ? 'Mainnet. Balances, signatures and transactions use real funds and cannot be reversed.'
                : 'This environment runs on test networks only. Balances and addresses here do not use real funds.'}
            </p>
          </GlassPopover>

          <button
            type="button"
            onClick={() => setWalletSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={walletSheetOpen}
            className={`inline-flex h-8 items-center gap-1.5 rounded-pill px-3.5 text-xs font-semibold transition-colors cursor-pointer sm:px-4 ${
              isConnected
                ? 'bg-surface-3 text-text border border-hairline hover:border-lime/40'
                : 'bg-text text-bg hover:bg-lime hover:text-lime-ink'
            }`}
          >
            <WalletIcon className="size-3.5 text-lime" />
            <span>{buttonLabel}</span>
          </button>
        </div>
      </nav>

      <WalletSheet
        open={walletSheetOpen}
        onClose={() => setWalletSheetOpen(false)}
      />
    </GlassNav>
  );
}
