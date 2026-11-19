import { describe, expect, it } from 'vitest';
import { claimSendLinkLive } from '../lib/send/claim-send-link';

const RECIPIENT = '0x1111222233334444555566667777888899990000';
const ORDER = `0x${'ab'.repeat(32)}` as const;
const LOCK = `0x${'cd'.repeat(32)}` as const;
const SECRET = `0x${'ee'.repeat(32)}` as const;

function signer(address: string) {
  return {
    getAddress: async () => address as `0x${string}`,
    getChainId: async () => 8453,
    signTypedData: async () => `0x${'33'.repeat(65)}` as `0x${string}`,
    sendTransaction: async () => `0x${'99'.repeat(32)}` as `0x${string}`,
  };
}

describe('claiming a send link', () => {
  it('refuses a wallet that is not the recipient before anything is sent', async () => {
    let relayed = false;
    const error = await claimSendLinkLive(
      {
        id: ORDER,
        orderId: ORDER,
        secret: SECRET,
        lockId: LOCK,
        recipientEvmAddress: RECIPIENT,
      },
      {
        solver: {
          relayClaim: async () => {
            relayed = true;
            return { ok: true, orderId: ORDER, txHash: ORDER };
          },
        } as never,
        evmSigner: signer(
          '0x9999999999999999999999999999999999999999',
        ) as never,
      },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((error as { message?: unknown } | null)?.message)).toContain(
      'The connected wallet is not the intended recipient.',
    );
    expect(relayed).toBe(false);
  });

  it("asks the relay with the recipient's signature", async () => {
    let body: Record<string, unknown> | null = null;
    await claimSendLinkLive(
      {
        id: ORDER,
        orderId: ORDER,
        secret: SECRET,
        lockId: LOCK,
        recipientEvmAddress: RECIPIENT,
      },
      {
        solver: {
          relayClaim: async (_id: string, request: Record<string, unknown>) => {
            body = request;
            return { ok: true, orderId: ORDER, txHash: ORDER };
          },
        } as never,
        evmSigner: signer(RECIPIENT) as never,
      },
    );
    expect(body).toMatchObject({ secret: SECRET, lockId: LOCK });
    expect(String((body as Record<string, unknown> | null)?.claimSig)).toMatch(
      /^0x[0-9a-f]{130}$/,
    );
  });
});
