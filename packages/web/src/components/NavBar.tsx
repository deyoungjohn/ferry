import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { isInternalPath } from './Footer';
import { NETWORK_LABEL, IS_MAINNET } from '../lib/config';
import { APP_NAV, PUBLIC_NAV } from '../lib/site-config';
import { OPEN_WALLETS_EVENT } from '../lib/site';
import { useScrolled } from '../lib/useScrolled';
import { useWallets } from '../lib/wallet/context';
import { Brand } from './Brand';
import { GlassPopover } from './GlassPopover';
import { WalletMenu } from './WalletMenu';
import { InfoIcon } from './icons';

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
  // The tabs follow the page, not the wallet: public pages always show Features, How it works
  // and Stats; the app and shared links show the app tabs.
  const internal = isInternalPath(useLocation().pathname);
  const links = internal ? APP_NAV : PUBLIC_NAV;

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

  return (
    <div className="sticky top-0 z-50 px-2 pt-2 sm:px-4 sm:pt-3">
      <header
        className={`relative mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-3 transition-[background,border-color] duration-300 sm:px-4 ${
          scrolled
            ? 'glass-nav site-bar glass-pop--dark rounded-full border'
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
                `flex h-10 items-center rounded-full px-4 text-[14px] font-medium transition-colors hover:bg-[var(--hl-soft)] ${
                  isActive
                    ? 'text-text bg-[var(--hl)] shadow-[inset_0_0_0_1px_var(--hl-edge)]'
                    : 'text-text-muted'
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
                  className="size-1.5 rounded-full bg-ok"
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

          {isConnected && !internal && (
            <Link
              to={APP_NAV[0]!.to}
              className="hidden h-11 items-center rounded-full border border-hairline px-5 text-[14px] font-medium text-text transition-colors hover:bg-[var(--hl-soft)] sm:inline-flex"
            >
              Open app
            </Link>
          )}

          <WalletMenu
            open={walletSheetOpen}
            onOpenChange={setWalletSheetOpen}
          />

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
    </div>
  );
}
