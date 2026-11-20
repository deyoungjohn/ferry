import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from 'viem';
import type { Address, Hash, PublicClient, WalletClient } from 'viem';
import {
  evmLockId,
  isValidSecret,
  orderId,
  parseEvmChainConfig,
} from '@ferry/core';
import type {
  ChainAdapter,
  EvmAssetConfig,
  EvmChainConfig,
  EvmChainId,
  EvmFinalityPolicy,
  Hex,
  Hex32,
  Lane,
  LockData,
  LockEvent,
  LockState,
  OrderTerms,
  SignedLock,
  TxRef,
  UnsignedLock,
  Unsubscribe,
} from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  ChainMismatchError,
  InvalidSecretError,
  RelayLockRejectedError,
  RelayLockTransportError,
  UnsupportedAssetError,
} from './errors.js';
import { decodeHtlcLog, fetchLogsChunked } from './logs.js';
import { buildUserLockPayload } from './user-side.js';
import { getSignerSendQueue } from './send-queue.js';

export interface EvmChainAdapterOptions {
  config: EvmChainConfig;
  client?: PublicClient | undefined;
  walletClient?: WalletClient | undefined;
  pollIntervalMs?: number | undefined;
  maxLogRange?: bigint | undefined;
  lookbackBlocks?: bigint | undefined;
  deployBlock?: bigint | undefined;
}

export interface RelayLockPayload {
  owner: Address;
  token: Address;
  recipient: Address;
  amount: bigint;
  hashLock: Hex32;
  deadline: bigint;
  intentDeadline: bigint;
  intentSig: Hex;
  permitDeadline: bigint;
  v: number;
  r: Hex32;
  s: Hex32;
}

const erc20Abi = parseAbi([
  'function name() external view returns (string)',
  'function version() external view returns (string)',
  'function nonces(address owner) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external',
]);

const ZERO_TX: Hex32 = `0x${'00'.repeat(32)}`;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_LOOKBACK_BLOCKS = 10n;

export class EvmChainAdapter implements ChainAdapter {
  readonly id: EvmChainId;
  readonly chainId: number;
  readonly htlcAddress: Address;
  readonly finality: EvmFinalityPolicy;
  readonly relayCostUsd: number;
  readonly assets: readonly EvmAssetConfig[];
  readonly client: PublicClient;
  readonly walletClient?: WalletClient | undefined;

  private readonly pollIntervalMs: number;
  private readonly maxLogRange?: bigint | undefined;
  private readonly lookbackBlocks: bigint;
  private readonly deployBlock: bigint;
  private readonly lastSeenTxByAction = new Map<string, Hex32>();
  private readonly lastSeenSecretByLock = new Map<string, Hex32>();

  constructor(options: EvmChainAdapterOptions) {
    const config = parseEvmChainConfig(options.config);
    this.id = config.id;
    this.chainId = config.chainId;
    this.htlcAddress = getAddress(config.htlcAddress);
    this.finality = config.finality;
    this.relayCostUsd = config.relayCostUsd;
    this.assets = Object.freeze(config.assets.map((a) => ({ ...a })));
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxLogRange = options.maxLogRange;
    this.lookbackBlocks = options.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS;
    this.deployBlock = options.deployBlock ?? 0n;

    this.client =
      options.client ??
      createPublicClient({
        transport:
          config.rpcUrls.length === 1
            ? http(config.rpcUrls[0])
            : fallback(config.rpcUrls.map((url) => http(url))),
      });
    this.walletClient = options.walletClient;
  }

  lockId(owner: string, hashLock: Hex32): Hex32 {
    return evmLockId(owner, hashLock);
  }

  /** "You hold 3.36 USDC and need 5.00 USDC." in the token's own units, rounded the safe way. */
  private async describeShortBalance(
    token: Address,
    balance: bigint,
    amount: bigint,
  ): Promise<string> {
    try {
      const [decimals, symbol] = await Promise.all([
        this.client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
        this.client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
      ]);
      const places = Math.min(2, Number(decimals));
      const scale = 10n ** BigInt(Number(decimals) - places);
      const show = (units: bigint, up: boolean) => {
        const cents = up ? (units + scale - 1n) / scale : units / scale;
        const text = cents.toString().padStart(places + 1, '0');
        return places === 0
          ? text
          : `${text.slice(0, -places)}.${text.slice(-places)}`;
      };
      return `You hold ${show(balance, false)} ${symbol} and need ${show(amount, true)} ${symbol}.`;
    } catch {
      return `You hold ${balance} and need ${amount} (smallest units of the token).`;
    }
  }

