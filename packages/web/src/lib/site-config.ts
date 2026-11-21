import { BANNER_CONFIG } from './config';
import { ROUTES } from './routes';
import chainsData from '../../../chain-config/src/data/chains.json';

/** Everything the navigation bar and the footer show, in one place, so the two never disagree. */
export const SITE = {
  name: 'Ferry',
  tagline:
    'Move stablecoins in and out of Bitcoin Cash seamlessly. It’s atomic, non-custodial and recoverable.',
  bigWord: 'ferry',
  copyright: `© ${new Date().getFullYear()} Ferry`,
  finePrintLeft: 'Built for BCH BLAZE 2026. Trust-minimised swaps.',
  finePrintRight: 'MIT licensed',
  repo: BANNER_CONFIG.repoUrl || null,
};

export interface NavItem {
  readonly label: string;
  readonly to: string;
}

/** Shown to everyone before a wallet is connected. */
export const PUBLIC_NAV: readonly NavItem[] = [
  { label: 'Features', to: '/features' },
  { label: 'How it works', to: '/how-it-works' },
  { label: 'Stats', to: '/stats' },
];

/** Shown once a wallet is connected. The guide and GitHub live in the footer. */
export const APP_NAV: readonly NavItem[] = [
  { label: 'Swap', to: ROUTES.swap },
  { label: 'Pay link', to: ROUTES.payLink },
  { label: 'My activity', to: ROUTES.activity },
  { label: 'Recover', to: ROUTES.recover },
];

export interface FooterColumn {
  readonly title: string;
  readonly links: readonly (NavItem & { readonly external?: boolean })[];
}

export function footerColumns(): readonly FooterColumn[] {
  return [
    {
      title: 'Ferry',
      links: [
        { label: 'Features', to: '/features' },
        { label: 'How it works', to: '/how-it-works' },
        { label: 'Stats', to: '/stats' },
      ],
    },
    {
      title: 'App',
      links: [
        { label: 'Swap', to: ROUTES.swap },
        { label: 'Pay link', to: ROUTES.payLink },
        { label: 'My activity', to: ROUTES.activity },
        { label: 'Recover', to: ROUTES.recover },
      ],
    },
    {
      title: 'Help',
      links: [
        { label: 'User guide', to: ROUTES.guide },
        { label: 'FAQ', to: '/how-it-works#faq' },
        { label: 'Route status', to: '/status' },
        ...(SITE.repo
          ? [{ label: 'GitHub', to: SITE.repo, external: true }]
          : []),
      ],
    },
  ];
}

/** The solver's wallets, which every quote shows as the other side of a swap. */
export const SOLVER_WALLETS = {
  evm: '0xD372Bf9fbE4188F041Bca5d77c7871A22CF17a5a',
  bch: 'bitcoincash:zzjkfjw2e9z58a8dwpw7dm8kh79ukhf2s502cxddkm',
  bchExplorer: 'https://bchexplorer.info/address/',
} as const;

const CHAIN_LABEL: Readonly<Record<string, string>> = {
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum One',
  bnb: 'BNB Chain',
  arc: 'Arc',
  robinhood: 'Robinhood Chain',
};

export interface MainnetLink {
  readonly label: string;
  readonly href: string;
}

/** The mainnet contract and solver wallets, each linking to its explorer page. */
export function mainnetLinks(): {
  readonly contracts: readonly MainnetLink[];
  readonly wallets: readonly MainnetLink[];
} {
  const chains = (
    chainsData as unknown as {
      chains: Record<
        string,
        {
          mainnet: {
            explorerUrl: string;
            deployment?: { htlcAddress?: string };
          };
        }
      >;
    }
  ).chains;
  const contracts: MainnetLink[] = [];
  // Bitcoin Cash locks are one covenant per swap (its address comes from the swap's terms), so
  // there is no single address to show: the source is linked instead.
  const covenant = SITE.repo
    ? [
        {
          label: 'Bitcoin Cash covenant (source)',
          href: `${SITE.repo.replace(/\/+$/, '')}/blob/main/packages/htlc-bch/contracts/FerryHTLC.cash`,
        },
      ]
    : [];
  const wallets: MainnetLink[] = [
    {
      label: 'Bitcoin Cash',
      href: `${SOLVER_WALLETS.bchExplorer}${SOLVER_WALLETS.bch}`,
    },
  ];
  for (const [key, label] of Object.entries(CHAIN_LABEL)) {
    const mainnet = chains[key]?.mainnet;
    if (!mainnet) continue;
    const base = mainnet.explorerUrl.replace(/\/+$/, '');
    const htlc = mainnet.deployment?.htlcAddress;
    if (htlc) contracts.push({ label, href: `${base}/address/${htlc}` });
    wallets.push({ label, href: `${base}/address/${SOLVER_WALLETS.evm}` });
  }
  return { contracts: [...contracts, ...covenant], wallets };
}
