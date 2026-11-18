import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import {
  evmLockId,
  type Direction,
  type EvmChainConfig,
  type Hex,
  type Hex32,
  type OrderTerms,
  type RecoveryFile,
} from '@ferry/core';
import type { QuoteRequest, QuoteResponse } from '@ferry/core/api';
import { EvmChainAdapter } from '@ferry/chain-evm';
import {
  buildBchRecoveryTransaction,
  buildLockTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
  type HtlcUtxo,
  type LockUtxo,
} from '@ferry/htlc-bch';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  createKeyBackedBchSigner,
  lockUserOnBch,
  lockUserOnEvm,
  type BchUtxo,
} from '@ferry/user-flow';
import {
  SolverClient,
  prepareRecoveryDownload,
  verifyQuote,
  type VerifiedQuote,
} from '@ferry/solver-client';
import type { Address, PublicClient, WalletClient } from 'viem';
import { sha256 } from 'viem';
import {
  explorerTxUrl,
  type ProbeEvidence,
  type ProbeWaitStep,
} from './explorers.js';
import {
  assertProbeSafety,
  loadProbeKeys,
  type ProbeKeys,
  type ProbeOptions,
} from './safety.js';

const DEFAULT_EVM_TOKEN_BY_CHAIN: Readonly<Record<number, Hex>> = {
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  84532: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
};

export interface ProbeEvmPort {
  buildDryRunLock(terms: OrderTerms): Promise<void>;
  lock(terms: OrderTerms, solverClient: SolverClient): Promise<Hex32>;
  waitForSolverLock(
    terms: OrderTerms,
    options: { readonly pollIntervalMs: number; readonly timeoutMs: number },
  ): Promise<Hex32 | null>;
  claim(terms: OrderTerms, secret: Hex32): Promise<Hex32>;
  waitForRefundDeadline(
    terms: OrderTerms,
    options: { readonly pollIntervalMs: number; readonly timeoutMs: number },
  ): Promise<void>;
  refund(terms: OrderTerms): Promise<Hex32>;
}

export interface ProbeBchPort {
  getTipHeight(): Promise<number>;
  getFundingUtxos(lockingBytecode: Hex): Promise<readonly LockUtxo[]>;
  buildDryRunLock(
    terms: OrderTerms,
    keys: ProbeKeys,
    feeRateSatPerByte: number,
  ): Promise<void>;
  lock(
    terms: OrderTerms,
    keys: ProbeKeys,
    feeRateSatPerByte: number,
  ): Promise<Hex32>;
  waitForHtlcUtxo(
    terms: OrderTerms,
    options: { readonly pollIntervalMs: number; readonly timeoutMs: number },
  ): Promise<{
    readonly utxos: readonly HtlcUtxo[];
    readonly lockTxid: Hex32 | null;
  }>;
  claim(file: RecoveryFile, utxos: readonly HtlcUtxo[]): Promise<Hex32>;
  waitForRefundHeight(
    terms: OrderTerms,
    options: { readonly pollIntervalMs: number; readonly timeoutMs: number },
  ): Promise<number>;
  refund(
    file: RecoveryFile,
    utxos: readonly HtlcUtxo[],
    locktime: number,
  ): Promise<Hex32>;
}

export interface ProbeDependencies {
  readonly solverClient?: SolverClient;
  readonly evmPort: ProbeEvmPort;
  readonly bchPort: ProbeBchPort;
  readonly evmToken?: Hex;
  readonly evmTokenDecimals?: number;
  readonly bchTokenDecimals?: number;
  readonly maxRefAgeBySource?: Readonly<Record<string, number>>;
  readonly defaultMaxRefAgeSeconds?: number;
  readonly expectedSolverAddress?: Hex;
  readonly saveRecoveryFile?: (filePath: string, json: string) => Promise<void>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nowSeconds?: () => number;
  readonly nowMs?: () => number;
  readonly onWait?: (name: string) => void;
  readonly secretGenerator?: () => Hex32;
}

export interface CreateDefaultEvmPortOptions {
  readonly chainConfig: EvmChainConfig;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly userAddress: Address;
}

