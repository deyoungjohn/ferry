import { Link } from 'react-router';
import { HowItWorks } from '../components/HowItWorks';

const PROOF_POINTS = [
  {
    value: 'No custodian',
    note: 'Funds sit in a contract on each chain, never with us.',
  },
  {
    value: 'Both ways',
    note: 'Stablecoins to PUSD or MUSD on Bitcoin Cash, and back.',
  },
  {
    value: 'Always refundable',
    note: 'Every swap has a timeout that returns your funds.',
  },
] as const;

export function LandingPage() {
  return (
    <div className="pb-16">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
        <div className="mb-5 inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-[11px] text-text-muted">
          <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_var(--lime)]" />
          Built for BCH BLAZE 2026
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-text sm:text-6xl">
          Move dollars onto Bitcoin Cash{' '}
          <span className="font-accent inline-block whitespace-nowrap italic text-lime text-glow">
            without a bridge
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-text-muted sm:text-lg">
          Swap USDC or USDT on Ethereum, Base, Arbitrum and other EVM chains for
          PUSD or MUSD, and back. Atomic, non-custodial, and refundable if
          anything stalls.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/swap"
            className="inline-flex h-12 items-center rounded-pill bg-lime px-8 text-sm font-semibold text-lime-ink transition-opacity hover:opacity-90"
          >
            Open Ferry
          </Link>
          <Link
            to="/how-it-works"
            className="inline-flex h-12 items-center rounded-pill border border-hairline bg-surface-2 px-8 text-sm font-medium text-text transition-colors hover:border-lime/40"
          >
            How it works
          </Link>
        </div>
      </section>

      <section
        aria-label="Highlights"
        className="mx-auto mt-6 grid max-w-4xl grid-cols-1 gap-4 px-4 sm:grid-cols-3 sm:px-6"
      >
        {PROOF_POINTS.map((point) => (
          <div
            key={point.value}
            className="rounded-card border border-hairline bg-surface-1/40 p-5 text-center"
          >
            <p className="text-lg font-semibold tracking-[-0.02em] text-text">
              {point.value}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {point.note}
            </p>
          </div>
        ))}
      </section>

      <HowItWorks />

      <section className="mx-auto mt-16 max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-[-0.025em] text-text">
          Check it, don&apos;t trust it
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-text-muted">
          The contracts are on-chain and the code is open. See what is deployed,
          what was tested, and what has not been independently reviewed yet.
        </p>
        <Link
          to="/proof"
          className="mt-6 inline-flex h-11 items-center rounded-pill border border-hairline bg-surface-2 px-6 text-sm font-medium text-text transition-colors hover:border-lime/40"
        >
          See the proof
        </Link>
      </section>
    </div>
  );
}
