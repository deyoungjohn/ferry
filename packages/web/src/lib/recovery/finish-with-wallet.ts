import {
  deriveRecoveryRoot,
  EVM_RECOVERY_KEY_TYPED_DATA,
  swapHashLockAt,
  swapSecretAt,
} from '@ferry/core';

/** How far to look for the swap's index (a wallet's swaps are numbered from 0). */
const MAX_INDEX = 2_000;

/**
 * Finishes a forward swap from any browser: the wallet signs the fixed recovery message, the
 * swap's secret is found among the wallet's derived secrets by its hash lock, and it is sent to
 * the solver, which pays the recipient (the address fixed in the lock) and only then claims.
 */
export async function finishWithWallet(input: {
  solverUrl: string;
  orderId: string;
  hashLock: string;
  signTypedData: (params: unknown) => Promise<`0x${string}`>;
  fetchFn?: typeof fetch;
}): Promise<void> {
  const signature = await input.signTypedData(EVM_RECOVERY_KEY_TYPED_DATA);
  const root = deriveRecoveryRoot(signature);
  const wanted = input.hashLock.toLowerCase();
  let secret: `0x${string}` | null = null;
  for (let index = 0; index < MAX_INDEX; index += 1) {
    if (swapHashLockAt(root, index).toLowerCase() === wanted) {
      secret = swapSecretAt(root, index);
      break;
    }
  }
  if (!secret) {
    throw new Error(
      'This wallet did not make this swap. Connect the wallet that started it and try again.',
    );
  }
  const res = await (input.fetchFn ?? fetch)(
    `${input.solverUrl.replace(/\/+$/, '')}/v1/orders/${encodeURIComponent(input.orderId)}/secret`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      body.message ?? `The solver did not accept the request (${res.status}).`,
    );
  }
}
