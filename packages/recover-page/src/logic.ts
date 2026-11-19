import {
  buildEvmRecoveryCalldata,
  orderId,
  parseRecoveryFileJson,
  recoveryActions,
  type EvmRecoveryCalldata,
  type LockChainStatus,
  type RecoveryFile,
  type RecoveryPlan,
} from '@ferry/core';
import {
  buildBchRecoveryTransaction,
  type BchRecoveryTransactionResult,
  type HtlcUtxo,
} from '@ferry/htlc-bch';

export interface EvmReading {
  readonly nowSeconds: number;
  readonly lockStatus: LockChainStatus;
  readonly refundTx?: string | undefined;
  readonly refundKind?: 'release' | 'keeper' | 'user' | undefined;
}

export interface BchReading {
  readonly tipHeight: number;
  /** Unspent outputs sitting on the swap's Bitcoin Cash contract. */
  readonly utxos: readonly HtlcUtxo[];
}

/** The two things the page reads from the outside world. Replaced by fakes in tests. */
export interface RecoveryPorts {
  readEvm(file: RecoveryFile): Promise<EvmReading>;
  readBch(file: RecoveryFile): Promise<BchReading>;
}

export interface Inspection {
  readonly file: RecoveryFile;
  /** Null when a chain could not be read: the page does not guess what to do then. */
  readonly plan: RecoveryPlan | null;
  readonly evm: EvmReading | null;
  readonly bch: BchReading | null;
  readonly errors: { readonly evm?: string; readonly bch?: string };
  /** The EVM transaction to send, whenever one can be built (it may not be time yet). */
  readonly evmCall: EvmRecoveryCalldata | null;
  /** The signed-nothing-needed Bitcoin Cash transaction, once the plan says it is ready. */
  readonly bchTx: BchRecoveryTransactionResult | null;
  readonly bchTxError: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a recovery file and refuse one that is damaged: it must parse, and its order id must be the
 * hash of its own terms. Nothing here touches the network.
 */
export function loadRecoveryFile(json: string): RecoveryFile {
  let file: RecoveryFile;
  try {
    file = parseRecoveryFileJson(json);
  } catch (error) {
    throw new Error(
      `This is not a Ferry recovery file, or it is damaged. ${messageOf(error)}`,
      { cause: error },
    );
  }
  if (orderId(file.terms) !== file.orderId) {
    throw new Error(
      'This recovery file does not match itself (its order id is not the hash of its terms). Do not use it.',
    );
  }
  return file;
}

function buildEvmCall(file: RecoveryFile): EvmRecoveryCalldata | null {
  try {
    return buildEvmRecoveryCalldata(file);
  } catch {
    return null;
  }
}

/**
 * Read both chains, work out what the user can do now, and build the transactions. A failed read
 * is reported plainly and no plan is made from a guess.
 */
export async function inspectRecovery(
  file: RecoveryFile,
  ports: RecoveryPorts,
): Promise<Inspection> {
  const [evmResult, bchResult] = await Promise.allSettled([
    ports.readEvm(file),
    ports.readBch(file),
  ]);
  const errors: { evm?: string; bch?: string } = {};
  if (evmResult.status === 'rejected') errors.evm = messageOf(evmResult.reason);
  if (bchResult.status === 'rejected') errors.bch = messageOf(bchResult.reason);
  const evm = evmResult.status === 'fulfilled' ? evmResult.value : null;
  const bch = bchResult.status === 'fulfilled' ? bchResult.value : null;

  const evmCall = buildEvmCall(file);
  if (!evm || !bch) {
    return {
      file,
      plan: null,
      evm,
      bch,
      errors,
      evmCall,
      bchTx: null,
      bchTxError: null,
    };
  }

  const plan = recoveryActions(file, {
    nowSeconds: evm.nowSeconds,
    bchTipHeight: bch.tipHeight,
    evmLock: { state: evm.lockStatus },
    bchLock: { state: bch.utxos.length > 0 ? 'locked' : 'none' },
  });

  let bchTx: BchRecoveryTransactionResult | null = null;
  let bchTxError: string | null = null;
  if (plan.actions.some((action) => action.chain === 'BCH')) {
    try {
      bchTx = buildBchRecoveryTransaction({ file, utxos: bch.utxos });
    } catch (error) {
      bchTxError = messageOf(error);
    }
  }
  return { file, plan, evm, bch, errors, evmCall, bchTx, bchTxError };
}
