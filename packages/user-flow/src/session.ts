import { decodeCashAddress, evmLockId } from '@ferry/core';
import type {
  Direction,
  Hex,
  Hex32,
  LockChainStatus,
  OrderTerms,
  RecoveryFile,
  RecoveryPlan,
} from '@ferry/core';
import {
  buildEvmRecoveryCalldata,
  parseRecoveryFileJson,
  recoveryActions,
} from '@ferry/core';
import type { QuoteRequest } from '@ferry/core/api';
import {
  buildBchRecoveryTransaction,
  buildLockTransaction,
  buildWizardConnectSignRequest,
  deriveHtlcAddresses,
  encodeHtlcParameters,
  inspectSignedTransaction,
  type LockUtxo,
} from '@ferry/htlc-bch';
import {
  prepareRecoveryDownload,
  verifyQuote,
  type VerifiedQuote,
} from '@ferry/solver-client';
import { binToHex } from '@bitauth/libauth';
import { sha256 } from 'viem';
import { UserFlowError } from './errors.js';
import { guardWallet, lockUserOnEvm } from './actions.js';
import type {
  BchChainPort,
  BchSignerPort,
  BchUtxo,
  EvmChainPort,
  EvmSignerPort,
  RecoveryStorePort,
  SolverPort,
} from './ports.js';

export type SwapStepName =
  | 'quote'
  | 'saveRecovery'
  | 'lock'
  | 'waitCounterLock'
  | 'claim'
  | 'done'
  | 'refund'
  | 'refunded';

export type SwapStatus = 'ready' | 'running' | 'waiting' | 'failed';

export interface SwapState {
  /** The step the user is on, or about to do. */
  readonly step: SwapStepName;
  readonly status: SwapStatus;
  /** Plain words describing what the swap is waiting for, or null. */
  readonly waiting: string | null;
  /** The last failure in plain words, or null. */
  readonly error: string | null;
  readonly direction: Direction | null;
  readonly orderId: Hex32 | null;
  readonly txids: {
    readonly userLock: string | null;
    readonly claim: string | null;
    readonly refund: string | null;
  };
}

export type VerifyOptions = Omit<
  Parameters<typeof verifyQuote>[2],
  'bchTipHeight' | 'evmTokenDecimals' | 'bchTokenDecimals' | 'nowSeconds'
>;

export interface UserSwapDependencies {
  readonly solver: SolverPort;
  readonly evmSigner: EvmSignerPort;
  readonly evmChain: EvmChainPort;
  readonly bchSigner: BchSignerPort;
  readonly bchChain: BchChainPort;
  readonly store: RecoveryStorePort;
  readonly bchNetwork: 'mainnet' | 'chipnet';
  /** The user's own Bitcoin Cash address: change and token change return here. */
  readonly bchCashAddress: string;
  readonly verify?: VerifyOptions;
  readonly feeRateSatPerByte?: number;
  readonly nowMs?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 32 random bytes. Defaults to the platform's `crypto.getRandomValues`. */
  readonly secretGenerator?: () => Hex32;
}

export interface QuoteInput {
  readonly direction: Direction;
  readonly token: 'PUSD' | 'MUSD';
  /** The chain the page believes the wallet is on; a mismatch stops the quote. */
  readonly chainId: number;
  readonly evmToken: Hex;
  readonly amountIn: bigint;
  readonly evmTokenDecimals: number;
  readonly bchTokenDecimals: number;
  readonly lane?: 'fast' | 'safe';
  readonly fastOptIn?: boolean;
  /** A price only: nothing is reserved and the session cannot go on to lock. */
  readonly dryRun?: boolean;
}

