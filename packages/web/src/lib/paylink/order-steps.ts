import { bchTxUrl, evmTxUrl } from '../explorer';
import type {
  ProcessStep,
  ProcessTx,
} from '../../components/links/ProcessSteps';

/** The transaction ids the solver recorded for an order (see GET /v1/orders/:id). */
export type OrderTxids = Readonly<Record<string, string | undefined>>;

/** What the server keeps for an order: its state, transactions and the time of each state. */
export interface OrderSnapshot {
  readonly state: string;
  readonly txids: OrderTxids;
  readonly createdAt?: number | undefined;
  readonly updatedAt?: number | undefined;
  readonly timeline?:
    ReadonlyArray<{ readonly status: string; readonly at: number }> | undefined;
  readonly direction?: 'EVM_TO_BCH' | 'BCH_TO_EVM' | undefined;
  readonly summary?:
    | {
        readonly bchToken: string;
        readonly bchTokenAmount: string;
        readonly evmAmount: string;
        readonly evmChainId: number;
        readonly evmToken?: string | undefined;
        readonly evmDecimals?: number | undefined;
      }
    | undefined;
}

/** The time the order first reached any of these states. */
function timeOf(
  snapshot: OrderSnapshot | null | undefined,
  statuses: readonly string[],
): number | undefined {
  return snapshot?.timeline?.find((entry) => statuses.includes(entry.status))
    ?.at;
}

const T = {
  userLock: ['USER_LOCK_SEEN', 'USER_LOCK_FINAL'],
  solverLock: ['SOLVER_LOCK_BROADCAST', 'SOLVER_LOCK_SEEN'],
  claimed: ['SECRET_KNOWN', 'DONE'],
  done: ['DONE'],
} as const;

