import {
  DEFAULT_REVEAL_CONFIG,
  evmLockId,
  parseOrderTerms,
  type OrderTerms,
} from '@ferry/core';
import type { CashAddressNetwork } from '@ferry/htlc-bch';
import {
  buildSolverBchClaim as buildSolverBchClaimHelper,
  buildSolverBchLock as buildSolverBchLockHelper,
  deriveBchKeyDetails,
  getHtlcScriptHash,
} from '../bch/lock-builder.js';
import type { SolverDatabase } from '../db/database.js';
import type { OrderRecord } from '../db/types.js';
import { ActionExecutor } from '../executor/action-executor.js';
import {
  checkCounterLockTiming,
  checkLockRevealPolicy,
  isForwardDirection,
  transition,
} from '../state-machine/transitions.js';
import type {
  OrderStatus,
  SolverEvent,
  SolverOrderRecord,
  SwapDirection,
} from '../state-machine/types.js';
import type { BchChainPort, EngineConfig, EvmChainPort } from './types.js';

export function stringifyTerms(terms: OrderTerms): string {
  return JSON.stringify(terms, (_key, value) =>
    typeof value === 'bigint' ? `${value.toString()}n` : value,
  );
}

export function parseTermsJson(termsJson: string): OrderTerms {
  const parsed = JSON.parse(termsJson, (_key, value) => {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      return BigInt(value.slice(0, -1));
    }
    return value;
  });
  for (const field of [
    'bchTokenAmount',
    'evmAmount',
    'bchCarrySats',
    'bchMaxFee',
  ]) {
    if (
      typeof parsed[field] === 'string' ||
      typeof parsed[field] === 'number'
    ) {
      parsed[field] = BigInt(parsed[field]);
    }
  }
  return parseOrderTerms(parsed);
}

