import type { Hex, Hex32, OrderTerms } from '@ferry/core';
import {
  buildLockTransaction,
  buildWizardConnectSignRequest,
  inspectSignedTransaction,
  type LockUtxo,
} from '@ferry/htlc-bch';
import { encodeFunctionData, parseAbi, parseSignature } from 'viem';
import { UserFlowError } from './errors.js';
import type {
  BchChainPort,
  BchSignerPort,
  BchUtxo,
  EvmChainPort,
  EvmSignerPort,
  SolverPort,
} from './ports.js';

const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
]);
const HTLC_LOCK_ABI = parseAbi([
  'function lock(address token, address recipient, uint256 amount, bytes32 hashLock, uint64 deadline) external returns (bytes32)',
]);

interface PermitIntentPayload {
  readonly mode: 'permit-intent';
  readonly permitTypedData: { readonly message: { readonly deadline: bigint } };
  readonly lockIntentTypedData: {
    readonly message: { readonly intentDeadline: bigint };
  };
}
interface ApproveLockPayload {
  readonly mode: 'approve-lock';
  readonly approve: {
    readonly token: Hex;
    readonly spender: Hex;
    readonly amount: bigint;
  };
  readonly lockCall: {
    readonly address: Hex;
    readonly args: readonly [Hex, Hex, bigint, Hex32, bigint];
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run a wallet request; a refusal becomes a plain error that says nothing was locked. */
export async function guardWallet<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new UserFlowError(
      'WALLET_REJECTED',
      `The wallet did not complete the request: ${messageOf(error)}. Nothing was locked.`,
      { cause: error },
    );
  }
}

export interface EvmLockContext {
  readonly evmSigner: EvmSignerPort;
  readonly evmChain: EvmChainPort;
  readonly solver: Pick<SolverPort, 'relayLock'>;
}

/**
 * The user's EVM lock. With a permit-capable token: two typed-data signatures
 * relayed through the solver. Without: an approval and the lock, both sent
 * through the wallet. Returns the transaction hash.
 */
export async function lockUserOnEvm(
  context: EvmLockContext,
  terms: OrderTerms,
): Promise<Hex32> {
  const { evmSigner, evmChain, solver } = context;
  const unsigned = await evmChain.buildUserLock(terms);
  const payload = unsigned.payload as PermitIntentPayload | ApproveLockPayload;

  if (payload.mode === 'permit-intent') {
    const permitSig = await guardWallet(() =>
      evmSigner.signTypedData(payload.permitTypedData),
    );
    const intentSig = await guardWallet(() =>
      evmSigner.signTypedData(payload.lockIntentTypedData),
    );
    const permit = parseSignature(permitSig);
    const response = await solver.relayLock(unsigned.orderId, {
      permit: {
        value: terms.evmAmount,
        deadline: Number(payload.permitTypedData.message.deadline),
        v: Number(permit.v ?? 27n),
        r: permit.r,
        s: permit.s,
      },
      intent: {
        orderId: unsigned.orderId,
        deadline: Number(payload.lockIntentTypedData.message.intentDeadline),
      },
      signature: intentSig,
    });
    return response.txHash;
  }

  const approveHash = await guardWallet(() =>
    evmSigner.sendTransaction({
      to: payload.approve.token,
      data: encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [payload.approve.spender, payload.approve.amount],
      }),
      chainId: terms.evmChainId,
    }),
  );
  await evmChain.waitForReceipt(approveHash);
  const lockHash = await guardWallet(() =>
    evmSigner.sendTransaction({
      to: payload.lockCall.address,
      data: encodeFunctionData({
        abi: HTLC_LOCK_ABI,
        functionName: 'lock',
        args: payload.lockCall.args,
      }),
      chainId: terms.evmChainId,
    }),
  );
  await evmChain.waitForReceipt(lockHash);
  return lockHash;
}

export interface BchLockContext {
  readonly bchSigner: BchSignerPort;
  readonly bchChain: BchChainPort;
  readonly bchNetwork: 'mainnet' | 'chipnet';
  /** The user's own address: change and token change return here. */
  readonly bchCashAddress: string;
  /** The user's own locking bytecode, hex: where the funding outputs are looked up. */
  readonly userLockingBytecodeHex: string;
  readonly feeRateSatPerByte?: number;
}

const DEFAULT_FEE_RATE_SAT_PER_BYTE = 1;

function toLockUtxo(utxo: BchUtxo): LockUtxo {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    ...(utxo.token
      ? {
          token: {
            category: utxo.token.category.toLowerCase(),
            amount: utxo.token.amount,
            ...(utxo.nft ? { nft: { ...utxo.nft } } : {}),
          },
        }
      : {}),
    ...(utxo.derivationPath
      ? { derivationPath: [utxo.derivationPath[0], utxo.derivationPath[1]] }
      : {}),
  };
}

function reverseHex(hex: string): string {
  return (hex.match(/../g) ?? []).reverse().join('');
}

/** Stop early, in plain words, when the funding outputs cannot pay for this lock. */
function assertFundingMakesSense(
  utxos: readonly BchUtxo[],
  terms: OrderTerms,
): void {
  const wanted = terms.bchTokenCategory.replace(/^0x/i, '').toLowerCase();
  const categories = utxos.flatMap((u) =>
    u.token ? [u.token.category.toLowerCase()] : [],
  );
  if (utxos.length === 0) {
    throw new UserFlowError(
      'INSUFFICIENT_FUNDS',
      'No funds were found at your Bitcoin Cash address, so nothing was locked.',
    );
  }
  if (!categories.includes(wanted) && categories.includes(reverseHex(wanted))) {
    throw new UserFlowError(
      'TOKEN_CATEGORY_ORDER',
      'The server reported the stablecoin category in the opposite byte order from the quote, so its outputs cannot be matched. Nothing was locked.',
    );
  }
}

/**
 * The user's Bitcoin Cash lock: build the transaction from the user's own
 * outputs, have the wallet (or a key) sign it, check what came back, and only
 * then broadcast. Returns the transaction id.
 */
export async function lockUserOnBch(
  context: BchLockContext,
  terms: OrderTerms,
): Promise<string> {
  const utxos = await context.bchChain.getUtxos(context.userLockingBytecodeHex);
  assertFundingMakesSense(utxos, terms);
  let built: ReturnType<typeof buildLockTransaction>;
  try {
    built = buildLockTransaction({
      params: terms,
      utxos: utxos.map(toLockUtxo),
      changeAddress: context.bchCashAddress,
      network: context.bchNetwork,
      feeRateSatPerByte:
        context.feeRateSatPerByte ?? DEFAULT_FEE_RATE_SAT_PER_BYTE,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Insufficient')) {
      throw new UserFlowError(
        'INSUFFICIENT_FUNDS',
        `Your Bitcoin Cash address does not hold enough to lock this swap, so nothing was locked. ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
  const request = buildWizardConnectSignRequest({ lockTx: built });
  const signedHex = await guardWallet(() =>
    context.bchSigner.signTransaction(request),
  );
  const report = inspectSignedTransaction(
    built.unsigned.txHex,
    signedHex,
    built.unsigned.sourceOutputs,
  );
  if (!report.ok) {
    throw new UserFlowError(
      'SIGNED_TRANSACTION_REJECTED',
      `The wallet's transaction did not pass the local check, so it was not sent. ${report.problems.join(' ')}`,
    );
  }
  return context.bchChain.broadcast(signedHex);
}