  async buildUserLock(terms: OrderTerms): Promise<UnsignedLock> {
    this.assertTermsMatchChain(terms);
    const asset = this.requireAsset(terms.evmToken);
    return {
      chain: this.id,
      orderId: orderId(terms),
      payload: await buildUserLockPayload({
        client: this.client,
        terms,
        permit: asset.permit,
      }),
    };
  }

  async relayLock(signed: SignedLock): Promise<TxRef> {
    if (signed.chain !== this.id) {
      throw new ChainMismatchError(
        `Signed lock is for ${signed.chain}, expected ${this.id}`,
      );
    }

    const payload = signed.payload as RelayLockPayload;
    if (
      !payload ||
      !isAddress(payload.owner) ||
      !isAddress(payload.token) ||
      !isAddress(payload.recipient)
    ) {
      throw new RelayLockRejectedError(
        'RELAY_LOCK_REVERTED',
        'Malformed relay lock payload',
      );
    }

    this.requireAsset(payload.token);
    const lockId = this.lockId(payload.owner, payload.hashLock);
    const actionKey = `relayLock:${lockId}`;
    const cachedTx = this.lastSeenTxByAction.get(actionKey);
    if (cachedTx) {
      return { chain: this.id, txId: cachedTx };
    }

    const currentLock = await this.getLock(lockId);
    if (currentLock.status !== 'absent') {
      return currentLock.lockTx;
    }

    const amount = BigInt(payload.amount);
    const deadline = BigInt(payload.deadline);
    const intentDeadline = BigInt(payload.intentDeadline);
    const permitDeadline = BigInt(payload.permitDeadline);

    const owner = getAddress(payload.owner);
    const token = getAddress(payload.token);
    const balance = await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    });
    if (balance < amount) {
      throw new RelayLockRejectedError(
        'INSUFFICIENT_USER_BALANCE',
        await this.describeShortBalance(token, balance, amount),
      );
    }

    let hash: Hash;
    try {
      hash = await this.send((account) => ({
        address: this.htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lockWithIntent',
        args: [
          owner,
          token,
          getAddress(payload.recipient),
          amount,
          payload.hashLock,
          deadline,
          intentDeadline,
          payload.intentSig,
          permitDeadline,
          payload.v,
          payload.r,
          payload.s,
        ],
        chain: null,
        account,
      }));
    } catch (err) {
      const e = err as {
        shortMessage?: string;
        details?: string;
        message?: string;
        cause?: { reason?: string; details?: string };
      };
      const reason = e.cause?.reason ?? e.details ?? e.cause?.details;
      const baseMsg = e.shortMessage ?? e.message ?? String(err);
      const message =
        reason && !baseMsg.includes(reason)
          ? `${baseMsg} (${reason})`
          : baseMsg;
      if (isContractRevertError(err)) {
        throw new RelayLockRejectedError('RELAY_LOCK_REVERTED', message);
      }
      throw new RelayLockTransportError(message, err);
    }

    const txId = hash as Hex32;
    this.lastSeenTxByAction.set(actionKey, txId);
    return { chain: this.id, txId };
  }

  async lock(terms: OrderTerms): Promise<TxRef> {
    this.assertTermsMatchChain(terms);
    this.requireAsset(terms.evmToken);

    const isForward = terms.direction === 'EVM_TO_BCH';
    const owner = getAddress(
      isForward ? terms.userEvmAddress : terms.solverEvmAddress,
    );
    const recipient = getAddress(
      isForward ? terms.solverEvmAddress : terms.userEvmAddress,
    );
    const lockId = this.lockId(owner, terms.hashLock);
    const actionKey = `lock:${lockId}`;
    const cachedTx = this.lastSeenTxByAction.get(actionKey);
    if (cachedTx) {
      return { chain: this.id, txId: cachedTx };
    }

    const currentLock = await this.getLock(lockId);
    if (currentLock.status !== 'absent') {
      return currentLock.lockTx;
    }

    const signer = this.requireWalletAccount();
    const walletClient = this.walletClient!;
    const token = getAddress(terms.evmToken);
    const queue = getSignerSendQueue(signer.address);

    const hash = await queue.enqueue(async () => {
      const allowance = await this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [signer.address, this.htlcAddress],
      });

      if (allowance < terms.evmAmount) {
        const approveHash = await walletClient.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [this.htlcAddress, terms.evmAmount],
          chain: null,
          account: signer,
        });
        const approveReceipt = await this.client.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (approveReceipt.status !== 'success') {
          throw new Error(`Approve transaction ${approveHash} reverted`);
        }
      }

      const lockHash = await walletClient.writeContract({
        address: this.htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [
          token,
          recipient,
          terms.evmAmount,
          terms.hashLock,
          BigInt(terms.evmDeadline),
        ],
        chain: null,
        account: signer,
      });
      const lockReceipt = await this.client.waitForTransactionReceipt({
        hash: lockHash,
      });
      if (lockReceipt.status !== 'success') {
        throw new Error(`Lock transaction ${lockHash} reverted`);
      }
      return lockHash;
    });

    const txId = hash as Hex32;
    this.lastSeenTxByAction.set(actionKey, txId);
    return { chain: this.id, txId };
  }

  async claim(lockId: string, secret: Hex32): Promise<TxRef> {
    const actionKey = `claim:${lockId}`;
    const cachedTx = this.lastSeenTxByAction.get(actionKey);
    if (cachedTx) {
      return { chain: this.id, txId: cachedTx };
    }

    const currentLock = await this.getLock(lockId);
    if (currentLock.status === 'claimed') {
      return currentLock.claimTx;
    }
    if (currentLock.status !== 'locked') {
      throw new Error(`Cannot claim lock in state: ${currentLock.status}`);
    }
    if (!isValidSecret(secret, currentLock.hashLock)) {
      throw new InvalidSecretError(lockId);
    }

    try {
      const hash = await this.send((account) => ({
        address: this.htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'claim',
        args: [lockId as Hex32, secret],
        chain: null,
        account,
      }));
      const txId = hash as Hex32;
      this.lastSeenTxByAction.set(actionKey, txId);
      this.lastSeenSecretByLock.set(lockId, secret);
      return { chain: this.id, txId };
    } catch (err) {
      const recheck = await this.getLock(lockId);
      if (recheck.status === 'claimed') {
        this.lastSeenTxByAction.set(actionKey, recheck.claimTx.txId);
        this.lastSeenSecretByLock.set(lockId, secret);
        return recheck.claimTx;
      }
      throw err;
    }
  }

  async refund(lockId: string): Promise<TxRef> {
    const actionKey = `refund:${lockId}`;
    const cachedTx = this.lastSeenTxByAction.get(actionKey);
    if (cachedTx) {
      return { chain: this.id, txId: cachedTx };
    }

    const currentLock = await this.getLock(lockId);
    if (currentLock.status === 'refunded') {
      return currentLock.refundTx;
    }
    if (currentLock.status !== 'locked') {
      throw new Error(`Cannot refund lock in state: ${currentLock.status}`);
    }

    try {
      const hash = await this.send((account) => ({
        address: this.htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'refund',
        args: [lockId as Hex32],
        chain: null,
        account,
      }));

      const txId = hash as Hex32;
      this.lastSeenTxByAction.set(actionKey, txId);
      return { chain: this.id, txId };
    } catch (err) {
      const recheck = await this.getLock(lockId);
      if (recheck.status === 'refunded') {
        this.lastSeenTxByAction.set(actionKey, recheck.refundTx.txId);
        return recheck.refundTx;
      }
      throw err;
    }
  }

  async release(lockId: string): Promise<TxRef> {
    const actionKey = `release:${lockId}`;
    const cachedTx = this.lastSeenTxByAction.get(actionKey);
    if (cachedTx) {
      return { chain: this.id, txId: cachedTx };
    }

    const currentLock = await this.getLock(lockId);
    if (currentLock.status === 'refunded') {
      return currentLock.refundTx;
    }
    if (currentLock.status !== 'locked') {
      throw new Error(`Cannot release lock in state: ${currentLock.status}`);
    }

    try {
      const hash = await this.send((account) => ({
        address: this.htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'release',
        args: [lockId as Hex32],
        chain: null,
        account,
      }));

      const txId = hash as Hex32;
      this.lastSeenTxByAction.set(actionKey, txId);
      this.lastSeenTxByAction.set(`refund:${lockId}`, txId);
      return { chain: this.id, txId };
    } catch (err) {
      const recheck = await this.getLock(lockId);
      if (recheck.status === 'refunded') {
        this.lastSeenTxByAction.set(actionKey, recheck.refundTx.txId);
        return recheck.refundTx;
      }
      throw err;
    }
  }

  private async findLockTx(lockId: Hex32): Promise<Hex32 | null> {
    try {
      const tip = await this.client.getBlockNumber();
      const lookback = 60_000n; // about a day on Base
      const from = tip > lookback ? tip - lookback : 0n;
      const logs = await fetchLogsChunked(
        this.client,
        this.htlcAddress,
        from > this.deployBlock ? from : this.deployBlock,
        tip,
        this.maxLogRange ? { maxRange: this.maxLogRange } : undefined,
      );
      for (const log of logs) {
        const event = decodeHtlcLog(log, this.id, this.assets);
        if (event?.type === 'Locked' && event.lockId === lockId) {
          return event.tx.txId;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getLock(lockId: string): Promise<LockState> {
    const lockRaw = await this.client.readContract({
      address: this.htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'locks',
      args: [lockId as Hex32],
    });

    const [token, sender, recipient, amount, hashLock, deadline, stateNum] =
      lockRaw as [Address, Address, Address, bigint, Hex32, bigint, number];

    if (stateNum === 0 || amount === 0n) {
      return { status: 'absent' };
    }

    const asset = this.requireAsset(token);
    const lockData: LockData = {
      owner: sender.toLowerCase(),
      recipient: recipient.toLowerCase(),
      asset,
      amount,
      hashLock,
      deadline: Number(deadline),
    };

    let cachedLockTx =
      this.lastSeenTxByAction.get(`lock:${lockId}`) ??
      this.lastSeenTxByAction.get(`relayLock:${lockId}`) ??
      ZERO_TX;
    if (cachedLockTx === ZERO_TX && stateNum === 1) {
      // After a restart (or for a lock made by another process) the transaction is not in
      // memory: read it from the contract's Locked event for this lock.
      const found = await this.findLockTx(lockId as Hex32);
      if (found) {
        cachedLockTx = found;
        this.lastSeenTxByAction.set(`lock:${lockId}`, found);
      }
    }
    const lockTx: TxRef = { chain: this.id, txId: cachedLockTx };

    if (stateNum === 1) {
      return { status: 'locked', lockTx, ...lockData };
    }

    if (stateNum === 2) {
      let cachedClaimTx = this.lastSeenTxByAction.get(`claim:${lockId}`);
      let claimSecret = this.lastSeenSecretByLock.get(lockId);

      if (!claimSecret || !cachedClaimTx) {
        try {
          const currentBlock = await this.client.getBlockNumber();
          const logs = await fetchLogsChunked(
            this.client,
            this.htlcAddress,
            this.deployBlock,
            currentBlock,
            this.maxLogRange ? { maxRange: this.maxLogRange } : undefined,
          );
          for (const log of logs) {
            const event = decodeHtlcLog(log, this.id, this.assets);
            if (event?.type === 'Claimed' && event.lockId === lockId) {
              claimSecret = event.secret;
              cachedClaimTx = event.tx.txId;
              this.lastSeenSecretByLock.set(lockId, claimSecret);
              this.lastSeenTxByAction.set(`claim:${lockId}`, cachedClaimTx);
              break;
            }
          }
        } catch {
          // Ignore log scan failure; return state with secret null if unavailable.
        }
      }

      if (claimSecret && !isValidSecret(claimSecret, lockData.hashLock)) {
        claimSecret = undefined;
      }

      return {
        status: 'claimed',
        lockTx,
        claimTx: { chain: this.id, txId: cachedClaimTx ?? ZERO_TX },
        secret: claimSecret ?? null,
        ...lockData,
      };
    }

    if (stateNum === 3) {
      const cachedRefundTx =
        this.lastSeenTxByAction.get(`refund:${lockId}`) ?? ZERO_TX;
      return {
        status: 'refunded',
        lockTx,
        refundTx: { chain: this.id, txId: cachedRefundTx },
        ...lockData,
      };
    }

    return { status: 'absent' };
  }

  watch(onEvent: (event: LockEvent) => void): Unsubscribe {
    const seenEvents = new Set<string>();
    let lastProcessedBlock: bigint | undefined = undefined;
    let active = true;

    const emitEvent = (event: LockEvent | null) => {
      if (!event || !active) return;
      if (seenEvents.has(event.eventId)) return;
      seenEvents.add(event.eventId);
      onEvent(event);
    };

    const unwatchContract = this.client.watchContractEvent({
      address: this.htlcAddress,
      abi: ferryHtlcAbi,
      onLogs: (logs) => {
        for (const log of logs) {
          emitEvent(decodeHtlcLog(log, this.id, this.assets));
        }
      },
    });

    const pollLogs = async () => {
      if (!active) return;
      try {
        const currentBlock = await this.client.getBlockNumber();
        const fromBlock =
          lastProcessedBlock !== undefined
            ? lastProcessedBlock + 1n
            : currentBlock > this.lookbackBlocks
              ? currentBlock - this.lookbackBlocks
              : 0n;

        if (fromBlock <= currentBlock) {
          const logs = await fetchLogsChunked(
            this.client,
            this.htlcAddress,
            fromBlock,
            currentBlock,
            this.maxLogRange ? { maxRange: this.maxLogRange } : undefined,
          );
          lastProcessedBlock = currentBlock;
          for (const log of logs) {
            emitEvent(decodeHtlcLog(log, this.id, this.assets));
          }
        }
      } catch {
        // Retry on next poll tick.
      }
    };

    const intervalId = setInterval(() => {
      void pollLogs();
    }, this.pollIntervalMs);

    return () => {
      active = false;
      clearInterval(intervalId);
      unwatchContract();
    };
  }

  async isFinal(tx: TxRef, lane: Lane): Promise<boolean> {
    if (tx.chain !== this.id) {
      return false;
    }
    try {
      const receipt = await this.client.getTransactionReceipt({
        hash: tx.txId as Hash,
      });
      if (!receipt || receipt.status !== 'success') {
        return false;
      }

      const currentBlock = await this.client.getBlockNumber();
      const confirmations = Number(
        currentBlock >= receipt.blockNumber
          ? currentBlock - receipt.blockNumber + 1n
          : 0n,
      );

      if (lane === 'fast') {
        return confirmations >= this.finality.fast;
      }

      if (typeof this.finality.safe === 'number') {
        return confirmations >= this.finality.safe;
      }

      const taggedBlock = await this.client.getBlock({
        blockTag: this.finality.safe,
      });
      return (
        taggedBlock.number !== null && receipt.blockNumber <= taggedBlock.number
      );
    } catch {
      return false;
    }
  }

  async estimateRelayCostUsd(): Promise<number> {
    return this.relayCostUsd;
  }

  async getTip(): Promise<{
    height: number;
    timestamp: number;
    ageSeconds: number;
  }> {
    const block = await this.client.getBlock({ blockTag: 'latest' });
    const height = Number(block.number);
    const timestamp = Number(block.timestamp);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ageSeconds = Math.max(0, nowSeconds - timestamp);
    return { height, timestamp, ageSeconds };
  }

  private assertTermsMatchChain(terms: OrderTerms): void {
    if (terms.evmChainId !== this.chainId) {
      throw new ChainMismatchError(
        `OrderTerms evmChainId ${terms.evmChainId} does not match ${this.chainId}`,
      );
    }
    if (terms.evmHtlc.toLowerCase() !== this.htlcAddress.toLowerCase()) {
      throw new ChainMismatchError(
        `OrderTerms evmHtlc ${terms.evmHtlc} does not match ${this.htlcAddress}`,
      );
    }
  }

  private requireAsset(tokenAddress: string): EvmAssetConfig {
    const normalized = getAddress(tokenAddress).toLowerCase();
    const asset = this.assets.find((a) => a.address === normalized);
    if (!asset) {
      throw new UnsupportedAssetError(tokenAddress, this.id);
    }
    return asset;
  }

  private requireWalletAccount() {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('WalletClient with account required to send transaction');
    }
    return this.walletClient.account;
  }

  private send(
    buildArgs: (
      account: NonNullable<WalletClient['account']>,
    ) => Parameters<WalletClient['writeContract']>[0],
  ): Promise<Hash> {
    const account = this.requireWalletAccount();
    const walletClient = this.walletClient!;
    const queue = getSignerSendQueue(account.address);
    return queue.enqueue(async () => {
      const hash = await walletClient.writeContract(buildArgs(account));
      const receipt = await this.client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error(`Transaction ${hash} reverted`);
      }
      return hash;
    });
  }
}

function isContractRevertError(err: unknown): boolean {
  let current: unknown = err;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === 'object';
    depth++
  ) {
    const node = current as {
      name?: unknown;
      message?: unknown;
      shortMessage?: unknown;
      details?: unknown;
      cause?: unknown;
    };
    if (
      node.name === 'ContractFunctionRevertedError' ||
      node.name === 'ExecutionRevertedError'
    ) {
      return true;
    }
    for (const field of [node.shortMessage, node.message, node.details]) {
      if (typeof field === 'string' && /revert/i.test(field)) {
        return true;
      }
    }
    current = node.cause;
  }
  return false;
}
