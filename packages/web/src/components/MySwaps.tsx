import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ROUTES } from '../lib/routes';

interface ListedOrder {
  readonly orderId: string;
  readonly direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
  readonly status: string;
  readonly createdAt: number;
  readonly evmAmount: string;
  readonly bchToken: string;
  readonly bchTokenAmount: string;
}

export interface MySwapsProps {
  readonly solverUrl: string;
  /** The EVM address: unlike a Bitcoin Cash address it does not change after each payment. */
  readonly evmAddress: string;
  readonly fetchFn?: typeof fetch;
}

const STATUS_TEXT: Record<string, string> = {
  USER_LOCK_SEEN: 'Your lock is seen',
  USER_LOCK_FINAL: 'Your lock is final',
  SOLVER_LOCK_BROADCAST: "The solver's lock is on its way",
  SOLVER_LOCK_SEEN: 'Ready to claim',
  SECRET_KNOWN: 'Finishing',
  DONE: 'Done',
  REFUNDED: 'Refunded',
  SOLVER_REFUNDED: 'Refunded',
};

function formatWhen(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

/** Your swaps by EVM address, from the solver: works on a browser that has no saved swaps. */
export function MySwaps({
  solverUrl,
  evmAddress,
  fetchFn = fetch,
}: MySwapsProps) {
  const [orders, setOrders] = useState<readonly ListedOrder[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFn(
          `${solverUrl}/v1/orders?address=${encodeURIComponent(evmAddress)}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { orders?: ListedOrder[] };
        if (!cancelled) setOrders(body.orders ?? []);
      } catch {
        // the list is a convenience; the swap card works without it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [solverUrl, evmAddress, fetchFn]);

  if (orders.length === 0) return null;
  return (
    <section
      data-testid="my-swaps"
      aria-label="Your swaps"
      className="mt-3 rounded-lg border border-hairline bg-surface-2 p-3 text-xs text-text"
    >
      <p className="font-medium">Your swaps</p>
      <ul className="mt-2 space-y-1.5">
        {orders.slice(0, 5).map((order) => (
          <li key={order.orderId} className="flex items-center justify-between">
            <Link
              to={ROUTES.swapOrder(order.orderId)}
              className="font-mono text-[11px] text-text-muted underline-offset-2 hover:underline"
            >
              {order.orderId.slice(0, 10)}…
            </Link>
            <span className="text-text-dim">
              {formatWhen(order.createdAt)} ·{' '}
              {STATUS_TEXT[order.status] ?? order.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
