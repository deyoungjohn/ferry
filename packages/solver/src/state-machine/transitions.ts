import {
  assertValidSecret,
  invariantF,
  invariantR,
  revealPolicy,
  type EvmChainId,
  type LockEvidence,
  type RevealConfig,
  type RevealDecision,
  type TimingConfig,
  type TimingDecision,
} from '@ferry/core';
import type {
  OrderStatus,
  SolverEvent,
  SolverOrderRecord,
  SwapDirection,
  TransitionResult,
} from './types.js';

export function isTerminalStatus(status: OrderStatus): boolean {
  return (
    status === 'DONE' ||
    status === 'EXPIRED' ||
    status === 'REJECTED' ||
    status === 'SOLVER_REFUNDED'
  );
}

export function isForwardDirection(direction: SwapDirection): boolean {
  return direction === 'COUNTER_TO_BCH' || direction === 'EVM_TO_BCH';
}

/**
 * Validates timing invariants (invariant F for forward, invariant R for reverse)
 * before counter-locking.
 */
export function checkCounterLockTiming(
  order: SolverOrderRecord,
  bchTipHeight: number,
  nowSeconds: number,
  timingConfig?: TimingConfig,
): TimingDecision {
  const evmDeadline =
    order.terms.evmDeadline ??
    (order.terms as unknown as { counterDeadline?: number }).counterDeadline;
  const deadlineTerms = {
    evmDeadlineSeconds: evmDeadline,
    bchRefundHeight: order.terms.bchRefundHeight,
  };
  const start = {
    unixSeconds: nowSeconds,
    bchTipHeight,
  };

  if (isForwardDirection(order.direction)) {
    return invariantF(deadlineTerms, start, timingConfig);
  } else {
    return invariantR(deadlineTerms, start, timingConfig);
  }
}

function resolveEvmChainName(chainId?: number): EvmChainId {
  if (chainId === 8453 || chainId === 84532 || chainId === 31337) return 'base';
  if (chainId === 1 || chainId === 11155111) return 'ethereum';
  if (chainId === 42161 || chainId === 421614) return 'arbitrum';
  return 'base';
}

/**
 * Validates secret reveal policy (§4.3) for incoming lock evidence.
 */
export function checkLockRevealPolicy(
  order: SolverOrderRecord,
  evidence: LockEvidence,
  config?: RevealConfig,
): RevealDecision {
  const isForward = isForwardDirection(order.direction);
  const chain: 'bch' | EvmChainId = isForward
    ? resolveEvmChainName(order.terms.evmChainId)
    : 'bch';

  const amountUsdMicros = isForward
    ? BigInt(order.terms.evmAmount)
    : BigInt(order.terms.bchTokenAmount) * 10_000n; // PUSD 2 decimals -> 6 decimals ($)

  return revealPolicy(
    {
      chain,
      lane: order.lane ?? 'safe',
      fastOptIn: order.fastOptIn ?? false,
      amountUsdMicros,
      evidence,
    },
    config,
  );
}

/**
 * Pure transition function for the solver state machine in both directions.
 * Throws an error on illegal transitions.
 */