export function createDefaultEvmPort(
  opts: CreateDefaultEvmPortOptions,
): ProbeEvmPort {
  const adapter = new EvmChainAdapter({
    config: opts.chainConfig,
    client: opts.publicClient,
    walletClient: opts.walletClient,
  });

  return {
    async buildDryRunLock(terms) {
      await adapter.buildUserLock(terms);
    },

    async lock(terms, solverClient) {
      return lockUserOnEvm(
        {
          evmSigner: {
            getAddress: () => Promise.resolve(opts.userAddress),
            getChainId: () => Promise.resolve(opts.chainConfig.chainId),
            signTypedData: (typedData) =>
              opts.walletClient.signTypedData(
                typedData as Parameters<WalletClient['signTypedData']>[0],
              ),
            sendTransaction: (tx) =>
              opts.walletClient.sendTransaction({
                account: opts.userAddress,
                chain: opts.walletClient.chain ?? null,
                to: tx.to,
                data: tx.data,
                value: tx.value ?? 0n,
              }),
          },
          evmChain: {
            buildUserLock: (lockTerms) => adapter.buildUserLock(lockTerms),
            getLock: (lockId) => adapter.getLock(lockId),
            waitForReceipt: async (hash) => {
              await opts.publicClient.waitForTransactionReceipt({ hash });
            },
            getBlockTimestamp: async () =>
              Number((await opts.publicClient.getBlock()).timestamp),
          },
          solver: solverClient,
        },
        terms,
      );
    },

    async waitForSolverLock(terms, pollOpts) {
      const id = evmLockId(terms.solverEvmAddress, terms.hashLock);
      const deadlineMs = Date.now() + pollOpts.timeoutMs;
      while (Date.now() <= deadlineMs) {
        const lockState = (await opts.publicClient.readContract({
          address: terms.evmHtlc,
          abi: ferryHtlcAbi,
          functionName: 'locks',
          args: [id],
        })) as readonly unknown[];
        const amount = lockState[3];
        if (typeof amount === 'bigint' && amount > 0n) {
          return id;
        }
        await new Promise((r) => setTimeout(r, pollOpts.pollIntervalMs));
      }
      throw new Error(`Timed out waiting for solver EVM lock ${id}`);
    },

    async claim(terms, secret) {
      const id = evmLockId(terms.solverEvmAddress, terms.hashLock);
      const hash = await opts.walletClient.writeContract({
        address: terms.evmHtlc,
        abi: ferryHtlcAbi,
        functionName: 'claim',
        args: [id, secret],
        account: opts.userAddress,
        chain: opts.walletClient.chain ?? null,
      });
      await opts.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },

    async waitForRefundDeadline(terms, pollOpts) {
      const deadlineMs = Date.now() + pollOpts.timeoutMs;
      while (Date.now() <= deadlineMs) {
        const block = await opts.publicClient.getBlock();
        if (Number(block.timestamp) >= terms.evmDeadline) {
          return;
        }
        await new Promise((r) => setTimeout(r, pollOpts.pollIntervalMs));
      }
      throw new Error(
        `Timed out waiting for EVM refund deadline ${terms.evmDeadline}`,
      );
    },

    async refund(terms) {
      const id = evmLockId(terms.userEvmAddress, terms.hashLock);
      const hash = await opts.walletClient.writeContract({
        address: terms.evmHtlc,
        abi: ferryHtlcAbi,
        functionName: 'refund',
        args: [id],
        account: opts.userAddress,
        chain: opts.walletClient.chain ?? null,
      });
      await opts.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/**
 * A funding output as a server reports it: either the probe's own shape or the
 * Electrum shape (`tx_hash`, `tx_pos`, `value`, `token_data`). Token data is
 * kept: the lock needs the stablecoin outputs, not only the satoshis.
 */
function toBchUtxo(raw: unknown): BchUtxo {
  const u = raw as {
    txid?: string;
    tx_hash?: string;
    vout?: number;
    tx_pos?: number;
    satoshis?: bigint | number;
    value?: bigint | number;
    token?: { category: string; amount: bigint | number | string };
    token_data?: { category: string; amount: bigint | number | string };
  };
  const token = u.token ?? u.token_data;
  return {
    txid: (u.txid ?? u.tx_hash ?? '').replace(/^0x/i, ''),
    vout: u.vout ?? u.tx_pos ?? 0,
    satoshis: BigInt(u.satoshis ?? u.value ?? 0),
    ...(token
      ? {
          token: {
            category: token.category.replace(/^0x/i, ''),
            amount: BigInt(token.amount),
          },
        }
      : {}),
  };
}

export interface BchRpcTransport {
  getTipHeight(): Promise<number>;
  getUtxos(addressOrLockingBytecode: string): Promise<readonly HtlcUtxo[]>;
  broadcast(txHex: string): Promise<string>;
}

export function createDefaultBchPort(
  transport: BchRpcTransport,
  network: 'chipnet' | 'mainnet',
): ProbeBchPort {
  const port: ProbeBchPort = {
    getTipHeight: () => transport.getTipHeight(),
    async getFundingUtxos(lockingBytecode) {
      const utxos = await transport.getUtxos(lockingBytecode);
      return utxos.map((u) => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
      })) as LockUtxo[];
    },
    async buildDryRunLock(terms, keys, feeRateSatPerByte) {
      const params = encodeHtlcParameters(terms);
      deriveHtlcAddresses(params, network);
      const utxos = await port.getFundingUtxos(keys.bchLockingBytecode);
      if (utxos.length > 0) {
        buildLockTransaction({
          params,
          utxos: [...utxos],
          changeAddress: keys.bchCashAddress,
          network,
          feeRateSatPerByte,
          privateKey: keys.bchPrivateKey,
        });
      }
    },
    async lock(terms, keys, feeRateSatPerByte) {
      const txid = await lockUserOnBch(
        {
          bchSigner: createKeyBackedBchSigner(keys.bchPrivateKey),
          bchChain: {
            getTipHeight: () => transport.getTipHeight(),
            getUtxos: async (lockingBytecodeHex) =>
              (await transport.getUtxos(`0x${lockingBytecodeHex}`)).map(
                toBchUtxo,
              ),
            broadcast: (txHex) => transport.broadcast(txHex),
          },
          bchNetwork: network,
          bchCashAddress: keys.bchCashAddress,
          userLockingBytecodeHex: keys.bchLockingBytecode.replace(/^0x/i, ''),
          feeRateSatPerByte,
        },
        terms,
      );
      return (txid.startsWith('0x') ? txid : `0x${txid}`) as Hex32;
    },
    async waitForHtlcUtxo(terms, pollOpts) {
      const params = encodeHtlcParameters(terms);
      const addrs = deriveHtlcAddresses(params, network);
      const lockingHex = `0x${binToHex(addrs.lockingBytecode)}`;
      const deadlineMs = Date.now() + pollOpts.timeoutMs;
      while (Date.now() <= deadlineMs) {
        const utxos = await transport.getUtxos(lockingHex);
        if (utxos.length > 0) {
          const first = utxos[0]!;
          const lockTxid = (
            first.txid.startsWith('0x') ? first.txid : `0x${first.txid}`
          ) as Hex32;
          return { utxos, lockTxid };
        }
        await new Promise((r) => setTimeout(r, pollOpts.pollIntervalMs));
      }
      throw new Error(
        `Timed out waiting for BCH HTLC UTXO at ${addrs.tokenAddress}`,
      );
    },
    async claim(file, utxos) {
      const built = buildBchRecoveryTransaction({ file, utxos });
      const txid = await transport.broadcast(built.txHex);
      return (txid.startsWith('0x') ? txid : `0x${txid}`) as Hex32;
    },
    async waitForRefundHeight(terms, pollOpts) {
      const deadlineMs = Date.now() + pollOpts.timeoutMs;
      while (Date.now() <= deadlineMs) {
        const tip = await transport.getTipHeight();
        if (tip >= terms.bchRefundHeight) {
          return tip;
        }
        await new Promise((r) => setTimeout(r, pollOpts.pollIntervalMs));
      }
      throw new Error(
        `Timed out waiting for BCH refund height ${terms.bchRefundHeight}`,
      );
    },
    async refund(file, utxos, locktime) {
      const built = buildBchRecoveryTransaction({ file, utxos, locktime });
      const txid = await transport.broadcast(built.txHex);
      return (txid.startsWith('0x') ? txid : `0x${txid}`) as Hex32;
    },
  };
  return port;
}

async function defaultSaveRecoveryFile(
  filePath: string,
  json: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, json, { encoding: 'utf8', mode: 0o600 });
}

