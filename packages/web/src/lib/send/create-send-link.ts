import { binToHex } from '@bitauth/libauth';
import {
  cashAddressToLockingBytecode,
  type Hex,
  type Hex32,
} from '@ferry/core';
import type { SendQuoteRequest } from '@ferry/core/api';
import { deriveHtlcAddresses, encodeHtlcParameters } from '@ferry/htlc-bch';
import { prepareRecoveryDownload } from '@ferry/solver-client';
import { lockUserOnBch } from '@ferry/user-flow';
import { sendLinkUrl } from '../paylink/link';
import { cleanNote, saveSendLink } from '../paylink/send-store';
import { farTokenFacts } from '../solver/core-quote';
import type { SendLinkDependencies } from './ports';
import { generateSecret, hashSecret } from './secret';
import type {
  SendLinkLiveCreationInput,
  SendLinkLiveCreationResult,
} from './types';
import { verifySendLinkQuote } from './verify';
import { sendLinkViewTag } from './wallet-send-links';

export function formatRefundDate(
  bchRefundHeight: number,
  evmDeadlineSeconds: number,
): string {
  const dateStr = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(evmDeadlineSeconds * 1000));
  return `${dateStr} (BCH block ${bchRefundHeight})`;
}

/**
 * Creates a live send link through the solver and locks BCH on-chain.
 *
 * Requirements:
 * 1. Generates 32-byte secret in browser, hashes it.
 * 2. Calls quoteSendLink on solver (request carries note, window, hashLock; NEVER the secret).
 * 3. Verifies quote.
 * 4. Recovery file is saved and downloaded BEFORE the lock.
 * 5. Runs user's BCH lock through wallet adapters.
 * 6. Returns link as /send/<orderId>#<secret>.
 */
