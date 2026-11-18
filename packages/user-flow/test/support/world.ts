import {
  binToHex,
  decodeTransaction,
  hexToBin,
  lockingBytecodeToCashAddress,
  ripemd160,
  secp256k1,
  sha256 as libauthSha256,
  type Transaction,
} from '@bitauth/libauth';
import {
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type Unlocker,
} from 'cashscript';
import {
  evmLockId,
  orderId as computeOrderId,
  signOrderId,
  type Hex,
  type Hex32,
  type LockState,
  type OrderTerms,
} from '@ferry/core';
import type { QuoteRequest, QuoteResponse } from '@ferry/core/api';
import { deriveHtlcAddresses, encodeHtlcParameters } from '@ferry/htlc-bch';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createMemoryStore,
  type BchChainPort,
  type BchSignerPort,
  type BchUtxo,
  type EvmChainPort,
  type EvmSignerPort,
  type SolverPort,
  type UserSwapDependencies,
} from '../../src/index.js';

const SOLVER_KEY =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as const;
export const SOLVER_ACCOUNT = privateKeyToAccount(SOLVER_KEY);

export const USER_EVM = '0x2222222222222222222222222222222222222222' as Hex;
export const EVM_TOKEN = '0x3333333333333333333333333333333333333333' as Hex;
export const EVM_HTLC = '0x4444444444444444444444444444444444444444' as Hex;
export const EVM_CHAIN_ID = 8453;
export const BCH_CATEGORY =
  '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const SOLVER_BCH_LOCKING =
  '0x76a91433221100ffeeddccbbaa9988776655443322110088ac' as Hex;
const START_SECONDS = 1_794_764_200;
const START_TIP = 500_000;

const USER_KEY = new Uint8Array(32).fill(0x21);
const USER_PUBKEY = secp256k1.derivePublicKeyCompressed(USER_KEY) as Uint8Array;
const USER_PKH = ripemd160.hash(libauthSha256.hash(USER_PUBKEY));
export const USER_LOCKING = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...USER_PKH,
  0x88,
  0xac,
]);
export const USER_LOCKING_HEX = binToHex(USER_LOCKING);
export const USER_CASH_ADDRESS = (
  lockingBytecodeToCashAddress({
    bytecode: USER_LOCKING,
    prefix: 'bitcoincash',
    tokenSupport: false,
  }) as { address: string }
).address;

export type LockMode = 'permit' | 'approve';

export interface WorldOptions {
  /** Whether the solver locks its side by itself once the user's lock is seen. Default true. */
  readonly autoCounterLock?: boolean;
  readonly lockMode?: LockMode;
}

type Status = 'absent' | 'locked' | 'claimed' | 'refunded';

function txidOf(txHex: string): string {
  const hash = libauthSha256.hash(libauthSha256.hash(hexToBin(txHex)));
  return binToHex(Uint8Array.from(hash).reverse());
}

/**
 * An in-memory world: a solver, an EVM chain, a Bitcoin Cash chain and the
 * user's two wallets, wired so that the session can run a swap end to end.
 */
