import type { Hex32 } from '@ferry/core';
import type {
  QuoteResponse,
  RelayClaimRequest,
  RelayClaimResponse,
  SendLinkDetailsResponse,
  SendLinkQueryMatch,
  SendQuoteRequest,
  SwitchSendLinkRouteRequest,
  SwitchSendLinkRouteResponse,
} from '@ferry/core/api';
import type {
  BchChainPort,
  BchSignerPort,
  EvmChainPort,
  EvmSignerPort,
  RecoveryStorePort,
} from '@ferry/user-flow';

export interface SendLinkSolverPort {
  quoteSendLink(request: SendQuoteRequest): Promise<QuoteResponse>;
  getSendLink?(id: string): Promise<SendLinkDetailsResponse>;
  querySendLinks?(
    tags: readonly Hex32[],
  ): Promise<readonly SendLinkQueryMatch[]>;
  relayClaim?(
    orderId: Hex32,
    request: RelayClaimRequest,
  ): Promise<RelayClaimResponse>;
  switchSendLinkRoute?(
    id: string,
    request: SwitchSendLinkRouteRequest,
  ): Promise<SwitchSendLinkRouteResponse>;
}

export interface SendLinkDependencies {
  readonly solver: SendLinkSolverPort;
  readonly bchSigner: BchSignerPort;
  readonly bchChain: BchChainPort;
  readonly store: RecoveryStorePort;
  readonly bchCashAddress: string;
  readonly bchNetwork: 'mainnet' | 'chipnet';
  readonly evmSigner?: EvmSignerPort | undefined;
  readonly evmChain?: EvmChainPort | undefined;
  readonly secretGenerator?: (() => Hex32 | Promise<Hex32>) & {
    lastTag?: `0x${string}` | undefined;
  };
  /**
   * Offers the recovery file. May ask the person first and resolve once they have saved it; if it
   * rejects, nothing is locked.
   */
  readonly downloadFile?: (
    filename: string,
    json: string,
  ) => boolean | Promise<boolean>;
}