export function transition(
  order: SolverOrderRecord,
  event: SolverEvent,
): TransitionResult {
  const current = order.status;

  // Terminal states cannot transition
  if (isTerminalStatus(current)) {
    return { nextStatus: current };
  }

  switch (event.type) {
    case 'USER_LOCK_SEEN': {
      if (current === 'QUOTED') {
        return {
          nextStatus: 'USER_LOCK_SEEN',
          mutations: { userLockTxId: event.txId },
        };
      }
      if (current === 'USER_LOCK_SEEN') {
        return {
          nextStatus: 'USER_LOCK_SEEN',
          mutations: { userLockTxId: event.txId },
        };
      }
      // If already further along, idempotent no-op
      if (
        current === 'USER_LOCK_FINAL' ||
        current === 'SOLVER_LOCK_BROADCAST' ||
        current === 'SOLVER_LOCK_SEEN' ||
        current === 'SECRET_KNOWN' ||
        current === 'USER_CLAIM_SEEN' ||
        current === 'SOLVER_CLAIM_BROADCAST' ||
        current === 'SOLVER_CLAIM_FINAL'
      ) {
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot apply USER_LOCK_SEEN in state ${current}`,
      );
    }

    case 'USER_LOCK_FINAL': {
      if (current === 'QUOTED' || current === 'USER_LOCK_SEEN') {
        return {
          nextStatus: 'USER_LOCK_FINAL',
          mutations: { userLockTxId: event.txId },
        };
      }
      if (current === 'USER_LOCK_FINAL') {
        return { nextStatus: current };
      }
      if (
        current === 'SOLVER_LOCK_BROADCAST' ||
        current === 'SOLVER_LOCK_SEEN' ||
        current === 'SECRET_KNOWN' ||
        current === 'USER_CLAIM_SEEN' ||
        current === 'SOLVER_CLAIM_BROADCAST' ||
        current === 'SOLVER_CLAIM_FINAL'
      ) {
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot apply USER_LOCK_FINAL in state ${current}`,
      );
    }

    case 'SOLVER_LOCK_BROADCAST': {
      if (current === 'USER_LOCK_FINAL') {
        return {
          nextStatus: 'SOLVER_LOCK_BROADCAST',
          mutations: { solverLockTxId: event.txId },
        };
      }
      if (current === 'SOLVER_LOCK_BROADCAST') {
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot apply SOLVER_LOCK_BROADCAST in state ${current}`,
      );
    }

    case 'SOLVER_LOCK_SEEN': {
      if (
        current === 'USER_LOCK_FINAL' ||
        current === 'SOLVER_LOCK_BROADCAST'
      ) {
        return {
          nextStatus: 'SOLVER_LOCK_SEEN',
          mutations: { solverLockTxId: event.txId },
        };
      }
      if (current === 'SOLVER_LOCK_SEEN') {
        return { nextStatus: current };
      }
      if (
        current === 'SECRET_KNOWN' ||
        current === 'USER_CLAIM_SEEN' ||
        current === 'SOLVER_CLAIM_BROADCAST' ||
        current === 'SOLVER_CLAIM_FINAL'
      ) {
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot apply SOLVER_LOCK_SEEN in state ${current}`,
      );
    }

    case 'SECRET_REVEALED_COOPERATIVE': {
      const hashLock = order.terms?.hashLock ?? order.hashLock;
      assertValidSecret(event.secret, hashLock);

      if (
        current === 'SOLVER_LOCK_SEEN' ||
        current === 'QUOTED' ||
        current === 'USER_LOCK_SEEN' ||
        current === 'USER_LOCK_FINAL' ||
        current === 'SOLVER_LOCK_BROADCAST'
      ) {
        return {
          nextStatus: 'SECRET_KNOWN',
          mutations: {
            secret: event.secret,
            secretSource: 'cooperative',
          },
        };
      }
      if (
        current === 'SECRET_KNOWN' ||
        current === 'USER_CLAIM_SEEN' ||
        current === 'SOLVER_CLAIM_BROADCAST' ||
        current === 'SOLVER_CLAIM_FINAL'
      ) {
        if (!order.secret) {
          return {
            nextStatus: current,
            mutations: {
              secret: event.secret,
              secretSource: 'cooperative',
            },
          };
        }
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot accept cooperative secret reveal in state ${current}`,
      );
    }

    case 'USER_CLAIM_SEEN': {
      const hashLock = order.terms?.hashLock ?? order.hashLock;
      if (event.secret) {
        assertValidSecret(event.secret, hashLock);
      }

      if (
        current === 'QUOTED' ||
        current === 'USER_LOCK_SEEN' ||
        current === 'USER_LOCK_FINAL' ||
        current === 'SOLVER_LOCK_BROADCAST' ||
        current === 'SOLVER_LOCK_SEEN' ||
        current === 'SECRET_KNOWN'
      ) {
        return {
          nextStatus: 'USER_CLAIM_SEEN',
          mutations: {
            userClaimTxId: event.txId,
            ...(event.secret
              ? { secret: event.secret, secretSource: 'on_chain_claim' }
              : {}),
          },
        };
      }
      if (
        current === 'USER_CLAIM_SEEN' ||
        current === 'SOLVER_CLAIM_BROADCAST' ||
        current === 'SOLVER_CLAIM_FINAL'
      ) {
        if (
          event.secret &&
          (!order.secret || order.secretSource !== 'on_chain_claim')
        ) {
          return {
            nextStatus: current,
            mutations: {
              secret: event.secret,
              secretSource: 'on_chain_claim',
              ...(event.txId ? { userClaimTxId: event.txId } : {}),
            },
          };
        }
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: unexpected USER_CLAIM_SEEN in state ${current}`,
      );
    }

    case 'SOLVER_CLAIM_BROADCAST': {
      if (current === 'USER_CLAIM_SEEN') {
        return {
          nextStatus: 'SOLVER_CLAIM_BROADCAST',
          mutations: { solverClaimTxId: event.txId },
        };
      }
      if (current === 'SOLVER_CLAIM_BROADCAST') {
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot apply SOLVER_CLAIM_BROADCAST in state ${current}`,
      );
    }

    case 'SOLVER_CLAIM_FINAL': {
      if (
        current === 'USER_CLAIM_SEEN' ||
        current === 'SOLVER_CLAIM_BROADCAST'
      ) {
        return {
          nextStatus: 'SOLVER_CLAIM_FINAL',
          mutations: { solverClaimTxId: event.txId },
        };
      }
      if (current === 'SOLVER_CLAIM_FINAL') {
        return { nextStatus: current };
      }
      throw new Error(
        `Illegal transition: cannot apply SOLVER_CLAIM_FINAL in state ${current}`,
      );
    }

    case 'SWAP_COMPLETE': {
      if (current === 'SOLVER_CLAIM_FINAL') {
        return { nextStatus: 'DONE' };
      }
      if (current === 'DONE') {
        return { nextStatus: 'DONE' };
      }
      throw new Error(
        `Illegal transition: cannot apply SWAP_COMPLETE in state ${current}`,
      );
    }

    case 'QUOTE_EXPIRED': {
      if (current === 'QUOTED') {
        return { nextStatus: 'EXPIRED' };
      }
      throw new Error(
        `Illegal transition: cannot apply QUOTE_EXPIRED in state ${current}`,
      );
    }

    case 'INVALID_TERMS': {
      if (
        current === 'QUOTED' ||
        current === 'USER_LOCK_SEEN' ||
        current === 'USER_LOCK_FINAL'
      ) {
        return {
          nextStatus: 'REJECTED',
          mutations: { rejectionReason: event.reason },
        };
      }
      throw new Error(
        `Illegal transition: cannot apply INVALID_TERMS in state ${current}`,
      );
    }

    case 'BCH_DEADLINE_PASSED':
    case 'COUNTER_DEADLINE_PASSED': {
      if (
        current === 'SOLVER_LOCK_SEEN' ||
        current === 'SECRET_KNOWN' ||
        current === 'SOLVER_LOCK_BROADCAST'
      ) {
        return {
          nextStatus: 'SOLVER_REFUNDED',
          mutations: { solverRefundTxId: event.refundTxId },
        };
      }
      throw new Error(
        `Illegal transition: cannot apply ${event.type} in state ${current}`,
      );
    }

    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
