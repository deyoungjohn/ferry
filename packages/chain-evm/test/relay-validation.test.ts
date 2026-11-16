import { describe, expect, it } from 'vitest';
import { sha256, stringToHex } from 'viem';
import { orderId, parseOrderTerms } from '@ferry/core';
import type { Hex, Hex32, LockState, OrderTerms } from '@ferry/core';
import {
  RelayValidationError,
  validateRelayClaim,
  validateRelayLock,
} from '../src/index.js';
import type { RelayLockPayload, SignedRelayIntent } from '../src/index.js';

const USER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const SOLVER = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const OTHER_TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const HTLC = '0x8b968625f983420b571c102ec0b57f7e509c916e';

function makeFixture(): {
  secret: Hex32;
  terms: OrderTerms;
  intent: SignedRelayIntent;
  now: number;
} {
  const now = 1_700_000_000;
  const secret = sha256(stringToHex('relay-val-secret'));
  const hashLock = sha256(secret);

  const terms = parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 1000n,
    evmAmount: 10_000_000n,
    evmToken: TOKEN,
    evmChainId: 8453,
    evmHtlc: HTLC,
    userEvmAddress: USER,
    userBchLockingBytecode:
      '0x76a91400112233445566778899aabbccddeeff0011223388ac',
    solverEvmAddress: SOLVER,
    solverBchLockingBytecode:
      '0x76a91433221100ffeeddccbbaa9988776655443322110088ac',
    hashLock,
    evmDeadline: now + 3600,
    bchRefundHeight: 200_000,
    bchCarrySats: 2000n,
    bchMaxFee: 1000n,
    quoteId: 'q-relay-val',
    quoteExpiry: now + 600,
    pricing: {
      refs: [
        {
          asset: 'USDC',
          usdPrice: '1.00',
          source: 'test-fixture',
          asOf: now,
        },
      ],
      spreadBps: 25,
      fixedFeeBase: 0n,
      rounding: 'floor',
    },
  });

  const payload: RelayLockPayload = {
    owner: USER,
    token: TOKEN,
    recipient: SOLVER,
    amount: terms.evmAmount,
    hashLock: terms.hashLock,
    deadline: BigInt(terms.evmDeadline),
    intentDeadline: BigInt(terms.quoteExpiry + 300),
    intentSig: `0x${'11'.repeat(65)}` as Hex,
    permitDeadline: BigInt(terms.quoteExpiry + 300),
    v: 27,
    r: `0x${'22'.repeat(32)}` as Hex32,
    s: `0x${'33'.repeat(32)}` as Hex32,
  };

  const intent: SignedRelayIntent = {
    chain: 'base',
    orderId: orderId(terms),
    evmChainId: 8453,
    verifyingContract: HTLC,
    payload,
  };

  return { secret, terms, intent, now };
}

