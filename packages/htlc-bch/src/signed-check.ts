import {
  binToHex,
  createVirtualMachineBCH,
  decodeTransaction,
  encodeTransactionOutput,
  hexToBin,
  type Output,
  type Transaction,
} from '@bitauth/libauth';
import type { WcSourceOutput } from './lock.js';
import { findP2sh32Mismatch } from './p2sh32.js';

export interface SignedInputDiagnostic {
  readonly index: number;
  readonly outpoint: string;
  readonly unlockingBytecodeLength: number;
  readonly signed: boolean;
  readonly sourceValueSatoshis: string;
  readonly sourceLockingBytecode: string;
  readonly token: {
    readonly category: string;
    readonly amount: string;
  } | null;
  readonly scriptError: string | null;
}

export interface SignedTransactionDiagnostic {
  readonly unsignedHex: string;
  readonly signedHex: string;
  readonly problems: readonly string[];
  readonly failedInput: number | null;
  readonly inputs: readonly SignedInputDiagnostic[];
  readonly sourceOutputs: readonly {
    readonly outpoint: string;
    readonly valueSatoshis: string;
    readonly lockingBytecode: string;
    readonly token: {
      readonly category: string;
      readonly amount: string;
    } | null;
  }[];
}

export interface SignedTransactionReport {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly failedInput: number | null;
  readonly diagnostic: SignedTransactionDiagnostic;
}

export class WalletSignedTransactionError extends Error {
  readonly diagnostic: SignedTransactionDiagnostic;

  constructor(report: SignedTransactionReport) {
    const prefix =
      report.failedInput === null
        ? 'The wallet transaction failed the local check'
        : `Input ${report.failedInput.toString()} failed the local check`;
    super(`${prefix}, so it was not broadcast. ${report.problems.join(' ')}`);
    this.name = 'WalletSignedTransactionError';
    this.diagnostic = report.diagnostic;
  }
}

function decodeHexTx(hex: string, label: string): Transaction | string {
  const decoded = decodeTransaction(hexToBin(hex.replace(/^0x/i, '')));
  return typeof decoded === 'string'
    ? `${label} does not decode: ${decoded}`
    : decoded;
}

function outputBytesHex(output: Output): string {
  return binToHex(encodeTransactionOutput(output));
}

function formatOutpoint(txid: Uint8Array, index: number): string {
  return `${binToHex(txid)}:${index.toString()}`;
}

function summarizeSource(source: WcSourceOutput) {
  return {
    outpoint: formatOutpoint(
      source.outpointTransactionHash,
      source.outpointIndex,
    ),
    valueSatoshis: source.valueSatoshis.toString(),
    lockingBytecode: binToHex(source.lockingBytecode),
    token: source.token
      ? {
          category: binToHex(source.token.category),
          amount: source.token.amount.toString(),
        }
      : null,
  };
}

function buildInputDiagnostics(
  signed: Transaction,
  sources: readonly WcSourceOutput[],
): SignedInputDiagnostic[] {
  return signed.inputs.map((input, index) => {
    const source = sources[index];
    return {
      index,
      outpoint: formatOutpoint(
        input.outpointTransactionHash,
        input.outpointIndex,
      ),
      unlockingBytecodeLength: input.unlockingBytecode.length,
      signed: input.unlockingBytecode.length > 0,
      sourceValueSatoshis: source?.valueSatoshis.toString() ?? 'missing',
      sourceLockingBytecode: source
        ? binToHex(source.lockingBytecode)
        : 'missing',
      token: source?.token
        ? {
            category: binToHex(source.token.category),
            amount: source.token.amount.toString(),
          }
        : null,
      scriptError: null,
    };
  });
}

function parseVmInputIndex(error: string): number | null {
  const match = /Error in evaluating input index (\d+)/i.exec(error);
  return match?.[1] !== undefined ? Number(match[1]) : null;
}

/**
 * Inspect a wallet-signed transaction against the unsigned request transaction
 * and its source outputs. Rejects altered inputs/outputs, names the first
 * unsigned input, and runs the Libauth BCH VM on every input.
 */
