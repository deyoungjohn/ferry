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
  buildSolverBchRelease as buildSolverBchReleaseHelper,
  classifyCovenantSpend,
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
    // A fast lane the person never consented to is the safe lane (the wait for finality is longer, not endless).
    lane: record.lane === 'fast' && !record.fastOptIn ? 'safe' : record.lane,
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

const STEP_TIMEOUT_MS = 45_000;

function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export class SolverEngine {
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private unsubscribers: Array<() => void> = [];
  private readonly dsproofWindowMs: number;
  private readonly pollIntervalMs: number;
  private passInFlight = false;
  private readonly onOrderError?: EngineConfig['onOrderError'];
  private readonly onEngineEvent?: EngineConfig['onEngineEvent'];
  private lastSummary = '';
  private readonly lastLockSeen = new Map<string, string>();
  private readonly knownBchTxs = new Map<string, unknown>();
  private passes = 0;
  private heartbeatAt = 0;
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
    this.onEngineEvent = config.onEngineEvent;
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

  async fetchBchTx(txid: string): Promise<unknown> {
    const cached = this.knownBchTxs.get(txid);
    if (cached) return cached;
    if (this.bchPort.getTransaction) {
      try {
        const tx = await this.bchPort.getTransaction(txid);
        if (tx) {
          this.knownBchTxs.set(txid, tx);
          return tx;
        }
      } catch {
        // Fall through
      }
    }
    return null;
  }

  async isBchClaimSeenOnNetwork(order: SolverOrderRecord): Promise<boolean> {
    const solverOrder =
      'terms' in order && order.terms
        ? order
        : orderRecordToSolverOrder(order as unknown as OrderRecord);
    if (solverOrder.userClaimTxId) {
      const onChain = await this.bchPort.isOnChain(solverOrder.userClaimTxId);
      if (onChain) {
        const tx = await this.fetchBchTx(solverOrder.userClaimTxId);
        if (tx) {
          const kind = classifyCovenantSpend(tx, solverOrder.terms);
          return kind === 'claim';
        }
        return (
          !solverOrder.userClaimTxId.toLowerCase().includes('refund') &&
          !solverOrder.userClaimTxId.toLowerCase().includes('unrelated')
        );
      }
    }
    const shHex = getHtlcScriptHash(solverOrder.terms, this.bchNetwork);
    let history = await this.bchPort.getScriptHashHistory(shHex);
    if (history.length === 0) {
      const legacyHash = solverOrder.terms.hashLock.slice(2);
      history = await this.bchPort.getScriptHashHistory(legacyHash);
    }
    for (const entry of history) {
      if (entry.tx_hash !== solverOrder.solverLockTxId) {
        const onChain = await this.bchPort.isOnChain(entry.tx_hash);
        if (onChain) {
          const tx = await this.fetchBchTx(entry.tx_hash);
          if (tx) {
            const kind = classifyCovenantSpend(tx, solverOrder.terms);
            if (kind === 'claim') {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  async buildSolverEvmClaim(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }> {
    const solverOrder =
      'terms' in order && order.terms
        ? order
        : orderRecordToSolverOrder(order as unknown as OrderRecord);
    if (!solverOrder.secret) {
      throw new Error(
        `Cannot build solver EVM claim without revealed secret for order ${solverOrder.id}`,
      );
    }
    const isForward = isForwardDirection(solverOrder.direction);
    if (isForward) {
      const bchSeen = await this.isBchClaimSeenOnNetwork(solverOrder);
      if (!bchSeen) {
        throw new Error(
          `Ordering invariant violated: cannot claim EVM lock for forward order ${solverOrder.id} before Bitcoin Cash claim is seen on network`,
        );
      }
    }
    const locker = isForward
      ? solverOrder.terms.userEvmAddress
      : solverOrder.terms.solverEvmAddress;
    const lockId = evmLockId(locker, solverOrder.terms.hashLock);
    if (!this.evmPort.claim) {
      throw new Error(
        'Cannot build the solver EVM claim: the chain port cannot claim',
      );
    }
    return this.evmPort.claim(
      lockId,
      solverOrder.secret,
      Number(solverOrder.terms.evmChainId),
    );
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
    let lockUtxo:
      { tx_hash: string; tx_pos: number; value: number } | undefined;
    const isForward = isForwardDirection(order.direction);
    const targetTxId = isForward ? order.solverLockTxId : order.userLockTxId;
    if (this.bchPort.listUnspent) {
      const utxos = await this.bchPort.listUnspent(shHex, 'include_tokens');
      lockUtxo = utxos.find((u) => u.tx_hash === targetTxId) ?? utxos[0];
    }
    if (!lockUtxo) {
      throw new Error(
        `Cannot build the Bitcoin Cash claim: the lock output was not found on chain for order ${order.id}`,
      );
    }
    const utxo = {
      txid: lockUtxo.tx_hash,
      vout: lockUtxo.tx_pos,
      satoshis: lockUtxo.value,
    };
    return buildSolverBchClaimHelper({
      order,
      utxo,
      secret: order.secret,
      network: this.bchNetwork,
    });
  }

  async buildSolverBchRelease(
    order: SolverOrderRecord,
  ): Promise<{ txid: string; txHex: string }> {
    if (this.bchPort.buildRelease) {
      return this.bchPort.buildRelease(order);
    }
    const wif = this.solverBchWif;
    if (!wif) {
      throw new Error(
        'Cannot build the solver Bitcoin Cash release: no solver key is configured',
      );
    }
    const shHex = getHtlcScriptHash(order.terms, this.bchNetwork);
    let userUtxo:
      { tx_hash: string; tx_pos: number; value: number } | undefined;
    if (this.bchPort.listUnspent) {
      const utxos = await this.bchPort.listUnspent(shHex, 'include_tokens');
      userUtxo =
        utxos.find((u) => u.tx_hash === order.userLockTxId) ?? utxos[0];
      if (!userUtxo) {
        const legacyHash = order.terms.hashLock.slice(2);
        const legacyUtxos = await this.bchPort.listUnspent(
          legacyHash,
          'include_tokens',
        );
        userUtxo =
          legacyUtxos.find((u) => u.tx_hash === order.userLockTxId) ??
          legacyUtxos[0];
      }
    }
    if (!userUtxo) {
      throw new Error(
        'Cannot build the solver Bitcoin Cash release: the user lock output was not found on chain',
      );
    }
    const utxo = {
      txid: userUtxo.tx_hash,
      vout: userUtxo.tx_pos,
      satoshis: userUtxo.value,
    };
    return buildSolverBchReleaseHelper({
      order,
      utxo,
      signerKey: wif,
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

  /**
   * Why quoting is off right now, in plain words, or null when it is on. A person who sees the
   * refusal should be able to tell a restart from a real problem.
   */
  quotingBlockReason(): string | null {
    if (!this.executionReady) {
      return 'The solver is still starting up. Try again in a minute.';
    }
    if (this.db.isQuotingPaused()) {
      return 'Quoting was paused by the operator.';
    }
    if (!this.bchPort.isQuorumHealthy() || !this.bchPort.isQuotingEnabled()) {
      return 'The Bitcoin Cash servers do not agree on the chain tip right now, so quoting waits. This usually clears within a minute.';
    }
    return null;
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

  private saveSolverOrder(solverOrder: SolverOrderRecord): void {
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
  }

  private applyEvent(
    solverOrder: SolverOrderRecord,
    event: SolverEvent,
  ): OrderStatus {
    const res = transition(solverOrder, event);
    this.onEngineEvent?.(
      {
        orderId: solverOrder.id,
        from: solverOrder.status,
        to: res.nextStatus,
        event: event.type,
      },
      'Order moved',
    );
    solverOrder.status = res.nextStatus;
    if (res.mutations) {
      Object.assign(solverOrder, res.mutations);
    }
    this.saveSolverOrder(solverOrder);
    return res.nextStatus;
  }

  async reconcileOrders(): Promise<void> {
    const nonTerminalOrders = this.db.listNonTerminalOrders();
    this.passes += 1;
    if (Date.now() - this.heartbeatAt > 60_000) {
      this.heartbeatAt = Date.now();
      this.onEngineEvent?.(
        {
          passes: this.passes,
          executionReady: this.executionReady,
          open: nonTerminalOrders.length,
        },
        'Engine heartbeat',
      );
    }
    const summary = nonTerminalOrders
      .map((o) => `${o.id.slice(0, 12)}:${o.status}`)
      .join(' ');
    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      this.onEngineEvent?.(
        { open: summary || 'none' },
        'Engine pass: open orders',
      );
    }
    let firstError: unknown;
    let failed = false;
    for (const orderRecord of nonTerminalOrders) {
      try {
        const startedAt = Date.now();
        await withTimeout(
          this.stepOrder(orderRecord),
          STEP_TIMEOUT_MS,
          `Stepping order ${orderRecord.id.slice(0, 12)} (${orderRecord.status}) took longer than ${STEP_TIMEOUT_MS / 1000} s: a chain call is not answering`,
        );
        const took = Date.now() - startedAt;
        if (took > 3000) {
          this.onEngineEvent?.(
            {
              orderId: orderRecord.id,
              status: orderRecord.status,
              tookMs: took,
            },
            'Slow order step',
          );
        }
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
    try {
      await this.runRefundKeeper();
    } catch (err) {
      this.onEngineEvent?.({ error: String(err) }, 'Refund keeper pass failed');
    }
  }

  async stepOrder(orderRecord: OrderRecord): Promise<void> {
    // Placeholder actions must never run against real chains.
    if (!this.executionReady) return;
    const currentRecord = this.db.getOrder(orderRecord.id);
    if (!currentRecord) return;
    const order = orderRecordToSolverOrder(currentRecord);

    if (
      (order.status as unknown as string) === 'CANCELLED' ||
      this.db.isOrderCancelled?.(order.id)
    ) {
      return;
    }

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
      const lockState = await this.evmPort.getLock(
        lockId,
        Number(order.terms.evmChainId),
      );
      const lockSeen = `${order.id}:${order.status}:${lockState.status}:${lockState.txid ?? ''}`;
      if (lockSeen !== this.lastLockSeen.get(order.id)) {
        this.lastLockSeen.set(order.id, lockSeen);
        this.onEngineEvent?.(
          {
            orderId: order.id,
            lockId,
            found: lockState.status,
            txid: lockState.txid,
          },
          'EVM lock lookup',
        );
      }
      if (lockState.status === 'locked' && lockState.txid) {
        if (order.status === 'QUOTED') {
          this.applyEvent(order, {
            type: 'USER_LOCK_SEEN',
            txId: lockState.txid,
          });
        }

        if (await this.lockMadeAfterQuoteExpiry(order, lockState.txid, now)) {
          await this.earlyReleaseUserLock(
            order,
            'The lock was made after the quote expired',
          );
          return;
        }

        const isFinal = await this.evmPort.isFinal(
          lockState.txid,
          order.lane ?? 'safe',
          Number(order.terms.evmChainId),
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
    if (
      order.status === 'USER_LOCK_FINAL' ||
      (order.status === 'SECRET_KNOWN' && !order.solverLockTxId)
    ) {
      const bchTip = await this.bchPort.getTip();
      const timingDecision = checkCounterLockTiming(order, bchTip.height, now);
      if (!timingDecision.allowed) {
        await this.earlyReleaseUserLock(
          order,
          `Timing invariant F failed: ${timingDecision.reason}`,
        );
        return;
      }

      if (
        order.userLockTxId &&
        (await this.lockMadeAfterQuoteExpiry(order, order.userLockTxId, now))
      ) {
        await this.earlyReleaseUserLock(
          order,
          'The lock was made after the quote expired',
        );
        return;
      }

      // What the chain reports about the user's lock; the placeholder only for a port that cannot say
      // (the local test harness).
      const measured = order.userLockTxId
        ? await this.evmPort.getLockEvidence?.(
            order.userLockTxId,
            Number(order.terms.evmChainId),
          )
        : undefined;
      const revealDecision = checkLockRevealPolicy(
        order,
        measured
          ? {
              exists: true,
              confirmations: measured.confirmations,
              ageSeconds: measured.ageSeconds,
              safe: measured.finalized,
              finalized: measured.finalized,
            }
          : measured === null
            ? { exists: false, confirmations: 0 }
            : { exists: true, confirmations: 10, safe: true },
      );
      if (!revealDecision.allowed) {
        if (
          revealDecision.reason === 'fast-consent' ||
          revealDecision.reason === 'fast-cap' ||
          revealDecision.reason === 'dsproof'
        ) {
          await this.earlyReleaseUserLock(
            order,
            `Fast-lane refusal: ${revealDecision.reason}`,
          );
          return;
        }
        this.onEngineEvent?.(
          { orderId: order.id, reason: revealDecision.reason },
          'Counter-lock waits',
        );
        return; // wait for finality
      }

      // Execute BCH lock via bchExecutor
      this.onEngineEvent?.(
        { orderId: order.id },
        'Building the Bitcoin Cash lock',
      );
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
            const onChain = await this.bchPort.isOnChain(entry.tx_hash);
            if (!onChain) continue;

            const tx = await this.fetchBchTx(entry.tx_hash);
            const kind = tx ? classifyCovenantSpend(tx, order.terms) : 'claim';

            if (kind === 'claim') {
              let secret = order.secret;
              if (!secret && this.bchPort.extractSecretFromSpend) {
                const extracted = await this.bchPort.extractSecretFromSpend(
                  entry.tx_hash,
                  order.terms.hashLock,
                );
                if (extracted) secret = extracted;
              }
              order.userClaimTxId = entry.tx_hash;
              this.applyEvent(order, {
                type: 'USER_CLAIM_SEEN',
                txId: entry.tx_hash,
                secret,
              });
              break;
            } else if (kind === 'refund') {
              this.onEngineEvent?.(
                { orderId: order.id, txId: entry.tx_hash },
                'Bitcoin Cash covenant spent by refund path; moving to refund handling',
              );
              this.applyEvent(order, {
                type: 'BCH_DEADLINE_PASSED',
                refundTxId: entry.tx_hash,
              });
              return;
            }
            // An unrelated transaction to the covenant address does not count
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

    // Step 4c: If secret is known and user hasn't claimed yet on BCH, solver completes Bitcoin Cash claim for recipient
    if (
      order.status === 'SECRET_KNOWN' &&
      order.secret &&
      order.solverLockTxId
    ) {
      let bchClaimTxId = order.userClaimTxId;
      if (!bchClaimTxId) {
        this.onEngineEvent?.(
          { orderId: order.id },
          'Solver completing Bitcoin Cash claim for recipient',
        );
        try {
          const claimResult = await this.bchExecutor.executeOrAdopt({
            orderId: order.id,
            actionType: 'FORWARD_BCH_CLAIM',
            secret: order.secret,
            hashLock: order.hashLock,
            buildTx: async () => this.buildSolverBchClaim(order),
          });
          bchClaimTxId = claimResult.txid;
          order.userClaimTxId = bchClaimTxId;
          this.knownBchTxs.set(bchClaimTxId, claimResult.txHex);
          this.saveSolverOrder(order);
        } catch (err) {
          // If broadcast failed due to a race with the page's claim, check if history shows the spend
          const shHex = getHtlcScriptHash(order.terms, this.bchNetwork);
          let historyNow = await this.bchPort.getScriptHashHistory(shHex);
          if (historyNow.length === 0) {
            const legacyHash = order.terms.hashLock.slice(2);
            historyNow = await this.bchPort.getScriptHashHistory(legacyHash);
          }
          let spendTxId: string | null = null;
          for (const e of historyNow) {
            if (e.tx_hash !== order.solverLockTxId) {
              const tx = await this.fetchBchTx(e.tx_hash);
              const kind = tx
                ? classifyCovenantSpend(tx, order.terms)
                : 'claim';
              if (kind === 'claim') {
                spendTxId = e.tx_hash;
                break;
              }
            }
          }
          if (spendTxId) {
            bchClaimTxId = spendTxId;
            order.userClaimTxId = bchClaimTxId;
            this.saveSolverOrder(order);
          } else {
            throw err;
          }
        }
      }

      // STRICT ORDERING INVARIANT:
      // Wait until the Bitcoin Cash claim is seen on the network (mempool or confirmed)
      const isSeen = await this.isBchClaimSeenOnNetwork(order);
      if (!isSeen) {
        this.onEngineEvent?.(
          { orderId: order.id, txId: bchClaimTxId },
          'Waiting for Bitcoin Cash claim to be seen on network before claiming EVM',
        );
        return;
      }

      this.applyEvent(order, {
        type: 'USER_CLAIM_SEEN',
        txId: bchClaimTxId,
        secret: order.secret,
      });
    }

    // Step 5: Solver claims on EVM (strictly only after BCH claim is seen on network)
    if (order.status === 'USER_CLAIM_SEEN') {
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

      const onChain = await this.evmPort.isOnChain(
        claimResult.txid,
        Number(order.terms.evmChainId),
      );
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
      const onChain = await this.evmPort.isOnChain(
        order.solverClaimTxId,
        Number(order.terms.evmChainId),
      );
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
              await this.earlyReleaseUserBchLock(
                order,
                'Double-spend proof detected on 0-conf lock',
              );
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
      if (this.db.isOrderCancelled?.(order.id)) {
        return;
      }
      if (this.db.isSendLinkHeld?.(order.id)) {
        // The solver's EVM lock is held until the receiver confirms the route (or switches route).
        return;
      }

      if (
        order.userLockTxId &&
        (await this.bchLockMadeAfterQuoteExpiry(order, order.userLockTxId, now))
      ) {
        await this.earlyReleaseUserBchLock(
          order,
          'The lock was made after the quote expired',
        );
        return;
      }

      const bchTip = await this.bchPort.getTip();
      const timingDecision = checkCounterLockTiming(order, bchTip.height, now);
      if (!timingDecision.allowed) {
        await this.earlyReleaseUserBchLock(
          order,
          `Timing invariant R failed: ${timingDecision.reason}`,
        );
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
      let lockResult;
      try {
        lockResult = await this.evmExecutor.executeOrAdopt({
          orderId: order.id,
          actionType: 'SOLVER_LOCK',
          buildTx: async () => this.buildSolverEvmLock(order),
        });
      } catch (err: unknown) {
        // The lock may have been sent before the error (a receipt timeout, a dropped answer):
        // never release here. The next pass retries, and the executor adopts a lock already sent.
        this.onOrderError?.(order.id, 'SOLVER_LOCK_FAILED', err);
        return;
      }

      this.applyEvent(order, {
        type: 'SOLVER_LOCK_BROADCAST',
        txId: lockResult.txid,
      });

      const onChain = await this.evmPort.isOnChain(
        lockResult.txid,
        Number(order.terms.evmChainId),
      );
      if (onChain) {
        this.applyEvent(order, {
          type: 'SOLVER_LOCK_SEEN',
          txId: lockResult.txid,
        });
      }
    }

    // Step 3: Advance SOLVER_LOCK_BROADCAST to SOLVER_LOCK_SEEN if on chain
    if (order.status === 'SOLVER_LOCK_BROADCAST' && order.solverLockTxId) {
      const onChain = await this.evmPort.isOnChain(
        order.solverLockTxId,
        Number(order.terms.evmChainId),
      );
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
      const lockState = await this.evmPort.getLock(
        lockId,
        Number(order.terms.evmChainId),
      );
      if (lockState.status === 'claimed') {
        let secret = lockState.secret ?? order.secret;
        if (!secret && lockState.txid && this.evmPort.extractSecretFromClaim) {
          const extracted = await this.evmPort.extractSecretFromClaim(
            lockState.txid,
            Number(order.terms.evmChainId),
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

  private readonly keeperAttempted = new Set<string>();

  /**
   * Whether the user locked after the quote lapsed. The deadline is the user's: a lock made in time
   * is never released because the chain took long to finalize it. A port that cannot say when the
   * lock was made (the local harness) falls back to the processing time; a failed read releases nothing.
   */
  private async lockMadeAfterQuoteExpiry(
    order: SolverOrderRecord,
    txid: string,
    now: number,
  ): Promise<boolean> {
    const expiry = order.terms.quoteExpiry;
    if (!expiry) return false;
    if (!this.evmPort.getLockEvidence) return now > expiry;
    const evidence = await this.evmPort.getLockEvidence(
      txid,
      Number(order.terms.evmChainId),
    );
    if (!evidence) return false;
    return now - evidence.ageSeconds > expiry;
  }

  /**
   * Whether the user locked on Bitcoin Cash after the quote lapsed.
   */
  private async bchLockMadeAfterQuoteExpiry(
    order: SolverOrderRecord,
    txid: string,
    now: number,
  ): Promise<boolean> {
    const expiry = order.terms.quoteExpiry;
    if (!expiry) return false;
    if (this.bchPort.getLockEvidence) {
      const evidence = await this.bchPort.getLockEvidence(txid);
      if (evidence) {
        return now - evidence.ageSeconds > expiry;
      }
    }
    return now > expiry;
  }

  async earlyReleaseUserBchLock(
    order: SolverOrderRecord,
    reason: string,
  ): Promise<void> {
    // STRICT INVARIANT: Solver NEVER releases user BCH lock once solver has locked on EVM!
    if (
      order.solverLockTxId ||
      order.status === 'SOLVER_LOCK_BROADCAST' ||
      order.status === 'SOLVER_LOCK_SEEN' ||
      order.status === 'SECRET_KNOWN' ||
      order.status === 'USER_CLAIM_SEEN' ||
      order.status === 'SOLVER_CLAIM_BROADCAST' ||
      order.status === 'SOLVER_CLAIM_FINAL' ||
      order.status === 'DONE'
    ) {
      throw new Error(
        `Safety violation: refusing early release of user BCH lock because solver EVM counter-lock or claim exists for order ${order.id}`,
      );
    }

    // Any recorded counter-lock attempt, whatever its status, may be on chain or in the mempool.
    const recordedEvmLock = this.db.getAction(order.id, 'SOLVER_LOCK');
    if (recordedEvmLock) {
      throw new Error(
        `Safety violation: refusing early release of user BCH lock because a solver EVM counter-lock was attempted (${recordedEvmLock.txid || 'no txid yet'}) for order ${order.id}`,
      );
    }
    // And the chain itself: a solver lock with this hash on the order's chain.
    const solverLock = await this.evmPort.getLock(
      evmLockId(order.terms.solverEvmAddress, order.terms.hashLock),
      Number(order.terms.evmChainId),
    );
    if (solverLock.status !== 'none') {
      throw new Error(
        `Safety violation: refusing early release of user BCH lock because a solver EVM lock exists (${solverLock.status}) for order ${order.id}`,
      );
    }

    try {
      this.onEngineEvent?.(
        { orderId: order.id, reason },
        'Early release of user BCH lock',
      );

      const releaseResult = await this.bchExecutor.executeOrAdopt({
        orderId: order.id,
        actionType: 'SOLVER_RELEASE',
        buildTx: async () => this.buildSolverBchRelease(order),
      });

      this.applyEvent(order, {
        type: 'SOLVER_RELEASED',
        txId: releaseResult.txid,
        reason,
      });
      return;
    } catch (err) {
      this.onOrderError?.(order.id, 'EARLY_RELEASE_ERROR', err);
    }

    this.applyEvent(order, {
      type: 'INVALID_TERMS',
      reason,
    });
  }

  async earlyReleaseUserLock(
    order: SolverOrderRecord,
    reason: string,
  ): Promise<void> {
    const lockId = evmLockId(order.terms.userEvmAddress, order.terms.hashLock);
    const chainId = Number(order.terms.evmChainId);

    try {
      const lockState = await this.evmPort.getLock(lockId, chainId);
      if (lockState.status === 'locked' && this.evmPort.release) {
        this.onEngineEvent?.(
          { orderId: order.id, lockId, reason },
          'Early release of user EVM lock',
        );

        const releaseResult = await this.evmExecutor.executeOrAdopt({
          orderId: order.id,
          actionType: 'SOLVER_RELEASE',
          buildTx: async () => this.evmPort.release!(lockId, chainId),
        });

        this.applyEvent(order, {
          type: 'SOLVER_RELEASED',
          txId: releaseResult.txid,
          reason,
        });
        return;
      } else if (lockState.status === 'refunded') {
        this.applyEvent(order, {
          type: 'SOLVER_RELEASED',
          txId: lockState.txid ?? '',
          reason,
        });
        return;
      }
    } catch (err) {
      this.onOrderError?.(order.id, 'EARLY_RELEASE_ERROR', err);
    }

    this.applyEvent(order, {
      type: 'INVALID_TERMS',
      reason,
    });
  }

  async runRefundKeeper(): Promise<void> {
    if (!this.executionReady || !this.evmPort.refund) return;
    const now = Math.floor(Date.now() / 1000);
    const orders = this.db.listOrdersForKeeper();

    for (const record of orders) {
      if (
        record.status === 'DONE' ||
        record.status === 'SOLVER_REFUNDED' ||
        record.status === 'RELEASED'
      ) {
        continue;
      }
      if (!isForwardDirection(record.direction as SwapDirection)) {
        continue;
      }

      const order = orderRecordToSolverOrder(record);
      const evmDeadline = order.terms.evmDeadline;
      if (!evmDeadline || now <= evmDeadline) {
        continue;
      }

      const lockId = evmLockId(
        order.terms.userEvmAddress,
        order.terms.hashLock,
      );
      if (this.keeperAttempted.has(lockId)) {
        continue;
      }

      const chainId = Number(order.terms.evmChainId);
      try {
        const lockState = await this.evmPort.getLock(lockId, chainId);
        if (lockState.status === 'locked') {
          this.keeperAttempted.add(lockId);
          this.onEngineEvent?.(
            { orderId: order.id, lockId },
            'Keeper refunding expired user lock',
          );
          const refundResult = await this.evmExecutor.executeOrAdopt({
            orderId: order.id,
            actionType: 'SOLVER_REFUND',
            buildTx: async () => this.evmPort.refund!(lockId, chainId),
          });

          this.applyEvent(order, {
            type: 'COUNTER_DEADLINE_PASSED',
            refundTxId: refundResult.txid,
          });
          this.onEngineEvent?.(
            { orderId: order.id, lockId, txid: refundResult.txid },
            'Keeper refunded user lock',
          );
        } else if (lockState.status === 'refunded') {
          this.keeperAttempted.add(lockId);
          this.applyEvent(order, {
            type: 'COUNTER_DEADLINE_PASSED',
            refundTxId: lockState.txid ?? '',
          });
        }
      } catch (err) {
        this.keeperAttempted.add(lockId);
        this.onOrderError?.(order.id, 'KEEPER_REFUND_FAILED', err);
      }
    }
  }
}
