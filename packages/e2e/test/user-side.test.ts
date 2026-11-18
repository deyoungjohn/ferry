import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseSignature,
  sha256,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmLockId } from '@ferry/core';
import type { Hex32, OrderTerms, RelayLockRequest } from '@ferry/core';
import type { QuoteResponse } from '@ferry/core/api';
import {
  buildClaimTransaction,
  buildLockIntentTypedData,
  buildOrderPermitTypedData,
  buildRefundTransaction,
  getUserLockStatus,
  prepareApproveAndLock,
  readPermitNonce,
} from '@ferry/chain-evm/browser';
import {
  DEPLOYER_KEY,
  SOLVER_KEY,
  USER_BCH_LOCKING_BYTECODE,
  USER_KEY,
  deployArtifact,
  deployFerryHtlcDeterministic,
  startAnvil,
  startInProcessSolver,
} from './harness.js';
import type { AnvilInstance, InProcessSolverHarness } from './harness.js';

const RUN_E2E = process.env['FERRY_RUN_E2E'] === '1';
const EXPLORER = 'https://basescan.org';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function name() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]);

// The wallet side of the flow, built only from the browser entry and driven
// against the in-process solver through its client.
describe.skipIf(!RUN_E2E)('User-wallet flow through the browser entry', () => {
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const solverAccount = privateKeyToAccount(SOLVER_KEY);
  const userAccount = privateKeyToAccount(USER_KEY);

  let anvil: AnvilInstance;
  let pub: PublicClient;
  let userWallet: WalletClient;
  let htlc: Address;
  let token: Address;
  let solver: InProcessSolverHarness;

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
      account: userAccount,
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
    for (const target of [userAccount.address, solverAccount.address]) {
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
    solver = await startInProcessSolver({
      rpcUrl: anvil.rpcUrl,
      chain: anvil.chain,
      htlcAddress: htlc,
      tokenAddress: token,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  });

  afterAll(async () => {
    await solver?.stop();
    await anvil?.stop();
  });

  function freshSecret(seed: string): { secret: Hex32; hashLock: Hex32 } {
    const secret = `0x${seed.repeat(32)}` as Hex32;
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

  async function quote(
    direction: 'EVM_TO_BCH' | 'BCH_TO_EVM',
    amountIn: bigint,
    hashLock: Hex32,
  ): Promise<QuoteResponse> {
    syncPrices();
    return solver.client.quote({
      direction,
      token: 'PUSD',
      chainId: anvil.chainId,
      evmToken: token,
      amountIn,
      userEvmAddress: userAccount.address,
      userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
      hashLock,
      lane: 'safe',
    });
  }

  const balanceOf = (account: Address) =>
    pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [account],
    });

  async function signedRelayRequest(
    orderId: Hex,
    terms: OrderTerms,
  ): Promise<RelayLockRequest> {
    const facts = {
      address: token,
      name: await pub.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'name',
      }),
      version: '1',
      domainSeparator: await pub.readContract({
        address: token,
        abi: tokenAbi,
        functionName: 'DOMAIN_SEPARATOR',
      }),
      permit: true,
    };
    const nonce = await readPermitNonce(pub, token, userAccount.address);
    const permit = buildOrderPermitTypedData(terms, facts, nonce);
    if (permit === null) throw new Error('expected a permit token');
    const intentSig = await userAccount.signTypedData(
      buildLockIntentTypedData(terms),
    );
    const { r, s, v, yParity } = parseSignature(
      await userAccount.signTypedData(permit),
    );
    return {
      permit: {
        value: terms.evmAmount,
        deadline: Number(permit.message.deadline),
        v: Number(v ?? (yParity === 0 ? 27n : 28n)),
        r,
        s,
      },
      intent: {
        orderId,
        deadline: Number(permit.message.deadline),
      },
      signature: intentSig,
    };
  }

  async function sendFromUser(tx: { to: Address; data: Hex }): Promise<void> {
    const hash = await userWallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      account: userAccount,
      chain: anvil.chain,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');
  }

  it('forward with permit: signed by the builders, relayed by the solver, claimed', async () => {
    const { secret, hashLock } = freshSecret('51');
    const q = await quote('EVM_TO_BCH', 10_000_000n, hashLock);
    const terms = q.terms as OrderTerms;
    const before = await balanceOf(userAccount.address);

    const relay = await solver.client.relayLock(
      q.orderId,
      await signedRelayRequest(q.orderId, terms),
    );
    expect(relay.ok).toBe(true);

    const lockId = evmLockId(userAccount.address, hashLock);
    const open = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: EXPLORER,
      fromBlock: 0n,
    });
    expect(open.state).toBe('open');
    expect(open.locked?.txHash).toBe(relay.txHash);

    expect((await solver.client.revealSecret(q.orderId, secret)).ok).toBe(true);
    const claim = await solver.client.relayClaim(q.orderId, { secret, lockId });
    expect(claim.ok).toBe(true);

    const after = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: EXPLORER,
      fromBlock: 0n,
    });
    expect(after.state).toBe('claimed');
    expect(after.secret).toBe(secret);
    expect(before - (await balanceOf(userAccount.address))).toBe(
      terms.evmAmount,
    );
  });

  it('forward without permit: approve and lock from the wallet, then the solver claims', async () => {
    const { secret, hashLock } = freshSecret('52');
    const q = await quote('EVM_TO_BCH', 10_000_000n, hashLock);
    const terms = q.terms as OrderTerms;

    const plan = await prepareApproveAndLock({ client: pub, terms });
    expect(plan.map((t) => t.kind)).toEqual(['approve', 'lock']);
    for (const tx of plan) await sendFromUser(tx);

    const lockId = evmLockId(userAccount.address, hashLock);
    expect((await solver.evmAdapter.getLock(lockId)).status).toBe('locked');
    expect((await solver.client.revealSecret(q.orderId, secret)).ok).toBe(true);
    const claim = await solver.client.relayClaim(q.orderId, { secret, lockId });
    expect(claim.ok).toBe(true);

    const status = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: EXPLORER,
      fromBlock: 0n,
    });
    expect(status.state).toBe('claimed');
    expect(status.secret).toBe(secret);
  });

  it('reverse: the user claims the solver lock from their own wallet', async () => {
    const { secret, hashLock } = freshSecret('53');
    const q = await quote('BCH_TO_EVM', 1_000n, hashLock);
    const terms = q.terms as OrderTerms;
    await solver.evmAdapter.lock(terms);
    expect((await solver.client.revealSecret(q.orderId, secret)).ok).toBe(true);

    const lockId = evmLockId(solverAccount.address, hashLock);
    const before = await balanceOf(userAccount.address);
    await sendFromUser(buildClaimTransaction({ htlc, lockId, secret }));
    expect((await balanceOf(userAccount.address)) - before).toBe(
      terms.evmAmount,
    );
    const status = await getUserLockStatus({
      client: pub,
      htlc,
      lockId,
      explorerUrl: EXPLORER,
      fromBlock: 0n,
    });
    expect(status.state).toBe('claimed');
  });

  it('refund: the user refunds an expired lock from their own wallet', async () => {
    const snap = await anvil.snapshot();
    try {
      const { hashLock } = freshSecret('54');
      const q = await quote('EVM_TO_BCH', 5_000_000n, hashLock);
      const terms = q.terms as OrderTerms;
      const relay = await solver.client.relayLock(
        q.orderId,
        await signedRelayRequest(q.orderId, terms),
      );
      expect(relay.ok).toBe(true);
      const lockId = evmLockId(userAccount.address, hashLock);

      const latest = await pub.getBlock({ blockTag: 'latest' });
      await anvil.increaseTimeAndMine(
        Math.max(terms.evmDeadline - Number(latest.timestamp) + 10, 1),
      );
      expect(
        (
          await getUserLockStatus({
            client: pub,
            htlc,
            lockId,
            explorerUrl: EXPLORER,
            fromBlock: 0n,
          })
        ).state,
      ).toBe('expired');

      const before = await balanceOf(userAccount.address);
      await sendFromUser(buildRefundTransaction({ htlc, lockId }));
      expect((await balanceOf(userAccount.address)) - before).toBe(
        terms.evmAmount,
      );
      expect(
        (
          await getUserLockStatus({
            client: pub,
            htlc,
            lockId,
            explorerUrl: EXPLORER,
            fromBlock: 0n,
          })
        ).state,
      ).toBe('refunded');
    } finally {
      await anvil.revert(snap);
    }
  });
});
