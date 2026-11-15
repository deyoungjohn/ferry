import { describe, expect, it } from 'vitest';
import {
  cashAddressToLockingBytecode,
  decodeCashAddress,
  isSingleUsePayLink,
  parsePayLink,
  quoteExactIn,
  quotePayLinkExactOut,
  transitionPayLinkStatus,
  validatePayLinkRecipient,
  type PayLink,
} from '../src/index.js';

const CHIPNET_TOKEN_ADDR = 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk';
const MAINNET_P2PKH_ADDR =
  'bitcoincash:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zye3kwllue';
const CHIPNET_P2SH32_TOKEN_ADDR =
  'bchtest:rv3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy5ghlh3cy';

const P2PKH_LOCKING_BYTECODE = `0x76a914${'11'.repeat(20)}88ac` as const;
const P2SH32_LOCKING_BYTECODE = `0xaa20${'22'.repeat(32)}87` as const;

function baseFixedPayLink(overrides: Partial<PayLink> = {}): PayLink {
  return parsePayLink({
    id: '4vJ9JU1bJJE96FWSJKvHsm',
    recipientCashaddr: CHIPNET_TOKEN_ADDR,
    recipientLockingBytecode: P2PKH_LOCKING_BYTECODE,
    token: 'PUSD',
    amountOut: 4000n,
    note: 'Coffee and lunch',
    expiresAt: 1_800_000_000,
    verified: true,
    status: 'open',
    createdAt: 1_799_900_000,
    ...overrides,
  });
}

describe('CashAddr decoding and PayLink recipient validation', () => {
  it('decodes mainnet P2PKH, chipnet token-aware P2PKH, and chipnet token-aware P2SH32', () => {
    const mainnet = decodeCashAddress(MAINNET_P2PKH_ADDR);
    expect(mainnet.prefix).toBe('bitcoincash');
    expect(mainnet.type).toBe('p2pkh');
    expect(mainnet.tokenAware).toBe(false);
    expect(mainnet.lockingBytecode).toBe(P2PKH_LOCKING_BYTECODE);

    const tokenP2pkh = decodeCashAddress(CHIPNET_TOKEN_ADDR);
    expect(tokenP2pkh.prefix).toBe('bchtest');
    expect(tokenP2pkh.type).toBe('p2pkhWithTokens');
    expect(tokenP2pkh.tokenAware).toBe(true);
    expect(tokenP2pkh.lockingBytecode).toBe(P2PKH_LOCKING_BYTECODE);

    const tokenP2sh32 = decodeCashAddress(CHIPNET_P2SH32_TOKEN_ADDR);
    expect(tokenP2sh32.type).toBe('p2shWithTokens');
    expect(tokenP2sh32.tokenAware).toBe(true);
    expect(tokenP2sh32.lockingBytecode).toBe(P2SH32_LOCKING_BYTECODE);
    expect(cashAddressToLockingBytecode(CHIPNET_P2SH32_TOKEN_ADDR)).toBe(
      P2SH32_LOCKING_BYTECODE,
    );
  });

  it('rejects malformed CashAddr strings and locking-bytecode mismatches', () => {
    expect(() => decodeCashAddress('')).toThrow();
    expect(() => decodeCashAddress('qqg3zyg3zyg3zyg3zye3kwllue')).toThrow();
    expect(() =>
      decodeCashAddress('bchtest:Zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk'),
    ).toThrow();
    expect(() =>
      decodeCashAddress('unknown:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zye3kwllue'),
    ).toThrow();
    expect(() => decodeCashAddress('bchtest:qqqq')).toThrow();
    expect(() =>
      decodeCashAddress('bchtest:1111111111111111111111111111111111111111'),
    ).toThrow();
    expect(() =>
      decodeCashAddress('bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyj'),
    ).toThrow(/checksum/);

    const mismatch = validatePayLinkRecipient(
      CHIPNET_TOKEN_ADDR,
      P2SH32_LOCKING_BYTECODE,
    );
    expect(mismatch.ok).toBe(false);
    expect(
      validatePayLinkRecipient('invalid-addr', P2PKH_LOCKING_BYTECODE).ok,
    ).toBe(false);
  });
});

