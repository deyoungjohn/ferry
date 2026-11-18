import { describe, expect, it } from 'vitest';
import type { Hex, Hex32, OrderTerms } from '@ferry/core';
import {
  lockUserOnEvm,
  type EvmChainPort,
  type EvmSignerPort,
} from '../src/index.js';

const terms = {
  evmChainId: 8453,
  evmAmount: 1_000_000n,
} as OrderTerms;
const R = '11'.repeat(32);
const S = '22'.repeat(32);

function permitPayload() {
  return {
    mode: 'permit-intent' as const,
    permitTypedData: { message: { deadline: 1_794_764_500n } },
    lockIntentTypedData: { message: { intentDeadline: 1_794_764_500n } },
  };
}

function harness(
  payload: unknown,
  signature: string,
  receiptStatus: (n: number) => 'success' | 'reverted' | void = () => undefined,
) {
  const relayed: { permit?: { v: number; r: string; s: string } }[] = [];
  const sent: { to: Hex; data: Hex; value?: bigint; gas?: bigint }[] = [];
  const events: string[] = [];
  const evmSigner: EvmSignerPort = {
    getAddress: () =>
      Promise.resolve('0x2222222222222222222222222222222222222222'),
    getChainId: () => Promise.resolve(8453),
    signTypedData: () => Promise.resolve(signature as Hex),
    sendTransaction: (tx) => {
      sent.push(tx);
      events.push(`send ${tx.data.slice(0, 10)}`);
      return Promise.resolve(
        `0x${String(sent.length).padStart(64, '0')}` as Hex32,
      );
    },
  };
  const evmChain: EvmChainPort = {
    buildUserLock: () =>
      Promise.resolve({
        chain: 'base' as never,
        orderId: `0x${'ab'.repeat(32)}` as Hex32,
        payload,
      }),
    getLock: () => Promise.reject(new Error('unused')),
    waitForReceipt: (hash) => {
      events.push(`receipt ${Number(BigInt(hash))}`);
      const status = receiptStatus(Number(BigInt(hash)));
      return Promise.resolve(status ? { status } : undefined);
    },
    getBlockTimestamp: () => Promise.resolve(0),
  };
  const solver = {
    relayLock: (_id: Hex32, request: unknown) => {
      relayed.push(request as (typeof relayed)[number]);
      return Promise.resolve({
        ok: true,
        orderId: _id,
        txHash: `0x${'cd'.repeat(32)}` as Hex32,
      });
    },
  };
  return { context: { evmSigner, evmChain, solver }, relayed, sent, events };
}

describe('the permit signature v', () => {
  it.each([
    ['1b', 27],
    ['1c', 28],
    ['00', 27],
    ['01', 28],
  ])('a signature ending in %s is sent with v %i', async (ending, v) => {
    const { context, relayed } = harness(
      permitPayload(),
      `0x${R}${S}${ending}`,
    );
    await lockUserOnEvm(context, terms);
    expect(relayed[0]!.permit).toMatchObject({
      v,
      r: `0x${R}`,
      s: `0x${S}`,
    });
  });
});

const TOKEN = '0x3333333333333333333333333333333333333333' as Hex;
const HTLC = '0x4444444444444444444444444444444444444444' as Hex;
const wallet = (kind: string, data: Hex, to: Hex, gas?: bigint) => ({
  kind,
  to,
  data,
  value: 0n,
  ...(gas !== undefined ? { gas, gasSource: 'bound' as const } : {}),
});
const RESET = '0x095ea7b3reset' as Hex;
const APPROVE = '0x095ea7b3approve' as Hex;
const LOCK = '0xdd4ba3a0lock' as Hex;

function approvePayload(transactions?: unknown[]) {
  return {
    mode: 'approve-lock' as const,
    approve: { token: TOKEN, spender: HTLC, amount: 1_000_000n },
    lockCall: {
      address: HTLC,
      args: [TOKEN, TOKEN, 1_000_000n, `0x${'33'.repeat(32)}`, 1_794_800_000n],
    },
    ...(transactions ? { transactions } : {}),
  };
}

