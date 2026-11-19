/**
 * Artwork for chains and stablecoins (files in public/brand). A name with no artwork returns null
 * and the page shows its initials instead.
 */
const base = () => import.meta.env.BASE_URL;

const CHAIN_FILES: Record<string, string> = {
  ethereum: 'ethereum.svg',
  base: 'base.svg',
  'base sepolia': 'base.svg',
  bnb: 'bnb.svg',
  'bnb chain': 'bnb.svg',
  bsc: 'bnb.svg',
  arbitrum: 'arbitrum.svg',
  'arbitrum one': 'arbitrum.svg',
  arc: 'arc.jpg',
  robinhood: 'robinhood.png',
  'robinhood chain': 'robinhood.png',
};

const CHAIN_IDS: Record<number, string> = {
  1: 'ethereum.svg',
  8453: 'base.svg',
  84532: 'base.svg',
  56: 'bnb.svg',
  42161: 'arbitrum.svg',
  5042: 'arc.jpg',
  4663: 'robinhood.png',
};

const TOKEN_FILES: Record<string, string> = {
  usdc: 'usdc.svg',
  usdt: 'usdt.svg',
  pusd: 'pusd.svg',
  musd: 'musd.png',
  usdg: 'usdg.svg',
};

/** The artwork of a chain, by name ("Base") or id (8453). */
export function chainIconUrl(chain: string | number): string | null {
  const file =
    typeof chain === 'number'
      ? CHAIN_IDS[chain]
      : (CHAIN_FILES[chain.toLowerCase()] ??
        (/^\d+$/.test(chain) ? CHAIN_IDS[Number(chain)] : undefined));
  return file ? `${base()}brand/chains/${file}` : null;
}

/** The artwork of a stablecoin (also the test tokens such as tPUSD). */
export function tokenIconUrl(symbol: string): string | null {
  const file = TOKEN_FILES[symbol.replace(/^t/i, '').toLowerCase()];
  return file ? `${base()}brand/tokens/${file}` : null;
}
