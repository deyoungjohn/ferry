import type { PayLinkData } from './link';
import type { OrderSnapshot } from './order-steps';

interface SolverPayLink {
  readonly id: string;
  readonly status: PayLinkData['status'];
  readonly createdAt: number;
  readonly paidAt?: number;
}

/** Creates the link on the solver, so the address people open actually exists. Returns its id. */
export async function createPayLinkOnSolver(
  solverUrl: string,
  input: {
    readonly token: 'PUSD' | 'MUSD';
    readonly recipientAddress: string;
    /** In cents (2 decimals), when the amount is fixed. */
    readonly amountCents?: number | undefined;
    readonly note?: string | undefined;
    readonly ownerSecretHash?: string | undefined;
  },
  fetchFn: typeof fetch = fetch,
): Promise<{ id: string; createdAt: number }> {
  const res = await fetchFn(`${solverUrl.replace(/\/+$/, '')}/v1/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: input.token,
      recipientAddress: input.recipientAddress,
      ...(input.amountCents !== undefined
        ? { amountOut: String(input.amountCents) }
        : {}),
      ...(input.note ? { memo: input.note } : {}),
      ...(input.ownerSecretHash
        ? { ownerSecretHash: input.ownerSecretHash }
        : {}),
    }),
  });
  const body = (await res
    .json()
    .catch(() => ({}))) as Partial<SolverPayLink> & {
    message?: string;
  };
  if (!res.ok || !body.id) {
    throw new Error(
      body.message ?? `The solver could not create the link (${res.status}).`,
    );
  }
  return {
    id: body.id,
    createdAt: body.createdAt ?? Math.floor(Date.now() / 1000),
  };
}

/** The solver's current state of one link (status and payment date), or null when unreadable. */
export async function readPayLinkState(
  solverUrl: string,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<Pick<PayLinkData, 'status' | 'paidAt'> | null> {
  try {
    const res = await fetchFn(
      `${solverUrl.replace(/\/+$/, '')}/v1/links/${encodeURIComponent(id)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as SolverPayLink;
    return { status: body.status, paidAt: body.paidAt };
  } catch {
    return null;
  }
}

export async function deletePayLinkOnSolver(
  solverUrl: string,
  id: string,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; id: string; status: string }> {
  const res = await fetchFn(
    `${solverUrl.replace(/\/+$/, '')}/v1/links/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      err.error?.message ?? `Failed to delete pay link (${res.status})`,
    );
  }
  return res.json() as Promise<{ ok: boolean; id: string; status: string }>;
}

export interface PayLinkDetails {
  readonly id: string;
  readonly recipientAddress: string;
  readonly token: 'PUSD' | 'MUSD';
  /** In whole units (2 decimals) when the amount is fixed. */
  readonly amount?: number | undefined;
  readonly note?: string | undefined;
  readonly verified: boolean;
  readonly status: PayLinkData['status'];
  /** The swap paying this link, once there is one. */
  readonly orderId?: string | undefined;
  readonly paidAt?: number | undefined;
  readonly createdAt?: number | undefined;
  /** The swap paying the link, as the server holds it (state, transactions, timeline). */
  readonly order?: OrderSnapshot | undefined;
}

/** The link as the solver holds it, so the payer sees what the creator made. Null when not found. */
export async function readPayLink(
  solverUrl: string,
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<PayLinkDetails | null> {
  try {
    const res = await fetchFn(
      `${solverUrl.replace(/\/+$/, '')}/v1/links/${encodeURIComponent(id)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      id: string;
      recipientAddress: string;
      token: 'PUSD' | 'MUSD';
      amountOut?: string;
      memo?: string;
      verified?: boolean;
      status: PayLinkData['status'];
      orderId?: string;
      paidAt?: number;
      createdAt?: number;
      order?: OrderSnapshot;
    };
    return {
      id: body.id,
      recipientAddress: body.recipientAddress,
      token: body.token,
      ...(body.amountOut !== undefined && /^\d+$/.test(body.amountOut)
        ? { amount: Number(body.amountOut) / 100 }
        : {}),
      ...(body.memo ? { note: body.memo } : {}),
      verified: Boolean(body.verified),
      status: body.status,
      ...(body.orderId ? { orderId: body.orderId } : {}),
      ...(body.paidAt ? { paidAt: body.paidAt } : {}),
      ...(body.createdAt ? { createdAt: body.createdAt } : {}),
      ...(body.order ? { order: body.order } : {}),
    };
  } catch {
    return null;
  }
}