export async function createSendLinkLive(
  input: SendLinkLiveCreationInput,
  deps: SendLinkDependencies,
): Promise<SendLinkLiveCreationResult> {
  const tokenFacts = farTokenFacts(input.destChain, input.destToken);
  if (!tokenFacts) {
    throw new Error(
      `Unsupported route or token: ${input.destToken} on ${input.destChain}`,
    );
  }

  // 1. Generate or derive 32-byte secret and hash it
  const secret = deps.secretGenerator
    ? await deps.secretGenerator()
    : generateSecret();
  const hashLock = hashSecret(secret);

  const rawTag =
    input.viewTag ??
    (deps.secretGenerator as { lastTag?: `0x${string}` })?.lastTag;
  const viewTag = rawTag ? sendLinkViewTag(rawTag) : undefined;

  const cancelHash = (
    deps.secretGenerator as { lastCancelHash?: `0x${string}` }
  )?.lastCancelHash;
  const cancelKey = (deps.secretGenerator as { lastCancelKey?: `0x${string}` })
    ?.lastCancelKey;

  // Derive sender's BCH locking bytecode
  const userBchLockingBytecode = cashAddressToLockingBytecode(
    deps.bchCashAddress,
  );

  // The amount the receiver is to get, in the destination token's smallest units.
  const wantedUnits =
    BigInt(Math.round(input.amount * 100)) *
    10n ** BigInt(Math.max(0, tokenFacts.decimals - 2));

  // 2. Call quoteSendLink from @ferry/solver-client (carries note, window, hashLock; NEVER secret).
  // The sender pays the spread and fees: when the quote would deliver less than the amount the
  // sender entered, the lock is raised by the shortfall and the quote is asked again (the spread
  // is a share of the amount, so a second or third round settles it).
  const quoteFor = (amountIn: bigint): SendQuoteRequest => ({
    token: 'PUSD',
    chainId: tokenFacts.chainId,
    evmToken: tokenFacts.address,
    amountIn,
    recipientEvmAddress: input.recipientEvmAddress as Hex,
    userEvmAddress: input.recipientEvmAddress as Hex,
    userBchLockingBytecode,
    hashLock,
    windowSeconds: input.windowSeconds,
    ...(input.note ? { note: cleanNote(input.note) } : {}),
    ...(viewTag ? { viewTag } : {}),
    ...(cancelHash ? { cancelHash } : {}),
    lane: 'safe',
  });

  let amountIn = BigInt(Math.round(input.amount * 100));
  let sendQuoteRequest = quoteFor(amountIn);
  let rawQuote = await deps.solver.quoteSendLink(sendQuoteRequest);
  for (let round = 0; round < 3; round += 1) {
    const delivered = BigInt(
      (rawQuote.terms as { evmAmount: string | bigint }).evmAmount,
    );
    if (delivered >= wantedUnits) break;
    // Cents to add: the shortfall scaled to cents, plus one cent for rounding.
    const unitsPerCent = 10n ** BigInt(Math.max(0, tokenFacts.decimals - 2));
    const shortCents =
      (wantedUnits - delivered + unitsPerCent - 1n) / unitsPerCent;
    amountIn += shortCents + 1n;
    sendQuoteRequest = quoteFor(amountIn);
    rawQuote = await deps.solver.quoteSendLink(sendQuoteRequest);
  }

  // 3. Verify the quote
  const verified = await verifySendLinkQuote(rawQuote, sendQuoteRequest);

  // 4. Recovery file saved and downloaded BEFORE the lock
  const params = encodeHtlcParameters(verified.terms);
  const derived = deriveHtlcAddresses(params, deps.bchNetwork);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const recoveryPayload = prepareRecoveryDownload({
    quote: {
      orderId: verified.orderId,
      terms: verified.terms,
      signature: verified.signature,
    },
    contracts: {
      evm: {
        chainId: verified.terms.evmChainId,
        htlcAddress: verified.terms.evmHtlc,
        tokenAddress: verified.terms.evmToken,
      },
      bch: {
        network: deps.bchNetwork,
        htlcAddress: derived.p2sh32Address,
        tokenAddress: derived.tokenAddress,
        redeemScript: `0x${binToHex(derived.redeemScript)}` as Hex,
        lockingBytecode: `0x${binToHex(derived.lockingBytecode)}` as Hex,
      },
    },
    secret,
    createdAt: nowSeconds,
  });

  // Save to recovery store
  await deps.store.save(verified.orderId, recoveryPayload.json);

  const refundDate = formatRefundDate(
    verified.terms.bchRefundHeight,
    verified.terms.evmDeadline,
  );

  // Pre-save to browser list as pending_lock in case wallet interaction is interrupted
  saveSendLink({
    id: verified.orderId,
    destinationChain: input.destChain,
    destinationToken: input.destToken,
    recipientEvmAddress: input.recipientEvmAddress,
    amount: input.amount,
    windowSeconds: input.windowSeconds,
    expiresAt: verified.terms.evmDeadline,
    note: cleanNote(input.note ?? ''),
    status: 'open',
    createdAt: nowSeconds,
    secret,
    ...(cancelKey ? { cancelKey } : {}),
    orderId: verified.orderId,
    refundDate,
    recoveryJson: recoveryPayload.json,
    lockStatus: 'pending_lock',
  });

  // The recovery file is offered before the lock when an explicit downloadFile handler is provided; no automatic download behind the user's back
  if (deps.downloadFile) {
    await deps.downloadFile(recoveryPayload.filename, recoveryPayload.json);
  }

  // 5. Run user's Bitcoin Cash lock through wallet adapters
  const bchLockTxId = await lockUserOnBch(
    {
      bchSigner: deps.bchSigner,
      bchChain: deps.bchChain,
      bchNetwork: deps.bchNetwork,
      bchCashAddress: deps.bchCashAddress,
      userLockingBytecodeHex: userBchLockingBytecode,
      ...(rawTag ? { recoveryTag: rawTag } : {}),
    },
    verified.terms,
  );

  // 6. Update browser list with successful lock
  saveSendLink({
    id: verified.orderId,
    destinationChain: input.destChain,
    destinationToken: input.destToken,
    recipientEvmAddress: input.recipientEvmAddress,
    amount: input.amount,
    windowSeconds: input.windowSeconds,
    expiresAt: verified.terms.evmDeadline,
    note: cleanNote(input.note ?? ''),
    status: 'open',
    createdAt: nowSeconds,
    secret,
    ...(cancelKey ? { cancelKey } : {}),
    orderId: verified.orderId,
    refundDate,
    txId: bchLockTxId,
    recoveryJson: recoveryPayload.json,
    lockStatus: 'locked',
  });

  const shareableUrl = sendLinkUrl(verified.orderId, secret);

  return {
    orderId: verified.orderId,
    secret,
    ...(cancelKey ? { cancelKey: cancelKey as Hex32 } : {}),
    hashLock,
    shareableUrl,
    refundDate,
    recoveryJson: recoveryPayload.json,
    bchLockTxId,
    expiresAt: verified.terms.evmDeadline,
    verifiedQuote: verified,
    amountLockedCents: Number(amountIn),
  };
}
