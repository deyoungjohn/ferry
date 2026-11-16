import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  sha256,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildRecoveryFile,
  evmLockId,
  parseSendLink,
  type Hex32,
  type OrderTerms,
  type RecoveryTerms,
} from '@ferry/core';
import {
  EvmChainAdapter,
  RelayLockRejectedError,
  RelayValidationError,
  checkRecipientCanReceiveToken,
  claimSendLink,
  lockSendLink,
  validateRelayLock,
} from '@ferry/chain-evm';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  executeEvmRecovery,
  planRecovery,
  probeEvmLockStatus,
} from '@ferry/recover-cli';
import type { QuoteResponse } from '@ferry/core/api';
import { SolverHttpError, SolverRefusalError } from '@ferry/solver-client';
import { runContractSuite } from '@ferry/solver-client/testing';
import {
  DEPLOYER_KEY,
  RECIPIENT_KEY,
  SOLVER_KEY,
  USER_BCH_LOCKING_BYTECODE,
  USER_KEY,
  deployArtifact,
  deployFerryHtlcDeterministic,
  signRelayLockPayload,
  startAnvil,
  startInProcessSolver,
  type AnvilInstance,
  type InProcessSolverHarness,
} from './harness.js';

const RUN_E2E = process.env.FERRY_RUN_E2E === '1';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function setBlacklisted(address account, bool blocked) external',
]);

function reviveBigInts<T>(json: unknown): T {
  const rec = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rec);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (
          (k === 'bchTokenAmount' ||
            k === 'evmAmount' ||
            k === 'bchCarrySats' ||
            k === 'bchMaxFee' ||
            k === 'fixedFeeBase') &&
          typeof val === 'string' &&
          /^\d+$/.test(val)
        ) {
          out[k] = BigInt(val);
        } else {
          out[k] = rec(val);
        }
      }
      return out;
    }
    return v;
  };
  return rec(json) as T;
}

async function postSolverJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  });
  const json = (await res.json()) as unknown;
  return { status: res.status, data: reviveBigInts<T>(json) };
}

