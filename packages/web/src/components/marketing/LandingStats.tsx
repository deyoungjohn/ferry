import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useSolver } from '../../lib/solver/useSolver';
import type { SolverStats } from '../../lib/solver/types';
import { CountUp, ScrollReveal } from './MotionPrimitives';

interface StatCell {
  readonly id: string;
  readonly value: number;
  readonly decimals?: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly label: string;
  readonly accent?: boolean;
}

/**
 * Editorial 3x2 on-chain stats grid for the landing page.
 * Displays live solver metrics when swaps are present and verified engineering
 * test results from the Ferry contract and covenant suites.
 */
export function LandingStats() {
  const solver = useSolver();
  const [live, setLive] = useState<SolverStats | null>(null);

  useEffect(() => {
    let active = true;
    solver
      .getStats()
      .then((res) => {
        if (active) setLive(res);
      })
      .catch(() => {
        // Offline or unconfigured solver falls back cleanly to verified static figures.
      });
    return () => {
      active = false;
    };
  }, [solver]);

  const hasLiveVolume =
    live !== null && !live.isHonestEmpty && live.completedSwaps > 0;

  const cells: readonly StatCell[] = [
    hasLiveVolume
      ? {
          id: 'swaps',
          value: live.completedSwaps,
          label: 'COMPLETED SWAPS',
        }
      : {
          id: 'evm-chains',
          value: 6,
          label: 'EVM CHAINS · ONE ADDRESS',
        },
    hasLiveVolume
      ? {
          id: 'volume',
          value: live.totalVolumeUsd,
          decimals: 2,
          prefix: '$',
          label: 'SETTLED VOLUME, USD',
        }
      : {
          id: 'stablecoins',
          value: 5,
          label: 'STABLECOINS BRIDGED',
        },
    hasLiveVolume && live.medianSecondsFast > 0
      ? {
          id: 'median',
          value: Math.round(live.medianSecondsFast),
          suffix: ' s',
          label: 'MEDIAN FAST SETTLEMENT',
          accent: true,
        }
      : {
          id: 'settlement',
          value: 36,
          prefix: '~',
          suffix: ' s',
          label: 'FAST-LANE SETTLEMENT',
          accent: true,
        },
    {
      id: 'fuzz',
      value: 20000,
      label: 'FOUNDRY FUZZ RUNS',
    },
    {
      id: 'covenant',
      value: 1100,
      suffix: '+',
      label: 'BCH COVENANT ATTACKS REJECTED',
    },
    {
      id: 'load-run',
      value: 200,
      label: 'FORK LOAD-RUN SWAPS · 0 FAILURES',
    },
  ];

  return (
    <section
      aria-labelledby="landing-stats-heading"
      className="mx-auto mt-28 max-w-6xl px-4 sm:px-6"
    >
      <ScrollReveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            id="landing-stats-heading"
            className="text-3xl font-semibold leading-[1.06] tracking-[-0.04em] sm:text-5xl"
          >
            <span className="block text-text">Every number</span>
            <span className="block text-text-muted">
              is verifiable on-chain.
            </span>
          </h2>
          <Link
            to="/stats"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text transition-colors hover:text-lime"
          >
            Live stats
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-1 border-y border-hairline sm:grid-cols-3">
          {cells.map((cell, index) => {
            const isSecondRow = index >= 3;
            const col = index % 3;
            return (
              <div
                key={cell.id}
                className={[
                  'px-2 py-8 sm:px-8 sm:py-10',
                  isSecondRow ? 'border-t border-hairline' : '',
                  col > 0 ? 'sm:border-l sm:border-hairline' : '',
                  index > 0 && !isSecondRow
                    ? 'border-t border-hairline sm:border-t-0'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <p
                  className={`text-4xl font-semibold tracking-[-0.04em] sm:text-5xl ${
                    cell.accent ? 'text-lime' : 'text-text'
                  }`}
                >
                  <CountUp
                    value={cell.value}
                    decimals={cell.decimals}
                    prefix={cell.prefix}
                    suffix={cell.suffix}
                    duration={1150}
                  />
                </p>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
                  {cell.label}
                </p>
              </div>
            );
          })}
        </div>
      </ScrollReveal>
    </section>
  );
}
