/** Public origin of the site, used for links people share. */
export const SITE_URL: string =
  (import.meta.env?.VITE_SITE_URL as string | undefined) ??
  'https://ferry.incepture.dev';

/** Absolute URL for a path on this site. Uses the page's own origin when running in a browser. */
export function siteUrl(path: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : SITE_URL;
  return `${origin}${path}`;
}

export const OPEN_WALLETS_EVENT = 'ferry:open-wallets';

/** Ask the navigation bar to open the wallet sheet. */
export function requestWalletSheet(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_WALLETS_EVENT));
  }
}
