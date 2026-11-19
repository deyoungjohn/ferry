import type { ActivityEntry } from './types';

interface ListedOrder {
  readonly orderId: string;
  readonly direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
  readonly status: string;
  readonly createdAt: number;
  readonly evmAmount: string;
  readonly bchToken: string;
  readonly bchTokenAmount: string;
}

const LABEL: Record<string, string> = {
  USER_LOCK_SEEN: 'Your lock is seen',
  USER_LOCK_FINAL: 'Your lock is final',
  SOLVER_LOCK_BROADCAST: "Solver's lock on its way",
  SOLVER_LOCK_SEEN: 'Ready to claim',
  SECRET_KNOWN: 'Finishing',
  DONE: 'Completed',
  REFUNDED: 'Refunded',
  SOLVER_REFUNDED: 'Refunded',
};

function decimal(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return '?';
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals);
  return `${whole}.${fraction}`;
}

/** Your swaps as the solver lists them for an EVM address, shaped as activity rows. */
export async function loadLiveActivity(
  solverUrl: string,
  evmAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<readonly ActivityEntry[]> {
  const res = await fetchFn(
    `${solverUrl.replace(/\/+$/, '')}/v1/orders?address=${encodeURIComponent(evmAddress)}`,
  );
  if (!res.ok) throw new Error(`The solver answered ${res.status}`);
  const body = (await res.json()) as { orders?: ListedOrder[] };
  return (body.orders ?? []).map((order) => {
    const forward = order.direction === 'EVM_TO_BCH';
    const usdc = `${decimal(order.evmAmount, 6)} USDC`;
    const bch = `${decimal(order.bchTokenAmount, 2)} ${order.bchToken || 'PUSD'}`;
    const refunded =
      order.status === 'REFUNDED' || order.status === 'SOLVER_REFUNDED';
    return {
      key: order.orderId,
      createdAt: order.createdAt,
      direction: forward ? 'COUNTER_TO_BCH' : 'BCH_TO_COUNTER',
      bch: null,
      chain: null,
      orderId: order.orderId,
      statusLabel: LABEL[order.status] ?? order.status,
      amountDisplay: forward ? `${usdc} → ${bch}` : `${bch} → ${usdc}`,
      tone: order.status === 'DONE' ? 'ok' : refunded ? 'warn' : 'neutral',
    } satisfies ActivityEntry;
  });
}