describe('validateRelayLock', () => {
  it('accepts a matching intent and signed terms', () => {
    const { terms, intent, now } = makeFixture();
    expect(() =>
      validateRelayLock(intent, terms, {
        expectedChain: 'base',
        expectedChainId: 8453,
        expectedHtlc: HTLC,
        nowSeconds: now,
      }),
    ).not.toThrow();
  });

  it('rejects mismatches on amount, token, recipient, hashLock, deadlines, chain, and contract', () => {
    const { terms, intent, now } = makeFixture();
    const basePayload = intent.payload as RelayLockPayload;

    const cases: Array<[string, () => void]> = [
      [
        'AMOUNT_MISMATCH',
        () =>
          validateRelayLock(
            { ...intent, payload: { ...basePayload, amount: 999n } },
            terms,
          ),
      ],
      [
        'TOKEN_MISMATCH',
        () =>
          validateRelayLock(
            { ...intent, payload: { ...basePayload, token: OTHER_TOKEN } },
            terms,
          ),
      ],
      [
        'RECIPIENT_MISMATCH',
        () =>
          validateRelayLock(
            { ...intent, payload: { ...basePayload, recipient: USER } },
            terms,
          ),
      ],
      [
        'HASH_LOCK_MISMATCH',
        () =>
          validateRelayLock(
            {
              ...intent,
              payload: {
                ...basePayload,
                hashLock: sha256(stringToHex('other')),
              },
            },
            terms,
          ),
      ],
      [
        'DEADLINE_MISMATCH',
        () =>
          validateRelayLock(
            {
              ...intent,
              payload: {
                ...basePayload,
                deadline: BigInt(terms.evmDeadline + 1),
              },
            },
            terms,
          ),
      ],
      [
        'INTENT_EXPIRED',
        () =>
          validateRelayLock(intent, terms, {
            nowSeconds: Number(basePayload.intentDeadline) + 1,
          }),
      ],
      [
        'CHAIN_MISMATCH',
        () => validateRelayLock({ ...intent, evmChainId: 1 }, terms),
      ],
      [
        'CONTRACT_MISMATCH',
        () =>
          validateRelayLock(
            { ...intent, verifyingContract: OTHER_TOKEN },
            terms,
          ),
      ],
      [
        'ORDER_ID_MISMATCH',
        () =>
          validateRelayLock(
            { ...intent, orderId: sha256(stringToHex('wrong-order')) },
            terms,
          ),
      ],
      [
        'CHAIN_MISMATCH',
        () =>
          validateRelayLock(intent, terms, {
            expectedChain: 'ethereum',
            nowSeconds: now,
          }),
      ],
    ];

    for (const [expectedCode, fn] of cases) {
      try {
        fn();
        expect.fail(`Expected RelayValidationError(${expectedCode})`);
      } catch (err) {
        expect(err).toBeInstanceOf(RelayValidationError);
        expect((err as RelayValidationError).code).toBe(expectedCode);
      }
    }
  });
});

describe('validateRelayClaim', () => {
  it('accepts a valid open lock, matching secret, unexpired deadline, and gas price within cap', () => {
    const { secret, terms, now } = makeFixture();
    const lock: LockState = {
      status: 'locked',
      lockTx: { chain: 'base', txId: `0x${'44'.repeat(32)}` },
      owner: SOLVER,
      recipient: USER,
      asset: { symbol: 'USDC', decimals: 6, address: TOKEN, permit: true },
      amount: terms.evmAmount,
      hashLock: terms.hashLock,
      deadline: now + 3600,
    };

    expect(() =>
      validateRelayClaim({
        lock,
        secret,
        nowSeconds: now + 100,
        gasPriceWei: 1_000_000_000n,
        maxGasPriceWei: 2_000_000_000n,
      }),
    ).not.toThrow();
  });

  it('rejects bad secret, closed lock, expired deadline, and exceeded gas price cap', () => {
    const { secret, terms, now } = makeFixture();
    const lock: LockState = {
      status: 'locked',
      lockTx: { chain: 'base', txId: `0x${'44'.repeat(32)}` },
      owner: SOLVER,
      recipient: USER,
      asset: { symbol: 'USDC', decimals: 6, address: TOKEN, permit: true },
      amount: terms.evmAmount,
      hashLock: terms.hashLock,
      deadline: now + 3600,
    };

    const expectCode = (code: string, fn: () => void) => {
      try {
        fn();
        expect.fail(`Expected RelayValidationError(${code})`);
      } catch (err) {
        expect(err).toBeInstanceOf(RelayValidationError);
        expect((err as RelayValidationError).code).toBe(code);
      }
    };

    expectCode('INVALID_SECRET', () =>
      validateRelayClaim({
        lock,
        secret: sha256(stringToHex('wrong-secret')),
        nowSeconds: now,
        gasPriceWei: 1n,
        maxGasPriceWei: 10n,
      }),
    );

    expectCode('LOCK_NOT_OPEN', () =>
      validateRelayClaim({
        lock: { status: 'absent' },
        secret,
        nowSeconds: now,
        gasPriceWei: 1n,
        maxGasPriceWei: 10n,
      }),
    );

    expectCode('DEADLINE_EXPIRED', () =>
      validateRelayClaim({
        lock,
        secret,
        nowSeconds: lock.deadline + 1,
        gasPriceWei: 1n,
        maxGasPriceWei: 10n,
      }),
    );

    expectCode('GAS_PRICE_EXCEEDED', () =>
      validateRelayClaim({
        lock,
        secret,
        nowSeconds: now,
        gasPriceWei: 11n,
        maxGasPriceWei: 10n,
      }),
    );
  });
});
