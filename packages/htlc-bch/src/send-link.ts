import {
  planSendLinkWindow,
  type CounterLockTime,
  type SendLinkWindowPlan,
  type TimingConfig,
} from '@ferry/core';
import { encodeHtlcParameters } from './contract.js';
import {
  buildLockTransaction,
  type BuildLockTxResult,
  type LockUtxo,
} from './lock.js';
import type { BchHtlcParameters, CashAddressNetwork } from './types.js';

export interface BuildSendLinkBchLockOptions {
  windowSeconds: number;
  start: CounterLockTime;
  config?: TimingConfig;
  extraBchMarginBlocks?: number;
  senderLockingBytecode: Uint8Array | string;
  solverLockingBytecode: Uint8Array | string;
  hashLock: Uint8Array | string;
  tokenCategory: string;
  tokenAmount: bigint;
  maxFee: bigint;
  carrySats?: bigint;
  utxos: readonly LockUtxo[];
  changeAddress: string;
  network?: CashAddressNetwork;
}

export interface BuildSendLinkBchLockResult {
  plan: SendLinkWindowPlan;
  params: BchHtlcParameters;
  lockTx: BuildLockTxResult;
}

/**
 * Plan the send-link BCH refund height for window W (24h, 3d, 7d) and build
 * the sender's BCH HTLC lock transaction (recipient = solver, refund = sender).
 */
export function buildSendLinkBchLock(
  options: BuildSendLinkBchLockOptions,
): BuildSendLinkBchLockResult {
  const plan = planSendLinkWindow({
    windowSeconds: options.windowSeconds,
    start: options.start,
    ...(options.config !== undefined ? { config: options.config } : {}),
    ...(options.extraBchMarginBlocks !== undefined
      ? { extraBchMarginBlocks: options.extraBchMarginBlocks }
      : {}),
  });

  if (!plan.ok) {
    throw new Error(
      `Send-link window plan failed (${plan.reason}): ${plan.message}`,
    );
  }

  const params = encodeHtlcParameters({
    hashLock: options.hashLock,
    recipientLockingBytecode: options.solverLockingBytecode,
    refundLockingBytecode: options.senderLockingBytecode,
    tokenCategory: options.tokenCategory,
    tokenAmount: options.tokenAmount,
    refundHeight: plan.bchRefundHeight,
    maxFee: options.maxFee,
  });

  const lockTx = buildLockTransaction({
    params,
    utxos: [...options.utxos],
    changeAddress: options.changeAddress,
    ...(options.carrySats !== undefined
      ? { carrySats: options.carrySats }
      : {}),
    ...(options.network !== undefined ? { network: options.network } : {}),
  });

  return { plan, params, lockTx };
}
