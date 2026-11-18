// End-to-end tests of the solver's real engine and HTTP API, in both directions, on a
// local EVM chain and a strict simulated Bitcoin Cash chain.
//
// While the engine's on-chain actions are placeholders these tests fail, on purpose:
// every assertion about the Bitcoin Cash side is made against the simulator, which
// only accepts a transaction that passes the script VM, so a placeholder id such as
// `bch_lock_<order>` or an `isOnChain` that always answers yes cannot satisfy them.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { evmLockId } from '@ferry/core';
import type { Hex32, OrderTerms } from '@ferry/core';
import {
  buildClaimTransaction,
  buildLockTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
} from '@ferry/htlc-bch';
import { buildClaimTransaction as buildEvmClaimTransaction } from '@ferry/chain-evm/browser';
import {
  DEPLOYER_KEY,
  RECIPIENT_KEY,
  SOLVER_KEY,
  USER_KEY,
  deployArtifact,
  deployFerryHtlcDeterministic,
  signRelayLockRequest,
  startAnvil,
} from './harness.js';
import type { AnvilInstance } from './harness.js';
import { FakeBchChain, scriptHashOf } from './support/fake-bch-chain.js';
import {
  makeBchIdentity,
  startRealEngineSolver,
} from './support/real-engine-solver.js';
import type { RealEngineSolver } from './support/real-engine-solver.js';

const RUN_E2E = process.env['FERRY_RUN_E2E'] === '1';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
]);

