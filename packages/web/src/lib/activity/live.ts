import { evmTokenInfo } from '../explorer';
import type { ActivityEntry } from './types';

interface ListedOrder {
  readonly orderId: string;
  readonly direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
  readonly status: string;
  readonly createdAt: number;
  readonly evmAmount: string;
  readonly bchToken: string;
  readonly bchTokenAmount: string;
  readonly evmChainId?: number;
  readonly evmToken?: string;
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
  RELEASED: 'Returned by the solver',
};

/** An amount in base units as a decimal with exactly 2 places, rounded down: never more. */
function decimal(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return '?';
  const units = BigInt(raw);
  const cents =
    decimals >= 2
      ? units / 10n ** BigInt(decimals - 2)
      : units * 10n ** BigInt(2 - decimals);
  const text = cents.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
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
    // The token and its decimals from the chain facts (BNB's USDT has 18); USDC only if unknown.
    const token =
      order.evmChainId && order.evmToken
        ? evmTokenInfo(order.evmChainId, order.evmToken)
        : null;
    const usdc = `${decimal(order.evmAmount, token?.decimals ?? 6)} ${token?.symbol ?? 'USDC'}`;
    const bch = `${decimal(order.bchTokenAmount, 2)} ${order.bchToken || 'PUSD'}`;
    const refunded =
      order.status === 'REFUNDED' ||
      order.status === 'SOLVER_REFUNDED' ||
      order.status === 'RELEASED';
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