export function orderRecordToSolverOrder(
  record: OrderRecord,
): SolverOrderRecord {
  let terms: OrderTerms;
  try {
    terms = parseTermsJson(record.termsJson);
  } catch {
    terms = JSON.parse(record.termsJson) as OrderTerms;
  }

  return {
    id: record.id,
    direction: record.direction as SwapDirection,
    status: record.status as OrderStatus,
    lane: record.lane,
    fastOptIn: record.fastOptIn,
    firstSeenAtMs: record.firstSeenAtMs,
    terms,
    hashLock: (record.hashLock.startsWith('0x')
      ? record.hashLock
      : `0x${record.hashLock}`) as `0x${string}`,
    secret: record.secret as `0x${string}` | undefined,
    secretSource: record.secretSource as
      'cooperative' | 'on_chain_claim' | undefined,
    userLockTxId: record.userLockTxId,
    solverLockTxId: record.solverLockTxId,
    userClaimTxId: record.userClaimTxId,
    solverClaimTxId: record.solverClaimTxId,
    solverRefundTxId: record.solverRefundTxId,
    needsAttention: record.needsAttention,
    rejectionReason: record.rejectionReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class SolverEngine {
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private unsubscribers: Array<() => void> = [];
  private readonly dsproofWindowMs: number;
  private readonly pollIntervalMs: number;
  private passInFlight = false;
  private readonly onOrderError?: EngineConfig['onOrderError'];
  private readonly lastErrors = new Map<string, string>();
  private readonly bchExecutor: ActionExecutor;
  private readonly evmExecutor: ActionExecutor;

  private readonly executionReady: boolean;
  private readonly solverBchWif?: string | undefined;
  private readonly bchNetwork: CashAddressNetwork;

  constructor(
    public readonly db: SolverDatabase,
    public readonly bchPort: BchChainPort,
    public readonly evmPort: EvmChainPort,
    config: EngineConfig = {},
    bchExecutor?: ActionExecutor,
    evmExecutor?: ActionExecutor,
  ) {
    this.executionReady = config.executionReady ?? true;
    this.dsproofWindowMs = config.dsproofWindowMs ?? 5000;
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    this.onOrderError = config.onOrderError;
    this.solverBchWif = config.solverBchWif;
    this.bchNetwork = config.bchNetwork ?? 'chipnet';
    this.bchExecutor = bchExecutor ?? new ActionExecutor(this.db, this.bchPort);
    this.evmExecutor = evmExecutor ?? new ActionExecutor(this.db, this.evmPort);
  }

  async buildSolverBchLock(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }> {
    if (this.bchPort.buildLock) {
      return this.bchPort.buildLock(order);
    }
    const wif = this.solverBchWif;
    if (!wif) {
      throw new Error(
        'Cannot build the solver Bitcoin Cash lock: no solver key is configured',
      );
    }
    const solverKeys = await deriveBchKeyDetails(
      wif,
      this.bchNetwork === 'mainnet' ? 'bitcoincash' : 'bchtest',
    );
    if (!this.bchPort.listUnspent) {
      throw new Error(
        'Cannot build the solver Bitcoin Cash lock: the chain port cannot list outputs',
      );
    }
    const utxos = await this.bchPort.listUnspent(
      solverKeys.scriptHash,
      'include_tokens',
    );
    if (utxos.length === 0) {
      throw new Error(
        'Cannot build the solver Bitcoin Cash lock: the solver address holds no outputs',
      );
    }
    return buildSolverBchLockHelper({
      order,
      solverBchWif: wif,
      utxos,
      network: this.bchNetwork,
    });
  }

  async buildSolverEvmClaim(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }> {
    if (!order.secret) {
      throw new Error(
        `Cannot build solver EVM claim without revealed secret for order ${order.id}`,
      );
    }
    const isForward = isForwardDirection(order.direction);
    const locker = isForward
      ? order.terms.userEvmAddress
      : order.terms.solverEvmAddress;
    const lockId = evmLockId(locker, order.terms.hashLock);
    if (!this.evmPort.claim) {
      throw new Error(
        'Cannot build the solver EVM claim: the chain port cannot claim',
      );
    }
    return this.evmPort.claim(lockId, order.secret);
  }

  async buildSolverEvmLock(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }> {
    if (!this.evmPort.lock) {
      throw new Error(
        'Cannot build the solver EVM lock: the chain port cannot lock',
      );
    }
    return this.evmPort.lock(order.terms);
  }

  async buildSolverBchClaim(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }> {
    if (!order.secret) {
      throw new Error(
        `Cannot build solver BCH claim without revealed secret for order ${order.id}`,
      );
    }
    if (this.bchPort.buildClaim) {
      return this.bchPort.buildClaim(order);
    }
    const shHex = getHtlcScriptHash(order.terms, this.bchNetwork);
    let userUtxo:
      { tx_hash: string; tx_pos: number; value: number } | undefined;
    if (this.bchPort.listUnspent) {
      const utxos = await this.bchPort.listUnspent(shHex, 'include_tokens');
      userUtxo =
        utxos.find((u) => u.tx_hash === order.userLockTxId) ?? utxos[0];
    }
    if (!userUtxo) {
      throw new Error(
        'Cannot build the solver Bitcoin Cash claim: the user lock output was not found on chain',
      );
    }
    const utxo = {
      txid: userUtxo.tx_hash,
      vout: userUtxo.tx_pos,
      satoshis: userUtxo.value,
    };
    return buildSolverBchClaimHelper({
      order,
      utxo,
      secret: order.secret,
      network: this.bchNetwork,
    });
  }

  /**
   * Quoting is allowed ONLY when BCH quorum is healthy and quoting is enabled.
   */
  isQuotingEnabled(): boolean {
    if (!this.executionReady) {
      return false;
    }
    if (this.db.isQuotingPaused()) {
      return false;
    }
    return this.bchPort.isQuorumHealthy() && this.bchPort.isQuotingEnabled();
  }

  pauseQuoting(): void {
    this.db.setQuotingPaused(true);
  }

  resumeQuoting(): void {
    this.db.setQuotingPaused(false);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 1. Reconcile non-terminal orders on startup
    await this.reconcileOrders();

    // 2. Set up event subscriptions
    if (this.evmPort.subscribeLockEvents) {
      const unsub = this.evmPort.subscribeLockEvents(async (event) => {
        const order = this.findOrderByLockId(event.lockId);
        if (order) {
          await this.stepOrder(order);
        }
      });
      this.unsubscribers.push(unsub);
    }

    // 3. Start background polling (reconciliation pass ensures dropped notifications never lose secrets)
    this.pollTimer = setInterval(async () => {
      if (!this.running || this.passInFlight) return;
      this.passInFlight = true;
      try {
        await this.reconcileOrders();
      } catch {
        // keep polling
      } finally {
        this.passInFlight = false;
      }
    }, this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.unsubscribers = [];
  }

  findOrderByLockId(lockId: string): OrderRecord | null {
    const orders = this.db.listNonTerminalOrders();
    const normLockId = lockId.toLowerCase();
    return orders.find((o) => o.lockId.toLowerCase() === normLockId) ?? null;
  }

  private applyEvent(
    solverOrder: SolverOrderRecord,
    event: SolverEvent,
  ): OrderStatus {
    const res = transition(solverOrder, event);
    solverOrder.status = res.nextStatus;
    if (res.mutations) {
      Object.assign(solverOrder, res.mutations);
    }
    const now = Math.floor(Date.now() / 1000);
    solverOrder.updatedAt = now;

    this.db.saveOrder({
      id: solverOrder.id,
      direction: solverOrder.direction as OrderRecord['direction'],
      status: solverOrder.status,
      userCounterAddress:
        solverOrder.terms.userEvmAddress ??
        (solverOrder.terms as unknown as { userCounterAddress?: string })
          .userCounterAddress ??
        '',
      lockId: solverOrder.terms.hashLock,
      termsJson: stringifyTerms(solverOrder.terms),
      hashLock: solverOrder.hashLock,
      secret: solverOrder.secret,
      secretSource: solverOrder.secretSource,
      userLockTxId: solverOrder.userLockTxId,
      solverLockTxId: solverOrder.solverLockTxId,
      userClaimTxId: solverOrder.userClaimTxId,
      solverClaimTxId: solverOrder.solverClaimTxId,
      solverRefundTxId: solverOrder.solverRefundTxId,
      lane: solverOrder.lane,
      fastOptIn: solverOrder.fastOptIn,
      firstSeenAtMs: solverOrder.firstSeenAtMs,
      needsAttention: solverOrder.needsAttention,
      rejectionReason: solverOrder.rejectionReason,
      createdAt: solverOrder.createdAt,
      updatedAt: solverOrder.updatedAt,
    });

    return res.nextStatus;
  }

  async reconcileOrders(): Promise<void> {
    const nonTerminalOrders = this.db.listNonTerminalOrders();
    let firstError: unknown;
    let failed = false;
    for (const orderRecord of nonTerminalOrders) {
      try {
        await this.stepOrder(orderRecord);
      } catch (err) {
        // one failing order must not block the others; the first error is rethrown after the pass
        if (!failed) {
          failed = true;
          firstError = err;
        }
        // Report each distinct failure once per order, so a 5 s retry does not flood the log.
        const message = err instanceof Error ? err.message : String(err);
        if (this.lastErrors.get(orderRecord.id) !== message) {
          this.lastErrors.set(orderRecord.id, message);
          this.onOrderError?.(orderRecord.id, orderRecord.status, err);
        }
      }
    }
    if (failed) throw firstError;
  }

  async stepOrder(orderRecord: OrderRecord): Promise<void> {
    // Placeholder actions must never run against real chains.
    if (!this.executionReady) return;
    const currentRecord = this.db.getOrder(orderRecord.id);
    if (!currentRecord) return;
    const order = orderRecordToSolverOrder(currentRecord);

    if (isForwardDirection(order.direction)) {
      await this.stepForwardOrder(order);
    } else {
      await this.stepReverseOrder(order);
    }
    this.expireStaleQuote(order.id);
  }

  /** A quote nobody locked against leaves the polled set ten minutes after it lapses. */
  private expireStaleQuote(orderId: string): void {
    const record = this.db.getOrder(orderId);
    if (!record || record.status !== 'QUOTED') return;
    const order = orderRecordToSolverOrder(record);
    const expiry = (order.terms as { quoteExpiry?: number }).quoteExpiry;
    const now = Math.floor(Date.now() / 1000);
    if (typeof expiry === 'number' && now > expiry + 600) {
      this.applyEvent(order, { type: 'QUOTE_EXPIRED' });
    }
  }

  /**
   * Forward Swap (COUNTER_TO_BCH / EVM_TO_BCH):
   * 1. User locks on EVM.
   * 2. Solver locks on BCH.
   * 3. User claims on BCH revealing secret.
   * 4. Solver claims on EVM using revealed secret.
   */
  private async stepForwardOrder(order: SolverOrderRecord): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Step 1: Check EVM lock status if in QUOTED or USER_LOCK_SEEN
    if (order.status === 'QUOTED' || order.status === 'USER_LOCK_SEEN') {
      const lockId = evmLockId(
        order.terms.userEvmAddress,
        order.terms.hashLock,
      );
      const lockState = await this.evmPort.getLock(lockId);
      if (lockState.status === 'locked' && lockState.txid) {
        if (order.status === 'QUOTED') {
          this.applyEvent(order, {
            type: 'USER_LOCK_SEEN',
            txId: lockState.txid,
          });
        }

        const isFinal = await this.evmPort.isFinal(
          lockState.txid,
          order.lane ?? 'safe',
        );
        if (isFinal) {
          this.applyEvent(order, {
            type: 'USER_LOCK_FINAL',
            txId: lockState.txid,
          });
        }
      }
    }

    // Step 2: Solver counter-locks on BCH
    if (order.status === 'USER_LOCK_FINAL') {
      const bchTip = await this.bchPort.getTip();
      const timingDecision = checkCounterLockTiming(order, bchTip.height, now);
      if (!timingDecision.allowed) {
        this.applyEvent(order, {
          type: 'INVALID_TERMS',
          reason: `Timing invariant F failed: ${timingDecision.reason}`,
        });
        return;
      }

      const revealDecision = checkLockRevealPolicy(order, {
        exists: true,
        confirmations: 10,
        safe: true,
      });
      if (!revealDecision.allowed) {
        return; // wait for finality
      }

      // Execute BCH lock via bchExecutor
      const lockResult = await this.bchExecutor.executeOrAdopt({
        orderId: order.id,
        actionType: 'SOLVER_LOCK',
        buildTx: async () => this.buildSolverBchLock(order),
      });

      this.applyEvent(order, {
        type: 'SOLVER_LOCK_BROADCAST',
        txId: lockResult.txid,
      });

      const onChain = await this.bchPort.isOnChain(lockResult.txid);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_LOCK_SEEN',
          txId: lockResult.txid,
        });
      }
    }

    // Step 3: Advance SOLVER_LOCK_BROADCAST to SOLVER_LOCK_SEEN if on chain
    if (order.status === 'SOLVER_LOCK_BROADCAST' && order.solverLockTxId) {
      const onChain = await this.bchPort.isOnChain(order.solverLockTxId);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_LOCK_SEEN',
          txId: order.solverLockTxId,
        });
      }
    }

    // Step 4: Check for user claim or secret reveal
    if (
      order.status === 'SOLVER_LOCK_SEEN' ||
      order.status === 'SECRET_KNOWN'
    ) {
      // 4a. Check if user claimed on BCH
      const shHex = getHtlcScriptHash(order.terms, this.bchNetwork);
      let history = await this.bchPort.getScriptHashHistory(shHex);
      if (history.length === 0) {
        const legacyHash = order.terms.hashLock.slice(2);
        history = await this.bchPort.getScriptHashHistory(legacyHash);
      }
      if (history.length > 0) {
        for (const entry of history) {
          if (entry.tx_hash !== order.solverLockTxId) {
            let secret = order.secret;
            if (!secret && this.bchPort.extractSecretFromSpend) {
              const extracted = await this.bchPort.extractSecretFromSpend(
                entry.tx_hash,
                order.terms.hashLock,
              );
              if (extracted) secret = extracted;
            }
            this.applyEvent(order, {
              type: 'USER_CLAIM_SEEN',
              txId: entry.tx_hash,
              secret,
            });
            break;
          }
        }
      }

      // 4b. Or check cooperative secret in order
      if (order.secret && order.status === 'SOLVER_LOCK_SEEN') {
        this.applyEvent(order, {
          type: 'SECRET_REVEALED_COOPERATIVE',
          secret: order.secret,
        });
      }
    }

    // Step 5: Solver claims on EVM
    if (
      order.status === 'USER_CLAIM_SEEN' ||
      (order.status === 'SECRET_KNOWN' && order.secret)
    ) {
      if (!order.secret) return;

      const claimResult = await this.evmExecutor.executeOrAdopt({
        orderId: order.id,
        actionType: 'SOLVER_CLAIM',
        secret: order.secret,
        hashLock: order.hashLock,
        buildTx: async () => this.buildSolverEvmClaim(order),
      });

      this.applyEvent(order, {
        type: 'SOLVER_CLAIM_BROADCAST',
        txId: claimResult.txid,
      });

      const onChain = await this.evmPort.isOnChain(claimResult.txid);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_CLAIM_FINAL',
          txId: claimResult.txid,
        });
        this.applyEvent(order, { type: 'SWAP_COMPLETE' });
      }
    }

    // Step 6: Advance SOLVER_CLAIM_BROADCAST to final
    if (order.status === 'SOLVER_CLAIM_BROADCAST' && order.solverClaimTxId) {
      const onChain = await this.evmPort.isOnChain(order.solverClaimTxId);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_CLAIM_FINAL',
          txId: order.solverClaimTxId,
        });
        this.applyEvent(order, { type: 'SWAP_COMPLETE' });
      }
    }
  }

  /**
   * Reverse Swap (BCH_TO_COUNTER / BCH_TO_EVM):
   * 1. User locks on BCH.
   *    Fast-lane rule: 0-conf query double-spend proof, wait window (default 5s), refuse if proof appears.
   * 2. Solver locks on EVM.
   * 3. User claims on EVM revealing secret.
   * 4. Solver claims on BCH using revealed secret.
   */
  private async stepReverseOrder(order: SolverOrderRecord): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Step 1: Detect user BCH lock
    if (order.status === 'QUOTED' || order.status === 'USER_LOCK_SEEN') {
      const shHex = getHtlcScriptHash(order.terms, this.bchNetwork);
      let history = await this.bchPort.getScriptHashHistory(shHex);
      if (history.length === 0) {
        const legacyHash = order.terms.hashLock.slice(2);
        history = await this.bchPort.getScriptHashHistory(legacyHash);
      }
      const lockEntry = history[0];
      if (lockEntry) {
        const isFastLane = order.lane === 'fast' && order.fastOptIn;

        if (order.status === 'QUOTED') {
          const nowMs = Date.now();
          order.firstSeenAtMs = order.firstSeenAtMs ?? nowMs;
          this.applyEvent(order, {
            type: 'USER_LOCK_SEEN',
            txId: lockEntry.tx_hash,
          });
        }

        // Fast-lane double-spend proof rule
        if (isFastLane && lockEntry.height <= 0) {
          if (this.bchPort.waitForDoubleSpendProof) {
            const dsproofResult = await this.bchPort.waitForDoubleSpendProof(
              lockEntry.tx_hash,
              this.dsproofWindowMs,
            );
            if (dsproofResult.hasProof) {
              // Contested double-spend detected: refuse counter-lock!
              this.applyEvent(order, {
                type: 'INVALID_TERMS',
                reason: 'Double-spend proof detected on 0-conf lock',
              });
              return;
            }
          }

          // DSProof clear and window passed
          this.applyEvent(order, {
            type: 'USER_LOCK_FINAL',
            txId: lockEntry.tx_hash,
          });
        } else if (lockEntry.height > 0) {
          // Safe lane (>= 1 confirmation)
          this.applyEvent(order, {
            type: 'USER_LOCK_FINAL',
            txId: lockEntry.tx_hash,
          });
        }
      }
    }

    // Step 2: Solver counter-locks on EVM
    if (order.status === 'USER_LOCK_FINAL') {
      const bchTip = await this.bchPort.getTip();
      const timingDecision = checkCounterLockTiming(order, bchTip.height, now);
      if (!timingDecision.allowed) {
        this.applyEvent(order, {
          type: 'INVALID_TERMS',
          reason: `Timing invariant R failed: ${timingDecision.reason}`,
        });
        return;
      }

      const revealDecision = checkLockRevealPolicy(
        order,
        {
          exists: true,
          confirmations: order.lane === 'fast' ? 0 : 1,
          dsproof: 'clear',
          dsproofElapsedMs: this.dsproofWindowMs,
        },
        { ...DEFAULT_REVEAL_CONFIG, dsproofWindowMs: this.dsproofWindowMs },
      );
      if (!revealDecision.allowed) {
        return;
      }

      // Execute EVM counter-lock via evmExecutor
      const lockResult = await this.evmExecutor.executeOrAdopt({
        orderId: order.id,
        actionType: 'SOLVER_LOCK',
        buildTx: async () => this.buildSolverEvmLock(order),
      });

      this.applyEvent(order, {
        type: 'SOLVER_LOCK_BROADCAST',
        txId: lockResult.txid,
      });

      const onChain = await this.evmPort.isOnChain(lockResult.txid);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_LOCK_SEEN',
          txId: lockResult.txid,
        });
      }
    }

    // Step 3: Advance SOLVER_LOCK_BROADCAST to SOLVER_LOCK_SEEN if on chain
    if (order.status === 'SOLVER_LOCK_BROADCAST' && order.solverLockTxId) {
      const onChain = await this.evmPort.isOnChain(order.solverLockTxId);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_LOCK_SEEN',
          txId: order.solverLockTxId,
        });
      }
    }

    // Step 4: Check if user claimed on EVM
    if (
      order.status === 'SOLVER_LOCK_SEEN' ||
      order.status === 'SECRET_KNOWN'
    ) {
      const lockId = evmLockId(
        order.terms.solverEvmAddress,
        order.terms.hashLock,
      );
      const lockState = await this.evmPort.getLock(lockId);
      if (lockState.status === 'claimed') {
        let secret = lockState.secret ?? order.secret;
        if (!secret && lockState.txid && this.evmPort.extractSecretFromClaim) {
          const extracted = await this.evmPort.extractSecretFromClaim(
            lockState.txid,
          );
          if (extracted) secret = extracted;
        }
        this.applyEvent(order, {
          type: 'USER_CLAIM_SEEN',
          txId: lockState.txid ?? order.userClaimTxId ?? lockId,
          secret,
        });
      } else if (order.secret && order.status === 'SOLVER_LOCK_SEEN') {
        this.applyEvent(order, {
          type: 'SECRET_REVEALED_COOPERATIVE',
          secret: order.secret,
        });
      }
    }

    // Step 5: Solver claims on BCH
    if (
      order.status === 'USER_CLAIM_SEEN' ||
      (order.status === 'SECRET_KNOWN' && order.secret)
    ) {
      if (!order.secret) return;

      const claimResult = await this.bchExecutor.executeOrAdopt({
        orderId: order.id,
        actionType: 'SOLVER_CLAIM',
        secret: order.secret,
        hashLock: order.hashLock,
        buildTx: async () => this.buildSolverBchClaim(order),
      });

      this.applyEvent(order, {
        type: 'SOLVER_CLAIM_BROADCAST',
        txId: claimResult.txid,
      });

      const onChain = await this.bchPort.isOnChain(claimResult.txid);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_CLAIM_FINAL',
          txId: claimResult.txid,
        });
        this.applyEvent(order, { type: 'SWAP_COMPLETE' });
      }
    }

    // Step 6: Advance SOLVER_CLAIM_BROADCAST to final
    if (order.status === 'SOLVER_CLAIM_BROADCAST' && order.solverClaimTxId) {
      const onChain = await this.bchPort.isOnChain(order.solverClaimTxId);
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_CLAIM_FINAL',
          txId: order.solverClaimTxId,
        });
        this.applyEvent(order, { type: 'SWAP_COMPLETE' });
      }
    }
  }
}
