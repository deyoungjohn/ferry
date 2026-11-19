import type { PayLinkData } from './link';

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
