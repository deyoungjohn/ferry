import type { Hex, Hex32, OrderTerms } from '@ferry/core';
import { encodeFunctionData, parseAbi, parseSignature } from 'viem';
import { UserFlowError } from './errors.js';
import type { EvmChainPort, EvmSignerPort, SolverPort } from './ports.js';

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
