import { binToHex } from '@bitauth/libauth';
import type {
  BuildLockTxResult,
  InputDerivationPath,
  UnsignedLockTransaction,
  WcSourceOutput,
} from './lock.js';

export interface RelayTokenData {
  readonly category: string;
  readonly amount: string;
  readonly nft?: {
    readonly capability: 'none' | 'mutable' | 'minting';
    readonly commitment: string;
  };
}

export interface RelaySourceOutput {
  readonly outpointTransactionHash: string;
  readonly outpointIndex: number;
  readonly unlockingBytecode: string;
  readonly sequenceNumber: number;
  readonly valueSatoshis: string;
  readonly lockingBytecode: string;
  readonly token?: RelayTokenData;
}

export interface WizardConnectSignRequest {
  readonly transaction: {
    readonly transaction: UnsignedLockTransaction['transaction'];
    readonly sourceOutputs: readonly WcSourceOutput[];
    readonly broadcast: boolean;
    readonly userPrompt?: string;
  };
  readonly relayTransaction: {
    readonly transaction: string;
    readonly sourceOutputs: readonly RelaySourceOutput[];
    readonly broadcast: boolean;
    readonly userPrompt?: string;
  };
  readonly inputPaths: readonly InputDerivationPath[];
}

/**
 * Recursively convert native BigInt and Uint8Array values into the JSON-safe
 * WizardConnect relay wire format (`<bigint: Xn>` and lowercase hex strings).
 */
export function serializeForRelay(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `<bigint: ${value.toString()}n>`;
  }
  if (value instanceof Uint8Array) {
    return binToHex(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeForRelay(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        out[key] = serializeForRelay(entry);
      }
    }
    return out;
  }
  return value;
}

export function stringifyRelayPayload(value: unknown): string {
  return JSON.stringify(serializeForRelay(value));
}

export function sourceOutputToRelay(output: WcSourceOutput): RelaySourceOutput {
  return {
    outpointTransactionHash: binToHex(output.outpointTransactionHash),
    outpointIndex: output.outpointIndex,
    unlockingBytecode: binToHex(output.unlockingBytecode),
    sequenceNumber: output.sequenceNumber,
    valueSatoshis: `<bigint: ${output.valueSatoshis.toString()}n>`,
    lockingBytecode: binToHex(output.lockingBytecode),
    ...(output.token
      ? {
          token: {
            category: binToHex(output.token.category),
            amount: `<bigint: ${output.token.amount.toString()}n>`,
            ...(output.token.nft
              ? {
                  nft: {
                    capability: output.token.nft.capability,
                    commitment: binToHex(output.token.nft.commitment),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Build a WizardConnect signing request from an unsigned `buildLockTransaction` result.
 * Ensures one `inputPaths` entry per input and a relay-safe serialized representation.
 */
export function buildWizardConnectSignRequest(options: {
  readonly lockTx: UnsignedLockTransaction | BuildLockTxResult;
  readonly broadcast?: boolean;
  readonly userPrompt?: string;
}): WizardConnectSignRequest {
  const unsigned =
    'unsigned' in options.lockTx ? options.lockTx.unsigned : options.lockTx;
  const broadcast = options.broadcast ?? false;

  if (unsigned.derivationPaths.length !== unsigned.sourceOutputs.length) {
    throw new Error(
      `inputPaths length (${unsigned.derivationPaths.length}) does not match sourceOutputs length (${unsigned.sourceOutputs.length})`,
    );
  }
  for (let i = 0; i < unsigned.derivationPaths.length; i++) {
    const entry = unsigned.derivationPaths[i]!;
    if (entry[0] !== i) {
      throw new Error(
        `inputPaths[${i}] has inputIndex ${entry[0]}, expected ${i}`,
      );
    }
  }

  return {
    transaction: {
      transaction: unsigned.transaction,
      sourceOutputs: unsigned.sourceOutputs,
      broadcast,
      ...(options.userPrompt !== undefined
        ? { userPrompt: options.userPrompt }
        : {}),
    },
    relayTransaction: {
      transaction: unsigned.txHex,
      sourceOutputs: unsigned.sourceOutputs.map(sourceOutputToRelay),
      broadcast,
      ...(options.userPrompt !== undefined
        ? { userPrompt: options.userPrompt }
        : {}),
    },
    inputPaths: unsigned.derivationPaths,
  };
}
