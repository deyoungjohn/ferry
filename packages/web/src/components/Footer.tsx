import { Link, useLocation } from 'react-router';
import { Brand } from './Brand';
import { SITE, footerColumns, mainnetLinks } from '../lib/site-config';

/**
 * Footer on every page: brand and tagline, link columns that match the
 * navigation, a copyright row, the name large and quiet, and the fine print.
 */
/** The app and shared links are inside the product; the big name belongs to the public pages. */
export function isInternalPath(pathname: string): boolean {
  return (
    pathname === '/app' ||
    pathname.startsWith('/app/') ||
    pathname.startsWith('/pay/') ||
    pathname.startsWith('/send/')
  );
}

export function Footer() {
  const columns = footerColumns();
  const mainnet = mainnetLinks();
  const internal = isInternalPath(useLocation().pathname);
  return (
    <footer className="mt-24 border-t border-hairline">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_repeat(3,1fr)_1.1fr]">
        <div>
          <Brand />
          <p className="mt-4 max-w-[30ch] text-[14px] leading-6 text-text-muted">
            {SITE.tagline}
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <p className="text-[14px] font-medium text-text-muted">
              {column.title}
            </p>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a
                      href={link.to}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[14px] text-text hover:text-lime"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      to={link.to}
                      className="text-[14px] text-text hover:text-lime"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div data-testid="footer-mainnet">
          <p className="text-[14px] font-medium text-text-muted">
            Mainnet contracts
          </p>
          <div className="mt-3">
            <ul className="space-y-2">
              {mainnet.contracts.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[14px] text-text hover:text-lime"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1240px] items-center justify-between border-t border-hairline px-4 py-6 text-[13px] text-text-muted sm:px-6">
        <span>{SITE.copyright}</span>
        {SITE.repo && (
          <a
            href={SITE.repo}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-text"
          >
            GitHub
          </a>
        )}
      </div>

      <div className="mx-auto max-w-[1240px] overflow-hidden px-4 pt-6 pb-10 sm:px-6">
        {!internal && (
          <p
            aria-hidden="true"
            className="flex select-none items-end justify-center text-[clamp(72px,19vw,260px)] leading-[0.8] font-semibold tracking-[-0.04em] text-lime [font-variant-caps:all-small-caps]"
          >
            {SITE.bigWord}
            <span className="mb-[0.06em] ml-[0.04em] inline-block size-[0.14em] rounded-full bg-lime" />
          </p>
        )}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 text-[13px] font-light text-text-muted ${internal ? '' : 'mt-6 border-t border-hairline pt-5'}`}
        >
          <p>{SITE.finePrintLeft}</p>
          <p>{SITE.finePrintRight}</p>
        </div>
      </div>
    </footer>
  );
}
