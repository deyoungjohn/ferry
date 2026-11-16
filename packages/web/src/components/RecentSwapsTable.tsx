import { useEffect, useState } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import type { PaginatedRecentSwaps } from '../lib/solver/types';

export function RecentSwapsTable() {
  const solver = useSolver();
  const [currentPage, setCurrentPage] = useState(1);
  const [data, setData] = useState<PaginatedRecentSwaps | null>(null);

  useEffect(() => {
    let active = true;
    solver.getRecentSwaps(currentPage, 10).then((res) => {
      if (active) setData(res);
    });
    return () => {
      active = false;
    };
  }, [currentPage, solver]);

  return (
    <section
      aria-label="Recent Swaps"
      className="mx-auto mt-16 max-w-5xl px-4 sm:px-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text">Recent Swaps</h2>
          <p className="text-xs text-text-muted">
            Live order settlements across supported routes.
          </p>
        </div>
        {data?.items && data.items.some((s) => s.isMock) && (
          <div className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-xs text-text-muted">
            <span className="size-1.5 rounded-full bg-warn" />
            <span>Simulated Hashes</span>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-card border border-hairline bg-surface-1">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-hairline bg-surface-2/60 text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Source Tx</th>
                <th className="px-4 py-3 font-medium">Claim Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {!data || data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-text-muted"
                  >
                    {!data
                      ? 'Loading recent swaps…'
                      : 'No swap activity recorded yet.'}
                  </td>
                </tr>
              ) : (
                data.items.map((swap) => (
                  <tr
                    key={swap.id}
                    className="transition-colors hover:bg-surface-2/40"
                  >
                    <td className="px-4 py-3 text-text">
                      <span className="font-semibold">
                        {swap.fromAmount.toFixed(2)}
                      </span>{' '}
                      {swap.fromToken}{' '}
                      <span className="text-[11px] text-text-dim">
                        ({swap.fromChain})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-lime font-medium">
                      <span className="font-semibold">
                        {swap.toAmount.toFixed(2)}
                      </span>{' '}
                      {swap.toToken}{' '}
                      <span className="text-[11px] text-text-dim">
                        ({swap.toChain})
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-text-muted">
                      {swap.durationSeconds}s
                    </td>
                    <td className="px-4 py-3 font-mono text-text-muted">
                      {/* Hashes do not link to any explorer per requirement */}
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">
                        {swap.sourceTxHash.slice(0, 10)}…
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-text-muted">
                      {/* Hashes do not link to any explorer per requirement */}
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">
                        {swap.targetTxHash.slice(0, 10)}…
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {data && (
          <div className="flex items-center justify-between border-t border-hairline bg-surface-2/30 px-4 py-3">
            <p
              data-testid="pagination-page-indicator"
              className="text-xs text-text-muted"
            >
              Page <span className="font-medium text-text">{data.page}</span> of{' '}
              <span className="font-medium text-text">{data.totalPages}</span> (
              {data.totalCount} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="pagination-prev"
                disabled={data.page <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                data-testid="pagination-next"
                disabled={data.page >= data.totalPages}
                onClick={() =>
                  setCurrentPage((p) => Math.min(data.totalPages, p + 1))
                }
                className="rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
