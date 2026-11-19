import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  checkCounterLockTiming,
  checkLockRevealPolicy,
  isTerminalStatus,
  transition,
} from '../src/state-machine/transitions.js';
import type {
  OrderStatus,
  SolverEvent,
  SolverOrderRecord,
} from '../src/state-machine/types.js';
import { parseOrderTerms } from '@ferry/core';

function sha256Hex(hexWithoutPrefix: string): `0x${string}` {
  return `0x${crypto.createHash('sha256').update(Buffer.from(hexWithoutPrefix, 'hex')).digest('hex')}` as `0x${string}`;
}

const defaultSecretHex = 'cc'.repeat(32);
const defaultHashLock = sha256Hex(defaultSecretHex);

describe('Solver pure state machine transitions', () => {
  const dummyForwardTerms = parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 2485n,
    evmAmount: 25000000n,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    evmChainId: 8453,
    evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode:
      '0x76a914000000000000000000000000000000000000000088ac',
    solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
    solverBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    hashLock: defaultHashLock,
    evmDeadline: 1700086400,
    bchRefundHeight: 330000,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'test-quote-1',
    quoteExpiry: 1700000120,
    pricing: {
      refs: [
        {
          asset: 'PUSD',
          usdPrice: '1.000',
          source: 'cauldron',
          asOf: 1700000000,
        },
      ],
      spreadBps: 50,
      fixedFeeBase: 0n,
      rounding: 'floor',
    },
  });

  const dummyReverseTerms = parseOrderTerms({
    ...dummyForwardTerms,
    direction: 'BCH_TO_EVM',
  });

  function makeOrder(
    status: OrderStatus,
    direction: 'COUNTER_TO_BCH' | 'BCH_TO_COUNTER' = 'COUNTER_TO_BCH',
    secret?: `0x${string}` | undefined,
    secretSource?: 'cooperative' | 'on_chain_claim' | undefined,
    hashLockOverride?: `0x${string}`,
  ): SolverOrderRecord {
    const baseTerms =
      direction === 'COUNTER_TO_BCH' ? dummyForwardTerms : dummyReverseTerms;
    const hl =
      hashLockOverride ??
      (secret ? sha256Hex(secret.replace('0x', '')) : baseTerms.hashLock);
    return {
      id: '0x1234',
      direction,
      status,
      terms: {
        ...baseTerms,
        hashLock: hl,
      },
      hashLock: hl,
      secret,
      secretSource,
      createdAt: 1000,
      updatedAt: 1000,
    };
  }

  describe('Forward direction (COUNTER_TO_BCH)', () => {
    const forwardEdges: Array<{
      from: OrderStatus;
      event: SolverEvent;
      expectedNext: OrderStatus;
    }> = [
      {
        from: 'QUOTED',
        event: { type: 'USER_LOCK_SEEN', txId: '0xevm1' },
        expectedNext: 'USER_LOCK_SEEN',
      },
      {
        from: 'USER_LOCK_SEEN',
        event: { type: 'USER_LOCK_FINAL', txId: '0xevm1' },
        expectedNext: 'USER_LOCK_FINAL',
      },
      {
        from: 'USER_LOCK_FINAL',
        event: { type: 'SOLVER_LOCK_BROADCAST', txId: '0xbch1' },
        expectedNext: 'SOLVER_LOCK_BROADCAST',
      },
      {
        from: 'SOLVER_LOCK_BROADCAST',
        event: { type: 'SOLVER_LOCK_SEEN', txId: '0xbch1' },
        expectedNext: 'SOLVER_LOCK_SEEN',
      },
      {
        from: 'SOLVER_LOCK_SEEN',
        event: {
          type: 'SECRET_REVEALED_COOPERATIVE',
          secret: `0x${defaultSecretHex}`,
        },
        expectedNext: 'SECRET_KNOWN',
      },
      {
        from: 'SECRET_KNOWN',
        event: {
          type: 'USER_CLAIM_SEEN',
          txId: '0xbchclaim',
          secret: `0x${defaultSecretHex}`,
        },
        expectedNext: 'USER_CLAIM_SEEN',
      },
      {
        from: 'USER_CLAIM_SEEN',
        event: { type: 'SOLVER_CLAIM_BROADCAST', txId: '0xevmclaim' },
        expectedNext: 'SOLVER_CLAIM_BROADCAST',
      },
      {
        from: 'SOLVER_CLAIM_BROADCAST',
        event: { type: 'SOLVER_CLAIM_FINAL', txId: '0xevmclaim' },
        expectedNext: 'SOLVER_CLAIM_FINAL',
      },
      {
        from: 'SOLVER_CLAIM_FINAL',
        event: { type: 'SWAP_COMPLETE' },
        expectedNext: 'DONE',
      },
    ];

    for (const edge of forwardEdges) {
      it(`transitions from ${edge.from} -> ${edge.expectedNext} on event ${edge.event.type}`, () => {
        const order = makeOrder(edge.from, 'COUNTER_TO_BCH');
        const res = transition(order, edge.event);
        expect(res.nextStatus).toBe(edge.expectedNext);
      });
    }

    it('transitions directly to USER_CLAIM_SEEN when user claims on chain', () => {
      const secret = `0x${'dd'.repeat(32)}` as const;
      const order = makeOrder(
        'SOLVER_LOCK_SEEN',
        'COUNTER_TO_BCH',
        undefined,
        undefined,
        sha256Hex('dd'.repeat(32)),
      );
      const res = transition(order, {
        type: 'USER_CLAIM_SEEN',
        txId: '0xbchclaim_onchain',
        secret,
      });
      expect(res.nextStatus).toBe('USER_CLAIM_SEEN');
      expect(res.mutations?.secret).toBe(secret);
      expect(res.mutations?.secretSource).toBe('on_chain_claim');
    });

    it('marks secretSource as cooperative on SECRET_REVEALED_COOPERATIVE', () => {
      const secret = `0x${'ee'.repeat(32)}` as const;
      const order = makeOrder(
        'SOLVER_LOCK_SEEN',
        'COUNTER_TO_BCH',
        undefined,
        undefined,
        sha256Hex('ee'.repeat(32)),
      );
      const res = transition(order, {
        type: 'SECRET_REVEALED_COOPERATIVE',
        secret,
      });
      expect(res.nextStatus).toBe('SECRET_KNOWN');
      expect(res.mutations?.secret).toBe(secret);
      expect(res.mutations?.secretSource).toBe('cooperative');
    });

    it('updates secretSource from cooperative to on_chain_claim when user claims on chain', () => {
      const order = makeOrder(
        'SECRET_KNOWN',
        'COUNTER_TO_BCH',
        `0x${'ee'.repeat(32)}`,
        'cooperative',
      );
      const res = transition(order, {
        type: 'USER_CLAIM_SEEN',
        txId: '0xbchclaim3',
        secret: `0x${'ee'.repeat(32)}`,
      });
      expect(res.nextStatus).toBe('USER_CLAIM_SEEN');
      expect(res.mutations?.secretSource).toBe('on_chain_claim');
    });
  });

  describe('Reverse direction (BCH_TO_COUNTER)', () => {
    const reverseEdges: Array<{
      from: OrderStatus;
      event: SolverEvent;
      expectedNext: OrderStatus;
    }> = [
      {
        from: 'QUOTED',
        event: { type: 'USER_LOCK_SEEN', txId: '0xbchlock1' },
        expectedNext: 'USER_LOCK_SEEN',
      },
      {
        from: 'USER_LOCK_SEEN',
        event: { type: 'USER_LOCK_FINAL', txId: '0xbchlock1' },
        expectedNext: 'USER_LOCK_FINAL',
      },
      {
        from: 'USER_LOCK_FINAL',
        event: { type: 'SOLVER_LOCK_BROADCAST', txId: '0xevmlock1' },
        expectedNext: 'SOLVER_LOCK_BROADCAST',
      },
      {
        from: 'SOLVER_LOCK_BROADCAST',
        event: { type: 'SOLVER_LOCK_SEEN', txId: '0xevmlock1' },
        expectedNext: 'SOLVER_LOCK_SEEN',
      },
      {
        from: 'SOLVER_LOCK_SEEN',
        event: {
          type: 'SECRET_REVEALED_COOPERATIVE',
          secret: `0x${defaultSecretHex}`,
        },
        expectedNext: 'SECRET_KNOWN',
      },
      {
        from: 'SECRET_KNOWN',
        event: {
          type: 'USER_CLAIM_SEEN',
          txId: '0xevmclaim1',
          secret: `0x${defaultSecretHex}`,
        },
        expectedNext: 'USER_CLAIM_SEEN',
      },
      {
        from: 'USER_CLAIM_SEEN',
        event: { type: 'SOLVER_CLAIM_BROADCAST', txId: '0xbchclaim1' },
        expectedNext: 'SOLVER_CLAIM_BROADCAST',
      },
      {
        from: 'SOLVER_CLAIM_BROADCAST',
        event: { type: 'SOLVER_CLAIM_FINAL', txId: '0xbchclaim1' },
        expectedNext: 'SOLVER_CLAIM_FINAL',
      },
      {
        from: 'SOLVER_CLAIM_FINAL',
        event: { type: 'SWAP_COMPLETE' },
        expectedNext: 'DONE',
      },
    ];

    for (const edge of reverseEdges) {
      it(`transitions reverse from ${edge.from} -> ${edge.expectedNext} on ${edge.event.type}`, () => {
        const order = makeOrder(edge.from, 'BCH_TO_COUNTER');
        const res = transition(order, edge.event);
        expect(res.nextStatus).toBe(edge.expectedNext);
      });
    }

    it('refunds solver EVM lock on COUNTER_DEADLINE_PASSED from SOLVER_LOCK_SEEN', () => {
      const order = makeOrder('SOLVER_LOCK_SEEN', 'BCH_TO_COUNTER');
      const res = transition(order, {
        type: 'COUNTER_DEADLINE_PASSED',
        refundTxId: '0xevmrefund1',
      });
      expect(res.nextStatus).toBe('SOLVER_REFUNDED');
      expect(res.mutations?.solverRefundTxId).toBe('0xevmrefund1');
    });
  });

  describe('Abort edges and terminal states', () => {
    it('aborts from QUOTED on QUOTE_EXPIRED', () => {
      const order = makeOrder('QUOTED');
      const res = transition(order, { type: 'QUOTE_EXPIRED' });
      expect(res.nextStatus).toBe('EXPIRED');
    });

    it('aborts to REJECTED on INVALID_TERMS from QUOTED or USER_LOCK_FINAL', () => {
      const order = makeOrder('USER_LOCK_FINAL');
      const res = transition(order, {
        type: 'INVALID_TERMS',
        reason: 'Timing invariant F failed',
      });
      expect(res.nextStatus).toBe('REJECTED');
      expect(res.mutations?.rejectionReason).toBe('Timing invariant F failed');
    });

    it('aborts to SOLVER_REFUNDED on BCH_DEADLINE_PASSED', () => {
      const order = makeOrder('SOLVER_LOCK_SEEN', 'COUNTER_TO_BCH');
      const res = transition(order, {
        type: 'BCH_DEADLINE_PASSED',
        refundTxId: '0xbchrefund1',
      });
      expect(res.nextStatus).toBe('SOLVER_REFUNDED');
      expect(res.mutations?.solverRefundTxId).toBe('0xbchrefund1');
    });

    it('terminal states ignore any subsequent events (absorption)', () => {
      const terminalStates: OrderStatus[] = [
        'DONE',
        'EXPIRED',
        'REJECTED',
        'SOLVER_REFUNDED',
      ];
      for (const term of terminalStates) {
        expect(isTerminalStatus(term)).toBe(true);
        const order = makeOrder(term);
        const res = transition(order, {
          type: 'USER_LOCK_SEEN',
          txId: '0xlate',
        });
        expect(res.nextStatus).toBe(term);
      }
    });
  });

  describe('Illegal transitions throw an error', () => {
    it('throws when applying SOLVER_LOCK_BROADCAST from QUOTED', () => {
      const order = makeOrder('QUOTED');
      expect(() =>
        transition(order, { type: 'SOLVER_LOCK_BROADCAST', txId: '0xbad' }),
      ).toThrow(/Illegal transition/);
    });

    it('throws when applying SOLVER_CLAIM_BROADCAST from QUOTED', () => {
      const order = makeOrder('QUOTED');
      expect(() =>
        transition(order, { type: 'SOLVER_CLAIM_BROADCAST', txId: '0xbad' }),
      ).toThrow(/Illegal transition/);
    });

    it('throws when applying QUOTE_EXPIRED from SOLVER_LOCK_SEEN', () => {
      const order = makeOrder('SOLVER_LOCK_SEEN');
      expect(() => transition(order, { type: 'QUOTE_EXPIRED' })).toThrow(
        /Illegal transition/,
      );
    });
  });

  describe('Timing Invariants and Reveal Policy Helpers', () => {
    it('checks invariant F on forward order: refuses counter-lock when margin is insufficient', () => {
      const order = makeOrder('USER_LOCK_FINAL', 'COUNTER_TO_BCH');
      // Set deadline in past relative to start time
      const timingDecision = checkCounterLockTiming(
        order,
        330000 - 10, // 10 blocks remaining
        order.terms.evmDeadline + 100, // already expired!
      );
      expect(timingDecision.allowed).toBe(false);
      expect(timingDecision.reason).toBe('expired');
    });

    it('checks invariant R on reverse order: refuses counter-lock when remaining blocks < 33', () => {
      const order = makeOrder('USER_LOCK_FINAL', 'BCH_TO_COUNTER');
      // Only 20 remaining blocks (minReverseRemainingBlocks is 33)
      const timingDecision = checkCounterLockTiming(
        order,
        order.terms.bchRefundHeight - 20,
        1700000000,
      );
      expect(timingDecision.allowed).toBe(false);
      expect(timingDecision.reason).toBe('remaining-blocks');
    });

    it('checks reveal policy for BCH 0-conf fast lane: refuses if dsproof detected', () => {
      const order = makeOrder('USER_LOCK_SEEN', 'BCH_TO_COUNTER');
      order.lane = 'fast';
      order.fastOptIn = true;

      const decision = checkLockRevealPolicy(order, {
        exists: true,
        confirmations: 0,
        dsproof: 'detected',
        dsproofElapsedMs: 6000,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('dsproof');
    });

    it('checks reveal policy for BCH 0-conf fast lane: allows when window elapsed and dsproof clear', () => {
      const order = makeOrder('USER_LOCK_SEEN', 'BCH_TO_COUNTER');
      order.lane = 'fast';
      order.fastOptIn = true;

      const decision = checkLockRevealPolicy(order, {
        exists: true,
        confirmations: 0,
        dsproof: 'clear',
        dsproofElapsedMs: 5000,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('ready');
    });
  });
});