describe.skipIf(!RUN_E2E)(
  'The real engine, both directions, end to end',
  () => {
    const deployer = privateKeyToAccount(DEPLOYER_KEY);
    const userEvm = privateKeyToAccount(USER_KEY);
    const receiverEvm = privateKeyToAccount(RECIPIENT_KEY);
    const userBch = makeBchIdentity(0x31);
    const solverBch = makeBchIdentity(0x52);
    const hex0x = (bytes: Uint8Array): Hex =>
      `0x${Buffer.from(bytes).toString('hex')}`;

    let anvil: AnvilInstance;
    let pub: PublicClient;
    let userWallet: WalletClient;
    let htlc: Address;
    let token: Address;
    let chain: FakeBchChain;
    let solver: RealEngineSolver;
    let counter = 0;

    beforeAll(async () => {
      anvil = await startAnvil({ chainId: 31337 });
      const transport = http(anvil.rpcUrl);
      pub = createPublicClient({
        chain: anvil.chain,
        transport,
        cacheTime: 0,
        pollingInterval: 50,
      });
      const deployerWallet = createWalletClient({
        account: deployer,
        chain: anvil.chain,
        transport,
      });
      userWallet = createWalletClient({
        account: userEvm,
        chain: anvil.chain,
        transport,
      });
      htlc = await deployFerryHtlcDeterministic(anvil.rpcUrl, DEPLOYER_KEY);
      token = await deployArtifact(
        deployerWallet,
        pub,
        deployer,
        anvil.chain,
        'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
      );
      for (const target of [
        userEvm.address,
        privateKeyToAccount(
          '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        ).address,
      ]) {
        const hash = await deployerWallet.writeContract({
          address: token,
          abi: tokenAbi,
          functionName: 'mint',
          args: [target, 500_000_000n],
          account: deployer,
          chain: anvil.chain,
        });
        await pub.waitForTransactionReceipt({ hash });
      }
    });

    // Each test gets its own solver, database and Bitcoin Cash chain, so a failure in
    // one never leaves orders behind for the next.
    beforeEach(async () => {
      chain = new FakeBchChain();
      solver = await startRealEngineSolver({
        rpcUrl: anvil.rpcUrl,
        chain: anvil.chain,
        htlcAddress: htlc,
        tokenAddress: token,
        bchChain: chain,
        solverBch,
      });
    });

    afterEach(async () => {
      await solver?.stop();
    });

    afterAll(async () => {
      await anvil?.stop();
    });

    // -- helpers ----------------------------------------------------------------

    function freshSecret(): { secret: Hex32; hashLock: Hex32 } {
      counter += 1;
      const secret = sha256(stringToHex(`real-engine-secret-${counter}`));
      return { secret, hashLock: sha256(secret) };
    }

    function syncPrices(): void {
      const asOf = Math.floor(Date.now() / 1000);
      for (const asset of ['usdc', 'pusd']) {
        solver.priceSource.setPrice(asset, {
          usdPrice: 1_000_000n,
          source: 'reference',
          asOf,
        });
      }
    }

    /** The covenant parameters and the on-chain locking bytecode for an order. */
    function covenantOf(terms: OrderTerms) {
      const params = encodeHtlcParameters(terms);
      return {
        params,
        lockingBytecode: deriveHtlcAddresses(params, 'chipnet').lockingBytecode,
      };
    }

    /** Funds a Bitcoin Cash key with tokens of the order's category and some satoshis. */
    function fundBch(
      identity: { lockingBytecode: Uint8Array },
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

    function watched<T extends { orderId: Hex32 }>(quote: T): T {
      solver.watch(quote.orderId);
      return quote;
    }

    async function quoteForward(hashLock: Hex32, amountIn = 10_000_000n) {
      syncPrices();
      return watched(
        await solver.client.quote({
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: anvil.chainId,
          evmToken: token,
          amountIn,
          userEvmAddress: userEvm.address,
          userBchLockingBytecode: hex0x(userBch.lockingBytecode),
          hashLock,
          lane: 'safe',
        }),
      );
    }

    async function quoteReverse(hashLock: Hex32, amountIn = 1_000n) {
      syncPrices();
      return watched(
        await solver.client.quote({
          direction: 'BCH_TO_EVM',
          token: 'PUSD',
          chainId: anvil.chainId,
          evmToken: token,
          amountIn,
          userEvmAddress: userEvm.address,
          userBchLockingBytecode: hex0x(userBch.lockingBytecode),
          hashLock,
          lane: 'safe',
        }),
      );
    }

    async function relayUserEvmLock(orderId: Hex32, terms: OrderTerms) {
      const request = await signRelayLockRequest({
        evmAdapter: solver.evmAdapter,
        orderId,
        terms,
        userAccount: userEvm,
      });
      const response = await solver.client.relayLock(orderId, request);
      expect(response.ok).toBe(true);
    }

    /** The user's own Bitcoin Cash lock, signed with the user's key. */
    function userBchLock(terms: OrderTerms): {
      txHex: string;
      txid: string;
      vout: number;
    } {
      const utxos = chain.rpc('blockchain.scripthash.listunspent', [
        scriptHashOf(userBch.lockingBytecode),
      ]) as unknown[];
      const built = buildLockTransaction({
        params: terms,
        utxos,
        changeAddress: addressOf(userBch.lockingBytecode),
        privateKey: userBch.privateKey,
        network: 'chipnet',
      });
      return {
        txHex: built.signed!.txHex,
        txid: built.signed!.txid,
        vout: built.htlcOutputIndex,
      };
    }

    function addressOf(lockingBytecode: Uint8Array): string {
      // A bchtest address for the p2pkh locking bytecode, via the lock builder's own helper.
      return deriveBchAddress(lockingBytecode);
    }

    function htlcUtxos(terms: OrderTerms) {
      return chain.utxosForScriptHash(
        scriptHashOf(covenantOf(terms).lockingBytecode),
      );
    }

    async function orderState(orderId: Hex32): Promise<string> {
      return (await solver.client.getOrder(orderId)).state;
    }

    /** One engine pass; a refused step is reported by the assertions, not thrown here. */
    /** The API reports a finished swap as DONE (the engine event is SWAP_COMPLETE). */
    const isComplete = (state: string): boolean =>
      state === 'DONE' || state === 'SWAP_COMPLETE';

    /** The API prefixes transaction ids with 0x; the chain does not. */
    const bare = (id: string | undefined): string =>
      (id ?? '').replace(/^0x/i, '');

    async function pumpQuietly(): Promise<void> {
      try {
        await solver.pump();
      } catch {
        // The assertions after the loop say what, if anything, went wrong.
      }
    }

    const balanceOf = (account: Address) =>
      pub.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [account],
      });

    // -- (a) forward: EVM to Bitcoin Cash ----------------------------------------

    it('forward swap: the solver locks with a transaction the chain verified, the user claims, the solver claims on EVM', async () => {
      const { secret, hashLock } = freshSecret();
      const first = await quoteForward(hashLock);
      const terms = first.terms as OrderTerms;
      fundBch(solverBch, terms, terms.bchTokenAmount * 5n);
      const { params, lockingBytecode } = covenantOf(terms);

      const userBefore = await balanceOf(userEvm.address);
      await relayUserEvmLock(first.orderId, terms);

      // The solver counter-locks on Bitcoin Cash.
      await solver.waitFor(
        'the solver lock on the simulated chain',
        () => htlcUtxos(terms).length === 1,
      );
      const lock = htlcUtxos(terms)[0]!;
      expect(chain.acceptedBroadcasts()).toContain(lock.txid);
      expect(lock.output.token?.amount).toBe(terms.bchTokenAmount);
      expect(lock.output.valueSatoshis).toBe(terms.bchCarrySats);

      // The order records exactly that transaction, not a placeholder.
      await solver.waitFor('the order to record the lock', async () => {
        const status = await solver.client.getOrder(first.orderId);
        return bare(status.txids.bchLock) === lock.txid;
      });
      expect(await solver.engine.bchPort.isOnChain(lock.txid)).toBe(true);
      expect(await solver.engine.bchPort.isOnChain(`${'ab'.repeat(32)}`)).toBe(
        false,
      );

      // The user claims on Bitcoin Cash, revealing the secret.
      chain.mine();
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
      const claimId = chain.broadcast(claim.txHex);
      expect(chain.secretRevealedBy(claimId, hashLock)).toBe(secret);

      // The solver reads the secret from that spend and claims on EVM.
      const evmLock = evmLockId(userEvm.address, hashLock);
      await solver.waitFor(
        'the solver claim on EVM',
        async () =>
          (await solver.evmAdapter.getLock(evmLock)).status === 'claimed',
      );
      const claimed = await solver.evmAdapter.getLock(evmLock);
      expect(claimed.status === 'claimed' && claimed.secret).toBe(secret);
      await solver.waitFor('SWAP_COMPLETE', async () =>
        isComplete(await orderState(first.orderId)),
      );

      // Funds moved: the user paid on EVM and holds the tokens on Bitcoin Cash.
      expect(userBefore - (await balanceOf(userEvm.address))).toBe(
        terms.evmAmount,
      );
      expect(
        chain
          .utxosForScriptHash(scriptHashOf(userBch.lockingBytecode))
          .some((u) => u.output.token?.amount === terms.bchTokenAmount),
      ).toBe(true);
      expect(lockingBytecode.length).toBe(35);
    });

    // -- (b) reverse: Bitcoin Cash to EVM -----------------------------------------

    it('reverse swap: the user locks on Bitcoin Cash, the solver locks on EVM, the user claims, the solver claims the Bitcoin Cash lock', async () => {
      const { secret, hashLock } = freshSecret();
      const quote = await quoteReverse(hashLock);
      const terms = quote.terms as OrderTerms;
      fundBch(userBch, terms, terms.bchTokenAmount * 2n);
      const evmLock = evmLockId(solverEvmAddress(), hashLock);

      const userLock = userBchLock(terms);
      chain.broadcast(userLock.txHex);
      chain.mine();
      expect(htlcUtxos(terms)).toHaveLength(1);

      // The solver sees the lock, counter-locks on EVM.
      await solver.waitFor(
        'the solver lock on EVM',
        async () =>
          (await solver.evmAdapter.getLock(evmLock)).status === 'locked',
      );

      // The user claims on EVM from their own wallet, revealing the secret.
      const userBalBefore = await balanceOf(userEvm.address);
      const evmClaim = buildEvmClaimTransaction({
        htlc,
        lockId: evmLock,
        secret,
      });
      const hash = await userWallet.sendTransaction({
        to: evmClaim.to,
        data: evmClaim.data,
        account: userEvm,
        chain: anvil.chain,
      });
      await pub.waitForTransactionReceipt({ hash });
      expect((await balanceOf(userEvm.address)) - userBalBefore).toBe(
        terms.evmAmount,
      );

      // The solver claims the user's Bitcoin Cash lock with a verified spend.
      await solver.waitFor('the solver claim of the Bitcoin Cash lock', () =>
        chain.isSpent(userLock.txid, userLock.vout),
      );
      const spender = chain.spenderOf(userLock.txid, userLock.vout)!;
      expect(chain.acceptedBroadcasts()).toContain(spender);
      expect(chain.secretRevealedBy(spender, hashLock)).toBe(secret);
      expect(
        chain
          .utxosForScriptHash(scriptHashOf(solverBch.lockingBytecode))
          .some((u) => u.output.token?.amount === terms.bchTokenAmount),
      ).toBe(true);
      await solver.waitFor('SWAP_COMPLETE', async () =>
        isComplete(await orderState(quote.orderId)),
      );
    });

    // -- (c) send link --------------------------------------------------------------

    it('send link: the sender locks on Bitcoin Cash, the solver locks for the receiver, the receiver claims through the relay', async () => {
      const { secret, hashLock } = freshSecret();
      syncPrices();
      const quote = await solver.client.quoteSendLink({
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: token,
        amountIn: 1000n,
        recipientEvmAddress: receiverEvm.address,
        userEvmAddress: userEvm.address,
        userBchLockingBytecode: hex0x(userBch.lockingBytecode),
        hashLock,
        windowSeconds: 86_400,
        lane: 'safe',
      });
      solver.watch(quote.orderId);
      const terms = quote.terms as OrderTerms;
      fundBch(userBch, terms, terms.bchTokenAmount * 2n);

      const senderLock = userBchLock(terms);
      chain.broadcast(senderLock.txHex);
      chain.mine();
      const evmLock = evmLockId(solverEvmAddress(), hashLock);
      await solver.waitFor(
        'the solver lock for the receiver',
        async () =>
          (await solver.evmAdapter.getLock(evmLock)).status === 'locked',
      );
      const locked = await solver.evmAdapter.getLock(evmLock);
      expect(locked.status === 'locked' && locked.recipient.toLowerCase()).toBe(
        receiverEvm.address.toLowerCase(),
      );

      const receiverBefore = await balanceOf(receiverEvm.address);
      const relayed = await solver.client.relayClaim(quote.orderId, {
        secret,
        lockId: evmLock,
      });
      expect(relayed.ok).toBe(true);
      expect((await balanceOf(receiverEvm.address)) - receiverBefore).toBe(
        terms.evmAmount,
      );

      await solver.waitFor('the solver to claim the sender lock', () =>
        chain.isSpent(senderLock.txid, senderLock.vout),
      );
      expect(chain.acceptedBroadcasts()).toContain(
        chain.spenderOf(senderLock.txid, senderLock.vout),
      );
      const link = await solver.client.getSendLink(quote.orderId);
      expect(['claimed', 'locked']).toContain(link.status);
    });

    // -- (d) failure paths ------------------------------------------------------------

    it('the user never locks: nothing is broadcast or locked, and the order stays quoted', async () => {
      const { hashLock } = freshSecret();
      const quote = await quoteForward(hashLock);
      const terms = quote.terms as OrderTerms;
      fundBch(solverBch, terms, terms.bchTokenAmount * 2n);
      const broadcastsBefore = chain.acceptedBroadcasts().length;
      for (let i = 0; i < 5; i++) await pumpQuietly();
      expect(chain.acceptedBroadcasts().length).toBe(broadcastsBefore);
      expect(htlcUtxos(terms)).toHaveLength(0);
      expect(
        (await solver.evmAdapter.getLock(evmLockId(userEvm.address, hashLock)))
          .status,
      ).toBe('absent');
      expect(await orderState(quote.orderId)).toBe('QUOTED');
    });

    it('a solver restart between a broadcast and its recording adopts the lock instead of broadcasting twice', async () => {
      const { hashLock } = freshSecret();
      const quote = await quoteForward(hashLock);
      const terms = quote.terms as OrderTerms;
      fundBch(solverBch, terms, terms.bchTokenAmount * 2n);
      const acceptedBefore = chain.acceptedBroadcasts().length;

      // The next broadcast reaches the chain but its reply is lost.
      solver.faults.loseNextBroadcastReply = true;
      await relayUserEvmLock(quote.orderId, terms);
      await solver.waitFor(
        'the lock to reach the chain',
        () => htlcUtxos(terms).length === 1,
      );
      expect(solver.faults.loseNextBroadcastReply).toBe(false);
      const lockTxid = htlcUtxos(terms)[0]!.txid;

      // The process restarts before the broadcast was recorded as complete.
      await solver.restart();
      await solver.waitFor('the order to adopt the existing lock', async () => {
        const status = await solver.client.getOrder(quote.orderId);
        return bare(status.txids.bchLock) === lockTxid;
      });
      for (let i = 0; i < 3; i++) await pumpQuietly();

      const solverLocks = chain
        .acceptedBroadcasts()
        .slice(acceptedBefore)
        .filter(
          (txid) =>
            txid === lockTxid || htlcUtxos(terms).some((u) => u.txid === txid),
        );
      expect(solverLocks).toEqual([lockTxid]);
      expect(htlcUtxos(terms)).toHaveLength(1);
    });

    it('a reorg of the solver lock does not let the solver claim without the secret or lock twice', async () => {
      const { hashLock } = freshSecret();
      const quote = await quoteForward(hashLock);
      const terms = quote.terms as OrderTerms;
      fundBch(solverBch, terms, terms.bchTokenAmount * 3n);
      await relayUserEvmLock(quote.orderId, terms);
      await solver.waitFor(
        'the solver lock',
        () => htlcUtxos(terms).length === 1,
      );
      const lockTxid = htlcUtxos(terms)[0]!.txid;
      chain.mine();

      // The block holding the lock is reorged away and the transaction does not return.
      chain.disconnectBlocks(1);
      chain.evict(lockTxid);
      expect(htlcUtxos(terms)).toHaveLength(0);
      expect(await solver.engine.bchPort.isOnChain(lockTxid)).toBe(false);

      for (let i = 0; i < 6; i++) {
        try {
          await solver.pump();
        } catch {
          // The engine may refuse or retry; the invariants below are what matter.
        }
      }

      // The solver never claims the user's EVM funds without the secret, never has two
      // live locks, and whatever it broadcast again was accepted by the verifying chain.
      expect(
        (await solver.evmAdapter.getLock(evmLockId(userEvm.address, hashLock)))
          .status,
      ).toBe('locked');
      expect(htlcUtxos(terms).length).toBeLessThanOrEqual(1);
      expect(isComplete(await orderState(quote.orderId))).toBe(false);
      for (const utxo of htlcUtxos(terms)) {
        expect(chain.acceptedBroadcasts()).toContain(utxo.txid);
      }
    });

    it('the user claiming before the solver lock exists is refused by the chain and changes nothing', async () => {
      const { secret, hashLock } = freshSecret();
      const quote = await quoteForward(hashLock);
      const terms = quote.terms as OrderTerms;
      fundBch(solverBch, terms, terms.bchTokenAmount * 2n);
      const { params } = covenantOf(terms);

      // No lock exists yet, so there is nothing to spend.
      const claim = buildClaimTransaction({
        params,
        utxo: { txid: 'ab'.repeat(32), vout: 0, satoshis: terms.bchCarrySats },
        secret,
        network: 'chipnet',
      });
      expect(() => chain.broadcast(claim.txHex)).toThrow(/missingorspent/);
      for (let i = 0; i < 3; i++) await pumpQuietly();
      expect(
        (await solver.evmAdapter.getLock(evmLockId(userEvm.address, hashLock)))
          .status,
      ).toBe('absent');
      expect(htlcUtxos(terms)).toHaveLength(0);
    });

    it('the user claiming the solver lock while it is still unconfirmed still completes the swap, and only through a verified spend', async () => {
      const { secret, hashLock } = freshSecret();
      const quote = await quoteForward(hashLock);
      const terms = quote.terms as OrderTerms;
      fundBch(solverBch, terms, terms.bchTokenAmount * 2n);
      const { params } = covenantOf(terms);
      await relayUserEvmLock(quote.orderId, terms);
      await solver.waitFor(
        'the solver lock',
        () => htlcUtxos(terms).length === 1,
      );
      const lock = htlcUtxos(terms)[0]!;
      expect(lock.height).toBe(0);

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
      const claimId = chain.broadcast(claim.txHex);
      const evmLock = evmLockId(userEvm.address, hashLock);
      await solver.waitFor(
        'the solver claim on EVM',
        async () =>
          (await solver.evmAdapter.getLock(evmLock)).status === 'claimed',
      );
      // The secret the solver used is the one in that verified spend.
      const result = await solver.evmAdapter.getLock(evmLock);
      expect(result.status === 'claimed' && result.secret).toBe(
        chain.secretRevealedBy(claimId, hashLock),
      );
      expect(chain.acceptedBroadcasts()).toContain(claimId);
    });

    function solverEvmAddress(): Address {
      return privateKeyToAccount(SOLVER_KEY).address;
    }
  },
);

// A bchtest cash address for a p2pkh locking bytecode.
function deriveBchAddress(lockingBytecode: Uint8Array): string {
  const result = lockingBytecodeToCashAddress({
    bytecode: lockingBytecode,
    prefix: 'bchtest',
    tokenSupport: false,
  });
  if (typeof result === 'string') throw new Error(result);
  return result.address;
}
