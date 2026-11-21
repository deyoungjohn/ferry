import { Link } from 'react-router';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { ROUTES } from '../../lib/routes';
import { CountUp, ScrollReveal } from './MotionPrimitives';
import { TokenMark } from './visuals';

const LIME_GRID_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Cpath d='M56 0H0V56' fill='none' stroke='rgba(11,13,5,0.08)' stroke-width='1'/%3E%3C/svg%3E")`;

/**
 * Full-width Ferry lime brand banner CTA inspired by the bold product banner pattern,
 * with overlapping holographic settlement cards, floating swap toasts, and organic line accents.
 */
export function LandingBannerCta() {
  return (
    <section
      aria-labelledby="banner-cta-heading"
      className="mx-auto mt-24 max-w-6xl px-4 sm:px-6"
    >
      <ScrollReveal>
        <div
          className="group relative overflow-hidden rounded-card px-6 pt-12 pb-8 sm:px-12 sm:pt-16 sm:pb-10"
          style={{
            background:
              'linear-gradient(135deg, #c6f219 0%, #9ee734 52%, #7ed957 100%)',
          }}
        >
          {/* Subtle architectural grid overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: LIME_GRID_BG,
              backgroundSize: '56px 56px',
            }}
          />

          {/* Top centered editorial copy */}
          <div className="relative z-10 mx-auto max-w-2xl text-center">
            <h2
              id="banner-cta-heading"
              className="text-3xl font-semibold uppercase leading-[1.03] tracking-[-0.04em] text-lime-ink sm:text-5xl"
            >
              Simplifying stablecoins for Bitcoin Cash
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm font-medium leading-relaxed text-lime-ink/80 sm:text-base">
              Bridge across <CountUp value={6} /> EVM chains and{' '}
              <CountUp value={5} /> stablecoins with zero custody — start your
              first atomic swap from <CountUp value={1} prefix="$" />.
            </p>
          </div>

          {/* Visual stage: overlapping cards + floating swap toasts + hand-drawn loop arrows */}
          <div className="relative z-10 mx-auto mt-10 flex max-w-3xl flex-col items-center justify-center gap-4 sm:mt-12 sm:h-64 sm:flex-row">
            {/* Playful left loop squiggle */}
            <svg
              aria-hidden="true"
              viewBox="0 0 120 70"
              className="pointer-events-none hidden h-16 w-28 text-lime-ink/45 sm:block sm:self-start"
              fill="none"
            >
              <path
                d="M8 42C26 24 44 58 58 38C72 18 52 6 44 20C36 34 66 56 108 50"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>

            {/* Floating bottom-left swap toast */}
            <div className="relative z-20 flex items-center gap-3 rounded-2xl border border-black/10 bg-white/95 px-4 py-3 text-lime-ink shadow-[0_18px_40px_rgba(11,13,5,0.18)] transition-transform duration-500 ease-out group-hover:-translate-y-1 sm:absolute sm:bottom-3 sm:-left-6">
              <TokenMark token="USDC" chain={42161} size={30} />
              <div className="text-left">
                <p className="text-xs font-semibold text-lime-ink">
                  Arbitrum → BCH
                </p>
                <p className="text-[11px] text-lime-ink/65">
                  Atomic PUSD claim
                </p>
              </div>
              <span className="ml-2 font-mono text-xs font-bold text-olive">
                <CountUp value={50} decimals={2} prefix="$" />
              </span>
            </div>

            {/* Center two overlapping flat settlement cards */}
            <div className="relative flex items-end justify-center sm:mt-14">
              <div className="relative -mr-8 h-44 w-48 -rotate-3 rounded-2xl border border-white/15 bg-surface-2 p-4 text-text shadow-[0_24px_60px_rgba(11,13,5,0.35)] transition-transform duration-500 ease-out group-hover:-translate-x-2 group-hover:-rotate-6">
                <span className="font-mono text-[10px] text-text-muted">
                  EVM LOCK
                </span>
                <p className="mt-14 font-mono text-[11px] font-semibold text-text">
                  USDC · USDT · USDG
                </p>
                <p className="mt-1 text-[11px] text-text-muted">
                  <CountUp value={6} /> EVM chains
                </p>
              </div>
              <div className="relative z-10 h-48 w-52 translate-y-3 rotate-2 rounded-2xl border border-lime/45 bg-bg p-4 text-text shadow-[0_28px_70px_rgba(11,13,5,0.48)] transition-transform duration-500 ease-out group-hover:translate-x-2 group-hover:translate-y-0 group-hover:rotate-4">
                <div className="flex items-center justify-between">
                  <img src="/brand/ferry.svg" alt="" className="size-6" />
                  <span className="inline-flex items-center gap-1 rounded-pill bg-lime/15 px-2 py-0.5 text-[10px] font-semibold text-lime">
                    <ShieldCheck className="size-3" />
                    Non-custodial
                  </span>
                </div>
                <p className="mt-14 font-mono text-xs font-semibold text-lime">
                  PUSD · MUSD
                </p>
                <p className="mt-1 text-[11px] text-text-muted">
                  Bitcoin Cash CashTokens
                </p>
              </div>
            </div>

            {/* Floating upper-right swap toast */}
            <div className="relative z-20 flex items-center gap-3 rounded-2xl border border-black/10 bg-white/95 px-4 py-3 text-lime-ink shadow-[0_18px_40px_rgba(11,13,5,0.18)] transition-transform duration-500 ease-out group-hover:-translate-y-1.5 sm:absolute sm:top-4 sm:right-2">
              <TokenMark token="USDT" chain={8453} size={30} />
              <div className="text-left">
                <p className="text-xs font-semibold text-lime-ink">
                  Base → BCH
                </p>
                <p className="text-[11px] text-lime-ink/65">
                  Settled in ~<CountUp value={36} suffix=" s" />
                </p>
              </div>
              <span className="ml-2 font-mono text-xs font-bold text-olive">
                <CountUp value={125} decimals={2} prefix="$" />
              </span>
            </div>

            {/* Playful right loop arrow */}
            <svg
              aria-hidden="true"
              viewBox="0 0 80 56"
              className="pointer-events-none hidden h-12 w-20 text-lime-ink/50 sm:block sm:self-end"
              fill="none"
            >
              <path
                d="M8 10C22 10 30 34 20 38C10 42 12 22 28 24C44 26 56 34 68 44M60 44H69V35"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Bottom-right crisp dark CTA button */}
          <div className="relative z-20 mt-8 flex justify-center sm:justify-end">
            <Link
              to={ROUTES.swap}
              className="inline-flex h-12 items-center gap-2 rounded-pill bg-lime-ink px-7 text-sm font-semibold text-lime shadow-[0_14px_32px_rgba(11,13,5,0.28)] transition-transform hover:-translate-y-0.5"
            >
              Open Ferry
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
