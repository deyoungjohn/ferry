import { createWalletClient, sha256, stringToHex } from 'viem';
import type { Address, Chain, Hex, PublicClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import {
  evmLockId,
  type Hex32,
  type OrderTerms,
  type QuoteResponse,
} from '@ferry/core';
import { buildClaimTransaction as buildEvmClaim } from '@ferry/chain-evm/browser';
import {
  buildClaimTransaction,
  buildLockTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
} from '@ferry/htlc-bch';
import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { signRelayLockRequest } from '../../e2e/test/harness.js';
import type {
  BchIdentity,
  RealEngineSolver,
} from '../../e2e/test/support/real-engine-solver.js';
import { scriptHashOf } from '../../e2e/test/support/fake-bch-chain.js';
import type { FakeBchChain } from '../../e2e/test/support/fake-bch-chain.js';

export interface FlowContext {
  solver: RealEngineSolver;
  chain: FakeBchChain;
  chainConfig: Chain;
  publicClient: PublicClient;
  user: PrivateKeyAccount;
  userWallet: ReturnType<typeof createWalletClient>;
  solverEvmAddress: Address;
  token: Address;
  tokenDecimals: number;
  tokenPermit: boolean;
  userBch: BchIdentity;
  solverBch: BchIdentity;
}

function syncPrices(ctx: FlowContext): void {
  const asOf = Math.floor(Date.now() / 1000);
  for (const asset of ['usdc', 'pusd']) {
    ctx.solver.priceSource.setPrice(asset, {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf,
    });
  }
}

function secretFor(label: string): { secret: Hex32; hashLock: Hex32 } {
  const secret = sha256(stringToHex(`${label}-${Date.now()}`));
  return { secret, hashLock: sha256(secret) };
}

function covenantOf(terms: OrderTerms) {
  const params = encodeHtlcParameters(terms);
  return {
    params,
    lockingBytecode: deriveHtlcAddresses(params, 'chipnet').lockingBytecode,
  };
}

function addressOf(lockingBytecode: Uint8Array): string {
  const result = lockingBytecodeToCashAddress({
    bytecode: lockingBytecode,
    prefix: 'bchtest',
    tokenSupport: false,
  });
  if (typeof result === 'string') throw new Error(result);
  return result.address;
}

function fundBch(
  chain: FakeBchChain,
  identity: BchIdentity,
  terms: OrderTerms,
  tokenAmount: bigint,
): void {
  const category = Uint8Array.from(
    encodeHtlcParameters(terms).tokenCategory,
  ).reverse();
  chain.fund({
    lockingBytecode: identity.lockingBytecode,
    valueSatoshis: 40_000n,
    token: { category, amount: tokenAmount },
  });
  chain.fund({
    lockingBytecode: identity.lockingBytecode,
    valueSatoshis: 200_000n,
  });
}

function userBchLock(
  ctx: FlowContext,
  terms: OrderTerms,
): { txHex: string; txid: string; vout: number } {
  const utxos = ctx.chain.rpc('blockchain.scripthash.listunspent', [
    scriptHashOf(ctx.userBch.lockingBytecode),
  ]) as unknown[];
  const built = buildLockTransaction({
    params: terms,
    utxos,
    changeAddress: addressOf(ctx.userBch.lockingBytecode),
    privateKey: ctx.userBch.privateKey,
    network: 'chipnet',
  });
  return {
    txHex: built.signed!.txHex,
    txid: built.signed!.txid,
    vout: built.htlcOutputIndex,
  };
}

async function lockUserEvm(
  ctx: FlowContext,
  quote: QuoteResponse,
): Promise<void> {
  const terms = quote.terms as OrderTerms;
  if (!ctx.tokenPermit) {
    const unsigned = await ctx.solver.evmAdapter.buildUserLock(terms);
    const payload = unsigned.payload as {
      mode: 'approve-lock';
      transactions: Array<{ to: Address; data: Hex; value: bigint }>;
    };
    if (payload.mode !== 'approve-lock') {
      throw new Error(`unexpected payload mode ${payload.mode}`);
    }
    for (const transaction of payload.transactions) {
      const hash = await ctx.userWallet.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        account: ctx.user,
        chain: ctx.chainConfig,
      });
      await ctx.publicClient.waitForTransactionReceipt({ hash });
    }
    return;
  }
  const request = await signRelayLockRequest({
    evmAdapter: ctx.solver.evmAdapter,
    orderId: quote.orderId as Hex32,
    terms,
    userAccount: ctx.user,
  });
  const response = await ctx.solver.client.relayLock(
    quote.orderId as Hex32,
    request,
    { timeoutMs: 60_000 },
  );
  if (!response.ok) throw new Error('relay-lock was refused');
}

