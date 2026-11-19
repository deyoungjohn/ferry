import { BANNER_CONFIG } from './config';
import { ROUTES } from './routes';

/** Everything the navigation bar and the footer show, in one place, so the two never disagree. */
export const SITE = {
  name: 'Ferry',
  tagline:
    'Move stablecoins into Bitcoin Cash seamlessly. Atomic, non-custodial and recoverable',
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
        { label: 'Route status', to: '/status' },
        ...(SITE.repo
          ? [{ label: 'GitHub', to: SITE.repo, external: true }]
          : []),
      ],
    },
  ];
}
