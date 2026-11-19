import { bchTxUrl, evmTxUrl } from '../explorer';
import type {
  ProcessStep,
  ProcessTx,
} from '../../components/links/ProcessSteps';

/** The transaction ids the solver recorded for an order (see GET /v1/orders/:id). */
export type OrderTxids = Readonly<Record<string, string | undefined>>;

export async function readOrderTxids(
  solverUrl: string,
  orderId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ state: string; txids: OrderTxids } | null> {
  try {
    const res = await fetchFn(
      `${solverUrl.replace(/\/+$/, '')}/v1/orders/${encodeURIComponent(orderId)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: string; txids?: OrderTxids };
    return { state: body.state ?? '', txids: body.txids ?? {} };
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
 */
export function payLinkSteps(
  token: string,
  txids: OrderTxids | null,
  paid: boolean,
  chainId = 8453,
): ProcessStep[] {
  const t = txids ?? {};
  const states = pick([
    true,
    Boolean(t.evmLock),
    Boolean(t.bchLock),
    paid || Boolean(t.bchClaim),
  ]);
  return [
    { id: 'created', label: 'Pay link created', state: states[0]! },
    {
      id: 'locked',
      label: "The payer's funds are locked",
      state: states[1]!,
      note: 'Waiting for the payment to be locked on the payer’s chain',
      txs: evm(chainId, "Payer's lock", t.evmLock),
    },
    {
      id: 'solver',
      label: `The solver locks ${token} on Bitcoin Cash`,
      state: states[2]!,
      note: `Waiting for the solver’s ${token} lock on Bitcoin Cash`,
      txs: bch("Solver's lock", t.bchLock),
    },
    {
      id: 'paid',
      label: `The owner is paid in ${token}`,
      state: states[3]!,
      note: 'Waiting for the claim that pays the owner',
      txs: [
        ...bch('Payment to the owner', t.bchClaim),
        ...evm(chainId, "Solver's claim", t.evmClaim),
      ],
    },
  ];
}

/**
 * A send link: created, the sender's funds locked on Bitcoin Cash, the solver's lock on the
 * destination chain, claimed by the receiver.
 */
export function sendLinkSteps(
  chainName: string,
  txids: OrderTxids | null,
  claimed: boolean,
  done = false,
  chainId = 8453,
): ProcessStep[] {
  const t = txids ?? {};
  const states = pick([
    true,
    Boolean(t.bchLock),
    Boolean(t.evmLock),
    claimed || Boolean(t.evmClaim),
    done || Boolean(t.bchClaim),
  ]);
  return [
    { id: 'created', label: 'Send link created', state: states[0]! },
    {
      id: 'locked',
      label: "The sender's funds are locked on Bitcoin Cash",
      state: states[1]!,
      note: 'Waiting for the lock on Bitcoin Cash',
      txs: bch("Sender's lock", t.bchLock),
    },
    {
      id: 'solver',
      label: `The solver locks the funds on ${chainName}`,
      state: states[2]!,
      note: `Waiting for the solver’s lock on ${chainName}`,
      txs: evm(chainId, "Solver's lock", t.evmLock),
    },
    {
      id: 'claimed',
      label: 'The receiver claims',
      state: states[3]!,
      note: 'Waiting for the receiver to open the link and claim',
      txs: evm(chainId, "Receiver's claim", t.evmClaim),
    },
    {
      id: 'done',
      label: 'Done',
      state: states[4]!,
      txs: bch("Solver's claim", t.bchClaim),
    },
  ];
}