describe('approve and lock with an ordered transaction list', () => {
  it('USDT-style: reset, approve, lock, each mined before the next is sent', async () => {
    const { context, sent, events } = harness(
      approvePayload([
        wallet('reset-approval', RESET, TOKEN),
        wallet('approve', APPROVE, TOKEN, 80_000n),
        wallet('lock', LOCK, HTLC, 300_000n),
      ]),
      '0x',
    );

    const hash = await lockUserOnEvm(context, terms);

    expect(sent.map((t) => t.data)).toEqual([RESET, APPROVE, LOCK]);
    expect(sent.map((t) => t.to)).toEqual([TOKEN, TOKEN, HTLC]);
    expect(sent.map((t) => t.gas)).toEqual([undefined, 80_000n, 300_000n]);
    expect(events).toEqual([
      `send ${RESET.slice(0, 10)}`,
      'receipt 1',
      `send ${APPROVE.slice(0, 10)}`,
      'receipt 2',
      `send ${LOCK.slice(0, 10)}`,
      'receipt 3',
    ]);
    expect(hash).toBe(`0x${String(3).padStart(64, '0')}`);
  });

  it('plain token: approve, then lock', async () => {
    const { context, sent } = harness(
      approvePayload([
        wallet('approve', APPROVE, TOKEN),
        wallet('lock', LOCK, HTLC),
      ]),
      '0x',
    );
    await lockUserOnEvm(context, terms);
    expect(sent.map((t) => t.data)).toEqual([APPROVE, LOCK]);
  });

  it('an allowance that already covers the amount: only the lock', async () => {
    const { context, sent } = harness(
      approvePayload([wallet('lock', LOCK, HTLC)]),
      '0x',
    );
    await lockUserOnEvm(context, terms);
    expect(sent.map((t) => t.data)).toEqual([LOCK]);
  });

  it('without the list, keeps sending one approve and the lock', async () => {
    const { context, sent } = harness(approvePayload(), '0x');
    await lockUserOnEvm(context, terms);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.to).toBe(TOKEN);
    expect(sent[0]!.data.startsWith('0x095ea7b3')).toBe(true);
    expect(sent[1]!.to).toBe(HTLC);
  });

  it('refuses a list that does not end with the lock, and sends nothing', async () => {
    const { context, sent } = harness(
      approvePayload([wallet('approve', APPROVE, TOKEN)]),
      '0x',
    );
    await expect(lockUserOnEvm(context, terms)).rejects.toThrow(/lock/i);
    expect(sent).toEqual([]);
  });

  it('stops at the first transaction the wallet refuses, so later ones are not sent', async () => {
    const { context, sent } = harness(
      approvePayload([
        wallet('reset-approval', RESET, TOKEN),
        wallet('approve', APPROVE, TOKEN),
        wallet('lock', LOCK, HTLC),
      ]),
      '0x',
    );
    let calls = 0;
    const original = context.evmSigner.sendTransaction;
    context.evmSigner.sendTransaction = (tx) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('User rejected'));
      return original(tx);
    };
    await expect(lockUserOnEvm(context, terms)).rejects.toMatchObject({
      code: 'WALLET_REJECTED',
    });
    expect(sent.map((t) => t.data)).toEqual([RESET]);
  });
});

describe('a mined transaction that reverted stops the list', () => {
  it('does not send the next step after a reverted reset', async () => {
    const { context, sent } = harness(
      approvePayload([
        wallet('reset-approval', RESET, TOKEN),
        wallet('approve', APPROVE, TOKEN),
        wallet('lock', LOCK, HTLC),
      ]),
      '0x',
      (n) => (n === 1 ? 'reverted' : 'success'),
    );
    await expect(lockUserOnEvm(context, terms)).rejects.toMatchObject({
      code: 'TX_REVERTED',
    });
    expect(sent).toHaveLength(1);
  });

  it('a port that returns nothing is still accepted', async () => {
    const { context, sent } = harness(
      approvePayload([
        wallet('approve', APPROVE, TOKEN),
        wallet('lock', LOCK, HTLC),
      ]),
      '0x',
    );
    await lockUserOnEvm(context, terms);
    expect(sent).toHaveLength(2);
  });
});
