/**
 * Base Path & URL Formatting Utilities
 *
 * Supports serving Ferry Web UI either at the root ('/') or under a subpath
 * (such as '/swap/' in production, alongside a root landing page at '/').
 * Also supports standalone IPFS hash routing when VITE_ROUTER=hash.
 */

export function resolveBasePath(raw?: string, isHash = false): string {
  if (isHash) {
    return './';
  }
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === '/' || trimmed === './') {
    return trimmed === './' ? './' : '/';
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export function getBasePath(): string {
  const isHash =
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_ROUTER === 'hash';
  const raw =
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_BASE_PATH as string | undefined)
      : undefined) ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env?.BASE_URL as string | undefined)
      : undefined);
  return resolveBasePath(raw, isHash);
}

export function getRouterBasename(): string | undefined {
  const isHash =
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_ROUTER === 'hash';
  if (isHash) {
    return undefined;
  }
  const base = getBasePath();
  if (base === '/' || base === './') {
    return undefined;
  }
  return base.replace(/\/+$/, '');
}

export function getLandingUrl(): string {
  const envUrl =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_LANDING_URL as string | undefined)?.trim()
      : undefined;
  return envUrl && envUrl.length > 0 ? envUrl : '/';
}

/**
 * Prepends the configured base path to an absolute application path.
 * Avoids duplicate base paths.
 */
export function withBasePath(path: string): string {
  const base = getBasePath();
  if (base === '/' || base === './') {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;

  if (cleanPath === cleanBase || cleanPath === `${cleanBase}/`) {
    return `${cleanBase}/`;
  }

  // Handle collision when cleanBase is '/swap' and route is '/swap/:orderId'
  if (cleanBase === '/swap') {
    if (cleanPath.startsWith('/swap/swap/')) {
      return cleanPath;
    }
    if (cleanPath.startsWith('/swap/')) {
      const afterSwap = cleanPath.slice('/swap/'.length);
      const isKnownSubpath =
        afterSwap.startsWith('status') ||
        afterSwap.startsWith('help') ||
        afterSwap.startsWith('recover') ||
        afterSwap.startsWith('pay-links') ||
        afterSwap.startsWith('send-links') ||
        afterSwap.startsWith('p/') ||
        afterSwap.startsWith('s/') ||
        afterSwap.startsWith('assets/') ||
        afterSwap.startsWith('favicon') ||
        afterSwap.startsWith('glass/');
      if (isKnownSubpath) {
        return cleanPath;
      }
      return `/swap${cleanPath}`;
    }
  }

  if (cleanPath.startsWith(`${cleanBase}/`)) {
    return cleanPath;
  }
  return `${cleanBase}${cleanPath}`;
}

/**
 * Formats a fully-qualified shareable URL (for copy buttons, QR codes, pay links, send links).
 * Uses window.location.origin in the browser, with https://ferry.cash fallback for SSR/testing.
 */
export function formatAppUrl(path: string): string {
  const isHash =
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_ROUTER === 'hash';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    if (isHash) {
      const base = getBasePath();
      const basePrefix =
        base === './' || base === '/' ? '' : base.replace(/\/+$/, '');
      return `${origin}${basePrefix}/#${cleanPath}`;
    }
    const fullPath = withBasePath(cleanPath);
    return `${origin}${fullPath}`;
  }

  const defaultDomain = 'https://ferry.cash';
  const fullPath = withBasePath(cleanPath);
  return `${defaultDomain}${fullPath}`;
}

export function payLinkUrl(id: string): string {
  return formatAppUrl(`/p/${id}`);
}

export function sendLinkUrl(id: string): string {
  return formatAppUrl(`/s/${id}`);
}

export function swapStatusUrl(orderId: string): string {
  return formatAppUrl(`/swap/${orderId}`);
}

export function routeStatusUrl(): string {
  return formatAppUrl('/status');
}

export function recoveryPageUrl(): string {
  return formatAppUrl('/recover');
}

export function helpPageUrl(): string {
  return formatAppUrl('/help');
}
