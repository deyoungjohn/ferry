import { useState, useMemo, useContext, type FormEvent } from 'react';
import { Link } from 'react-router';
import { decodeCashAddress } from '@ferry/core';
import { WalletContext } from '../lib/wallet/context';
import { getMockActivity } from '../lib/activity/mock';
import type { ActivityEntry } from '../lib/activity/types';

export const ACTIVITY_PAGE_SIZE = 10;

function formatTimestamp(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function ActivityPage() {
  const walletContext = useContext(WalletContext);
  const bch = walletContext?.bch ?? { status: 'disconnected', address: null };
  const [pastedAddress, setPastedAddress] = useState('');
  const [activeAddress, setActiveAddress] = useState(
    bch.address?.address ??
      'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
  );
  const [addressError, setAddressError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Load activity (BCH-first merge)
  const allEntries = useMemo<ActivityEntry[]>(() => {
    // In testnet/mock environment, returns merged activity for the address
    return getMockActivity();
  }, []);

  const totalPages = Math.max(
    1,
    Math.ceil(allEntries.length / ACTIVITY_PAGE_SIZE),
  );
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * ACTIVITY_PAGE_SIZE;
    return allEntries.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [allEntries, currentPage]);

  function handleAddressSubmit(e: FormEvent) {
    e.preventDefault();
    setAddressError(null);
    const trimmed = pastedAddress.trim();
    if (!trimmed) {
      if (bch.address?.address) {
        setActiveAddress(bch.address.address);
      }
      return;
    }

    try {
      decodeCashAddress(trimmed);
    } catch (err) {
      setAddressError(
        `Invalid CashAddress: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    setActiveAddress(trimmed);
    setPastedAddress('');
    setCurrentPage(1);
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 1500);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            My Activity
          </h1>
          <p className="text-xs text-text-muted">
            Rebuilt from Bitcoin Cash covenant history and EVM counter-locks.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      {/* Address Bar */}
      <div className="mb-6 rounded-card border border-hairline bg-surface-1 p-4 shadow-elev-card">
        <form
          onSubmit={handleAddressSubmit}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <div className="flex-1">
            <label htmlFor="activity-address" className="sr-only">
              Bitcoin Cash Address
            </label>
            <input
              id="activity-address"
              type="text"
              value={pastedAddress}
              onChange={(e) => setPastedAddress(e.target.value)}
              placeholder={activeAddress || 'Enter CashAddr (bchtest:…)'}
              className="w-full rounded-pill border border-hairline bg-surface-2 px-4 py-2 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-pill bg-olive px-4 py-2 text-xs font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer"
          >
            Inspect Address
          </button>
        </form>
        {addressError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {addressError}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
          <span>Active address:</span>
          <span className="font-mono text-text truncate max-w-md">
            {activeAddress}
          </span>
          {bch.address?.address === activeAddress && (
            <span className="rounded-pill bg-lime/10 px-2 py-0.5 text-[10px] font-semibold text-lime">
              Connected Wallet
            </span>
          )}
        </div>
      </div>

      {/* Activity Table */}
      <div className="rounded-card border border-hairline bg-surface-1 overflow-hidden shadow-elev-card">
        {paginatedEntries.length === 0 ? (
          <div className="p-8 text-center text-xs text-text-muted">
            No swap activity found for this Bitcoin Cash address.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-left text-xs"
              aria-label="Swap Activity Table"
            >
              <thead>
                <tr className="border-b border-hairline bg-surface-2/60 text-text-muted">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Date & Time
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Swap Route
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Transactions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {paginatedEntries.map((entry) => (
                  <tr
                    key={entry.key}
                    className="hover:bg-surface-2/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[11px] text-text-muted whitespace-nowrap">
                      {formatTimestamp(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-text whitespace-nowrap">
                      {entry.amountDisplay}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                          entry.bch?.state === 'received' ||
                          entry.chain?.state === 'claimed'
                            ? 'bg-ok/10 text-ok border border-ok/20'
                            : entry.bch?.state === 'refunded' ||
                                entry.chain?.state === 'refunded'
                              ? 'bg-warn/10 text-warn border border-warn/20'
                              : 'bg-surface-3 text-text-muted border border-hairline'
                        }`}
                      >
                        {entry.statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {entry.bch?.txs.map((tx) => (
                          <button
                            key={tx.hash}
                            type="button"
                            onClick={() => handleCopy(tx.hash)}
                            title={`Copy ${tx.label} hash: ${tx.hash}`}
                            className="inline-flex items-center gap-1 rounded border border-hairline bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-text-muted hover:text-text cursor-pointer transition-colors"
                          >
                            <span>{tx.label}:</span>
                            <span>{truncateHash(tx.hash)}</span>
                            {copiedHash === tx.hash ? (
                              <span className="text-ok">✓</span>
                            ) : null}
                          </button>
                        ))}
                        {entry.chain && (
                          <button
                            type="button"
                            onClick={() => handleCopy(entry.chain!.lockTx)}
                            title={`Copy EVM Lock: ${entry.chain.lockTx}`}
                            className="inline-flex items-center gap-1 rounded border border-hairline bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-text-muted hover:text-text cursor-pointer transition-colors"
                          >
                            <span>EVM Lock:</span>
                            <span>{truncateHash(entry.chain.lockTx)}</span>
                            {copiedHash === entry.chain.lockTx ? (
                              <span className="text-ok">✓</span>
                            ) : null}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-hairline bg-surface-2/40 px-4 py-3 text-xs text-text-muted">
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded-pill border border-hairline px-3 py-1 font-medium hover:text-text disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                className="rounded-pill border border-hairline px-3 py-1 font-medium hover:text-text disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
