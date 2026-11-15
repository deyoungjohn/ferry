import crypto from 'node:crypto';
import type { SolverDatabase } from '../db/database.js';
import type {
  ChainPort,
  ExecuteOrAdoptParams,
  ExecuteOrAdoptResult,
  SecretValidator,
} from './types.js';

export const CLAIM_STALE_TIMEOUT_SECONDS = 180; // 3 minutes
export const LOCK_STALE_TIMEOUT_SECONDS = 600; // 10 minutes

const AMBIGUOUS_ERROR_PATTERNS = [
  /missing inputs/i,
  /conflict/i,
  /already in block chain/i,
  /already spent/i,
  /bad-txns-inputs-missingorspent/i,
  /txn-mempool-conflict/i,
];

export function isAmbiguousNodeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return AMBIGUOUS_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

export const defaultValidateSecret: SecretValidator = (
  secret: string,
  hashLock: string,
): boolean => {
  if (!secret || !hashLock) return false;
  const cleanSecret = secret.startsWith('0x') ? secret.slice(2) : secret;
  if (cleanSecret.length === 0 || /^0+$/.test(cleanSecret)) return false;
  const secretBuf = Buffer.from(cleanSecret, 'hex');
  if (secretBuf.length !== 32) return false;
  const cleanHashLock = (
    hashLock.startsWith('0x') ? hashLock.slice(2) : hashLock
  ).toLowerCase();
  const computedHash = crypto
    .createHash('sha256')
    .update(secretBuf)
    .digest('hex')
    .toLowerCase();
  return computedHash === cleanHashLock;
};

export class ActionExecutor {
  constructor(
    private readonly db: SolverDatabase,
    private readonly chainPort: ChainPort,
    private readonly validateSecret: SecretValidator = defaultValidateSecret,
  ) {}

