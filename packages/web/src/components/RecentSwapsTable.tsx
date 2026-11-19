import { formatDuration } from '@ferry/core';
import { bchTxUrl, evmTxUrl } from '../lib/explorer';
import { useEffect, useMemo, useState } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import type { RecentSwap } from '../lib/solver/types';
import { Pagination } from './ui/pagination';
import {
  DEFAULT_RANGE,
  RangeFilter,
  filterByRange,
  type RangeValue,
} from './ui/range-filter';

/** A table on the swap page never shows more than this many rows. */
export const RECENT_SWAPS_PAGE_SIZE = 10;

export function RecentSwapsTable() {
  const solver = useSolver();
  const [currentPage, setCurrentPage] = useState(1);
  const [all, setAll] = useState<RecentSwap[] | null>(null);
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);

  useEffect(() => {
    let active = true;
    solver.getRecentSwaps(1, 100).then((res) => {
      if (active) setAll([...res.items]);
    });
    return () => {
      active = false;
    };
  }, [solver]);

  // The window is counted from when the list was loaded, not re-read on every render.
  const loadedAt = useMemo(() => Math.floor(Date.now() / 1000), [all]);
  const data = useMemo(() => {
    if (!all) return null;
    const inWindow = filterByRange(
      all,
      (swap) => swap.timestampSeconds,
      range,
      loadedAt,
    );
    const totalPages = Math.max(
      1,
      Math.ceil(inWindow.length / RECENT_SWAPS_PAGE_SIZE),
    );
    const page = Math.min(currentPage, totalPages);
    const start = (page - 1) * RECENT_SWAPS_PAGE_SIZE;
    return {
      items: inWindow.slice(start, start + RECENT_SWAPS_PAGE_SIZE),
      page,
      totalPages,
      totalCount: inWindow.length,
    };
  }, [all, range, loadedAt, currentPage]);

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

      <RangeFilter
        value={range}
        onChange={(next) => {
          setRange(next);
          setCurrentPage(1);
        }}
        className="mb-3"
      />

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
              {!data ? (
                [0, 1, 2, 3].map((idx) => (
                  <tr
                    key={idx}
                    data-testid="recent-swaps-skeleton"
                    className="animate-pulse"
                  >
                    <td className="px-4 py-3.5">
                      <div className="h-4 w-24 rounded bg-surface-2" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="h-4 w-24 rounded bg-surface-2" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="h-4 w-12 rounded bg-surface-2" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="h-4 w-28 rounded bg-surface-2" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="h-4 w-28 rounded bg-surface-2" />
                    </td>
                  </tr>
                ))
              ) : data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    data-testid="recent-swaps-empty"
                    className="px-4 py-12 text-center"
                  >
                    <p className="text-sm font-semibold text-text">
                      No swaps settled yet
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Live order settlements will appear here as swaps complete
                      on-chain.
                    </p>
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
                      {formatDuration(swap.durationSeconds)}
                    </td>
                    <td className="px-4 py-3">
                      <ExplorerCell
                        hash={swap.sourceTxHash}
                        mock={swap.isMock}
                        chain={swap.fromChain}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <ExplorerCell
                        hash={swap.targetTxHash}
                        mock={swap.isMock}
                        chain={swap.toChain}
                      />
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
            <Pagination
              totalPages={data.totalPages}
              page={data.page}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/** A transaction as a link to the block explorer of its chain; a dash when none is recorded. */
function ExplorerCell({
  hash,
  chain,
  mock = false,
}: {
  hash: string;
  chain: string;
  mock?: boolean;
}) {
  // Demo rows have invented hashes: shown as plain text, never linked.
  if (mock)
    return (
      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-text-muted">
        {hash.slice(0, 10)}…
      </span>
    );
  if (!hash) return <span className="text-text-dim">—</span>;
  const onBch = /bitcoin cash/i.test(chain);
  const chainId = Number(/\d+/.exec(chain)?.[0] ?? 0);
  const url = onBch ? bchTxUrl(hash) : evmTxUrl(chainId, hash);
  const name = onBch
    ? 'BCH explorer'
    : chainId === 8453
      ? 'Basescan'
      : 'Explorer';
  if (!url) return <span className="text-text-dim">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid="recent-tx-link"
      className="inline-flex items-center gap-1 rounded-pill bg-lime/10 px-2.5 py-1 text-[11px] font-semibold text-lime hover:bg-lime/20"
    >
      {name} ↗
    </a>
  );
}