export async function readOrderTxids(
  solverUrl: string,
  orderId: string,
  fetchFn: typeof fetch = fetch,
): Promise<OrderSnapshot | null> {
  try {
    const res = await fetchFn(
      `${solverUrl.replace(/\/+$/, '')}/v1/orders/${encodeURIComponent(orderId)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      state?: string;
      txids?: OrderTxids;
      createdAt?: number;
      updatedAt?: number;
      timeline?: OrderSnapshot['timeline'];
      direction?: OrderSnapshot['direction'];
      summary?: OrderSnapshot['summary'];
    };
    return {
      state: body.state ?? '',
      txids: body.txids ?? {},
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
      timeline: body.timeline,
      direction: body.direction,
      summary: body.summary,
    };
  } catch {
    return null;
  }
}

function pick(states: readonly boolean[]): ProcessStep['state'][] {
  const firstOpen = states.findIndex((done) => !done);
  return states.map((done, i) =>
    done ? 'done' : i === firstOpen ? 'active' : 'todo',
  );
}

const bch = (label: string, hash?: string): ProcessTx[] =>
  hash ? [{ label, hash, url: bchTxUrl(hash) }] : [];
const evm = (chainId: number, label: string, hash?: string): ProcessTx[] =>
  hash ? [{ label, hash, url: evmTxUrl(chainId, hash) }] : [];

/**
 * A pay link: created, the payer's funds locked, the solver's PUSD locked, the owner paid.
 * (The payer locks on the EVM chain, the solver locks on Bitcoin Cash, the claim pays the owner.)
 * A step is done only when the server's record shows it, so the page never ticks ahead of its data.
 */
export function payLinkSteps(
  token: string,
  snapshot: OrderSnapshot | null,
  paid: boolean,
  createdAt?: number,
  chainIdHint = 8453,
): ProcessStep[] {
  // The chain the server recorded for the order wins over the page's guess.
  const chainId = snapshot?.summary?.evmChainId ?? chainIdHint;
  const t = snapshot?.txids ?? {};
  const states = pick([
    true,
    Boolean(t.evmLock),
    Boolean(t.bchLock),
    paid || snapshot?.state === 'DONE' || Boolean(t.bchClaim),
  ]);
  return [
    {
      id: 'created',
      label: 'Pay link created',
      state: states[0]!,
      at: createdAt,
    },
    {
      id: 'locked',
      label: "The payer's funds are locked",
      state: states[1]!,
      note: 'Waiting for the payment to be locked on the payer’s chain',
      at: timeOf(snapshot, T.userLock),
      txs: evm(chainId, "Payer's lock", t.evmLock),
    },
    {
      id: 'solver',
      label: `The solver locks ${token} on Bitcoin Cash`,
      state: states[2]!,
      note: `Waiting for the solver’s ${token} lock on Bitcoin Cash`,
      at: timeOf(snapshot, T.solverLock),
      txs: bch("Solver's lock", t.bchLock),
    },
    {
      id: 'paid',
      label: `The owner is paid in ${token}`,
      state: states[3]!,
      note: 'Waiting for the claim that pays the owner',
      at: timeOf(snapshot, T.claimed),
      txs: [
        ...bch('Payment to the owner', t.bchClaim),
        ...evm(chainId, "Solver's claim", t.evmClaim),
      ],
    },
  ];
}

/**
 * A send link: created, the sender's funds locked on Bitcoin Cash, the solver's lock on the
 * destination chain, claimed by the receiver, done.
 */
export function sendLinkSteps(
  chainName: string,
  snapshot: OrderSnapshot | null,
  claimed: boolean,
  done = false,
  createdAt?: number,
  chainIdHint = 8453,
): ProcessStep[] {
  // The chain the server recorded for the order wins over the page's guess.
  const chainId = snapshot?.summary?.evmChainId ?? chainIdHint;
  const t = snapshot?.txids ?? {};
  const states = pick([
    true,
    Boolean(t.bchLock),
    Boolean(t.evmLock),
    claimed || Boolean(t.evmClaim),
    done || Boolean(t.bchClaim),
  ]);
  return [
    {
      id: 'created',
      label: 'Send link created',
      state: states[0]!,
      at: createdAt ?? snapshot?.createdAt,
    },
    {
      id: 'locked',
      label: "The sender's funds are locked on Bitcoin Cash",
      state: states[1]!,
      note: 'Waiting for the lock on Bitcoin Cash',
      at: timeOf(snapshot, T.userLock),
      txs: bch("Sender's lock", t.bchLock),
    },
    {
      id: 'solver',
      label: `The solver locks the funds on ${chainName}`,
      state: states[2]!,
      note: `Waiting for the solver’s lock on ${chainName}`,
      at: timeOf(snapshot, T.solverLock),
      txs: evm(chainId, "Solver's lock", t.evmLock),
    },
    {
      id: 'claimed',
      label: 'The receiver claims',
      state: states[3]!,
      note: 'Waiting for the receiver to open the link and claim',
      at: timeOf(snapshot, T.claimed),
      txs: evm(chainId, "Receiver's claim", t.evmClaim),
    },
    {
      id: 'done',
      label: 'Done',
      state: states[4]!,
      at: timeOf(snapshot, T.done),
      txs: bch("Solver's claim", t.bchClaim),
    },
  ];
}

/** One side of a swap, for the header: an amount, a token, and the chain it sits on. */
export interface SwapEnd {
  readonly amount: string;
  readonly token: string;
  /** An EVM chain id, or "bch" for Bitcoin Cash. */
  readonly chain: number | 'bch';
}

function twoPlaces(raw: string, decimals: number): string {
  const units = BigInt(raw);
  const value =
    decimals >= 2
      ? units / 10n ** BigInt(decimals - 2)
      : units * 10n ** BigInt(2 - decimals);
  const text = value.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** The two ends of a swap, from the server's summary: what leaves and what arrives. */
export function swapEnds(
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
  summary: NonNullable<OrderSnapshot['summary']>,
): { from: SwapEnd; to: SwapEnd } {
  const evm: SwapEnd = {
    amount: twoPlaces(summary.evmAmount, summary.evmDecimals ?? 6),
    token: summary.evmToken ?? 'USDC',
    chain: summary.evmChainId,
  };
  const bch: SwapEnd = {
    amount: twoPlaces(summary.bchTokenAmount, 2),
    token: summary.bchToken,
    chain: 'bch',
  };
  return direction === 'EVM_TO_BCH'
    ? { from: evm, to: bch }
    : { from: bch, to: evm };
}

/** "5.00 USDC → 4.98 PUSD" as one line (for places that cannot show the two columns). */
export function swapAmountText(
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
  summary: NonNullable<OrderSnapshot['summary']>,
): string {
  const { from, to } = swapEnds(direction, summary);
  return `${from.amount} ${from.token} → ${to.amount} ${to.token}`;
}

/** How far a swap has got, from the server's record alone: 0 nothing, up to 4 done. */
export function swapMilestones(
  snapshot: OrderSnapshot | null,
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
) {
  const t = snapshot?.txids ?? {};
  const forward = direction === 'EVM_TO_BCH';
  const userLock = Boolean(forward ? t.evmLock : t.bchLock);
  const solverLock = Boolean(forward ? t.bchLock : t.evmLock);
  const userClaim = Boolean(forward ? t.bchClaim : t.evmClaim);
  const done =
    snapshot?.state === 'DONE' || Boolean(forward ? t.evmClaim : t.bchClaim);
  return { userLock, solverLock, userClaim, done };
}

/**
 * The read-only steps of any swap (for someone who did not start it, or whose browser has no
 * recovery file): every transaction linked to its explorer, each step timed.
 */
export function swapSteps(
  snapshot: OrderSnapshot | null,
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
  chainIdHint = 8453,
): ProcessStep[] {
  // The chain the server recorded for the order wins over the page's guess.
  const chainId = snapshot?.summary?.evmChainId ?? chainIdHint;
  const t = snapshot?.txids ?? {};
  const forward = direction === 'EVM_TO_BCH';
  const m = swapMilestones(snapshot, direction);
  const states = pick([
    true,
    m.userLock,
    m.solverLock,
    m.userClaim || m.done,
    m.done,
  ]);
  return [
    {
      id: 'created',
      label: 'Swap created',
      state: states[0]!,
      at: snapshot?.createdAt,
    },
    {
      id: 'locked',
      label: 'The funds are locked',
      state: states[1]!,
      at: timeOf(snapshot, T.userLock),
      txs: forward
        ? evm(chainId, "Payer's lock", t.evmLock)
        : bch("Payer's lock", t.bchLock),
    },
    {
      id: 'solver',
      label: "The solver's funds are locked",
      state: states[2]!,
      at: timeOf(snapshot, T.solverLock),
      txs: forward
        ? bch("Solver's lock", t.bchLock)
        : evm(chainId, "Solver's lock", t.evmLock),
    },
    {
      id: 'claimed',
      label: 'The funds are claimed',
      state: states[3]!,
      at: timeOf(snapshot, T.claimed),
      txs: forward
        ? bch('Claim', t.bchClaim)
        : evm(chainId, 'Claim', t.evmClaim),
    },
    {
      id: 'done',
      label: 'Done',
      state: states[4]!,
      at: timeOf(snapshot, T.done),
      txs: forward
        ? evm(chainId, "Solver's claim", t.evmClaim)
        : bch("Solver's claim", t.bchClaim),
    },
  ];
}
