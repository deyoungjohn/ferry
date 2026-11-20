import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  Check,
  FileDown,
  KeyRound,
  Lock,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '../lib/routes';
import {
  Eyebrow,
  RecoveryFileCard,
  ReleaseCard,
  StepsPreview,
  SwapCardPreview,
  SwapLine,
  UiCard,
} from '../components/marketing/visuals';

const STEPS = [
  {
    n: '01',
    title: 'Get a price',
    body: 'Pick the chain, the stablecoin and the amount. The solver signs a quote with its reference prices, and the page saves your recovery file.',
  },
  {
    n: '02',
    title: 'Lock your side',
    body: 'You sign one lock in your wallet. Your funds go into a contract on their own chain, under a hash only your secret matches.',
  },
  {
    n: '03',
    title: 'Claim the other side',
    body: 'The solver locks the other side with the same hash. You claim it, which reveals the secret and lets the solver take yours.',
  },
] as const;

interface Walk {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly picture: ReactNode;
}

const WALKTHROUGH: readonly Walk[] = [
  {
    icon: FileDown,
    title: 'A quote you can check, and a file to fall back on',
    body: "The quote carries the prices it was built from, where they came from and when. Before anything is locked, the page saves a recovery file with the swap's terms and your secret.",
    points: [
      'Reference prices signed into the terms',
      'Minimum and maximum shown before you start',
      'Recovery file saved before the lock',
    ],
    picture: (
      <div className="flex w-full flex-col items-center gap-4">
        <SwapCardPreview />
      </div>
    ),
  },
  {
    icon: Lock,
    title: 'Two locks with the same key',
    body: "Your lock and the solver's lock use the same hash. Neither can be opened without the secret, and the secret only appears when you claim.",
    points: [
      "Your lock on your chain, the solver's on the other",
      'The solver waits for your lock to be final first',
      'Each transaction linked to its explorer',
    ],
    picture: (
      <UiCard className="w-full max-w-sm">
        <SwapLine
          from={{ amount: '9.00', token: 'USDC', chain: 42161 }}
          to={{ amount: '8.96', token: 'PUSD', chain: 'bch' }}
        />
        <StepsPreview className="mt-4" done={3} />
      </UiCard>
    ),
  },
  {
    icon: KeyRound,
    title: 'One claim finishes both sides',
    body: 'When you claim, the secret becomes public on that chain. The solver uses it to take your locked side. Either both transfers happen, or neither does.',
    points: [
      'The page claims for you when it can',
      'You can claim from the recovery page instead',
      'Done in about a minute on the fast lane',
    ],
    picture: (
      <UiCard className="w-full max-w-sm">
        <SwapLine
          from={{ amount: '5.00', token: 'PUSD', chain: 'bch' }}
          to={{ amount: '4.98', token: 'USDC', chain: 42161 }}
        />
        <StepsPreview className="mt-4" />
      </UiCard>
    ),
  },
  {
    icon: Undo2,
    title: 'If anything stops, your funds come back',
    body: 'When the solver will not finish a swap from an EVM chain, it returns your lock at once. Every lock also refunds on its own deadline, with or without this site.',
    points: [
      'Early release by the solver on EVM chains',
      'Refund on the deadline, anyone can send it',
      'Recovery works offline with the file',
    ],
    picture: (
      <div className="flex w-full flex-col items-center gap-4">
        <ReleaseCard />
        <RecoveryFileCard />
      </div>
    ),
  },
];

export function HowItWorksPage() {
  return (
    <div className="pb-20">
      {/* Hero */}
      <section className="mx-auto mt-6 max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-10 overflow-hidden rounded-card border border-hairline bg-olive-ink p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:p-14">
          <div>
            <Eyebrow>How it works</Eyebrow>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-text sm:text-6xl">
              How a Ferry swap works
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-text-muted">
              Two contracts, one on each chain, locked with the same secret. You
              get the other side or your own funds back, and no one holds your
              money in between.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to={ROUTES.swap}
                className="inline-flex h-12 items-center gap-2 rounded-pill bg-lime px-7 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
              >
                Start a swap
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#walkthrough"
                className="inline-flex h-12 items-center rounded-pill border border-hairline bg-surface-2 px-7 text-sm font-medium text-text transition-colors hover:border-lime/40"
              >
                See each step
              </a>
            </div>
          </div>
          <div className="flex justify-center">
            <UiCard className="w-full max-w-sm">
              <SwapLine
                from={{ amount: '8.00', token: 'USDC', chain: 42161 }}
                to={{ amount: '7.96', token: 'PUSD', chain: 'bch' }}
              />
              <StepsPreview className="mt-4" />
            </UiCard>
          </div>
        </div>
      </section>

      {/* Three steps */}
      <section
        aria-labelledby="steps-heading"
        className="mx-auto mt-24 max-w-6xl px-4 sm:px-6"
      >
        <div className="text-center">
          <h2
            id="steps-heading"
            className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-4xl"
          >
            Swap in three steps
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-text-muted">
            You need an EVM wallet and a Bitcoin Cash wallet. That is all.
          </p>
        </div>
        <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="flex min-h-64 flex-col rounded-card border border-hairline bg-surface-1 p-6"
            >
              <span className="text-7xl font-semibold leading-none tracking-[-0.05em] text-text-dim/50">
                {step.n}
              </span>
              <h3 className="mt-auto pt-8 text-base font-semibold text-text">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Walkthrough: text and picture, alternating */}
      <section
        id="walkthrough"
        aria-labelledby="walkthrough-heading"
        className="mx-auto mt-24 max-w-6xl scroll-mt-24 px-4 sm:px-6"
      >
        <div className="text-center">
          <h2
            id="walkthrough-heading"
            className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-4xl"
          >
            What happens at each step
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-text-muted">
            The same steps you see on your order page, explained.
          </p>
        </div>
        <div className="mt-10 flex flex-col gap-4">
          {WALKTHROUGH.map((item, index) => (
            <div key={item.title} className="grid gap-4 md:grid-cols-2">
              <article
                className={`flex flex-col justify-center rounded-card border border-hairline bg-surface-1 p-6 sm:p-8 ${
                  index % 2 ? 'md:order-2' : ''
                }`}
              >
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-surface-2 text-text">
                  <item.icon className="size-5" />
                </span>
                <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em] text-text">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">
                  {item.body}
                </p>
                <ul className="mt-5 flex flex-col gap-2">
                  {item.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-center gap-2.5 text-sm text-text-muted"
                    >
                      <Check className="size-4 shrink-0 text-lime" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
              <div className="flex min-h-72 items-center justify-center rounded-card border border-hairline bg-olive-ink p-6 sm:p-8">
                {item.picture}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-card border border-hairline bg-olive-ink p-8 sm:flex-row sm:items-center sm:p-12">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-4xl">
              Try it with a stablecoin
            </h2>
            <p className="mt-2 max-w-md text-sm text-text-muted">
              The smallest swap is $1 on most chains ($5 on Ethereum), so a
              first try costs next to nothing.
            </p>
          </div>
          <Link
            to={ROUTES.swap}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-pill bg-lime px-7 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
          >
            Open Ferry
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
