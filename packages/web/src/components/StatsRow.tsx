import { useEffect, useState } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import type { SolverStats } from '../lib/solver/types';

export function StatsRow() {
  const solver = useSolver();
  const [stats, setStats] = useState<SolverStats | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      solver.getStats().then((res) => {
        // A failed read keeps what is on screen rather than showing an empty state.
        if (active)
          setStats((prev) => (res.isHonestEmpty && prev ? prev : res));
      });
    };
    load();
    // Live: the figures refresh while the page is open.
    const timer = setInterval(load, 20_000);
    return () => {
      active = false;
      clearInterval(timer);
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
                <p className="text-2xl font-semibold text-text">0</p>
                <p className="mt-1 text-xs text-text-muted">Completed swaps</p>
              </div>
              <div className="sm:border-x sm:border-hairline sm:px-4">
                <p className="text-2xl font-semibold text-text">$0.00</p>
                <p className="mt-1 text-xs text-text-muted">
                  Total settled volume
                </p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-text">—</p>
                <p className="mt-1 text-xs text-text-muted">Median time</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 text-center sm:grid-cols-3">
            <div>
              <p className="text-3xl font-semibold text-text">
                {stats.completedSwaps}
              </p>
              <p className="mt-1 text-xs text-text-muted">Completed swaps</p>
            </div>
            <div className="sm:border-x sm:border-hairline sm:px-4">
              <p className="text-3xl font-semibold text-text">
                ${stats.totalVolumeUsd.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Total settled volume
              </p>
            </div>
            <div>
              <p className="text-3xl font-semibold text-lime">
                {formatMedian(stats.medianSecondsFast)}
              </p>
              <p className="mt-1 text-xs text-text-muted">Median time</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** "45s", "7m 30s"; a dash when no swap has finished yet. */
function formatMedian(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}
