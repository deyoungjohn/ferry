import type { Hex32 } from '@ferry/core';
import type { SendLinkDetailsResponse } from '@ferry/core/api';
import type { VerifiedQuote } from '@ferry/solver-client';

export type SendLinkWaitState =
  | "the sender's funds are being locked"
  | 'ready to claim'
  | 'claimed'
  | 'expired: the sender gets their funds back';

export interface SendLinkLiveCreationInput {
  readonly recipientEvmAddress: string;
  readonly destChain: string;
  readonly destToken: string;
  readonly amount: number;
  readonly windowSeconds: number;
  readonly note?: string | undefined;
}

export interface SendLinkLiveCreationResult {
  readonly orderId: Hex32;
  readonly secret: Hex32;
  readonly hashLock: Hex32;
  readonly shareableUrl: string;
  readonly refundDate: string;
  readonly recoveryJson: string;
  readonly bchLockTxId?: string | undefined;
  readonly expiresAt: number;
  readonly verifiedQuote: VerifiedQuote;
}

export interface ClaimSendLinkLiveInput {
  readonly id: string;
  readonly orderId?: Hex32 | undefined;
  readonly secret: Hex32;
  readonly lockId?: Hex32 | undefined;
  readonly chainId?: number | undefined;
}

export interface ClaimSendLinkLiveResult {
  readonly ok: boolean;
  readonly method: 'relay' | 'evm-wallet';
  readonly txHash: string;
}

export function formatWaitState(
  status: SendLinkDetailsResponse['status'] | string,
): SendLinkWaitState {
  switch (status) {
    case 'pending_lock':
      return "the sender's funds are being locked";
    case 'open':
    case 'locked':
      return 'ready to claim';
    case 'claimed':
      return 'claimed';
    case 'refunded':
    case 'expired':
    default:
      return 'expired: the sender gets their funds back';
  }
}
