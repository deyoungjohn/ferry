import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ArrowUpDown } from 'lucide-react';
import { ROUTES } from '../lib/routes';
import { FeatureBento } from '../components/marketing/FeatureBento';
import { ChainRow, Eyebrow, TokenMark } from '../components/marketing/visuals';

// The 3D ribbon animation loads asynchronously so the initial route bundle stays lean.
const HeroCoinRibbon = lazy(() =>
  import('../components/marketing/HeroCoinRibbon').then((m) => ({
    default: m.HeroCoinRibbon,
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

type HeroDirection = 'to-bch' | 'to-evm';

export function LandingPage() {
  const [direction, setDirection] = useState<HeroDirection>('to-bch');

  const sendLeg =
    direction === 'to-bch'
      ? {
          token: 'USDC',
          network: 'Arbitrum',
          chain: 42161 as const,
          amount: '100.00',
          range: '1.00 – 5,000 USDC',
        }
      : {
          token: 'PUSD',
          network: 'Bitcoin Cash',
          chain: 'bch' as const,
          amount: '100.00',
          range: '1.00 – 5,000 PUSD',
        };

  const getLeg =
    direction === 'to-bch'
      ? {
          token: 'PUSD',
          network: 'Bitcoin Cash',
          chain: 'bch' as const,
          amount: '99.85',
        }
      : {
          token: 'USDC',
          network: 'Arbitrum',
          chain: 42161 as const,
          amount: '99.85',
        };

  return (
    <div className="pb-20">
      {/* Split-screen hero: lime-lit 3D coin ribbon on the left, structured swap panel on the right */}
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:pt-8">
        <div className="grid overflow-hidden rounded-card border border-hairline bg-surface-1 shadow-[0_32px_90px_rgba(0,0,0,0.45)] lg:grid-cols-[1.24fr_0.92fr]">
          {/* Left visual stage: full-bleed Three.js stablecoin ribbon on Ferry lime gradient */}
          <div className="relative min-h-[340px] sm:min-h-[430px] lg:min-h-[548px]">
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(155deg, #dff87c 0%, #f8fbf0 46%, #edf6d4 78%, #cbe682 100%)',
              }}
            >
              <Suspense fallback={null}>
                <HeroCoinRibbon className="size-full" />
              </Suspense>
            </div>

            <div className="pointer-events-none absolute inset-x-5 bottom-4 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-lime-ink/75 sm:inset-x-6 sm:bottom-5">
              <span>USDT · USDC · USDG · MUSD · PUSD</span>
              <span>Atomic · Non-custodial</span>
            </div>
          </div>

          {/* Right hero panel: claim + interactive swap preview + primary CTA */}
          <div className="flex flex-col justify-between border-t border-hairline bg-surface-1 p-6 sm:p-8 lg:border-l lg:border-t-0 lg:px-10 lg:py-9">
            <div className="mx-auto flex w-full max-w-[390px] flex-1 flex-col justify-center">
              <div className="flex justify-center">
                <Eyebrow>Built for BCH BLAZE 2026</Eyebrow>
              </div>

              <h1 className="mt-4 text-center text-3xl font-semibold leading-[1.06] tracking-[-0.04em] text-text sm:text-[40px]">
                Move stablecoins into Bitcoin Cash
              </h1>

              {/* Direction toggle pill */}
              <div
                role="tablist"
                aria-label="Swap direction"
                className="mt-6 grid grid-cols-2 rounded-pill border border-hairline bg-surface-2 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={direction === 'to-bch'}
                  onClick={() => setDirection('to-bch')}
                  className={`h-9 rounded-pill text-xs font-semibold transition-colors ${
                    direction === 'to-bch'
                      ? 'bg-surface-3 text-text shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  EVM to BCH
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={direction === 'to-evm'}
                  onClick={() => setDirection('to-evm')}
                  className={`h-9 rounded-pill text-xs font-semibold transition-colors ${
                    direction === 'to-evm'
                      ? 'bg-surface-3 text-text shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  BCH to EVM
                </button>
              </div>

              {/* Swap preview rows */}
              <div className="mt-4">
                <div className="rounded-well border border-hairline bg-surface-2/70 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span>You send</span>
                    <span>{sendLeg.network}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <TokenMark
                        token={sendLeg.token}
                        chain={sendLeg.chain}
                        size={34}
                      />
                      <div>
                        <div className="text-sm font-semibold text-text">
                          {sendLeg.token}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          {sendLeg.range}
                        </div>
                      </div>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-text">
                      {sendLeg.amount}
                    </span>
                  </div>
                </div>

                <div className="relative z-10 -my-3 flex justify-center">
                  <button
                    type="button"
                    aria-label="Flip swap direction"
                    onClick={() =>
                      setDirection((d) =>
                        d === 'to-bch' ? 'to-evm' : 'to-bch',
                      )
                    }
                    className="inline-flex size-8 items-center justify-center rounded-full border border-hairline bg-surface-1 text-text-muted transition-colors hover:border-lime/50 hover:text-lime"
                  >
                    <ArrowUpDown className="size-3.5" />
                  </button>
                </div>

                <div className="rounded-well border border-hairline bg-surface-2/70 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span>You get</span>
                    <span>{getLeg.network}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <TokenMark
                        token={getLeg.token}
                        chain={getLeg.chain}
                        size={34}
                      />
                      <div>
                        <div className="text-sm font-semibold text-text">
                          {getLeg.token}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          {getLeg.network}
                        </div>
                      </div>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-text">
                      {getLeg.amount}
                    </span>
                  </div>
                </div>
              </div>

              <p className="mt-3.5 text-center text-xs tabular-nums text-text-muted">
                1 {sendLeg.token} ≈ 0.9985 {getLeg.token} · settles in ~36 s
              </p>

              <div className="mt-4 flex flex-col gap-2">
                <Link
                  to={ROUTES.swap}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-lime px-7 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
                >
                  Open Ferry
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  to="/how-it-works"
                  className="inline-flex h-9 w-full items-center justify-center rounded-pill text-xs font-medium text-text-muted transition-colors hover:text-text"
                >
                  How atomic swaps work
                </Link>
              </div>
            </div>

            <div className="mt-5 flex justify-center border-t border-hairline pt-4">
              <ChainRow />
            </div>
          </div>
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
    </div>
  );
}
