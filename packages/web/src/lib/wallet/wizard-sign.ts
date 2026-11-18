import type { WizardConnectSignRequest } from '@ferry/htlc-bch';

/**
 * What the WizardConnect manager receives for a sign request. The relay carries JSON, which cannot
 * hold bigint or byte arrays, so the request's relay form is used: bytes as hex strings, amounts as
 * `<bigint: Xn>` strings. Handing over the native form throws "Do not know how to serialize a
 * BigInt" on the first real signature.
 */
export function wizardSignParams(request: WizardConnectSignRequest) {
  return {
    transaction: request.relayTransaction,
    inputPaths: request.inputPaths,
  };
}