export async function runForwardFlow(ctx: FlowContext): Promise<string> {
  syncPrices(ctx);
  const { secret, hashLock } = secretFor(`forward-${ctx.chainConfig.id}`);
  const quote = await ctx.solver.client.quote({
    direction: 'EVM_TO_BCH',
    token: 'PUSD',
    chainId: ctx.chainConfig.id,
    evmToken: ctx.token,
    amountIn: 5n * 10n ** BigInt(ctx.tokenDecimals),
    userEvmAddress: ctx.user.address,
    userBchLockingBytecode: `0x${Buffer.from(ctx.userBch.lockingBytecode).toString('hex')}`,
    hashLock,
    lane: 'safe',
  });
  ctx.solver.watch(quote.orderId);
  const terms = quote.terms as OrderTerms;
  fundBch(ctx.chain, ctx.solverBch, terms, terms.bchTokenAmount * 5n);
  await lockUserEvm(ctx, quote);
  const { params, lockingBytecode } = covenantOf(terms);
  const htlcScript = scriptHashOf(lockingBytecode);
  await ctx.solver.waitFor(
    'solver BCH lock',
    () => ctx.chain.utxosForScriptHash(htlcScript).length === 1,
    30_000,
  );
  const lock = ctx.chain.utxosForScriptHash(htlcScript)[0]!;
  ctx.chain.mine();
  const claim = buildClaimTransaction({
    params,
    utxo: {
      txid: lock.txid,
      vout: lock.vout,
      satoshis: lock.output.valueSatoshis,
    },
    secret,
    network: 'chipnet',
  });
  const claimId = ctx.chain.broadcast(claim.txHex);
  if (ctx.chain.secretRevealedBy(claimId, hashLock) !== secret) {
    throw new Error('BCH claim did not reveal the secret');
  }
  const evmLock = evmLockId(ctx.user.address, hashLock);
  await ctx.solver.waitFor(
    'solver EVM claim',
    async () =>
      (await ctx.solver.evmAdapter.getLock(evmLock)).status === 'claimed',
    60_000,
  );
  await ctx.solver.waitFor(
    'order DONE',
    async () => {
      const state = (await ctx.solver.client.getOrder(quote.orderId)).state;
      return state === 'DONE' || state === 'SWAP_COMPLETE';
    },
    30_000,
  );
  return `forward done: bch=${lock.txid.slice(0, 10)} evm=${evmLock.slice(0, 10)}`;
}

export async function runReverseFlow(ctx: FlowContext): Promise<string> {
  syncPrices(ctx);
  const { secret, hashLock } = secretFor(`reverse-${ctx.chainConfig.id}`);
  const quote = await ctx.solver.client.quote({
    direction: 'BCH_TO_EVM',
    token: 'PUSD',
    chainId: ctx.chainConfig.id,
    evmToken: ctx.token,
    amountIn: 1_000n,
    userEvmAddress: ctx.user.address,
    userBchLockingBytecode: `0x${Buffer.from(ctx.userBch.lockingBytecode).toString('hex')}`,
    hashLock,
    lane: 'safe',
  });
  ctx.solver.watch(quote.orderId);
  const terms = quote.terms as OrderTerms;
  fundBch(ctx.chain, ctx.userBch, terms, terms.bchTokenAmount * 2n);
  const userLock = userBchLock(ctx, terms);
  ctx.chain.broadcast(userLock.txHex);
  ctx.chain.mine();
  const evmLock = evmLockId(ctx.solverEvmAddress, hashLock);
  await ctx.solver.waitFor(
    'solver EVM lock',
    async () =>
      (await ctx.solver.evmAdapter.getLock(evmLock)).status === 'locked',
    30_000,
  );
  const claim = buildEvmClaim({
    htlc: ctx.solver.evmAdapter.htlcAddress,
    lockId: evmLock,
    secret,
  });
  const hash = await ctx.userWallet.sendTransaction({
    to: claim.to,
    data: claim.data,
    value: claim.value,
    account: ctx.user,
    chain: ctx.chainConfig,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash });
  await ctx.solver.waitFor(
    'solver BCH claim',
    () => ctx.chain.isSpent(userLock.txid, userLock.vout),
    60_000,
  );
  await ctx.solver.waitFor(
    'order DONE',
    async () => {
      const state = (await ctx.solver.client.getOrder(quote.orderId)).state;
      return state === 'DONE' || state === 'SWAP_COMPLETE';
    },
    30_000,
  );
  return `reverse done: evm=${evmLock.slice(0, 10)} bch=${userLock.txid.slice(0, 10)}`;
}
