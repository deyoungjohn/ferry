import { describe, expect, it } from 'vitest';
import {
  paymentSummary,
  readPayLink,
  readPayLinkState,
} from '../lib/paylink/pay-api';

// The shape of the solver's answer for a paid open link (summary inside the order).
const answer = {
  id: 'abc',
  recipientAddress: 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65',
  token: 'PUSD',
  status: 'paid',
  createdAt: 1,
  paidAt: 2,
  orderId: '0x' + 'aa'.repeat(32),
  order: {
    state: 'DONE',
    txids: {},
    createdAt: 1,
    updatedAt: 2,
    timeline: [],
    summary: {
      bchToken: 'PUSD',
      bchTokenAmount: '195',
      evmAmount: '1960000',
      evmChainId: 56,
      evmToken: 'USDT',
      evmDecimals: 6,
    },
  },
};
const fetchFn = (() =>
  Promise.resolve(
    new Response(JSON.stringify(answer), { status: 200 }),
  )) as unknown as typeof fetch;

describe('a paid open pay link', () => {
  it('gives the page what the creator received and what the payer used', async () => {
    const link = await readPayLink('https://solver.test', 'abc', fetchFn);
    expect(paymentSummary(link?.order)).toEqual({
      received: 1.95,
      paid: 1.96,
      payToken: 'USDT',
      chainId: 56,
    });
  });

  it('gives the table the amount received once paid', async () => {
    const state = await readPayLinkState('https://solver.test', 'abc', fetchFn);
    expect(state?.paidAmount).toBe(1.95);
  });
});