export function inspectSignedTransaction(
  unsignedHex: string,
  signedHex: string,
  sourceOutputs: readonly WcSourceOutput[],
): SignedTransactionReport {
  const unsigned = decodeHexTx(unsignedHex, 'The request transaction');
  const signed = decodeHexTx(signedHex, 'The wallet transaction');
  const emptyDiagnostic: SignedTransactionDiagnostic = {
    unsignedHex,
    signedHex,
    problems: [],
    failedInput: null,
    inputs: [],
    sourceOutputs: sourceOutputs.map(summarizeSource),
  };

  if (typeof unsigned === 'string') {
    return {
      ok: false,
      problems: [unsigned],
      failedInput: null,
      diagnostic: { ...emptyDiagnostic, problems: [unsigned] },
    };
  }
  if (typeof signed === 'string') {
    return {
      ok: false,
      problems: [signed],
      failedInput: null,
      diagnostic: { ...emptyDiagnostic, problems: [signed] },
    };
  }

  const problems: string[] = [];
  let failedInput: number | null = null;

  if (signed.inputs.length !== unsigned.inputs.length) {
    problems.push(
      `The wallet returned ${signed.inputs.length} inputs; the request had ${unsigned.inputs.length}.`,
    );
  }
  unsigned.inputs.forEach((input, index) => {
    const returned = signed.inputs[index];
    if (!returned) return;
    if (
      binToHex(returned.outpointTransactionHash) !==
        binToHex(input.outpointTransactionHash) ||
      returned.outpointIndex !== input.outpointIndex
    ) {
      problems.push(
        `Input ${index} spends a different outpoint than requested.`,
      );
      failedInput ??= index;
    }
  });

  if (signed.outputs.length !== unsigned.outputs.length) {
    problems.push(
      `The wallet returned ${signed.outputs.length} outputs; the request had ${unsigned.outputs.length}.`,
    );
  } else {
    unsigned.outputs.forEach((output, index) => {
      const returned = signed.outputs[index];
      if (returned && outputBytesHex(returned) !== outputBytesHex(output)) {
        problems.push(`Output ${index} was altered by the wallet.`);
      }
    });
  }

  signed.inputs.forEach((input, index) => {
    if (input.unlockingBytecode.length === 0) {
      problems.push(`Input ${index} is not signed (empty unlockingBytecode).`);
      failedInput ??= index;
    }
  });

  const inputs = buildInputDiagnostics(signed, sourceOutputs);
  if (sourceOutputs.length !== signed.inputs.length) {
    problems.push(
      `Expected ${signed.inputs.length} source outputs, received ${sourceOutputs.length}.`,
    );
  } else if (problems.length === 0) {
    const mismatch = findP2sh32Mismatch(
      signed,
      sourceOutputs.map((output) => output.lockingBytecode),
    );
    if (mismatch !== null) {
      problems.push(mismatch.message);
      failedInput ??= mismatch.inputIndex;
      const flagged = inputs[mismatch.inputIndex];
      if (flagged) {
        inputs[mismatch.inputIndex] = {
          ...flagged,
          scriptError: mismatch.message,
        };
      }
    }
  }
  if (problems.length === 0 && sourceOutputs.length === signed.inputs.length) {
    const vm = createVirtualMachineBCH();
    const result = vm.verify({
      sourceOutputs: sourceOutputs.map((output) => ({
        lockingBytecode: output.lockingBytecode,
        valueSatoshis: output.valueSatoshis,
        ...(output.token
          ? {
              token: {
                category: output.token.category,
                amount: output.token.amount,
              },
            }
          : {}),
      })),
      transaction: signed,
    });
    if (typeof result === 'string') {
      problems.push(`Script check failed: ${result}`);
      const inputIndex = parseVmInputIndex(result);
      failedInput ??= inputIndex;
      if (inputIndex !== null && inputs[inputIndex]) {
        inputs[inputIndex] = {
          ...inputs[inputIndex],
          scriptError: result,
        };
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    failedInput,
    diagnostic: {
      unsignedHex,
      signedHex,
      problems,
      failedInput,
      inputs,
      sourceOutputs: sourceOutputs.map(summarizeSource),
    },
  };
}

export function assertSignedTransactionValid(
  unsignedHex: string,
  signedHex: string,
  sourceOutputs: readonly WcSourceOutput[],
): SignedTransactionReport {
  const report = inspectSignedTransaction(
    unsignedHex,
    signedHex,
    sourceOutputs,
  );
  if (!report.ok) {
    throw new WalletSignedTransactionError(report);
  }
  return report;
}
