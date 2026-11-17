import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { BANNER_CONFIG, NETWORK_LABEL, IS_MAINNET } from '../lib/config';
import { GlassNav } from './GlassNav';
import { GlassPopover } from './GlassPopover';
import { WalletSheet } from './WalletSheet';
import { useWallets } from '../lib/wallet/context';
import { InfoIcon, WalletIcon } from './icons';
import { OPEN_WALLETS_EVENT } from '../lib/site';
import { ROUTES } from '../lib/routes';

const PUBLIC_NAV = [
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/proof', label: 'Proof' },
] as const;

const APP_NAV = [
  { to: ROUTES.swap, label: 'Swap' },
  { to: ROUTES.payLink, label: 'Pay link' },
  { to: ROUTES.activity, label: 'My activity' },
  { to: ROUTES.recover, label: 'Recover' },
  { to: ROUTES.guide, label: 'User guide' },
] as const;

export function NavBar() {
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const { evm, bch } = useWallets();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const open = () => setWalletSheetOpen(true);
    window.addEventListener(OPEN_WALLETS_EVENT, open);
    return () => window.removeEventListener(OPEN_WALLETS_EVENT, open);
  }, []);

  const isConnected = evm.status === 'connected' || bch.status === 'connected';
  const NAV_LINKS = isConnected ? APP_NAV : PUBLIC_NAV;

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

          <div className="hidden items-center gap-5 lg:flex">
            {NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `text-sm transition-colors hover:text-text ${
                    isActive ? 'text-text' : 'text-text-muted'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
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

      <div className="lg:hidden border-t border-hairline">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((v) => !v)}
          className="mx-auto flex h-10 w-full max-w-6xl items-center justify-between px-4 text-xs text-text-muted sm:px-6"
        >
          <span>Menu</span>
          <span aria-hidden="true">{menuOpen ? '–' : '+'}</span>
        </button>
        {menuOpen && (
          <ul
            id="mobile-menu"
            className="mx-auto max-w-6xl space-y-1 px-4 pb-3 sm:px-6"
          >
            {NAV_LINKS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-2 py-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <WalletSheet
        open={walletSheetOpen}
        onClose={() => setWalletSheetOpen(false)}
      />
    </GlassNav>
  );
}