describe('PayLink schema and status transitions', () => {
  it('validates PayLink schema and rejects invalid fields', () => {
    const fixed = baseFixedPayLink();
    expect(isSingleUsePayLink(fixed)).toBe(true);

    const openAmount = parsePayLink({
      id: '4vJ9JU1bJJE96FWSJKvHsm',
      recipientCashaddr: CHIPNET_TOKEN_ADDR,
      recipientLockingBytecode: P2PKH_LOCKING_BYTECODE,
      token: 'MUSD',
      minAmountOut: 100n,
      verified: false,
      status: 'open',
      createdAt: 1_799_900_000,
    });
    expect(isSingleUsePayLink(openAmount)).toBe(false);

    expect(() =>
      parsePayLink({
        ...fixed,
        note: 'a'.repeat(141),
      }),
    ).toThrow();

    expect(() =>
      parsePayLink({
        ...fixed,
        expiresAt: 1_800_000_000_000, // milliseconds rejected
      }),
    ).toThrow();

    expect(() =>
      parsePayLink({
        ...fixed,
        minAmountOut: 5000n, // exceeds amountOut 4000n
      }),
    ).toThrow();

    expect(() =>
      parsePayLink({
        ...fixed,
        recipientLockingBytecode: P2SH32_LOCKING_BYTECODE,
      }),
    ).toThrow();
  });

  it('transitions fixed-amount links to paid (single-use) and keeps no-amount links open', () => {
    const fixed = baseFixedPayLink();
    const reserved = transitionPayLinkStatus(fixed, {
      type: 'reserve',
      nowSeconds: 1_799_950_000,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.status).toBe('reserved');

    // Second concurrent reservation is rejected
    const secondReserve = transitionPayLinkStatus(reserved.link, {
      type: 'reserve',
      nowSeconds: 1_799_950_010,
    });
    expect(secondReserve).toEqual({
      ok: false,
      reason: 'already-reserved',
      status: 'reserved',
    });

    // Payment marks fixed-amount link as paid (terminal)
    const paid = transitionPayLinkStatus(reserved.link, {
      type: 'pay',
      nowSeconds: 1_799_950_020,
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.status).toBe('paid');

    expect(
      transitionPayLinkStatus(paid.link, {
        type: 'pay',
        nowSeconds: 1_799_950_030,
      }),
    ).toEqual({ ok: false, reason: 'already-terminal', status: 'paid' });

    // No-amount link stays open after payment
    const noAmount = parsePayLink({
      id: '4vJ9JU1bJJE96FWSJKvHsm',
      recipientCashaddr: CHIPNET_TOKEN_ADDR,
      recipientLockingBytecode: P2PKH_LOCKING_BYTECODE,
      token: 'PUSD',
      verified: true,
      status: 'open',
      createdAt: 1_799_900_000,
    });
    const paidOpen = transitionPayLinkStatus(noAmount, {
      type: 'pay',
      nowSeconds: 1_799_950_000,
    });
    expect(paidOpen.ok).toBe(true);
    if (paidOpen.ok) {
      expect(paidOpen.status).toBe('open');
    }
  });

  it('handles release, expiry, and cancellation transitions', () => {
    const fixed = baseFixedPayLink();
    expect(
      transitionPayLinkStatus(fixed, {
        type: 'release',
        nowSeconds: 1_799_950_000,
      }),
    ).toEqual({ ok: false, reason: 'not-reserved', status: 'open' });

    const reserved = transitionPayLinkStatus(fixed, {
      type: 'reserve',
      nowSeconds: 1_799_950_000,
    });
    if (!reserved.ok) throw new Error('expected reserve ok');

    const released = transitionPayLinkStatus(reserved.link, {
      type: 'release',
      nowSeconds: 1_799_950_100,
    });
    expect(released.ok).toBe(true);
    if (released.ok) expect(released.status).toBe('open');

    // Releasing after expiresAt transitions to expired
    const releasedExpired = transitionPayLinkStatus(reserved.link, {
      type: 'release',
      nowSeconds: 1_800_000_000,
    });
    expect(releasedExpired.ok).toBe(true);
    if (releasedExpired.ok) expect(releasedExpired.status).toBe('expired');

    // Expired link refuses reserve/pay
    expect(
      transitionPayLinkStatus(fixed, {
        type: 'reserve',
        nowSeconds: 1_800_000_000,
      }),
    ).toEqual({ ok: false, reason: 'link-expired', status: 'open' });

    expect(
      transitionPayLinkStatus(fixed, {
        type: 'expire',
        nowSeconds: 1_799_999_999,
      }),
    ).toEqual({ ok: false, reason: 'not-expired', status: 'open' });

    const expired = transitionPayLinkStatus(fixed, {
      type: 'expire',
      nowSeconds: 1_800_000_000,
    });
    expect(expired.ok).toBe(true);
    if (expired.ok) expect(expired.status).toBe('expired');

    const cancelled = transitionPayLinkStatus(fixed, { type: 'cancel' });
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.status).toBe('cancelled');
  });
});

describe('PayLink exact-output quoting', () => {
  const policy = { spreadBps: 50, fixedFeeUsdMicros: 100_000n };

  it('computes exact-output payer amount covering recipient amountOut', () => {
    const fixed = baseFixedPayLink({ amountOut: 4000n }); // 40.00 PUSD
    const quote = quotePayLinkExactOut({
      link: fixed,
      fromDecimals: 6,
      policy,
      nowSeconds: 1_799_950_000,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.recipientAmountOut).toBe(4000n);
    expect(
      quoteExactIn(quote.payerAmountIn, 6, 2, policy),
    ).toBeGreaterThanOrEqual(4000n);
    expect(quoteExactIn(quote.payerAmountIn - 1n, 6, 2, policy)).toBeLessThan(
      4000n,
    );
  });

  it('enforces link status, expiry, minAmountOut, and fixed-amount equality', () => {
    const fixed = baseFixedPayLink({ amountOut: 4000n });
    expect(
      quotePayLinkExactOut({
        link: { ...fixed, status: 'reserved' },
        fromDecimals: 6,
        policy,
        nowSeconds: 1_799_950_000,
      }),
    ).toEqual({ ok: false, reason: 'link-not-payable' });

    expect(
      quotePayLinkExactOut({
        link: fixed,
        fromDecimals: 6,
        policy,
        nowSeconds: 1_800_000_000,
      }),
    ).toEqual({ ok: false, reason: 'link-expired' });

    expect(
      quotePayLinkExactOut({
        link: fixed,
        amountOut: 3000n,
        fromDecimals: 6,
        policy,
        nowSeconds: 1_799_950_000,
      }),
    ).toEqual({ ok: false, reason: 'amount-mismatch' });

    const openLink = parsePayLink({
      id: '4vJ9JU1bJJE96FWSJKvHsm',
      recipientCashaddr: CHIPNET_TOKEN_ADDR,
      recipientLockingBytecode: P2PKH_LOCKING_BYTECODE,
      token: 'MUSD',
      minAmountOut: 500n,
      verified: false,
      status: 'open',
      createdAt: 1_799_900_000,
    });

    expect(
      quotePayLinkExactOut({
        link: openLink,
        fromDecimals: 18,
        policy,
        nowSeconds: 1_799_950_000,
      }),
    ).toEqual({ ok: false, reason: 'missing-amount' });

    expect(
      quotePayLinkExactOut({
        link: openLink,
        amountOut: 499n,
        fromDecimals: 18,
        policy,
        nowSeconds: 1_799_950_000,
      }),
    ).toEqual({ ok: false, reason: 'below-min-amount' });

    const openQuote = quotePayLinkExactOut({
      link: openLink,
      amountOut: 1500n,
      fromDecimals: 18,
      policy,
      nowSeconds: 1_799_950_000,
    });
    expect(openQuote.ok).toBe(true);
    if (openQuote.ok) {
      expect(
        quoteExactIn(openQuote.payerAmountIn, 18, 2, policy),
      ).toBeGreaterThanOrEqual(1500n);
    }
  });
});