function defaultSecretGenerator(): Hex32 {
  return `0x${randomBytes(32).toString('hex')}` as Hex32;
}

function usdToTokenAmount(amountUsd: number, decimals: number): bigint {
  const scaled = Math.round(amountUsd * 1_000_000);
  if (decimals >= 6) {
    return BigInt(scaled) * 10n ** BigInt(decimals - 6);
  }
  return BigInt(scaled) / 10n ** BigInt(6 - decimals);
}

function buildContractsForRecovery(
  terms: OrderTerms,
  bchNetwork: 'chipnet' | 'mainnet',
): RecoveryFile['contracts'] {
  const params = encodeHtlcParameters(terms);
  const derived = deriveHtlcAddresses(params, bchNetwork);
  return {
    evm: {
      chainId: terms.evmChainId,
      htlcAddress: terms.evmHtlc,
      tokenAddress: terms.evmToken,
    },
    bch: {
      network: bchNetwork,
      htlcAddress: derived.p2sh32Address,
      tokenAddress: derived.tokenAddress,
      redeemScript: `0x${binToHex(derived.redeemScript)}` as Hex,
      lockingBytecode: `0x${binToHex(derived.lockingBytecode)}` as Hex,
    },
  };
}

export async function runProbe(
  options: ProbeOptions,
  deps: ProbeDependencies,
): Promise<ProbeEvidence> {
  const env = deps.env ?? process.env;
  assertProbeSafety(options, env);

  const nowMs = deps.nowMs ?? Date.now;
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(nowMs() / 1000));
  const totalStart = nowMs();

  const keys = loadProbeKeys(env, {
    network: options.network,
    requireEnvKeys: options.execute,
  });

  const bchNetwork: 'chipnet' | 'mainnet' =
    options.network === 'mainnet' ? 'mainnet' : 'chipnet';
  const evmDecimals = deps.evmTokenDecimals ?? 6;
  const bchDecimals = deps.bchTokenDecimals ?? 2;

  const solverClient =
    deps.solverClient ?? new SolverClient({ baseUrl: options.solverUrl });

  const waits: ProbeWaitStep[] = [];
  const recordWait = async <T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    deps.onWait?.(name);
    const startedAtMs = nowMs();
    const result = await fn();
    const finishedAtMs = nowMs();
    waits.push({
      name,
      startedAtMs,
      finishedAtMs,
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
    });
    return result;
  };

  const secret = (deps.secretGenerator ?? defaultSecretGenerator)();
  const hashLock = sha256(secret) as Hex32;

  const inputAmount =
    options.direction === 'EVM_TO_BCH'
      ? usdToTokenAmount(options.amountUsd, evmDecimals)
      : usdToTokenAmount(options.amountUsd, bchDecimals);

  const evmToken =
    deps.evmToken ??
    DEFAULT_EVM_TOKEN_BY_CHAIN[options.chainId] ??
    DEFAULT_EVM_TOKEN_BY_CHAIN[84532]!;

  const quoteRequest: QuoteRequest = {
    direction: options.direction,
    token: options.token,
    chainId: options.chainId,
    evmToken,
    amountIn: inputAmount,
    userEvmAddress: keys.evmAddress,
    userBchLockingBytecode: keys.bchLockingBytecode,
    hashLock,
    lane: options.direction === 'EVM_TO_BCH' ? 'fast' : 'safe',
  };

  const quoteStart = nowMs();
  const [bchTipHeight, quote]: [number, QuoteResponse] = await Promise.all([
    deps.bchPort.getTipHeight(),
    solverClient.quote(quoteRequest),
  ]);

  const verified: VerifiedQuote = await verifyQuote(quote, quoteRequest, {
    bchTipHeight,
    evmTokenDecimals: evmDecimals,
    bchTokenDecimals: bchDecimals,
    nowSeconds: nowSeconds(),
    ...(deps.defaultMaxRefAgeSeconds !== undefined
      ? { defaultMaxRefAgeSeconds: deps.defaultMaxRefAgeSeconds }
      : {}),
    ...(deps.maxRefAgeBySource !== undefined
      ? { maxRefAgeBySource: deps.maxRefAgeBySource }
      : {}),
    ...(deps.expectedSolverAddress !== undefined
      ? { expectedSolverAddress: deps.expectedSolverAddress }
      : {}),
  });
  const quoteDuration = Math.max(0, nowMs() - quoteStart);

  const contracts = buildContractsForRecovery(verified.terms, bchNetwork);
  const recoveryPayload = prepareRecoveryDownload({
    quote: verified,
    contracts,
    secret,
    createdAt: nowSeconds(),
  });
  const recoveryFilePath = join(options.recoveryDir, recoveryPayload.filename);

  const saveFn = deps.saveRecoveryFile ?? defaultSaveRecoveryFile;
  if (options.execute) {
    // Recovery file MUST be saved before any lock transaction is broadcast.
    await saveFn(recoveryFilePath, recoveryPayload.json);
  }
  const recoverySavedBeforeLock = true;

  let userLockTxid: Hex32 | null = null;
  let solverLockTxid: Hex32 | null = null;
  let claimTxid: Hex32 | null = null;
  let refundTxid: Hex32 | null = null;
  let lockDuration = 0;
  let counterpartyWaitDuration = 0;
  let settleDuration = 0;
  let status: ProbeEvidence['status'] = 'dry-run';

  if (!options.execute) {
    await recordWait(
      'dry-run verification (no transactions sent)',
      async () => {
        if (options.direction === 'EVM_TO_BCH') {
          await deps.evmPort.buildDryRunLock(verified.terms);
        } else {
          await deps.bchPort.buildDryRunLock(
            verified.terms,
            keys,
            options.bchFeeRateSatPerByte,
          );
        }
      },
    );
  } else if (options.mode === 'swap') {
    const lockStart = nowMs();
    if (options.direction === 'EVM_TO_BCH') {
      userLockTxid = await deps.evmPort.lock(verified.terms, solverClient);
      lockDuration = Math.max(0, nowMs() - lockStart);

      const waitStart = nowMs();
      const bchHtlc = await recordWait('waiting for solver BCH lock', () =>
        deps.bchPort.waitForHtlcUtxo(verified.terms, {
          pollIntervalMs: options.pollIntervalMs,
          timeoutMs: options.timeoutMs,
        }),
      );
      solverLockTxid = bchHtlc.lockTxid;
      counterpartyWaitDuration = Math.max(0, nowMs() - waitStart);

      const settleStart = nowMs();
      claimTxid = await recordWait('claiming BCH HTLC', () =>
        deps.bchPort.claim(recoveryPayload.file, bchHtlc.utxos),
      );
      settleDuration = Math.max(0, nowMs() - settleStart);
      status = 'claimed';
    } else {
      userLockTxid = await deps.bchPort.lock(
        verified.terms,
        keys,
        options.bchFeeRateSatPerByte,
      );
      lockDuration = Math.max(0, nowMs() - lockStart);

      const waitStart = nowMs();
      solverLockTxid = await recordWait('waiting for solver EVM lock', () =>
        deps.evmPort.waitForSolverLock(verified.terms, {
          pollIntervalMs: options.pollIntervalMs,
          timeoutMs: options.timeoutMs,
        }),
      );
      counterpartyWaitDuration = Math.max(0, nowMs() - waitStart);

      const settleStart = nowMs();
      claimTxid = await recordWait('claiming EVM HTLC', () =>
        deps.evmPort.claim(verified.terms, secret),
      );
      settleDuration = Math.max(0, nowMs() - settleStart);
      status = 'claimed';
    }
  } else {
    // Refund drill (pre-expired order)
    const lockStart = nowMs();
    if (options.direction === 'EVM_TO_BCH') {
      userLockTxid = await deps.evmPort.lock(verified.terms, solverClient);
      lockDuration = Math.max(0, nowMs() - lockStart);

      const waitStart = nowMs();
      await recordWait('waiting for EVM refund deadline', () =>
        deps.evmPort.waitForRefundDeadline(verified.terms, {
          pollIntervalMs: options.pollIntervalMs,
          timeoutMs: options.timeoutMs,
        }),
      );
      counterpartyWaitDuration = Math.max(0, nowMs() - waitStart);

      const settleStart = nowMs();
      refundTxid = await recordWait('refunding EVM HTLC', () =>
        deps.evmPort.refund(verified.terms),
      );
      settleDuration = Math.max(0, nowMs() - settleStart);
      status = 'refunded';
    } else {
      userLockTxid = await deps.bchPort.lock(
        verified.terms,
        keys,
        options.bchFeeRateSatPerByte,
      );
      lockDuration = Math.max(0, nowMs() - lockStart);

      const waitStart = nowMs();
      const bchHtlc = await recordWait('waiting for user BCH lock UTXO', () =>
        deps.bchPort.waitForHtlcUtxo(verified.terms, {
          pollIntervalMs: options.pollIntervalMs,
          timeoutMs: options.timeoutMs,
        }),
      );
      const refundTip = await recordWait('waiting for BCH refund height', () =>
        deps.bchPort.waitForRefundHeight(verified.terms, {
          pollIntervalMs: options.pollIntervalMs,
          timeoutMs: options.timeoutMs,
        }),
      );
      counterpartyWaitDuration = Math.max(0, nowMs() - waitStart);

      const settleStart = nowMs();
      refundTxid = await recordWait('refunding BCH HTLC', () =>
        deps.bchPort.refund(
          recoveryPayload.file,
          bchHtlc.utxos,
          Math.max(refundTip, verified.terms.bchRefundHeight),
        ),
      );
      settleDuration = Math.max(0, nowMs() - settleStart);
      status = 'refunded';
    }
  }

  const totalDuration = Math.max(0, nowMs() - totalStart);
  const evmChain = { kind: 'evm' as const, chainId: verified.terms.evmChainId };
  const bchChain = { kind: 'bch' as const, network: bchNetwork };

  const userLockChain:
    | { kind: 'evm'; chainId: number }
    | { kind: 'bch'; network: 'chipnet' | 'mainnet' } =
    options.direction === 'EVM_TO_BCH' ? evmChain : bchChain;
  const solverLockChain:
    | { kind: 'evm'; chainId: number }
    | { kind: 'bch'; network: 'chipnet' | 'mainnet' } =
    options.direction === 'EVM_TO_BCH' ? bchChain : evmChain;
  const claimChain:
    | { kind: 'evm'; chainId: number }
    | { kind: 'bch'; network: 'chipnet' | 'mainnet' } =
    options.direction === 'EVM_TO_BCH' ? bchChain : evmChain;
  const refundChain = userLockChain;

  return {
    schemaVersion: 1,
    network: options.network,
    mode: options.mode,
    dryRun: !options.execute,
    status,
    direction: options.direction,
    chainId: verified.terms.evmChainId,
    orderId: verified.orderId,
    quoteId: verified.terms.quoteId,
    recoveryFilePath,
    recoverySavedBeforeLock,
    amounts: {
      evmToken: verified.terms.evmToken,
      evmAmount: verified.terms.evmAmount.toString(),
      bchToken: verified.terms.bchToken,
      bchTokenAmount: verified.terms.bchTokenAmount.toString(),
    },
    pricing: {
      spreadBps: verified.terms.pricing.spreadBps,
      fixedFeeBase: verified.terms.pricing.fixedFeeBase.toString(),
      rounding: verified.terms.pricing.rounding,
      refs: verified.terms.pricing.refs.map((r) => ({
        asset: r.asset,
        usdPrice: r.usdPrice,
        source: r.source,
        asOf: r.asOf,
      })),
    },
    txids: {
      userLockTxid,
      solverLockTxid,
      claimTxid,
      refundTxid,
    },
    explorerLinks: {
      userLock: explorerTxUrl(userLockChain, userLockTxid),
      solverLock: explorerTxUrl(solverLockChain, solverLockTxid),
      claim: explorerTxUrl(claimChain, claimTxid),
      refund: explorerTxUrl(refundChain, refundTxid),
    },
    waits,
    durationsMs: {
      total: totalDuration,
      quote: quoteDuration,
      lock: lockDuration,
      counterpartyWait: counterpartyWaitDuration,
      settle: settleDuration,
    },
  };
}

export type ProbeDirectionHelper = Direction;
