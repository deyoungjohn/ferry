import { describe, expect, it } from 'vitest';
import { createSendLinkLive } from '../lib/send/create-send-link';

const BCH = 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65';

describe('send link quotes the fee on the sender', () => {
  it('prices the raised amount with previews and makes one real quote, as the solver allows', async () => {
    const used = new Set<string>();
    const real: bigint[] = [];
    let previews = 0;
    const solver = {
      quoteSendLink: (request: {
        amountIn: bigint;
        hashLock: string;
        dryRun?: boolean;
      }) => {
        // The solver's rule: a hash lock belongs to one real order only; previews save nothing.
        if (!request.dryRun) {
          if (used.has(request.hashLock)) {
            return Promise.reject(
              new Error('hashLock has already been used by another order'),
            );
          }
          used.add(request.hashLock);
          real.push(request.amountIn);
        } else {
          previews += 1;
        }
        // 0.15 per cent of spread plus a 1 cent fee: 20.00 locked delivers 19.97
        const cents = request.amountIn;
        const delivered = cents - (cents * 15n) / 10000n - 1n;
        return Promise.resolve({
          orderId: '0x' + '11'.repeat(32),
          terms: { evmAmount: (delivered * 10000n).toString() },
        });
      },
    };
    let message = '';
    try {
      await createSendLinkLive(
        {
          recipientEvmAddress: '0x' + '22'.repeat(20),
          destChain: 'Base',
          destToken: 'USDC',
          amount: 20,
          windowSeconds: 3600,
        } as never,
        { solver, bchCashAddress: BCH } as never,
      );
    } catch (error) {
      // The fake quote does not verify; anything after the quotes is out of scope here.
      message = String((error as { message?: unknown }).message);
    }
    expect(message).not.toMatch(/already been used/);
    expect(previews).toBeGreaterThan(1);
    expect(real).toHaveLength(1);
    const last = real[0]!;
    const delivered = last - (last * 15n) / 10000n - 1n;
    expect(delivered).toBeGreaterThanOrEqual(2000n);
  });
});
