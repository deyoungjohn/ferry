import { describe, expect, it } from 'vitest';
import { deriveRecoveryRoot, swapHashLockAt, swapSecretAt } from '@ferry/core';
import { finishWithWallet } from '../lib/recovery/finish-with-wallet';

const signature = ('0x' + '5a'.repeat(65)) as `0x${string}`;

describe('finish a swap with the wallet that made it', () => {
  it('finds the secret by the hash lock and sends it to the solver', async () => {
    const root = deriveRecoveryRoot(signature);
    const hashLock = swapHashLockAt(root, 7);
    const posted: { url: string; body: string }[] = [];
    await finishWithWallet({
      solverUrl: 'https://solver.test/',
      orderId: '0xabc',
      hashLock,
      signTypedData: async () => signature,
      fetchFn: (async (url: string, init: RequestInit) => {
        posted.push({ url, body: String(init.body) });
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(posted).toEqual([
      {
        url: 'https://solver.test/v1/orders/0xabc/secret',
        body: JSON.stringify({ secret: swapSecretAt(root, 7) }),
      },
    ]);
  });

  it('says so when the wallet did not make the swap, and sends nothing', async () => {
    let sent = 0;
    let message = '';
    try {
      await finishWithWallet({
        solverUrl: 'https://solver.test',
        orderId: '0xabc',
        hashLock: '0x' + '00'.repeat(32),
        signTypedData: async () => signature,
        fetchFn: (async () => {
          sent += 1;
          return new Response('{}');
        }) as unknown as typeof fetch,
      });
    } catch (error) {
      message = String((error as { message?: unknown }).message);
    }
    expect(message).toMatch(/did not make this swap/);
    expect(sent).toBe(0);
  }, 30_000);
});
