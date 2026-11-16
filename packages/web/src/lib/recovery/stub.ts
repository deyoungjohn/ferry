import { orderId as computeOrderId } from '@ferry/core';
import type { RecoveryFile, RecoveryPort, RecoverySnapshot } from './types';

export class StubRecoveryPort implements RecoveryPort {
  validateFile(rawJson: string): RecoveryFile {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('Invalid JSON format');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Recovery file must be an object');
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1) {
      throw new Error('Unsupported recovery file version');
    }
    if (!obj.orderId || typeof obj.orderId !== 'string') {
      throw new Error('Missing orderId in recovery file');
    }
    if (!obj.terms || typeof obj.terms !== 'object') {
      throw new Error('Missing terms in recovery file');
    }
    if (!obj.secret || typeof obj.secret !== 'string') {
      throw new Error('Missing secret in recovery file');
    }
    if (!obj.contracts || typeof obj.contracts !== 'object') {
      throw new Error('Missing contracts section in recovery file');
    }

    const rawTerms = obj.terms as Record<string, unknown>;
    const hydratedTerms = {
      ...rawTerms,
      ...(rawTerms.bchTokenAmount !== undefined
        ? {
            bchTokenAmount: BigInt(
              rawTerms.bchTokenAmount as string | number | bigint,
            ),
          }
        : {}),
      ...(rawTerms.evmAmount !== undefined
        ? { evmAmount: BigInt(rawTerms.evmAmount as string | number | bigint) }
        : {}),
      ...(rawTerms.bchCarrySats !== undefined
        ? {
            bchCarrySats: BigInt(
              rawTerms.bchCarrySats as string | number | bigint,
            ),
          }
        : {}),
      ...(rawTerms.bchMaxFee !== undefined
        ? { bchMaxFee: BigInt(rawTerms.bchMaxFee as string | number | bigint) }
        : {}),
    };

    let calculatedId: string;
    try {
      calculatedId = computeOrderId(hydratedTerms);
    } catch (err) {
      throw new Error(
        `Invalid terms in recovery file: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (calculatedId.toLowerCase() !== (obj.orderId as string).toLowerCase()) {
      throw new Error(
        'Order ID does not match the terms in this recovery file',
      );
    }

    return {
      ...(parsed as RecoveryFile),
      terms: hydratedTerms as unknown as RecoveryFile['terms'],
    };
  }

  async loadSnapshot(file: RecoveryFile): Promise<RecoverySnapshot> {
    const isMock = file.solverKind === 'mock';
    const now = Math.floor(Date.now() / 1000);
    const deadlinePassed =
      file.terms.evmDeadline !== undefined && now >= file.terms.evmDeadline;

    return {
      file,
      bchLockStatus: isMock ? 'funded' : 'funded',
      evmLockStatus: isMock ? 'funded' : 'funded',
      bchCanRefund: Boolean(deadlinePassed),
      evmCanRefund: Boolean(deadlinePassed),
      canClaim: !deadlinePassed,
      bchBlocksRemaining: deadlinePassed ? 0 : 12,
      evmSecondsRemaining: deadlinePassed
        ? 0
        : Math.max(0, Number(file.terms.evmDeadline ?? 0) - now),
    };
  }

  async executeClaim(snapshot: RecoverySnapshot): Promise<string> {
    if (snapshot.file.solverKind === 'mock') {
      throw new Error(
        'This file was issued by the mock solver and cannot be claimed on chain.',
      );
    }
    return '0xmockclaimhash' + snapshot.file.orderId.slice(2, 10);
  }

  async executeRefund(snapshot: RecoverySnapshot): Promise<string> {
    if (snapshot.file.solverKind === 'mock') {
      throw new Error(
        'This file was issued by the mock solver and cannot be refunded on chain.',
      );
    }
    return '0xmockrefundhash' + snapshot.file.orderId.slice(2, 10);
  }
}

export const defaultRecoveryPort = new StubRecoveryPort();
