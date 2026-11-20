import { lazy, Suspense } from 'react';
import { Faq } from '../components/Faq';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { ROUTES } from '../lib/routes';
import { FeatureBento } from '../components/marketing/FeatureBento';
import {
  ChainRow,
  Eyebrow,
  SwapLine,
  UiCard,
} from '../components/marketing/visuals';

// The animation loads after the page: its box is sized up front, so nothing moves when it arrives.
const HeroCoins = lazy(() =>
  import('../components/marketing/HeroCoins').then((m) => ({
    default: m.HeroCoins,
  })),
);

const STEPS = [
  {
    n: '01',
    title: 'You lock',
    body: 'Your stablecoin goes into a contract on its own chain, under a hash lock only your secret opens.',
  },
  {
    n: '02',
    title: 'The solver locks',
    body: 'It puts the other side into a matching contract with the same lock, on the other chain.',
  },
  {
    n: '03',
    title: 'You claim',
    body: 'Claiming reveals the secret, which lets the solver take its side. Both happen, or neither.',
  },
] as const;

export function LandingPage() {
  return (
    <div className="pb-20">
      {/* Hero: the claim on the left, the coins in motion on the right */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pt-20">
        <div>
          <Eyebrow>Built for BCH BLAZE 2026</Eyebrow>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.04] tracking-[-0.04em] text-text sm:text-6xl">
            Move stablecoins into Bitcoin Cash
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-text-muted sm:text-lg">
            Swap USDC, USDT or USDG on six EVM chains for PUSD or MUSD, and
            back. Atomic and non-custodial: you get the other side or your own
            funds back.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to={ROUTES.swap}
              className="inline-flex h-12 items-center gap-2 rounded-pill bg-lime px-7 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
            >
              Open Ferry
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/how-it-works"
              className="inline-flex h-12 items-center rounded-pill border border-hairline bg-surface-2 px-7 text-sm font-medium text-text transition-colors hover:border-lime/40"
            >
              How it works
            </Link>
          </div>
          <ChainRow className="mt-10" />
        </div>

        <div className="relative">
          <div className="overflow-hidden rounded-card border border-hairline">
            <div className="aspect-[1080/882] w-full bg-[linear-gradient(160deg,#b9b4f0,#ece6f2_45%,#efc9be)]">
              <Suspense fallback={null}>
                <HeroCoins className="block size-full" />
              </Suspense>
            </div>
          </div>
          <UiCard className="absolute -bottom-6 left-4 w-[min(320px,85%)] sm:-left-6">
            <SwapLine
              from={{ amount: '8.00', token: 'USDC', chain: 42161 }}
              to={{ amount: '7.96', token: 'PUSD', chain: 'bch' }}
            />
            <p className="mt-3 flex items-center justify-between text-[11px] text-text-muted">
              <span>Settled on both chains</span>
              <span className="font-mono text-text-dim">36 s</span>
            </p>
          </UiCard>
        </div>
      </section>

      <FeatureBento />

      {/* Three steps, the short version of the how it works page */}
      <section
        aria-labelledby="steps-heading"
        className="mx-auto mt-24 max-w-6xl px-4 sm:px-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            id="steps-heading"
            className="text-3xl font-semibold tracking-[-0.03em] text-text sm:text-4xl"
          >
            One secret, two locks
          </h2>
          <Link
            to="/how-it-works"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-lime"
          >
            The full walkthrough
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <ol className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="rounded-card border border-hairline bg-surface-1 p-6"
            >
              <span className="text-5xl font-semibold tracking-[-0.04em] text-text-dim/50">
                {step.n}
              </span>
              <h3 className="mt-6 text-base font-semibold text-text">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-card border border-hairline bg-surface-1 p-8 sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-text sm:text-3xl">
              Check it, don&apos;t trust it
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-muted">
              The contracts are verified on every chain and the code is open.
              See what is deployed, what was tested and what has not been
              reviewed yet.
            </p>
          </div>
          <Link
            to="/stats"
            className="inline-flex h-11 shrink-0 items-center rounded-pill border border-hairline bg-surface-2 px-6 text-sm font-medium text-text transition-colors hover:border-lime/40"
          >
            See the stats
          </Link>
        </div>
      </section>
      <Faq />
    </div>
  );
}
