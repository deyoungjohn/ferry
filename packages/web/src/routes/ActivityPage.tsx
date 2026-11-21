import {
  useState,
  useMemo,
  useContext,
  useEffect,
  type FormEvent,
} from 'react';
import { Link } from 'react-router';
import { cashAddressToLockingBytecode, decodeCashAddress } from '@ferry/core';
import { WalletContext } from '../lib/wallet/context';
import { getMockActivity } from '../lib/activity/mock';
import { loadLiveActivity, loadLiveActivityByBch } from '../lib/activity/live';
import { LIVE_EXECUTION_ENABLED } from '../lib/config';
import { ROUTES } from '../lib/routes';
import type { ActivityEntry } from '../lib/activity/types';
import { useToast } from '../lib/toast/ToastContext';
import { Pagination } from '../components/ui/pagination';
import {
  DEFAULT_RANGE,
  RangeFilter,
  filterByRange,
  type RangeValue,
} from '../components/ui/range-filter';

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
  // Only a connected wallet's address: an offline wallet remembered in this browser is not shown
  // as connected.
  const connectedBchAddress =
    bch.status === 'connected' ? (bch.address?.address ?? null) : null;
  const [activeAddress, setActiveAddress] = useState(connectedBchAddress ?? '');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  // Live: the solver's list of this EVM address's swaps. Otherwise the demo data.
  const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const live = LIVE_EXECUTION_ENABLED && Boolean(solverUrl);
  const evmAddress = walletContext?.evm.address ?? null;
  const [liveEntries, setLiveEntries] = useState<readonly ActivityEntry[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  useEffect(() => {
    if (!live || !solverUrl || !evmAddress) return;
    let cancelled = false;
    loadLiveActivity(solverUrl, evmAddress)
      .then((rows) => {
        if (!cancelled) {
          setLiveEntries(rows);
          setLiveError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setLiveError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [live, solverUrl, evmAddress]);

  // Live, Bitcoin Cash side: the swaps of the connected wallet's addresses (it rotates them, so
  // the connected address is asked for first, then every address the wallet has used), or of an
  // address pasted above.
  const bchWallet = walletContext?.bch ?? null;
  const bchConnected = bchWallet?.status === 'connected';
  const connectedBch = bchWallet?.address?.lockingBytecode ?? null;
  const [walletBytecodes, setWalletBytecodes] = useState<readonly string[]>([]);
  const [bchEntries, setBchEntries] = useState<readonly ActivityEntry[]>([]);
  const [bchScanning, setBchScanning] = useState(false);
  useEffect(() => {
    if (!live || !bchConnected || !connectedBch) {
      setWalletBytecodes([]);
      return;
    }
    let cancelled = false;
    setWalletBytecodes([connectedBch]);
    const list = bchWallet?.listFundingAddresses;
    if (list) {
      setBchScanning(true);
      list()
        .then((addresses) => {
          if (cancelled) return;
          setWalletBytecodes([
            connectedBch,
            ...addresses
              .map((a) => a.lockingBytecodeHex ?? '')
              .filter((hex) => hex.length > 0),
          ]);
        })
        .catch(() => {
          // The connected address alone is still looked up.
        })
        .finally(() => {
          if (!cancelled) setBchScanning(false);
        });
    }
    return () => {
      cancelled = true;
    };
    // The wallet object changes on every render; its address is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, bchConnected, connectedBch]);

  const inspectedBytecode = useMemo(() => {
    if (!activeAddress || activeAddress === bchWallet?.address?.address) {
      return null;
    }
    try {
      return cashAddressToLockingBytecode(activeAddress);
    } catch {
      return null;
    }
  }, [activeAddress, bchWallet?.address?.address]);

  useEffect(() => {
    if (!live || !solverUrl) return;
    const bytecodes = inspectedBytecode ? [inspectedBytecode] : walletBytecodes;
    if (bytecodes.length === 0) {
      setBchEntries([]);
      return;
    }
    let cancelled = false;
    loadLiveActivityByBch(solverUrl, bytecodes)
      .then((rows) => {
        if (!cancelled) {
          setBchEntries(rows);
          setLiveError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setLiveError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [live, solverUrl, walletBytecodes, inspectedBytecode]);

  const loadedEntries = useMemo<ActivityEntry[]>(() => {
    if (live) {
      // An inspected address shows only its own swaps; otherwise both wallets' swaps, once each.
      const rows = inspectedBytecode
        ? bchEntries
        : [...liveEntries, ...bchEntries];
      const seen = new Set<string>();
      return rows
        .filter((row) =>
          seen.has(row.key) ? false : (seen.add(row.key), true),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    return getMockActivity(activeAddress);
  }, [live, liveEntries, bchEntries, inspectedBytecode, activeAddress]);
  // The window is counted from when the list was loaded.
  const loadedAt = useMemo(
    () => Math.floor(Date.now() / 1000),
    [loadedEntries],
  );
  const allEntries = useMemo(
    () =>
      filterByRange(loadedEntries, (entry) => entry.createdAt, range, loadedAt),
    [loadedEntries, range, loadedAt],
  );

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
      if (connectedBchAddress) {
        setActiveAddress(connectedBchAddress);
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

    setLoading(true);
    setActiveAddress(trimmed);
    setPastedAddress('');
    setCurrentPage(1);
    setTimeout(() => setLoading(false), 200);
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedHash(text);
    showToast('Transaction hash copied to clipboard', 'success');
    setTimeout(() => setCopiedHash(null), 1500);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            My Activity
          </h1>
          <p className="text-xs text-text-muted">
            {live
              ? 'Swaps made with your connected wallets: your EVM address, and every address your Bitcoin Cash wallet has used.'
              : 'Rebuilt from Bitcoin Cash covenant history and EVM counter-locks.'}
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      {live && !evmAddress && !bchConnected && (
        <p
          data-testid="activity-needs-evm"
          className="mb-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn"
        >
          Connect a wallet (the pill at the top right) to see your swaps: your
          EVM wallet, your Bitcoin Cash wallet, or both.
        </p>
      )}
      {live && bchScanning && (
        <p
          data-testid="activity-bch-scanning"
          role="status"
          className="mb-4 text-xs text-text-muted"
        >
          Checking every address your Bitcoin Cash wallet has used…
        </p>
      )}
      {live && liveError && (
        <p
          data-testid="activity-error"
          className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
        >
          Could not load your swaps: {liveError}
        </p>
      )}

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
              placeholder={activeAddress || 'Paste a Bitcoin Cash address'}
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
        {activeAddress && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
            <span>Active address:</span>
            <span className="font-mono text-text truncate max-w-md">
              {activeAddress}
            </span>
            {connectedBchAddress !== null &&
              connectedBchAddress === activeAddress && (
                <span className="rounded-pill bg-lime/10 px-2 py-0.5 text-[10px] font-semibold text-lime">
                  Connected Wallet
                </span>
              )}
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

      {/* Activity Table */}
      <div className="rounded-card border border-hairline bg-surface-1 overflow-hidden shadow-elev-card">
        {loading ? (
          <div
            data-testid="activity-skeleton"
            role="status"
            aria-label="Loading swap activity"
            className="p-6 space-y-4 animate-pulse"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <div className="h-4 w-28 rounded bg-surface-2" />
                <div className="h-4 w-32 rounded bg-surface-2" />
                <div className="h-4 w-20 rounded bg-surface-2" />
                <div className="h-4 w-24 rounded bg-surface-2" />
              </div>
            ))}
          </div>
        ) : paginatedEntries.length === 0 ? (
          <div
            data-testid="activity-empty-state"
            className="p-12 text-center text-xs"
          >
            <p className="text-sm font-semibold text-text">
              No swap activity found
            </p>
            <p className="mt-2 max-w-md mx-auto text-text-muted leading-relaxed">
              {live
                ? 'No swaps were found for the connected wallets or this address.'
                : 'No swap history found for this Bitcoin Cash address.'}{' '}
              Activity is reconstructed directly from on-chain CashTokens
              covenants on the Bitcoin Cash blockchain, ensuring complete
              privacy with zero server-side tracking.
            </p>
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
                          entry.tone === 'ok' ||
                          entry.bch?.state === 'received' ||
                          entry.chain?.state === 'claimed'
                            ? 'bg-ok/10 text-ok border border-ok/20'
                            : entry.tone === 'warn' ||
                                entry.bch?.state === 'refunded' ||
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
                        {entry.orderId && (
                          <Link
                            to={ROUTES.swapOrder(entry.orderId)}
                            className="inline-flex items-center rounded border border-hairline bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-text-muted transition-colors hover:text-text"
                          >
                            Open swap {entry.orderId.slice(0, 10)}…
                          </Link>
                        )}
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
            <Pagination
              totalPages={totalPages}
              page={Math.min(currentPage, totalPages)}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
