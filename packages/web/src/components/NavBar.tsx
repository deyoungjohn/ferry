import { useState } from 'react';
import { Link } from 'react-router';
import { BANNER_CONFIG, NETWORK_LABEL, IS_MAINNET } from '../lib/config';
import { GlassNav } from './GlassNav';
import { GlassPopover } from './GlassPopover';
import { GlassModal } from './GlassModal';
import { InfoIcon, WalletIcon } from './icons';

export function NavBar() {
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  return (
    <GlassNav>
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
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
            <a
              href="#how-it-works"
              className="text-sm text-text-muted transition-colors hover:text-text"
            >
              How it works
            </a>
            <a
              href="#faq"
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
                className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-2.5 py-1.5 text-[11px] text-text-muted transition-colors hover:text-text sm:px-3"
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
            onClick={() => setWalletModalOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={walletModalOpen}
            className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-text px-3.5 text-xs font-semibold text-bg transition-colors hover:bg-lime hover:text-lime-ink sm:px-4 cursor-pointer"
          >
            <WalletIcon className="size-3.5" />
            Connect
          </button>
        </div>
      </nav>

      <GlassModal
        open={walletModalOpen}
        onOpenChange={setWalletModalOpen}
        title="Connect Wallet"
        description="Select a wallet to begin swapping stablecoins."
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-hairline bg-surface-2 p-3 text-xs text-text-muted">
            <p className="font-medium text-text">Mock Interface Active</p>
            <p className="mt-1 text-text-dim">
              Wallet connections and live settlement arrive in the subsequent
              phase. No funds move in this mock shell.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWalletModalOpen(false)}
            className="w-full rounded-pill bg-surface-3 py-2 text-xs font-medium text-text hover:bg-surface-2 transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </GlassModal>
    </GlassNav>
  );
}