export interface WaitOptions {
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const DEFAULT_FEE_RATE_SAT_PER_BYTE = 1;

const WAITING = {
  counterLockEvm: "Waiting for the solver's lock on the EVM chain to confirm",
  counterLockBch: "Waiting for the solver's lock on Bitcoin Cash to confirm",
} as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSecretGenerator(): Hex32 {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${binToHex(bytes)}` as Hex32;
}

const INITIAL_STATE: SwapState = {
  step: 'quote',
  status: 'ready',
  waiting: null,
  error: null,
  direction: null,
  orderId: null,
  txids: { userLock: null, claim: null, refund: null },
};

/**
 * The user's side of one swap, in either direction. Named steps, each with a
 * plain description of what it is waiting for, and resumable from the saved
 * recovery file after a reload. Nothing here touches a wallet, a socket or a
 * file: all of that is behind the ports.
 */
export class UserSwapSession {
  private readonly deps: UserSwapDependencies;
  private current: SwapState = INITIAL_STATE;
  private readonly listeners = new Set<(state: SwapState) => void>();
  private verified: VerifiedQuote | null = null;
  private file: RecoveryFile | null = null;
  private secret: Hex32 | null = null;
  private dryRun = false;
  private recoverySaved = false;

  constructor(deps: UserSwapDependencies) {
    this.deps = deps;
  }

  /** Rebuild a session from the recovery file saved before the lock (after a reload). */
  static async resume(
    deps: UserSwapDependencies,
    orderId: Hex32,
  ): Promise<UserSwapSession> {
    const json = await deps.store.load(orderId);
    if (json === null) {
      throw new UserFlowError(
        'NO_QUOTE',
        'No saved recovery file was found for this swap.',
      );
    }
    const session = new UserSwapSession(deps);
    session.file = parseRecoveryFileJson(json);
    session.secret = session.file.secret ?? null;
    session.recoverySaved = true;
    session.set({
      direction: session.file.terms.direction,
      orderId: session.file.orderId,
    });
    await session.refresh();
    return session;
  }

  get state(): SwapState {
    return this.current;
  }

  get quoted(): VerifiedQuote | null {
    return this.verified;
  }

  get recoveryFile(): RecoveryFile | null {
    return this.file;
  }

  subscribe(listener: (state: SwapState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- steps -----------------------------------------------------------

  /** Step `quote`: a fresh secret and hash lock, the real request, verified before it is trusted. */
  async quote(input: QuoteInput): Promise<VerifiedQuote> {
    this.set({ step: 'quote', status: 'running', error: null });
    try {
      const userEvmAddress = await this.deps.evmSigner.getAddress();
      const walletChain = await this.deps.evmSigner.getChainId();
      if (walletChain !== input.chainId) {
        throw new UserFlowError(
          'WRONG_CHAIN',
          `The wallet is on chain ${walletChain}, but this swap is for chain ${input.chainId}. Switch networks and try again.`,
        );
      }
      if (
        userEvmAddress.toLowerCase() === ZERO_ADDRESS ||
        input.evmToken.toLowerCase() === ZERO_ADDRESS
      ) {
        throw new UserFlowError(
          'INVALID_INPUT',
          'A wallet or token address is empty; the request was not sent.',
        );
      }
      if (input.amountIn <= 0n) {
        throw new UserFlowError(
          'INVALID_INPUT',
          'The amount must be more than zero.',
        );
      }
      const bchLockingBytecode = this.userBchLockingBytecode();

      const secret = (this.deps.secretGenerator ?? defaultSecretGenerator)();
      const hashLock = sha256(secret) as Hex32;
      const request: QuoteRequest = {
        direction: input.direction,
        token: input.token,
        chainId: input.chainId,
        evmToken: input.evmToken,
        amountIn: input.amountIn,
        userEvmAddress,
        userBchLockingBytecode: bchLockingBytecode,
        hashLock,
        lane:
          input.lane ?? (input.direction === 'EVM_TO_BCH' ? 'fast' : 'safe'),
        ...(input.fastOptIn !== undefined
          ? { fastOptIn: input.fastOptIn }
          : {}),
        ...(input.dryRun === true ? { dryRun: true } : {}),
      };

      const [bchTipHeight, response] = await Promise.all([
        this.tipHeight(),
        this.deps.solver.quote(request),
      ]);
      const verified = await verifyQuote(response, request, {
        ...this.deps.verify,
        bchTipHeight,
        evmTokenDecimals: input.evmTokenDecimals,
        bchTokenDecimals: input.bchTokenDecimals,
        nowSeconds: Math.floor(this.nowMs() / 1000),
      });

      this.verified = verified;
      this.secret = secret;
      this.dryRun = input.dryRun === true;
      this.recoverySaved = false;
      this.file = null;
      this.set({
        step: input.dryRun === true ? 'quote' : 'saveRecovery',
        status: 'ready',
        direction: verified.terms.direction,
        orderId: verified.orderId,
      });
      return verified;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Step `saveRecovery`: the recovery file, with the real covenant, saved before any lock. */
  async saveRecovery(): Promise<RecoveryFile> {
    const quote = this.requireQuote();
    this.set({ step: 'saveRecovery', status: 'running', error: null });
    try {
      const params = encodeHtlcParameters(quote.terms);
      const derived = deriveHtlcAddresses(params, this.deps.bchNetwork);
      const payload = prepareRecoveryDownload({
        quote,
        contracts: {
          evm: {
            chainId: quote.terms.evmChainId,
            htlcAddress: quote.terms.evmHtlc,
            tokenAddress: quote.terms.evmToken,
          },
          bch: {
            network: this.deps.bchNetwork,
            htlcAddress: derived.p2sh32Address,
            tokenAddress: derived.tokenAddress,
            redeemScript: `0x${binToHex(derived.redeemScript)}` as Hex,
            lockingBytecode: `0x${binToHex(derived.lockingBytecode)}` as Hex,
          },
        },
        secret: this.secret ?? defaultSecretGenerator(),
        createdAt: Math.floor(this.nowMs() / 1000),
      });
      await this.deps.store.save(quote.orderId, payload.json);
      this.file = payload.file;
      this.recoverySaved = true;
      this.set({ step: 'lock', status: 'ready' });
      return payload.file;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Step `lock`: the user's own lock. Refused until the recovery file is saved. */
  async lock(): Promise<string> {
    const { terms } = this.requireSavedOrder();
    this.set({ step: 'lock', status: 'running', error: null });
    try {
      const txid =
        terms.direction === 'EVM_TO_BCH'
          ? await this.lockOnEvm(terms)
          : await this.lockOnBch(terms);
      this.set({
        step: 'waitCounterLock',
        status: 'ready',
        txids: { ...this.current.txids, userLock: txid },
      });
      return txid;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Step `waitCounterLock`: wait until the solver's lock is on chain. It looks
   * at the chain first, so it keeps working when the solver stops answering;
   * on timeout the refund path is named in the error.
   */
  async waitCounterLock(options: WaitOptions): Promise<void> {
    const { terms } = this.requireSavedOrder();
    const waiting =
      terms.direction === 'EVM_TO_BCH'
        ? WAITING.counterLockBch
        : WAITING.counterLockEvm;
    this.set({
      step: 'waitCounterLock',
      status: 'waiting',
      waiting,
      error: null,
    });
    const sleep = this.deps.sleep ?? defaultSleep;
    const deadline = this.nowMs() + options.timeoutMs;
    for (;;) {
      if (await this.counterLockSeen(terms)) {
        this.set({ step: 'claim', status: 'ready', waiting: null });
        return;
      }
      if (this.nowMs() >= deadline) {
        const error = new UserFlowError(
          'COUNTER_LOCK_TIMEOUT',
          `${waiting}: it did not appear in time. Your own lock is safe, and you can refund it once its deadline passes.`,
          { refundPossible: true },
        );
        this.fail(error, 'refund');
        throw error;
      }
      await sleep(options.pollIntervalMs);
    }
  }

  /** Step `claim` (forward: the user's Bitcoin Cash claim; reverse: the relayed EVM claim). */
  async claim(): Promise<string> {
    const { file, terms } = this.requireSavedOrder();
    this.set({ step: 'claim', status: 'running', waiting: null, error: null });
    try {
      let txid: string;
      if (terms.direction === 'EVM_TO_BCH') {
        const utxos = await this.covenantUtxos(file);
        if (utxos.length === 0) {
          throw new UserFlowError(
            'NOTHING_TO_SPEND',
            "The solver's Bitcoin Cash lock was not found, so there is nothing to claim yet.",
            { refundPossible: true },
          );
        }
        const built = buildBchRecoveryTransaction({ file, utxos });
        txid = await this.deps.bchChain.broadcast(built.txHex);
      } else {
        const secret = this.requireSecret();
        const response = await this.deps.solver.relayClaim(file.orderId, {
          secret,
        });
        txid = response.txHash;
      }
      this.set({
        step: 'done',
        status: 'ready',
        txids: { ...this.current.txids, claim: txid },
      });
      return txid;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Step `refund`: the user's own refund, only when its deadline has passed. */
  async refund(): Promise<string> {
    const { file, terms } = this.requireSavedOrder();
    const plan = await this.plan();
    if (!plan.actions.some((a) => a.action === 'refund')) {
      throw new UserFlowError(
        'NOT_READY',
        plan.waits.find((w) => w.action === 'refund')?.waitingFor ??
          'There is nothing to refund right now.',
      );
    }
    this.set({ step: 'refund', status: 'running', waiting: null, error: null });
    try {
      let txid: string;
      if (terms.direction === 'EVM_TO_BCH') {
        const call = buildEvmRecoveryCalldata(file);
        const hash = await this.deps.evmSigner.sendTransaction({
          to: call.to,
          data: call.data,
          value: 0n,
          chainId: call.chainId,
        });
        await this.deps.evmChain.waitForReceipt(hash);
        txid = hash;
      } else {
        const utxos = await this.covenantUtxos(file);
        if (utxos.length === 0) {
          throw new UserFlowError(
            'NOTHING_TO_SPEND',
            'Your Bitcoin Cash lock was not found, so there is nothing to refund.',
          );
        }
        const tip = await this.tipHeight();
        const built = buildBchRecoveryTransaction({
          file,
          utxos,
          locktime: Math.max(tip, terms.bchRefundHeight),
        });
        txid = await this.deps.bchChain.broadcast(built.txHex);
      }
      this.set({
        step: 'refunded',
        status: 'ready',
        txids: { ...this.current.txids, refund: txid },
      });
      return txid;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** What the user can do now and what each wait is waiting for, from the chains. */
  async plan(): Promise<RecoveryPlan> {
    const { file, terms } = this.requireSavedOrder();
    const forward = terms.direction === 'EVM_TO_BCH';
    const evmOwner = forward ? terms.userEvmAddress : terms.solverEvmAddress;
    const [evm, bch, tip, nowSeconds, order] = await Promise.all([
      this.evmLockStatus(evmLockId(evmOwner, terms.hashLock)),
      this.bchLockStatus(file),
      this.tipHeight(),
      this.chainSeconds(),
      this.orderTxids(file.orderId),
    ]);
    const bchState: LockChainStatus =
      bch === 'locked'
        ? 'locked'
        : order?.bchClaim !== undefined
          ? 'claimed'
          : order?.bchRefund !== undefined
            ? 'refunded'
            : 'none';
    return recoveryActions(file, {
      nowSeconds,
      bchTipHeight: tip,
      evmLock: { state: evm },
      bchLock: { state: bchState },
    });
  }

  /** Work out the current step from the chains (used after a reload). */
  async refresh(): Promise<SwapState> {
    const { file, terms } = this.requireSavedOrder();
    const forward = terms.direction === 'EVM_TO_BCH';
    const ownOwner = forward ? terms.userEvmAddress : terms.solverEvmAddress;
    const evm = await this.evmLockStatus(evmLockId(ownOwner, terms.hashLock));
    const bch = await this.bchLockStatus(file);
    const userLock = forward ? evm : bch;
    const counterLock = forward ? bch : evm;
    const plan = await this.plan();
    const refundReady = plan.actions.some((a) => a.action === 'refund');

    if (userLock === 'refunded')
      return this.set({ step: 'refunded', status: 'ready', waiting: null });
    if (userLock === 'none' && counterLock === 'none') {
      return this.set({ step: 'lock', status: 'ready', waiting: null });
    }
    if (counterLock === 'claimed' || plan.summary.startsWith('Swap already')) {
      return this.set({ step: 'done', status: 'ready', waiting: null });
    }
    if (counterLock === 'locked') {
      return this.set({
        step: refundReady ? 'refund' : 'claim',
        status: 'ready',
        waiting: null,
      });
    }
    return this.set({
      step: refundReady ? 'refund' : 'waitCounterLock',
      status: refundReady ? 'ready' : 'waiting',
      waiting: refundReady
        ? null
        : plan.waits.map((w) => w.waitingFor).join('; ') || null,
    });
  }

  /** The whole flow in order. Stops at the first failure with the refund path still open. */
  async run(input: QuoteInput, wait: WaitOptions): Promise<SwapState> {
    await this.quote(input);
    if (this.dryRun) return this.current;
    await this.saveRecovery();
    await this.lock();
    await this.waitCounterLock(wait);
    await this.claim();
    return this.current;
  }

  // ---- locks -----------------------------------------------------------

  private lockOnEvm(terms: OrderTerms): Promise<string> {
    return lockUserOnEvm(this.deps, terms);
  }

  private async lockOnBch(terms: OrderTerms): Promise<string> {
    const utxos = await this.deps.bchChain.getUtxos(
      binToHex(this.userLockingBytecodeBytes()),
    );
    const built = buildLockTransaction({
      params: terms,
      utxos: utxos.map(toLockUtxo),
      changeAddress: this.deps.bchCashAddress,
      network: this.deps.bchNetwork,
      feeRateSatPerByte:
        this.deps.feeRateSatPerByte ?? DEFAULT_FEE_RATE_SAT_PER_BYTE,
    });
    const request = buildWizardConnectSignRequest({ lockTx: built });
    const signedHex = await guardWallet(() =>
      this.deps.bchSigner.signTransaction(request),
    );
    const report = inspectSignedTransaction(
      built.unsigned.txHex,
      signedHex,
      built.unsigned.sourceOutputs,
    );
    if (!report.ok) {
      throw new UserFlowError(
        'SIGNED_TRANSACTION_REJECTED',
        `The wallet's transaction did not pass the local check, so it was not sent. ${report.problems.join(' ')}`,
      );
    }
    return this.deps.bchChain.broadcast(signedHex);
  }

  // ---- reads -----------------------------------------------------------

  private async counterLockSeen(terms: OrderTerms): Promise<boolean> {
    try {
      if (terms.direction === 'EVM_TO_BCH') {
        const file = this.requireSavedOrder().file;
        if ((await this.covenantUtxos(file)).length > 0) return true;
      } else {
        const status = await this.evmLockStatus(
          evmLockId(terms.solverEvmAddress, terms.hashLock),
        );
        if (status !== 'none') return true;
      }
    } catch {
      // A chain read failed; the solver's own report below can still answer.
    }
    const txids = await this.orderTxids(this.requireSavedOrder().file.orderId);
    return terms.direction === 'EVM_TO_BCH'
      ? txids?.bchLock !== undefined
      : txids?.evmLock !== undefined;
  }

  private async covenantUtxos(
    file: RecoveryFile,
  ): Promise<readonly { txid: string; vout: number; satoshis: bigint }[]> {
    const utxos = await this.deps.bchChain.getUtxos(
      file.contracts.bch.lockingBytecode.replace(/^0x/i, ''),
    );
    return utxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
    }));
  }

  private async bchLockStatus(file: RecoveryFile): Promise<LockChainStatus> {
    return (await this.covenantUtxos(file)).length > 0 ? 'locked' : 'none';
  }

  private async evmLockStatus(lockId: Hex32): Promise<LockChainStatus> {
    const lock = await this.deps.evmChain.getLock(lockId);
    return lock.status === 'absent' ? 'none' : lock.status;
  }

  private async orderTxids(orderId: Hex32): Promise<
    | {
        readonly evmLock?: string | undefined;
        readonly bchLock?: string | undefined;
        readonly bchClaim?: string | undefined;
        readonly bchRefund?: string | undefined;
      }
    | undefined
  > {
    try {
      return (await this.deps.solver.getOrder(orderId)).txids;
    } catch {
      return undefined;
    }
  }

  /** `/v1/health` `tips.bchHeight` first, the chain reader as the fallback. */
  private async tipHeight(): Promise<number> {
    try {
      const health = await this.deps.solver.health();
      const height = health.tips?.bchHeight;
      if (height !== undefined) return height;
    } catch {
      // Fall through to the chain reader.
    }
    return this.deps.bchChain.getTipHeight();
  }

  private async chainSeconds(): Promise<number> {
    try {
      return await this.deps.evmChain.getBlockTimestamp();
    } catch {
      return Math.floor(this.nowMs() / 1000);
    }
  }

  // ---- helpers ---------------------------------------------------------

  private userBchLockingBytecode(): Hex {
    let decoded: ReturnType<typeof decodeCashAddress>;
    try {
      decoded = decodeCashAddress(this.deps.bchCashAddress);
    } catch (error) {
      throw new UserFlowError(
        'INVALID_INPUT',
        `The Bitcoin Cash address is not valid (${messageOf(error)}).`,
        { cause: error },
      );
    }
    const expectedPrefix =
      this.deps.bchNetwork === 'mainnet' ? 'bitcoincash' : 'bchtest';
    if (decoded.prefix !== expectedPrefix) {
      throw new UserFlowError(
        'INVALID_INPUT',
        `The Bitcoin Cash address is for a different network (expected ${expectedPrefix}).`,
      );
    }
    return decoded.lockingBytecode;
  }

  private userLockingBytecodeBytes(): Uint8Array {
    const hex = this.userBchLockingBytecode().replace(/^0x/i, '');
    return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  }

  private requireQuote(): VerifiedQuote {
    if (this.verified === null) {
      throw new UserFlowError('NO_QUOTE', 'Get a quote first.');
    }
    if (this.dryRun) {
      throw new UserFlowError(
        'DRY_RUN_QUOTE',
        'This was a price-only quote; it reserved nothing and cannot be locked. Ask for a real quote.',
      );
    }
    return this.verified;
  }

  private requireSavedOrder(): { file: RecoveryFile; terms: OrderTerms } {
    if (this.file === null || !this.recoverySaved) {
      if (this.verified !== null && !this.dryRun) {
        throw new UserFlowError(
          'RECOVERY_NOT_SAVED',
          'The recovery file must be saved before anything is locked.',
        );
      }
      throw new UserFlowError('NO_QUOTE', 'Get a quote first.');
    }
    return { file: this.file, terms: this.file.terms };
  }

  private requireSecret(): Hex32 {
    if (this.secret === null) {
      throw new UserFlowError(
        'NOT_READY',
        'The swap secret is not available in this recovery file.',
      );
    }
    return this.secret;
  }

  private nowMs(): number {
    return (this.deps.nowMs ?? Date.now)();
  }

  private set(patch: Partial<SwapState>): SwapState {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  private fail(error: unknown, step?: SwapStepName): void {
    this.set({
      ...(step !== undefined ? { step } : {}),
      status: 'failed',
      error: messageOf(error),
    });
  }
}

function toLockUtxo(utxo: BchUtxo): LockUtxo {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    ...(utxo.token ? { token: { ...utxo.token } } : {}),
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
