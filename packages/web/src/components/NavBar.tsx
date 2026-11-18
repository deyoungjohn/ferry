import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router';
import { NETWORK_LABEL, IS_MAINNET } from '../lib/config';
import { APP_NAV, PUBLIC_NAV } from '../lib/site-config';
import { OPEN_WALLETS_EVENT } from '../lib/site';
import { useScrolled } from '../lib/useScrolled';
import { useWallets } from '../lib/wallet/context';
import { Brand } from './Brand';
import { GlassPopover } from './GlassPopover';
import { WalletSheet } from './WalletSheet';
import { InfoIcon, WalletIcon } from './icons';

/**
 * Floating navigation pill: clear at the top of the page, glass once the page
 * scrolls under it. Public tabs before a wallet is connected, the app tabs after.
 */
export function NavBar() {
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled(8);
  const { evm, bch } = useWallets();

  const isConnected = evm.status === 'connected' || bch.status === 'connected';
  const links = isConnected ? APP_NAV : PUBLIC_NAV;

  useEffect(() => {
    const open = () => setWalletSheetOpen(true);
    window.addEventListener(OPEN_WALLETS_EVENT, open);
    return () => window.removeEventListener(OPEN_WALLETS_EVENT, open);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  let buttonLabel = 'Connect';
  if (evm.status === 'connected' && bch.status === 'connected') {
    buttonLabel = 'Wallets connected';
  } else if (evm.status === 'connected') {
    buttonLabel = `${evm.address?.slice(0, 6)}…`;
  } else if (bch.status === 'connected') {
    buttonLabel = `${bch.address?.address.slice(0, 10)}…`;
  }

  return (
    <div className="sticky top-0 z-50 px-2 pt-2 sm:px-4 sm:pt-3">
      <header
        className={`relative mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-3 transition-[background,border-color] duration-300 sm:px-4 ${
          scrolled
            ? 'glass glass-nav rounded-full!'
            : 'rounded-full border border-transparent'
        }`}
      >
        <Link to="/" aria-label="Ferry home" className="shrink-0">
          <Brand />
        </Link>

        <nav
          aria-label="Main"
          className="mx-auto hidden items-center gap-1 lg:flex"
        >
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `flex h-10 items-center rounded-full px-4 text-[14px] font-medium transition-colors hover:bg-surface-2 ${
                  isActive ? 'text-text bg-surface-2' : 'text-text-muted'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <GlassPopover
            label="Network details"
            trigger={
              <button
                type="button"
                className="hidden items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:text-text sm:inline-flex"
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
            className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold transition-colors cursor-pointer ${
              isConnected
                ? 'border border-hairline bg-surface-3 text-text hover:border-lime/40'
                : 'bg-lime text-lime-ink hover:opacity-90'
            }`}
          >
            <WalletIcon
              className={`size-4 ${isConnected ? 'text-lime' : 'text-lime-ink'}`}
            />
            <span>{buttonLabel}</span>
          </button>

          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-11 place-items-center rounded-full border border-hairline text-text lg:hidden"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {menuOpen ? '×' : '≡'}
            </span>
          </button>
        </div>

        {menuOpen && (
          <div
            id="mobile-menu"
            className="absolute inset-x-0 top-[72px] rounded-2xl border border-hairline bg-surface-1 p-4 lg:hidden"
          >
            <ul className="grid grid-cols-2 gap-1">
              {links.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-[14px] text-text hover:bg-surface-2"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {/* Rendered at the page root: a glass bar creates its own frame for fixed children. */}
      {createPortal(
        <WalletSheet
          open={walletSheetOpen}
          onClose={() => setWalletSheetOpen(false)}
        />,
        document.body,
      )}
    </div>
  );
}