  async executeOrAdopt(
    params: ExecuteOrAdoptParams,
  ): Promise<ExecuteOrAdoptResult> {
    // 1. Invariant: Secrets reach the executor only through validated secret check
    if (params.secret !== undefined || params.actionType === 'SOLVER_CLAIM') {
      const order = this.db.getOrder(params.orderId);
      const expectedHashLock = params.hashLock || order?.hashLock;
      const secretToValidate = params.secret || order?.secret;

      if (!secretToValidate || !expectedHashLock) {
        throw new Error(
          `Action ${params.actionType} requires a valid secret and hash lock (none found for order ${params.orderId})`,
        );
      }

      if (!this.validateSecret(secretToValidate, expectedHashLock)) {
        throw new Error(
          `Invalid secret for order ${params.orderId}: sha256(secret) does not equal hashLock (zero/empty rejected)`,
        );
      }
    }

    // 2. Check for existing write-ahead action in SQLite
    const existingAction = this.db.getAction(params.orderId, params.actionType);
    let txid = '';
    let txHex = '';
    let inputs: Array<{ txid: string; vout: number }> = [];

    if (existingAction) {
      try {
        const parsed = JSON.parse(existingAction.intentPayload);
        txid = parsed.txid || existingAction.txid || '';
        txHex = parsed.txHex || '';
        if (Array.isArray(parsed.inputs)) inputs = parsed.inputs;
      } catch {
        txid = existingAction.txid || '';
      }

      // Verify stored txHex if verifyTx provided
      if (txHex && params.verifyTx) {
        const verifyResult = await params.verifyTx(txHex);
        if (verifyResult !== true) {
          this.db.deleteAction(params.orderId, params.actionType);
          txid = '';
          txHex = '';
        }
      }
    }

    if (txid) {
      // 3. Check if already on chain
      const alreadyMined = await this.chainPort.isOnChain(txid);
      if (alreadyMined) {
        this.db.recordBroadcast(params.orderId, params.actionType, txid);
        return { txid, txHex, adopted: true };
      }

      // 4. Stale-action rebuild policy
      const defaultTimeout =
        params.actionType === 'SOLVER_LOCK'
          ? LOCK_STALE_TIMEOUT_SECONDS
          : CLAIM_STALE_TIMEOUT_SECONDS;
      const staleTimeout = params.staleTimeoutSeconds ?? defaultTimeout;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const actionAgeSeconds = nowSeconds - (existingAction?.updatedAt ?? 0);

      if (
        existingAction?.status === 'BROADCAST' &&
        actionAgeSeconds > staleTimeout
      ) {
        // Quorum check
        let inQuorum = false;
        if (this.chainPort.checkTxAcrossQuorum) {
          const check = await this.chainPort.checkTxAcrossQuorum(txid);
          inQuorum = check.found;
        }

        if (inQuorum) {
          // Rebroadcast to assist propagation
          if (txHex) {
            try {
              await this.chainPort.broadcast(txHex);
            } catch {
              // ignore
            }
          }
          this.db.recordBroadcast(params.orderId, params.actionType, txid);
          return { txid, txHex, adopted: false };
        }

        // Quorum does not see it; check spent status of inputs
        let anyInputSpent = false;
        if (inputs.length > 0 && this.chainPort.isInputSpent) {
          for (const inp of inputs) {
            if (await this.chainPort.isInputSpent(inp)) {
              anyInputSpent = true;
              break;
            }
          }
        }

        if (anyInputSpent) {
          // Search history for alternative spend
          let alternativeSpendTxid: string | null = null;
          if (inputs.length > 0 && this.chainPort.findAlternativeSpend) {
            for (const inp of inputs) {
              const alt = await this.chainPort.findAlternativeSpend(inp);
              if (alt) {
                alternativeSpendTxid = alt;
                break;
              }
            }
          }

          if (alternativeSpendTxid) {
            // Adopt winning spend from history
            this.db.recordBroadcast(
              params.orderId,
              params.actionType,
              alternativeSpendTxid,
            );
            return {
              txid: alternativeSpendTxid,
              txHex,
              adopted: true,
            };
          }

          // Conflicting spend; refuse blind rebuild!
          const errMsg = `Action ${params.actionType} inputs spent by conflicting transaction; refusing blind rebuild`;
          this.db.markNeedsAttention(params.orderId, errMsg);
          throw new Error(errMsg);
        }

        // Inputs still unspent: safe to delete stale action and rebuild cleanly
        this.db.deleteAction(params.orderId, params.actionType);
        txid = '';
        txHex = '';
      }
    }

    if (txid) {
      // Rebroadcast existing transaction
      if (txHex) {
        try {
          await this.chainPort.broadcast(txHex);
        } catch (err) {
          if (isAmbiguousNodeError(err)) {
            const onChain = await this.chainPort.isOnChain(txid);
            if (onChain) {
              this.db.recordBroadcast(params.orderId, params.actionType, txid);
              return { txid, txHex, adopted: true };
            }
          }
          // continue with recorded action
        }
      }
      this.db.recordBroadcast(params.orderId, params.actionType, txid);
      return { txid, txHex, adopted: false };
    }

    // 5. First-time execution or rebuild: build transaction
    const built = await params.buildTx();
    txid = built.txid;
    txHex = built.txHex;

    if (params.verifyTx) {
      const verifyResult = await params.verifyTx(txHex);
      if (verifyResult !== true) {
        throw new Error(
          `Built transaction failed verification: ${String(verifyResult)}`,
        );
      }
    }

    // Persist write-ahead intent BEFORE broadcast
    this.db.recordIntent(params.orderId, params.actionType, {
      txid,
      txHex,
      inputs: built.inputs,
    });

    if (params.faultBeforeBroadcast) {
      params.faultBeforeBroadcast();
    }

    // Check chain state: is input already spent or txid known?
    if (built.inputs && this.chainPort.isInputSpent) {
      for (const inp of built.inputs) {
        if (await this.chainPort.isInputSpent(inp)) {
          const errMsg = `Input ${inp.txid}:${inp.vout} is already spent prior to broadcast`;
          this.db.deleteAction(params.orderId, params.actionType);
          this.db.markNeedsAttention(params.orderId, errMsg);
          throw new Error(errMsg);
        }
      }
    }

    const alreadyOnChain = await this.chainPort.isOnChain(txid);
    if (alreadyOnChain) {
      this.db.recordBroadcast(params.orderId, params.actionType, txid);
      return { txid, txHex, adopted: true };
    }

    // Broadcast
    try {
      await this.chainPort.broadcast(txHex);
    } catch (err) {
      if (isAmbiguousNodeError(err)) {
        // Ambiguous node error: count as success ONLY if exact txid is found on chain
        const confirmedOnChain = await this.chainPort.isOnChain(txid);
        if (confirmedOnChain) {
          this.db.recordBroadcast(params.orderId, params.actionType, txid);
          return { txid, txHex, adopted: true };
        }
        const errMsg = `Ambiguous node error on broadcast (${err instanceof Error ? err.message : String(err)}); exact txid ${txid} not found on chain`;
        this.db.deleteAction(params.orderId, params.actionType);
        this.db.markNeedsAttention(params.orderId, errMsg);
        throw new Error(errMsg, { cause: err });
      }

      // Unambiguous failure
      const errMsg = `Node rejected broadcast: ${err instanceof Error ? err.message : String(err)}`;
      this.db.deleteAction(params.orderId, params.actionType);
      this.db.markNeedsAttention(params.orderId, errMsg);
      throw err;
    }

    if (params.faultAfterBroadcast) {
      params.faultAfterBroadcast();
    }

    this.db.recordBroadcast(params.orderId, params.actionType, txid);
    return { txid, txHex, adopted: false };
  }
}
