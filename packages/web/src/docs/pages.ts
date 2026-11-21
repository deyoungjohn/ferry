/** The docs: groups and pages in sidebar order. Each page's text is `content/<slug>.md`. */

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}

export interface DocGroup {
  readonly title: string;
  readonly pages: readonly DocPage[];
}

export const DOC_GROUPS: readonly DocGroup[] = [
  {
    title: 'Getting started',
    pages: [
      {
        slug: 'welcome',
        title: 'Ferry Documentation',
        description:
          'Documentation for Ferry, atomic stablecoin swaps between six EVM chains and Bitcoin Cash.',
      },
      {
        slug: 'what-is-ferry',
        title: 'What Ferry is',
        description: 'The problem, the idea, and what Ferry is not.',
      },
      {
        slug: 'quickstart',
        title: 'Quickstart',
        description: 'Your first swap in about a minute.',
      },
      {
        slug: 'chains-and-tokens',
        title: 'Chains, tokens and contracts',
        description:
          'Every supported chain and stablecoin, and the mainnet contract addresses.',
      },
    ],
  },
  {
    title: 'Using Ferry',
    pages: [
      {
        slug: 'swap-to-bch',
        title: 'Swap into Bitcoin Cash',
        description: 'USDC, USDT or USDG on an EVM chain to PUSD or MUSD.',
      },
      {
        slug: 'swap-from-bch',
        title: 'Swap out of Bitcoin Cash',
        description: 'PUSD or MUSD to a stablecoin on an EVM chain.',
      },
      {
        slug: 'pay-links',
        title: 'Pay links',
        description:
          'Get paid in PUSD or MUSD by anyone holding dollars on six chains.',
      },
      {
        slug: 'send-links',
        title: 'Send links',
        description: 'Send PUSD or MUSD to someone who only has an EVM wallet.',
      },
      {
        slug: 'recovery',
        title: 'Recovery',
        description:
          'Finish or refund any swap, with your wallet, a file, or no website at all.',
      },
      {
        slug: 'my-activity',
        title: 'My activity',
        description: 'Your swaps and links, rebuilt from the chains.',
      },
      {
        slug: 'wallets',
        title: 'Wallets',
        description:
          'EVM wallets, WizardConnect for Bitcoin Cash, and pairing.',
      },
      {
        slug: 'fees-and-limits',
        title: 'Fees, limits and lanes',
        description: 'What a swap costs, how much you can move, and how fast.',
      },
    ],
  },
  {
    title: 'Concepts',
    pages: [
      {
        slug: 'atomic-swaps',
        title: 'Atomic swaps',
        description:
          'One secret, two locks: why both sides happen or neither does.',
      },
      {
        slug: 'timing',
        title: 'Timeouts and refunds',
        description: 'Why the first lock always outlives the second.',
      },
      {
        slug: 'trust-model',
        title: 'Trust model',
        description:
          'What you trust, what you do not, and the optional handoff.',
      },
      {
        slug: 'recovery-key',
        title: 'Wallet-derived recovery key',
        description: 'How one signature recovers every swap, on any device.',
      },
    ],
  },
  {
    title: 'Architecture',
    pages: [
      {
        slug: 'architecture',
        title: 'Overview',
        description: 'The pieces, how they talk, and the repository layout.',
      },
      {
        slug: 'evm-contract',
        title: 'The EVM contract',
        description:
          'FerryHTLC.sol: lock, lockWithIntent, claim, refund, release.',
      },
      {
        slug: 'bch-covenant',
        title: 'The Bitcoin Cash covenant',
        description: 'FerryHTLC.cash: a keyless, per-swap CashTokens covenant.',
      },
      {
        slug: 'solver',
        title: 'The solver',
        description: 'Quoting, counter-locking, claiming and staying safe.',
      },
      {
        slug: 'api',
        title: 'Solver API',
        description: 'The public HTTP API under /v1.',
      },
      {
        slug: 'self-hosting',
        title: 'Running Ferry',
        description: 'Build, test, deploy, and the pairing relay.',
      },
    ],
  },
  {
    title: 'Security and proof',
    pages: [
      {
        slug: 'security',
        title: 'Security model',
        description: 'Threats, mitigations and what is left.',
      },
      {
        slug: 'testing',
        title: 'How Ferry was tested',
        description:
          'The fuzz runs, covenant attacks and load run behind the numbers on the site.',
      },
      {
        slug: 'mainnet-record',
        title: 'Mainnet record',
        description: 'Real swaps on every route, with explorer links.',
      },
      {
        slug: 'limitations',
        title: 'Known limitations',
        description: 'What Ferry does not do yet, said plainly.',
      },
    ],
  },
  {
    title: 'Project',
    pages: [
      {
        slug: 'testnet-vs-mainnet',
        title: 'Testnet and mainnet',
        description: 'What changed between the testnet build and this one.',
      },
      {
        slug: 'faq',
        title: 'FAQ',
        description: 'Short answers to common questions.',
      },
      {
        slug: 'credits',
        title: 'Credits and license',
        description: 'Who and what Ferry is built on.',
      },
    ],
  },
];

export const DOC_PAGES: readonly DocPage[] = DOC_GROUPS.flatMap((g) => g.pages);

export const DOCS_HOME = 'welcome';

const sources = import.meta.glob('./content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function sourceOf(slug: string): string | null {
  return sources[`./content/${slug}.md`] ?? null;
}

export function pageOf(slug: string): DocPage | null {
  return DOC_PAGES.find((p) => p.slug === slug) ?? null;
}

/** Link to a docs page, optionally a section on it. */
export function docsHref(slug: string, section?: string): string {
  return `/docs/${slug}${section ? `#${section}` : ''}`;
}
