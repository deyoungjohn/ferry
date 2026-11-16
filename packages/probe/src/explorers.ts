import type { Direction, Hex32 } from '@ferry/core';
import type { ProbeMode, ProbeNetwork } from './safety.js';

export interface ProbeWaitStep {
  readonly name: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
}

export interface ProbeEvidence {
  readonly schemaVersion: 1;
  readonly network: ProbeNetwork;
  readonly mode: ProbeMode;
  readonly dryRun: boolean;
  readonly status: 'dry-run' | 'claimed' | 'refunded';
  readonly direction: Direction;
  readonly chainId: number;
  readonly orderId: Hex32;
  readonly quoteId: string;
  readonly recoveryFilePath: string;
  readonly recoverySavedBeforeLock: boolean;
  readonly amounts: {
    readonly evmToken: string;
    readonly evmAmount: string;
    readonly bchToken: 'PUSD' | 'MUSD';
    readonly bchTokenAmount: string;
  };
  readonly pricing: {
    readonly spreadBps: number;
    readonly fixedFeeBase: string;
    readonly rounding: 'floor';
    readonly refs: ReadonlyArray<{
      readonly asset: string;
      readonly usdPrice: string;
      readonly source: string;
      readonly asOf: number;
    }>;
  };
  readonly txids: {
    readonly userLockTxid: string | null;
    readonly solverLockTxid: string | null;
    readonly claimTxid: string | null;
    readonly refundTxid: string | null;
  };
  readonly explorerLinks: {
    readonly userLock: string | null;
    readonly solverLock: string | null;
    readonly claim: string | null;
    readonly refund: string | null;
  };
  readonly waits: readonly ProbeWaitStep[];
  readonly durationsMs: {
    readonly total: number;
    readonly quote: number;
    readonly lock: number;
    readonly counterpartyWait: number;
    readonly settle: number;
  };
}

const EVM_EXPLORER_TX_BASE: Readonly<Record<number, string>> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  84532: 'https://sepolia.basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
  421614: 'https://sepolia.arbiscan.io/tx/',
};

export function explorerTxUrl(
  chain:
    | { readonly kind: 'evm'; readonly chainId: number }
    | { readonly kind: 'bch'; readonly network: 'chipnet' | 'mainnet' },
  txid: string | null,
): string | null {
  if (!txid) return null;
  if (chain.kind === 'evm') {
    const base = EVM_EXPLORER_TX_BASE[chain.chainId];
    return base ? `${base}${txid}` : null;
  }
  const cleanTxid = txid.replace(/^0x/i, '');
  return chain.network === 'mainnet'
    ? `https://blockchair.com/bitcoin-cash/transaction/${cleanTxid}`
    : `https://chipnet.chaingraph.cash/tx/${cleanTxid}`;
}

export function formatEvidenceSummary(evidence: ProbeEvidence): string {
  const refLine = evidence.pricing.refs
    .map((r) => `${r.asset}=$${r.usdPrice} (${r.source}@${r.asOf})`)
    .join(', ');
  const lines = [
    `Ferry Probe [${evidence.status.toUpperCase()}] ${evidence.network} ${evidence.direction} (${evidence.mode})`,
    `Order: ${evidence.orderId} (quote ${evidence.quoteId})`,
    `Recovery saved before lock: ${evidence.recoverySavedBeforeLock ? 'yes' : 'no'} (${evidence.recoveryFilePath})`,
    `Amounts: EVM=${evidence.amounts.evmAmount} (${evidence.amounts.evmToken}) | BCH=${evidence.amounts.bchTokenAmount} ${evidence.amounts.bchToken}`,
    `Pricing: spread=${evidence.pricing.spreadBps}bps fee=${evidence.pricing.fixedFeeBase} rounding=${evidence.pricing.rounding} | refs: ${refLine}`,
    `Durations (ms): total=${evidence.durationsMs.total} quote=${evidence.durationsMs.quote} lock=${evidence.durationsMs.lock} wait=${evidence.durationsMs.counterpartyWait} settle=${evidence.durationsMs.settle}`,
  ];

  if (evidence.txids.userLockTxid) {
    lines.push(
      `User lock: ${evidence.txids.userLockTxid}${evidence.explorerLinks.userLock ? ` -> ${evidence.explorerLinks.userLock}` : ''}`,
    );
  }
  if (evidence.txids.solverLockTxid) {
    lines.push(
      `Solver lock: ${evidence.txids.solverLockTxid}${evidence.explorerLinks.solverLock ? ` -> ${evidence.explorerLinks.solverLock}` : ''}`,
    );
  }
  if (evidence.txids.claimTxid) {
    lines.push(
      `Claim: ${evidence.txids.claimTxid}${evidence.explorerLinks.claim ? ` -> ${evidence.explorerLinks.claim}` : ''}`,
    );
  }
  if (evidence.txids.refundTxid) {
    lines.push(
      `Refund: ${evidence.txids.refundTxid}${evidence.explorerLinks.refund ? ` -> ${evidence.explorerLinks.refund}` : ''}`,
    );
  }
  if (evidence.waits.length > 0) {
    lines.push(
      `Waits: ${evidence.waits.map((w) => `${w.name} (${w.durationMs}ms)`).join(' -> ')}`,
    );
  }

  return lines.join('\n');
}
