import { describe, expect, it } from 'vitest';
import { createSendLinkLive } from '../lib/send/create-send-link';

const BCH = 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65';

describe('send link quotes the fee on the sender', () => {
  it('raises the lock until the receiver gets the amount entered', async () => {
    const asked: bigint[] = [];
    const solver = {
      quoteSendLink: (request: { amountIn: bigint }) => {
        asked.push(request.amountIn);
        // 0.15 per cent of spread plus a 1 cent fee: 20.00 locked delivers 19.97
        const cents = request.amountIn;
        const delivered = cents - (cents * 15n) / 10000n - 1n;
        return Promise.resolve({
          orderId: '0x' + '11'.repeat(32),
          terms: { evmAmount: (delivered * 10000n).toString() },
        });
      },
    };
    await expect(
      createSendLinkLive(
        {
          recipientEvmAddress: '0x' + '22'.repeat(20),
          destChain: 'Base',
          destToken: 'USDC',
          amount: 20,
          windowSeconds: 3600,
        } as never,
        { solver, bchCashAddress: BCH } as never,
      ),
    ).rejects.toBeDefined();
    expect(asked.length).toBeGreaterThan(1);
    const last = asked[asked.length - 1]!;
    expect(last).toBeGreaterThan(2000n);
    const delivered = last - (last * 15n) / 10000n - 1n;
    expect(delivered).toBeGreaterThanOrEqual(2000n);
  });
});
