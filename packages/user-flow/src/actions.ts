import type { Hex, Hex32, OrderTerms } from '@ferry/core';
import {
  buildLockTransaction,
  buildWizardConnectSignRequest,
  inspectSignedTransaction,
  type LockUtxo,
} from '@ferry/htlc-bch';
import { hexToBin } from '@bitauth/libauth';
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
  /**
   * The complete ordered list to send: a reset to zero when the token needs it,
   * the approval, then the lock. Absent in older payloads.
   */
  readonly transactions?: readonly WalletStep[];
}

interface WalletStep {
  readonly kind: string;
  readonly to: Hex;
  readonly data: Hex;
  readonly value?: bigint;
  readonly gas?: bigint;
}

/**
 * The permit's `v`. `parseSignature` gives `v` for a signature ending in 1b or
 * 1c but only `yParity` (0 or 1) for one ending in 00 or 01.
 */
function permitV(signature: {
  v?: bigint | undefined;
  yParity?: number | undefined;
}): number {
  if (signature.v !== undefined) return Number(signature.v);
  return signature.yParity === 1 ? 28 : 27;
}

/** Wait for a transaction to be mined and stop if it reverted: the next step must not be sent. */
export async function awaitMined(
  chain: EvmChainPort,
  hash: Hex32,
): Promise<void> {
  const receipt = await chain.waitForReceipt(hash);
  if (receipt && receipt.status === 'reverted') {
    throw new UserFlowError(
      'TX_REVERTED',
      'A transaction was mined but failed, so the next step was not sent. Check your wallet; nothing further was done.',
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a wallet or library failure means for a person, in one or two plain sentences: no library
 * versions, request dumps or "Details:" tails. The raw error stays on `cause` for the log.
 */
export function plainWalletMessage(error: unknown): string {
  const raw = messageOf(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === 4001 ||
    /user (rejected|denied|cancel)|rejected the request|denied (the )?request|request rejected/i.test(
      raw,
    )
  ) {
    return 'You cancelled the request in your wallet. Nothing was locked.';
  }
  if (
    /insufficient funds|exceeds the balance|gas required exceeds/i.test(raw)
  ) {
    return "Your wallet does not have enough of the chain's gas token to pay the network fee. Add some and try again. Nothing was locked.";
  }
  if (
    /chain.*(mismatch|not configured|does not match)|unrecognized chain|switch.*chain/i.test(
      raw,
    )
  ) {
    return 'Your wallet is on a different network than this swap. Switch network in your wallet and try again. Nothing was locked.';
  }
  if (/timed? ?out|timeout/i.test(raw)) {
    return 'Your wallet did not answer in time. Open it, check for a pending request, and try again. Nothing was locked.';
  }
  const first =
    raw
      .split(/\n|Details:|Version:|Request Arguments:|Docs:/)[0]
      ?.trim()
      .replace(/\.$/, '') ?? '';
  return first
    ? `The wallet did not complete the request: ${first}. Nothing was locked.`
    : 'The wallet did not complete the request. Nothing was locked.';
}

/** Run a wallet request; a refusal becomes a plain error that says nothing was locked. */
export async function guardWallet<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new UserFlowError('WALLET_REJECTED', plainWalletMessage(error), {
      cause: error,
    });
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
        v: permitV(permit),
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

  if (payload.transactions !== undefined && payload.transactions.length > 0) {
    return sendInOrder(context, terms, payload.transactions);
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
  await awaitMined(evmChain, approveHash);
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
  await awaitMined(evmChain, lockHash);
  return lockHash;
}

/**
 * Send the planned transactions one at a time, in order, each one mined before
 * the next is sent: the approval may depend on a reset, and the lock on the
 * approval. The list must end with the lock; the lock's hash is returned.
 */
async function sendInOrder(
  context: EvmLockContext,
  terms: OrderTerms,
  steps: readonly WalletStep[],
): Promise<Hex32> {
  if (steps[steps.length - 1]?.kind !== 'lock') {
    throw new UserFlowError(
      'INVALID_INPUT',
      'The planned transactions do not end with the lock, so nothing was sent.',
    );
  }
  let lastHash: Hex32 | null = null;
  for (const step of steps) {
    const hash = await guardWallet(() =>
      context.evmSigner.sendTransaction({
        to: step.to,
        data: step.data,
        value: step.value ?? 0n,
        chainId: terms.evmChainId,
        ...(step.gas !== undefined ? { gas: step.gas } : {}),
      }),
    );
    await awaitMined(context.evmChain, hash);
    lastHash = hash;
  }
  return lastHash as Hex32;
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
  readonly recoveryTag?: string | Uint8Array | undefined;
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
    ...(utxo.lockingBytecodeHex
      ? {
          lockingBytecode: hexToBin(
            utxo.lockingBytecodeHex.replace(/^0x/i, ''),
          ),
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
  const { utxos, searched } = await gatherFunding(context);
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
      includeTermsOutput: true,
      recoveryTag: context.recoveryTag,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Insufficient')) {
      throw new UserFlowError(
        'INSUFFICIENT_FUNDS',
        insufficientBchMessage(
          error.message,
          searched,
          String((terms as { bchToken?: string }).bchToken ?? 'PUSD'),
        ),
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

/** Satoshis as BCH with no trailing zeros: 4633 reads "0.00004633 BCH". */
export function formatBchAmount(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const fraction = (sats % 100_000_000n)
    .toString()
    .padStart(8, '0')
    .replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} BCH`;
}

/** The lock builder's "required X, available Y" (satoshis) in words a person can act on. */
export function insufficientBchMessage(
  builderMessage: string,
  searched = 0,
  tokenSymbol = 'PUSD',
): string {
  const where =
    searched > 0 ? ` Searched ${searched} of your wallet's addresses.` : '';
  // A shortage of the token itself (PUSD or MUSD, two decimals), not of BCH for the fee.
  const token =
    /^Insufficient token balance.*required (\d+), available (\d+)/.exec(
      builderMessage,
    );
  if (token) {
    const cents = (v: string) => (Number(v) / 100).toFixed(2);
    return `Your Bitcoin Cash wallet does not hold enough ${tokenSymbol}. You hold ${cents(token[2]!)} ${tokenSymbol} and this swap needs ${cents(token[1]!)} ${tokenSymbol}.${where} Nothing was locked.`;
  }
  const match = /required (\d+), available (\d+)/.exec(builderMessage);
  if (!match) {
    return 'Your Bitcoin Cash wallet needs a little BCH to pay the network fee. Nothing was locked.';
  }
  const required = BigInt(match[1]!);
  const available = BigInt(match[2]!);
  const missing = required > available ? required - available : 0n;
  return `Your Bitcoin Cash wallet needs a little BCH to pay the network fee. You hold ${formatBchAmount(available)} and you need ${formatBchAmount(required)} (${formatBchAmount(missing)} more).${searched > 0 ? ` Searched ${searched} of your wallet's addresses.` : ''} Nothing was locked.`;
}

/**
 * The outputs the lock may spend: from every address the wallet reports (each tagged with where
 * the wallet keeps its key), or from the one known address when the wallet reports none.
 */
async function gatherFunding(
  context: BchLockContext,
): Promise<{ utxos: readonly BchUtxo[]; searched: number }> {
  const { bchSigner, bchChain } = context;
  let searched = 0;
  if (bchSigner.listFundingAddresses && bchChain.getUtxosMany) {
    const addresses = await bchSigner.listFundingAddresses();
    if (addresses.length > 0) {
      const found = await bchChain.getUtxosMany(
        addresses.map((a) => a.lockingBytecodeHex),
      );
      const all: BchUtxo[] = [];
      const seen = new Set<string>();
      for (const address of addresses) {
        for (const utxo of found.get(address.lockingBytecodeHex) ?? []) {
          const key = `${utxo.txid}:${utxo.vout}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({
            ...utxo,
            lockingBytecodeHex: address.lockingBytecodeHex,
            derivationPath: address.derivationPath,
          });
        }
      }
      if (all.length > 0) return { utxos: all, searched: addresses.length };
      searched = addresses.length;
    }
  }
  return {
    utxos: await bchChain.getUtxos(context.userLockingBytecodeHex),
    searched,
  };
}
