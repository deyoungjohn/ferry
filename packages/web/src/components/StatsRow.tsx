import { useEffect, useState } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import type { SolverStats } from '../lib/solver/types';

export function StatsRow() {
  const solver = useSolver();
  const [stats, setStats] = useState<SolverStats | null>(null);

  useEffect(() => {
    let active = true;
    solver.getStats().then((res) => {
      if (active) setStats(res);
    });
    return () => {
      active = false;
    };
  }, [solver]);

  if (!stats) {
    return (
      <section
        aria-label="Network Statistics"
        className="mx-auto mt-12 max-w-4xl px-4 sm:px-6"
      >
        <div
          data-testid="stats-skeleton"
          role="status"
          aria-label="Loading network statistics"
          className="rounded-card border border-hairline bg-surface-1/60 p-6 animate-pulse"
        >
          <div className="grid grid-cols-1 gap-6 text-center sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="h-8 w-20 rounded bg-surface-2" />
                <div className="h-3 w-28 rounded bg-surface-3" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Network Statistics"
      className="mx-auto mt-12 max-w-4xl px-4 sm:px-6"
    >
      <div className="rounded-card border border-hairline bg-surface-1/60 p-6">
        {stats.isHonestEmpty ? (
          <div
            data-testid="stats-empty-state"
            className="flex flex-col items-center justify-center py-4 text-center"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
              <span className="size-1.5 rounded-full bg-text-dim" />
              <span>Honest Metrics · No Simulated Volume</span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3 w-full border-t border-hairline pt-4">
              <div>
                <p className="text-2xl font-bold text-text">0</p>
                <p className="mt-1 text-xs text-text-muted">Completed swaps</p>
              </div>
              <div className="sm:border-x sm:border-hairline sm:px-4">
                <p className="text-2xl font-bold text-text">$0.00</p>
                <p className="mt-1 text-xs text-text-muted">
                  Total settled volume
                </p>
              </div>
              <div>
                <p className="text-2xl font-bold text-text">—</p>
                <p className="mt-1 text-xs text-text-muted">
                  Median time (fast lane)
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 text-center sm:grid-cols-3">
            <div>
              <p className="text-3xl font-bold text-text">
                {stats.completedSwaps}
              </p>
              <p className="mt-1 text-xs text-text-muted">Completed swaps</p>
            </div>
            <div className="sm:border-x sm:border-hairline sm:px-4">
              <p className="text-3xl font-bold text-text">
                ${stats.totalVolumeUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Total settled volume
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-lime">
                {stats.medianSecondsFast}s
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Median time (fast lane)
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