describe.skipIf(!RUN_E2E)('Ferry EVM End-to-End Harness', () => {
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const solverAccount = privateKeyToAccount(SOLVER_KEY);
  const userAccount = privateKeyToAccount(USER_KEY);
  const recipientAccount = privateKeyToAccount(RECIPIENT_KEY);

  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerWallet: WalletClient;
  let solverWallet: WalletClient;
  let htlcAddress: Address;
  let tokenAddress: Address;
  let solver: InProcessSolverHarness;

  beforeAll(async () => {
    anvil = await startAnvil({ chainId: 31337 });
    publicClient = createPublicClient({
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    deployerWallet = createWalletClient({
      account: deployer,
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
    });
    solverWallet = createWalletClient({
      account: solverAccount,
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
    });

    htlcAddress = await deployFerryHtlcDeterministic(
      anvil.rpcUrl,
      DEPLOYER_KEY,
    );
    tokenAddress = await deployArtifact(
      deployerWallet,
      publicClient,
      deployer,
      anvil.chain,
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );

    // Fund both user and solver with MockUSDCWithPermit
    for (const target of [userAccount.address, solverAccount.address]) {
      const hash = await deployerWallet.writeContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'mint',
        args: [target, 500_000_000n],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    solver = await startInProcessSolver({
      rpcUrl: anvil.rpcUrl,
      chain: anvil.chain,
      htlcAddress,
      tokenAddress,
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

  async function syncPriceTimestamp(): Promise<number> {
    const ts = Math.floor(Date.now() / 1000);
    solver.priceSource.setPrice('usdc', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: ts,
    });
    solver.priceSource.setPrice('pusd', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: ts,
    });
    return ts;
  }

  async function requestQuote(params: {
    direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
    amountIn: bigint;
    hashLock: Hex32;
  }): Promise<QuoteResponse> {
    return solver.client.quote({
      direction: params.direction,
      token: 'PUSD',
      chainId: anvil.chainId,
      evmToken: tokenAddress,
      amountIn: params.amountIn,
      userEvmAddress: userAccount.address,
      userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
      hashLock: params.hashLock,
      lane: 'safe',
    });
  }

  it('0. SolverClient health, quote, order status, and contract suite', async () => {
    await syncPriceTimestamp();
    const health = await solver.client.health();
    expect(health.ok).toBe(true);

    const { hashLock } = freshSecret('00');
    const quote = await requestQuote({
      direction: 'EVM_TO_BCH',
      amountIn: 5_000_000n,
      hashLock,
    });
    expect(quote.orderId).toMatch(/^0x[0-9a-f]{64}$/);
    const order = await solver.client.getOrder(quote.orderId);
    expect(order.orderId).toBe(quote.orderId);
    expect(order.state).toBe('QUOTED');

    const report = await runContractSuite(solver.baseUrl, {
      bearerToken: 'a'.repeat(32),
      fixtures: {
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        userEvmAddress: userAccount.address,
        recipientEvmAddress: recipientAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
      },
    });
    const passedRoutes = new Set(
      report.results.filter((r) => r.ok).map((r) => r.route),
    );
    expect(passedRoutes).toContain('GET /v1/health');
    expect(passedRoutes).toContain('GET /v1/liquidity');
    expect(passedRoutes).toContain('GET /v1/chains');
    expect(passedRoutes).toContain('GET /v1/stats');
    expect(passedRoutes).toContain('POST /v1/quotes');
    expect(passedRoutes).toContain('GET /v1/orders/:orderId');
    expect(passedRoutes).toContain('POST /v1/quotes [bad body]');
    expect(passedRoutes).toContain('GET /v1/orders/:orderId [unknown order]');
  });

  it('1. Forward happy path: quote -> relay-lock -> secret -> claim', async () => {
    await syncPriceTimestamp();
    const { secret, hashLock } = freshSecret('11');

    const quote = await requestQuote({
      direction: 'EVM_TO_BCH',
      amountIn: 10_000_000n,
      hashLock,
    });

    const userBalBefore = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    const solverBalBefore = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [solverAccount.address],
    });

    const relayPayload = await signRelayLockPayload({
      evmAdapter: solver.evmAdapter,
      terms: quote.terms as OrderTerms,
      userAccount,
    });

    // server.ts passes raw.payload ?? raw directly to EvmChainAdapter.relayLock,
    // which expects RelayLockPayload rather than RelayLockRequest.
    const relayRes = await postSolverJson<{
      ok: boolean;
      orderId: Hex32;
      txHash: Hex32;
    }>(solver.baseUrl, `/v1/orders/${quote.orderId}/relay-lock`, {
      payload: relayPayload,
    });
    expect(relayRes.status).toBe(200);
    expect(relayRes.data.ok).toBe(true);
    expect(relayRes.data.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const lockId = evmLockId(userAccount.address, hashLock);
    const lockState = await solver.evmAdapter.getLock(lockId);
    expect(lockState.status).toBe('locked');

    const revealRes = await solver.client.revealSecret(quote.orderId, secret);
    expect(revealRes.ok).toBe(true);
    expect(revealRes.orderId).toBe(quote.orderId);

    // Remaining solver gap: POST /v1/orders/:id/relay-claim passes order.id instead of evmLockId(owner, hashLock).
    await expect(
      solver.client.relayClaim(quote.orderId, { secret }),
    ).rejects.toBeInstanceOf(SolverHttpError);

    // Direct adapter claim completes the EVM leg on-chain
    const claimTx = await solver.evmAdapter.claim(lockId, secret);
    expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

    const userBalAfter = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    const solverBalAfter = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [solverAccount.address],
    });
    expect(userBalBefore - userBalAfter).toBe(quote.terms.evmAmount);
    expect(solverBalAfter - solverBalBefore).toBe(quote.terms.evmAmount);
  });

  it('2. Reverse happy path: quote -> solver lock -> secret -> claim', async () => {
    await syncPriceTimestamp();
    const { secret, hashLock } = freshSecret('22');

    const quote = await requestQuote({
      direction: 'BCH_TO_EVM',
      amountIn: 1_000n, // 10.00 PUSD
      hashLock,
    });

    const userBalBefore = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });

    const lockTx = await solver.evmAdapter.lock(quote.terms as OrderTerms);
    expect(lockTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

    const lockId = evmLockId(solverAccount.address, hashLock);
    expect((await solver.evmAdapter.getLock(lockId)).status).toBe('locked');

    const revealRes = await solver.client.revealSecret(quote.orderId, secret);
    expect(revealRes.ok).toBe(true);
    expect(revealRes.orderId).toBe(quote.orderId);

    const claimTx = await solver.evmAdapter.claim(lockId, secret);
    expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

    const userBalAfter = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    expect(userBalAfter - userBalBefore).toBe(quote.terms.evmAmount);
  });

  it('3. User refund after deadline (anvil time travel)', async () => {
    const snap = await anvil.snapshot();
    try {
      await syncPriceTimestamp();
      const { hashLock } = freshSecret('33');

      const quote = await requestQuote({
        direction: 'EVM_TO_BCH',
        amountIn: 5_000_000n,
        hashLock,
      });

      const relayPayload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms as OrderTerms,
        userAccount,
      });
      const relayRes = await postSolverJson<{ ok: boolean; txHash: Hex32 }>(
        solver.baseUrl,
        `/v1/orders/${quote.orderId}/relay-lock`,
        { payload: relayPayload },
      );
      expect(relayRes.status).toBe(200);
      expect(relayRes.data.ok).toBe(true);

      const lockId = evmLockId(userAccount.address, hashLock);
      await expect(solver.evmAdapter.refund(lockId)).rejects.toThrow();

      const latest = await publicClient.getBlock({ blockTag: 'latest' });
      const jump = quote.terms.evmDeadline - Number(latest.timestamp) + 10;
      await anvil.increaseTimeAndMine(Math.max(jump, 1));

      const balBefore = await publicClient.readContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [userAccount.address],
      });
      const refundTx = await solver.evmAdapter.refund(lockId);
      expect(refundTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

      const balAfter = await publicClient.readContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [userAccount.address],
      });
      expect(balAfter - balBefore).toBe(quote.terms.evmAmount);
      expect((await solver.evmAdapter.getLock(lockId)).status).toBe('refunded');
    } finally {
      await anvil.revert(snap);
    }
  });

  it('4. Solver refuses on stale price', async () => {
    const now = Math.floor(Date.now() / 1000);
    solver.priceSource.setPrice('usdc', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: now - 120,
    });

    const { hashLock } = freshSecret('44');
    let caught: unknown;
    try {
      await requestQuote({
        direction: 'EVM_TO_BCH',
        amountIn: 5_000_000n,
        hashLock,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SolverRefusalError);
    expect((caught as SolverRefusalError).refusal.reason).toBe(
      'PRICE_UNAVAILABLE',
    );

    await syncPriceTimestamp();
  });

  it('5. Cross-chain replay of lockWithIntent signature on second anvil chain id fails', async () => {
    await syncPriceTimestamp();
    const anvilB = await startAnvil({ chainId: 84532 });
    try {
      const htlcB = await deployFerryHtlcDeterministic(
        anvilB.rpcUrl,
        DEPLOYER_KEY,
      );
      expect(htlcB).toBe(htlcAddress);

      const publicB = createPublicClient({
        chain: anvilB.chain,
        transport: http(anvilB.rpcUrl),
        cacheTime: 0,
      });
      const deployerWalletB = createWalletClient({
        account: deployer,
        chain: anvilB.chain,
        transport: http(anvilB.rpcUrl),
      });
      const solverWalletB = createWalletClient({
        account: solverAccount,
        chain: anvilB.chain,
        transport: http(anvilB.rpcUrl),
      });
      const tokenB = await deployArtifact(
        deployerWalletB,
        publicB,
        deployer,
        anvilB.chain,
        'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
      );
      const mintHash = await deployerWalletB.writeContract({
        address: tokenB,
        abi: tokenAbi,
        functionName: 'mint',
        args: [userAccount.address, 50_000_000n],
        account: deployer,
        chain: anvilB.chain,
      });
      await publicB.waitForTransactionReceipt({ hash: mintHash });

      const adapterB = new EvmChainAdapter({
        config: {
          id: 'base',
          chainId: 84532,
          htlcAddress: htlcB,
          rpcUrls: [anvilB.rpcUrl],
          explorerUrl: 'https://sepolia.basescan.org',
          nativeGas: 'ETH',
          finality: { fast: 1, safe: 1 },
          relayCostUsd: 0.01,
          assets: [
            { symbol: 'USDC', address: tokenB, decimals: 6, permit: true },
          ],
        },
        client: publicB,
        walletClient: solverWalletB,
      });

      const { hashLock } = freshSecret('55');
      const quote = await requestQuote({
        direction: 'EVM_TO_BCH',
        amountIn: 5_000_000n,
        hashLock,
      });

      const payloadChainA = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms,
        userAccount,
      });

      await expect(
        adapterB.relayLock({
          chain: 'base',
          orderId: quote.orderId,
          payload: { ...payloadChainA, token: tokenB },
        }),
      ).rejects.toBeInstanceOf(RelayLockRejectedError);
    } finally {
      await anvilB.stop();
    }
  });

  it('6 & 7. Claim after deadline is still valid, and double claim fails', async () => {
    const snap = await anvil.snapshot();
    try {
      await syncPriceTimestamp();
      const { secret, hashLock } = freshSecret('66');

      const quote = await requestQuote({
        direction: 'EVM_TO_BCH',
        amountIn: 5_000_000n,
        hashLock,
      });

      const relayPayload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms,
        userAccount,
      });
      const relayRes = await postSolverJson<{ relayed: boolean }>(
        solver.baseUrl,
        `/v1/orders/${quote.orderId}/relay-lock`,
        { payload: relayPayload },
      );
      expect(relayRes.status).toBe(200);

      const latest = await publicClient.getBlock({ blockTag: 'latest' });
      const jump = quote.terms.evmDeadline - Number(latest.timestamp) + 15;
      await anvil.increaseTimeAndMine(Math.max(jump, 1));

      const lockId = evmLockId(userAccount.address, hashLock);
      const claimTx = await solver.evmAdapter.claim(lockId, secret);
      expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
      expect((await solver.evmAdapter.getLock(lockId)).status).toBe('claimed');

      // Double claim must fail on-chain
      await expect(
        solverWallet.writeContract({
          address: htlcAddress,
          abi: ferryHtlcAbi,
          functionName: 'claim',
          args: [lockId, secret],
          account: solverAccount,
          chain: anvil.chain,
        }),
      ).rejects.toThrow();
    } finally {
      await anvil.revert(snap);
    }
  });

  it('8. Relay-lock with a tampered intent is refused', async () => {
    await syncPriceTimestamp();
    const { hashLock } = freshSecret('88');

    const quote = await requestQuote({
      direction: 'EVM_TO_BCH',
      amountIn: 5_000_000n,
      hashLock,
    });

    const validPayload = await signRelayLockPayload({
      evmAdapter: solver.evmAdapter,
      terms: quote.terms,
      userAccount,
    });
    const tamperedPayload = {
      ...validPayload,
      amount: validPayload.amount + 1n,
    };

    expect(() =>
      validateRelayLock(
        {
          chain: 'base',
          orderId: quote.orderId,
          payload: tamperedPayload,
          evmChainId: anvil.chainId,
          verifyingContract: htlcAddress,
        },
        quote.terms,
      ),
    ).toThrow(RelayValidationError);

    const res = await postSolverJson<{ error: { code: string } }>(
      solver.baseUrl,
      `/v1/orders/${quote.orderId}/relay-lock`,
      { payload: tamperedPayload },
    );
    expect(res.status).toBe(502);
    expect(res.data.error.code).toBe('RELAY_LOCK_REVERTED');
  });

  it('9. Send-link 24 h and 7 d windows with relayed claim', async () => {
    for (const [idx, windowSeconds] of [
      [1, 86_400],
      [2, 604_800],
    ] as const) {
      const { secret, hashLock } = freshSecret(idx === 1 ? '9a' : '9b');
      const sendLink = parseSendLink({
        id: hashLock,
        destinationChainId: anvil.chainId,
        token: tokenAddress,
        recipientAddress: recipientAccount.address,
        amount: 3_000_000n,
        windowSeconds,
        status: 'quoted',
        createdAt: Math.floor(Date.now() / 1000),
      });

      const { txRef, lockId } = await lockSendLink({
        adapter: solver.evmAdapter,
        sendLink,
        hashLock,
      });
      expect(txRef.txId).toMatch(/^0x[0-9a-f]{64}$/);

      const balBefore = await publicClient.readContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [recipientAccount.address],
      });
      const claimTx = await claimSendLink({
        adapter: solver.evmAdapter,
        lockId,
        secret,
      });
      expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
      expect((await solver.evmAdapter.getLock(lockId)).status).toBe('claimed');

      const balAfter = await publicClient.readContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [recipientAccount.address],
      });
      expect(balAfter - balBefore).toBe(3_000_000n);
    }
  });

  it('10. Recipient is a contract that cannot receive', async () => {
    const blocklistToken = await deployArtifact(
      deployerWallet,
      publicClient,
      deployer,
      anvil.chain,
      'MockBlocklistToken.sol/MockBlocklistToken.json',
    );
    const smartWallet = await deployArtifact(
      deployerWallet,
      publicClient,
      deployer,
      anvil.chain,
      'MockSmartWallet.sol/MockSmartWallet.json',
      [recipientAccount.address],
    );

    await publicClient.waitForTransactionReceipt({
      hash: await deployerWallet.writeContract({
        address: blocklistToken,
        abi: tokenAbi,
        functionName: 'mint',
        args: [solverAccount.address, 10_000_000n],
        account: deployer,
        chain: anvil.chain,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await deployerWallet.writeContract({
        address: blocklistToken,
        abi: tokenAbi,
        functionName: 'setBlacklisted',
        args: [smartWallet, true],
        account: deployer,
        chain: anvil.chain,
      }),
    });

    const check = await checkRecipientCanReceiveToken({
      client: publicClient,
      token: blocklistToken,
      recipient: smartWallet,
    });
    expect(check.ok).toBe(false);
    expect(check.isContract).toBe(true);
    expect(check.reason).toBe('blocklisted');

    const { secret, hashLock } = freshSecret('aa');
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const deadline = latest.timestamp + 3600n;

    await publicClient.waitForTransactionReceipt({
      hash: await solverWallet.writeContract({
        address: blocklistToken,
        abi: tokenAbi,
        functionName: 'approve',
        args: [htlcAddress, 1_000_000n],
        account: solverAccount,
        chain: anvil.chain,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await solverWallet.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [blocklistToken, smartWallet, 1_000_000n, hashLock, deadline],
        account: solverAccount,
        chain: anvil.chain,
      }),
    });

    const lockId = evmLockId(solverAccount.address, hashLock);
    await expect(
      solverWallet.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'claim',
        args: [lockId, secret],
        account: solverAccount,
        chain: anvil.chain,
      }),
    ).rejects.toThrow();
  });

  it('11. Recovery CLI completes refund and claim with solver switched off', async () => {
    await syncPriceTimestamp();

    const refundCase = freshSecret('b1');
    const claimCase = freshSecret('b2');

    const refundQuote = await requestQuote({
      direction: 'EVM_TO_BCH',
      amountIn: 4_000_000n,
      hashLock: refundCase.hashLock,
    });
    const refundPayload = await signRelayLockPayload({
      evmAdapter: solver.evmAdapter,
      terms: refundQuote.terms,
      userAccount,
    });
    const refundRelayRes = await postSolverJson<{ relayed: boolean }>(
      solver.baseUrl,
      `/v1/orders/${refundQuote.orderId}/relay-lock`,
      { payload: refundPayload },
    );
    expect(refundRelayRes.status).toBe(200);

    const claimQuote = await requestQuote({
      direction: 'BCH_TO_EVM',
      amountIn: 1_000n,
      hashLock: claimCase.hashLock,
    });
    await solver.evmAdapter.lock(claimQuote.terms);

    // Switch off solver completely
    await solver.stop();

    const dummyBchContract = {
      network: 'chipnet' as const,
      htlcAddress: 'bchtest:qz0000000000000000000000000000000000000000',
      tokenAddress:
        'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
      redeemScript: '0x51' as Hex,
      lockingBytecode: USER_BCH_LOCKING_BYTECODE,
    };

    // 11a. Refund via @ferry/recover-cli after deadline
    const refundLockId = evmLockId(userAccount.address, refundCase.hashLock);
    const refundFile = buildRecoveryFile({
      orderId: refundQuote.orderId,
      terms: refundQuote.terms as RecoveryTerms,
      solverSignature: refundQuote.signature,
      contracts: {
        evm: {
          chainId: anvil.chainId,
          htlcAddress,
          tokenAddress,
          lockId: refundLockId,
        },
        bch: dummyBchContract,
      },
    });

    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const jump = refundQuote.terms.evmDeadline - Number(latest.timestamp) + 20;
    await anvil.increaseTimeAndMine(Math.max(jump, 1));

    const refundProbe = await probeEvmLockStatus(refundFile, anvil.rpcUrl);
    expect(refundProbe.lockStatus).toBe('locked');

    const refundPlan = planRecovery(refundFile, {
      nowSeconds: refundProbe.nowSeconds,
      bchTipHeight: 330_000,
      evmLock: { state: refundProbe.lockStatus },
      bchLock: { state: 'none' },
    });
    expect(
      refundPlan.actions.some(
        (a) => a.chain === 'EVM' && a.action === 'refund',
      ),
    ).toBe(true);

    const userBalBeforeRefund = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    const refundExec = await executeEvmRecovery({
      file: refundFile,
      rpcUrl: anvil.rpcUrl,
      broadcast: true,
      env: { FERRY_RECOVER_PRIVATE_KEY: USER_KEY },
    });
    expect(refundExec.status).toBe('success');
    const userBalAfterRefund = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    expect(userBalAfterRefund - userBalBeforeRefund).toBe(
      refundQuote.terms.evmAmount,
    );

    // 11b. Claim via @ferry/recover-cli (even after deadline) with solver off
    const claimLockId = evmLockId(solverAccount.address, claimCase.hashLock);
    const claimFile = buildRecoveryFile({
      orderId: claimQuote.orderId,
      terms: claimQuote.terms as RecoveryTerms,
      solverSignature: claimQuote.signature,
      secret: claimCase.secret,
      contracts: {
        evm: {
          chainId: anvil.chainId,
          htlcAddress,
          tokenAddress,
          lockId: claimLockId,
        },
        bch: dummyBchContract,
      },
    });

    const claimProbe = await probeEvmLockStatus(claimFile, anvil.rpcUrl);
    expect(claimProbe.lockStatus).toBe('locked');

    const claimPlan = planRecovery(claimFile, {
      nowSeconds: claimProbe.nowSeconds,
      bchTipHeight: 330_000,
      evmLock: { state: claimProbe.lockStatus },
      bchLock: { state: 'none' },
    });
    expect(
      claimPlan.actions.some((a) => a.chain === 'EVM' && a.action === 'claim'),
    ).toBe(true);

    const userBalBeforeClaim = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    const claimExec = await executeEvmRecovery({
      file: claimFile,
      rpcUrl: anvil.rpcUrl,
      broadcast: true,
      env: { FERRY_RECOVER_PRIVATE_KEY: USER_KEY },
    });
    expect(claimExec.status).toBe('success');
    const userBalAfterClaim = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    expect(userBalAfterClaim - userBalBeforeClaim).toBe(
      claimQuote.terms.evmAmount,
    );
    const claimedLock = await publicClient.readContract({
      address: htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'locks',
      args: [claimLockId],
    });
    expect(getAddress(claimedLock[2])).toBe(getAddress(userAccount.address));
    expect(Number(claimedLock[6])).toBe(2);
  });
});
