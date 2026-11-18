import {
  cashAddressToLockingBytecode,
  parseRecoveryFileJson,
  type Hex32,
} from '@ferry/core';
import { lockUserOnBch } from '@ferry/user-flow';
import { sendLinkUrl, type SendLinkData } from '../paylink/link';
import { saveSendLink } from '../paylink/send-store';
import type { SendLinkDependencies } from './ports';

export interface ResumeSendLinkResult {
  readonly orderId: Hex32;
  readonly shareableUrl: string;
  readonly bchLockTxId: string;
}

/**
 * Resumes an unfinished send link lock using its saved recovery file.
 */
export async function resumeSendLinkLock(
  link: SendLinkData,
  deps: SendLinkDependencies,
): Promise<ResumeSendLinkResult> {
  const orderId = (link.orderId ?? link.id) as Hex32;
  let json = link.recoveryJson;
  if (!json) {
    json = (await deps.store.load(orderId)) ?? undefined;
  }

  if (!json) {
    throw new Error(
      `No recovery file found for send link ${orderId} to resume.`,
    );
  }

  const recoveryFile = parseRecoveryFileJson(json);
  const userBchLockingBytecode = cashAddressToLockingBytecode(
    deps.bchCashAddress,
  );

  const bchLockTxId = await lockUserOnBch(
    {
      bchSigner: deps.bchSigner,
      bchChain: deps.bchChain,
      bchNetwork: deps.bchNetwork,
      bchCashAddress: deps.bchCashAddress,
      userLockingBytecodeHex: userBchLockingBytecode,
    },
    recoveryFile.terms,
  );

  const secret = (link.secret ?? recoveryFile.secret) as Hex32 | undefined;

  saveSendLink({
    ...link,
    lockStatus: 'locked',
    status: 'open',
    txId: bchLockTxId,
    recoveryJson: json,
    ...(secret ? { secret } : {}),
  });

  const shareableUrl = sendLinkUrl(orderId, secret);

  return {
    orderId,
    shareableUrl,
    bchLockTxId,
  };
}