export function createWorld(options: WorldOptions = {}) {
  const world = {
    now: START_SECONDS,
    tip: START_TIP,
    solverAnswers: true,
    autoCounterLock: options.autoCounterLock ?? true,
    lockMode: options.lockMode ?? ('permit' as LockMode),
    rejectSignatures: false,
    walletChainId: EVM_CHAIN_ID,
    tamperSignedTransaction: false,
    healthHasTips: true,
    events: [] as string[],
    quoteRequests: [] as QuoteRequest[],
    evmStatus: new Map<Hex32, Status>(),
    bchUtxos: new Map<string, BchUtxo[]>(),
    broadcasts: [] as string[],
    evmTransactions: [] as { to: Hex; data: Hex }[],
    terms: null as OrderTerms | null,
    store: createMemoryStore(),
  };

  const userUtxo = (satoshis: bigint, amount: bigint): BchUtxo => ({
    txid: '77'.repeat(32),
    vout: 0,
    satoshis,
    token: { category: BCH_CATEGORY, amount },
  });
  world.bchUtxos.set(USER_LOCKING_HEX, [userUtxo(50_000n, 1_000_000n)]);

  const covenantLockingHex = (terms: OrderTerms): string =>
    binToHex(
      deriveHtlcAddresses(encodeHtlcParameters(terms), 'mainnet')
        .lockingBytecode,
    );

  const addCovenantUtxo = (terms: OrderTerms, txid: string): void => {
    const key = covenantLockingHex(terms);
    world.bchUtxos.set(key, [
      {
        txid,
        vout: 0,
        satoshis: terms.bchCarrySats,
        token: { category: BCH_CATEGORY, amount: terms.bchTokenAmount },
      },
    ]);
  };

  const setEvm = (owner: Hex, hashLock: Hex32, status: Status): void => {
    world.evmStatus.set(evmLockId(owner, hashLock), status);
  };

  const counterLock = (terms: OrderTerms): void => {
    if (terms.direction === 'EVM_TO_BCH') {
      addCovenantUtxo(terms, 'cc'.repeat(32));
    } else {
      setEvm(terms.solverEvmAddress, terms.hashLock, 'locked');
    }
    world.events.push('solver counter-lock');
  };

  const solver: SolverPort = {
    quote: (request: QuoteRequest) => {
      if (!world.solverAnswers) return Promise.reject(new Error('solver down'));
      world.quoteRequests.push(request);
      return makeQuote(request);
    },
    getOrder: (orderId: Hex32) => {
      if (!world.solverAnswers) return Promise.reject(new Error('solver down'));
      const terms = world.terms;
      const txids: Record<string, Hex32> = {};
      if (terms) {
        const key = covenantLockingHex(terms);
        if (terms.direction === 'EVM_TO_BCH' && world.bchUtxos.has(key)) {
          txids['bchLock'] = `0x${'cc'.repeat(32)}` as Hex32;
        }
        if (
          terms.direction === 'BCH_TO_EVM' &&
          world.evmStatus.get(
            evmLockId(terms.solverEvmAddress, terms.hashLock),
          ) !== undefined
        ) {
          txids['evmLock'] = `0x${'dd'.repeat(32)}` as Hex32;
        }
      }
      return Promise.resolve({
        orderId,
        state: 'OPEN',
        txids,
        quoteExpiry: world.now + 300,
        counterDeadline: world.now + 3600,
        bchRefundHeight: terms?.bchRefundHeight ?? world.tip + 12,
        updatedAt: world.now,
      }) as ReturnType<SolverPort['getOrder']>;
    },
    relayLock: (orderId: Hex32, request: unknown) => {
      world.events.push('relayLock');
      const terms = world.terms!;
      setEvm(terms.userEvmAddress, terms.hashLock, 'locked');
      if (world.autoCounterLock) counterLock(terms);
      void request;
      return Promise.resolve({
        ok: true,
        orderId,
        txHash: `0x${'e1'.repeat(32)}` as Hex32,
      });
    },
    relayClaim: (orderId: Hex32) => {
      world.events.push('relayClaim');
      const terms = world.terms!;
      setEvm(terms.solverEvmAddress, terms.hashLock, 'claimed');
      return Promise.resolve({
        ok: true,
        orderId,
        txHash: `0x${'e2'.repeat(32)}` as Hex32,
      });
    },
    health: () => {
      if (!world.solverAnswers) return Promise.reject(new Error('solver down'));
      return Promise.resolve({
        ok: true,
        quotingEnabled: true,
        timestamp: world.now,
        ...(world.healthHasTips ? { tips: { bchHeight: world.tip } } : {}),
      });
    },
  } as unknown as SolverPort;

  function makeQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const forward = request.direction === 'EVM_TO_BCH';
    const spread = 9950n;
    const amountIn = BigInt(request.amountIn);
    const evmAmount = forward
      ? amountIn
      : (amountIn * spread * 10n ** 6n) / (10_000n * 10n ** 2n);
    const bchTokenAmount = forward
      ? (amountIn * spread * 10n ** 2n) / (10_000n * 10n ** 6n)
      : amountIn;
    const terms: OrderTerms = {
      version: 1,
      direction: request.direction,
      bchToken: request.token,
      bchTokenCategory: `0x${BCH_CATEGORY}` as Hex32,
      bchTokenAmount,
      evmAmount,
      evmToken: request.evmToken,
      evmChainId: request.chainId,
      evmHtlc: EVM_HTLC,
      userEvmAddress: request.userEvmAddress,
      userBchLockingBytecode: request.userBchLockingBytecode as Hex,
      solverEvmAddress: SOLVER_ACCOUNT.address.toLowerCase() as Hex,
      solverBchLockingBytecode: SOLVER_BCH_LOCKING,
      hashLock: request.hashLock,
      evmDeadline: forward ? world.now + 28_800 : world.now + 7_200,
      bchRefundHeight: forward ? world.tip + 12 : world.tip + 144,
      bchCarrySats: 3000n,
      bchMaxFee: 1000n,
      quoteId: 'q-flow-1',
      quoteExpiry: world.now + 300,
      pricing: {
        refs: [
          { asset: 'USDC', usdPrice: '1.00', source: 'pyth', asOf: world.now },
          {
            asset: request.token,
            usdPrice: '1.00',
            source: 'cauldron',
            asOf: world.now,
          },
        ],
        spreadBps: 50,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
    };
    world.terms = terms;
    const id = computeOrderId(terms);
    return signOrderId(id, SOLVER_ACCOUNT).then((signature) => ({
      orderId: id,
      terms,
      signature,
      signerAddress: SOLVER_ACCOUNT.address.toLowerCase() as Hex,
    }));
  }

  const evmSigner: EvmSignerPort = {
    getAddress: () => Promise.resolve(USER_EVM),
    getChainId: () => Promise.resolve(world.walletChainId),
    signTypedData: () => {
      if (world.rejectSignatures) {
        return Promise.reject(new Error('User rejected the request'));
      }
      world.events.push('evm signature');
      return Promise.resolve(`0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b` as Hex);
    },
    sendTransaction: (tx) => {
      if (world.rejectSignatures) {
        return Promise.reject(new Error('User rejected the request'));
      }
      world.evmTransactions.push({ to: tx.to, data: tx.data });
      const terms = world.terms!;
      const selector = tx.data.slice(0, 10);
      if (tx.to.toLowerCase() === EVM_HTLC) {
        // refund(bytes32) and lock(...) are told apart by length.
        if (tx.data.length === 10 + 64) {
          setEvm(terms.userEvmAddress, terms.hashLock, 'refunded');
          world.events.push('evm refund');
        } else {
          setEvm(terms.userEvmAddress, terms.hashLock, 'locked');
          world.events.push('evm lock');
          if (world.autoCounterLock) counterLock(terms);
        }
      } else {
        world.events.push(`evm approve ${selector}`);
      }
      return Promise.resolve(`0x${'e3'.repeat(32)}` as Hex32);
    },
  };

  const evmChain: EvmChainPort = {
    buildUserLock: (terms) => {
      const intentDeadline = BigInt(terms.quoteExpiry + 3600);
      if (world.lockMode === 'approve') {
        return Promise.resolve({
          chain: 'base' as never,
          orderId: computeOrderId(terms),
          payload: {
            mode: 'approve-lock',
            approve: {
              token: terms.evmToken,
              spender: terms.evmHtlc,
              amount: terms.evmAmount,
            },
            lockCall: {
              address: terms.evmHtlc,
              args: [
                terms.evmToken,
                terms.solverEvmAddress,
                terms.evmAmount,
                terms.hashLock,
                BigInt(terms.evmDeadline),
              ],
            },
          },
        });
      }
      return Promise.resolve({
        chain: 'base' as never,
        orderId: computeOrderId(terms),
        payload: {
          mode: 'permit-intent',
          permitTypedData: { message: { deadline: intentDeadline } },
          lockIntentTypedData: { message: { intentDeadline } },
        },
      });
    },
    getLock: (lockId) => {
      const status = world.evmStatus.get(lockId) ?? 'absent';
      return Promise.resolve({ status } as unknown as LockState);
    },
    waitForReceipt: () => Promise.resolve(),
    getBlockTimestamp: () => Promise.resolve(world.now),
  };

  const bchSigner: BchSignerPort = {
    signTransaction: (request) => {
      if (world.rejectSignatures) {
        return Promise.reject(new Error('Wallet request rejected'));
      }
      world.events.push('bch signature');
      const tx = request.transaction.transaction as Transaction;
      const sources = request.transaction.sourceOutputs;
      const builder = new TransactionBuilder({
        provider: new MockNetworkProvider(),
      });
      const template = new SignatureTemplate(USER_KEY);
      tx.inputs.forEach((input, index) => {
        const src = sources[index]!;
        builder.addInput(
          {
            txid: binToHex(input.outpointTransactionHash),
            vout: input.outpointIndex,
            satoshis: src.valueSatoshis,
            lockingBytecode: binToHex(src.lockingBytecode),
            ...(src.token
              ? {
                  token: {
                    category: binToHex(src.token.category),
                    amount: src.token.amount,
                  },
                }
              : {}),
          },
          world.tamperSignedTransaction
            ? ({
                generateLockingBytecode: () => USER_LOCKING,
                generateUnlockingBytecode: () => new Uint8Array(),
              } as unknown as Unlocker)
            : template.unlockP2PKH(),
        );
      });
      tx.outputs.forEach((output) => {
        builder.addOutput({
          to: output.lockingBytecode,
          amount: output.valueSatoshis,
          ...(output.token
            ? {
                token: {
                  category: binToHex(output.token.category),
                  amount: output.token.amount,
                },
              }
            : {}),
        });
      });
      return Promise.resolve(builder.build());
    },
  };

  const bchChain: BchChainPort = {
    getTipHeight: () => Promise.resolve(world.tip),
    getUtxos: (lockingBytecodeHex) =>
      Promise.resolve(
        world.bchUtxos.get(lockingBytecodeHex.replace(/^0x/, '')) ?? [],
      ),
    broadcast: (txHex) => {
      world.broadcasts.push(txHex);
      const tx = decodeTransaction(hexToBin(txHex)) as Transaction;
      const txid = txidOf(txHex);
      const terms = world.terms!;
      const covenantKey = covenantLockingHex(terms);
      const spendsCovenant = tx.inputs.some((input) => {
        const spentTxid = binToHex(input.outpointTransactionHash);
        return (world.bchUtxos.get(covenantKey) ?? []).some(
          (u) => u.txid === spentTxid && u.vout === input.outpointIndex,
        );
      });
      if (spendsCovenant) {
        world.bchUtxos.delete(covenantKey);
        world.events.push('bch covenant spend');
      } else if (
        tx.outputs.some((o) => binToHex(o.lockingBytecode) === covenantKey)
      ) {
        world.bchUtxos.set(covenantKey, [
          {
            txid,
            vout: 0,
            satoshis: tx.outputs[0]!.valueSatoshis,
            token: { category: BCH_CATEGORY, amount: terms.bchTokenAmount },
          },
        ]);
        world.events.push('bch lock');
        if (world.autoCounterLock) counterLock(terms);
      }
      return Promise.resolve(txid);
    },
  };

  const store = {
    ...world.store,
    save: async (id: Hex32, json: string) => {
      world.events.push('save recovery');
      await world.store.save(id, json);
    },
  };

  const deps = (
    overrides: Partial<UserSwapDependencies> = {},
  ): UserSwapDependencies => ({
    solver,
    evmSigner,
    evmChain,
    bchSigner,
    bchChain,
    store,
    bchNetwork: 'mainnet',
    bchCashAddress: USER_CASH_ADDRESS,
    nowMs: () => world.now * 1000,
    sleep: () => {
      world.now += 15;
      return Promise.resolve();
    },
    secretGenerator: () => `0x${'5a'.repeat(32)}` as Hex32,
    ...overrides,
  });

  /** The solver locks its side now (for tests that need to control the moment). */
  const solverLocks = (): void => counterLock(world.terms!);

  return { world, deps, covenantLockingHex, solverLocks };
}
