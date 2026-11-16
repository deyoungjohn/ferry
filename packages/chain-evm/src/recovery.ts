import {
  isValidSecret,
  type Hex32,
  type LockChainStatus,
  type RecoveryAction,
  type RecoveryWait,
} from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import type { Address, PublicClient } from 'viem';

const LOCK_STATE_MAP: Record<number, LockChainStatus> = {
  0: 'none',
  1: 'locked',
  2: 'claimed',
  3: 'refunded',
};

export interface EvmWalletRecoveryInput {
  status: LockChainStatus;
  deadline: number;
  nowSeconds: number;
  hashLock: Hex32;
  secret?: Hex32;
  blockTimeSeconds?: number;
}

export interface EvmWalletRecoveryPlan {
  status: LockChainStatus;
  actions: RecoveryAction[];
  waits: RecoveryWait[];
  secondsRemaining?: number;
  blocksRemaining?: number;
  summary: string;
}

/**
 * Computes the user's possible EVM recovery actions for a single lock
 * (claim now with valid secret, refund at/after deadline, or wait for N blocks / seconds).
 * Reuses `@ferry/core` recovery types for consumption by the web recovery page.
 */
export function getEvmWalletRecoveryActions(
  input: EvmWalletRecoveryInput,
): EvmWalletRecoveryPlan {
  const actions: RecoveryAction[] = [];
  const waits: RecoveryWait[] = [];

  if (input.status === 'none') {
    return {
      status: 'none',
      actions,
      waits: [
        {
          chain: 'EVM',
          action: 'claim',
          waitingFor: 'Lock has not appeared on chain yet',
        },
      ],
      summary: 'Lock has not appeared on chain yet',
    };
  }

  if (input.status === 'claimed' || input.status === 'refunded') {
    return {
      status: input.status,
      actions,
      waits,
      summary: `Lock already ${input.status} on chain`,
    };
  }

  // status === 'locked'
  if (input.secret && isValidSecret(input.secret, input.hashLock)) {
    actions.push({ chain: 'EVM', action: 'claim' });
  }

  let secondsRemaining: number | undefined;
  let blocksRemaining: number | undefined;

  if (input.nowSeconds >= input.deadline) {
    actions.push({ chain: 'EVM', action: 'refund' });
  } else {
    secondsRemaining = input.deadline - input.nowSeconds;
    if (input.blockTimeSeconds && input.blockTimeSeconds > 0) {
      blocksRemaining = Math.ceil(secondsRemaining / input.blockTimeSeconds);
      waits.push({
        chain: 'EVM',
        action: 'refund',
        waitingFor: `Wait ${blocksRemaining} blocks (~${secondsRemaining}s) until refund deadline`,
      });
    } else {
      waits.push({
        chain: 'EVM',
        action: 'refund',
        waitingFor: `Wait ${secondsRemaining}s until refund deadline`,
      });
    }
  }

  const summary =
    actions.length > 0
      ? `Ready: ${actions.map((a) => `${a.chain} ${a.action}`).join(', ')}`
      : waits.map((w) => w.waitingFor).join('; ');

  return {
    status: input.status,
    actions,
    waits,
    ...(secondsRemaining !== undefined ? { secondsRemaining } : {}),
    ...(blocksRemaining !== undefined ? { blocksRemaining } : {}),
    summary,
  };
}

export interface InspectEvmWalletRecoveryOptions {
  client: PublicClient;
  htlc: Address;
  lockId: Hex32;
  secret?: Hex32;
  blockTimeSeconds?: number;
}

export async function inspectEvmWalletRecovery(
  options: InspectEvmWalletRecoveryOptions,
): Promise<EvmWalletRecoveryPlan> {
  const [block, lockTuple] = await Promise.all([
    options.client.getBlock({ blockTag: 'latest' }),
    options.client.readContract({
      address: options.htlc,
      abi: ferryHtlcAbi,
      functionName: 'locks',
      args: [options.lockId],
    }),
  ]);

  const hashLock = lockTuple[4].toLowerCase() as Hex32;
  const deadline = Number(lockTuple[5]);
  const status = LOCK_STATE_MAP[Number(lockTuple[6])] ?? 'none';

  return getEvmWalletRecoveryActions({
    status,
    deadline,
    nowSeconds: Number(block.timestamp),
    hashLock,
    ...(options.secret !== undefined ? { secret: options.secret } : {}),
    ...(options.blockTimeSeconds !== undefined
      ? { blockTimeSeconds: options.blockTimeSeconds }
      : {}),
  });
}
