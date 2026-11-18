import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex32, OrderTerms } from '@ferry/core';
import { lockSendLink } from '@ferry/chain-evm';
import {
  DEPLOYER_KEY,
  RECIPIENT_KEY,
  SOLVER_KEY,
  USER_BCH_LOCKING_BYTECODE,
  deployArtifact,
  deployFerryHtlcDeterministic,
  startAnvil,
  startInProcessSolver,
  type AnvilInstance,
  type InProcessSolverHarness,
} from './harness.js';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
]);

describe('Send Link End-to-End Flow on Local Harness (B4-12)', () => {
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const solverAccount = privateKeyToAccount(SOLVER_KEY);
  const recipientAccount = privateKeyToAccount(RECIPIENT_KEY);

  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerWallet: WalletClient;
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

    // Fund solver with MockUSDC so solver can lock on EVM for receiver
    const mintTx = await deployerWallet.writeContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'mint',
      args: [solverAccount.address, 50_000_000_000n],
      account: deployer,
      chain: anvil.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: mintTx });

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

  it('completes the full send link lifecycle end-to-end via HTTP API', async () => {
    const rawSecret = '0x' + '77'.repeat(32);
    const secret = rawSecret as Hex32;
    const hashLock = sha256(secret) as Hex32;
    const note = 'Coffee and pastry';

    // 1. POST /v1/send-quotes with note and windowSeconds (24h)
    const quoteRes = await fetch(`${solver.baseUrl}/v1/send-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: '1000000', // 10.00 PUSD
        recipientEvmAddress: recipientAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        windowSeconds: 86400, // 24 hours (1h-7d range)
        note,
      }),
    });

    expect(quoteRes.status).toBe(200);
    const quoteData = (await quoteRes.json()) as {
      orderId: Hex32;
      terms: OrderTerms;
      signature: Hex;
      signerAddress: Hex;
    };

    expect(quoteData.orderId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(quoteData.terms.evmAmount).toBeDefined();
    const orderId = quoteData.orderId;

    // 2. GET /v1/send-links/:id -> status is pending_lock
    const linkRes1 = await fetch(`${solver.baseUrl}/v1/send-links/${orderId}`);
    expect(linkRes1.status).toBe(200);
    const linkData1 = (await linkRes1.json()) as {
      status: string;
      note?: string;
      recipientEvmAddress: string;
      amountIn: string;
      amountOut: string;
    };
    expect(linkData1.status).toBe('pending_lock');
    expect(linkData1.note).toBe(note);
    expect(linkData1.recipientEvmAddress.toLowerCase()).toBe(
      recipientAccount.address.toLowerCase(),
    );

    // 3. User BCH lock detected -> status becomes locked
    const order = solver.db.getOrder(orderId);
    expect(order).toBeDefined();
    order!.status = 'USER_LOCK_SEEN';
    order!.updatedAt = Math.floor(Date.now() / 1000);
    solver.db.saveOrder(order!);

    const linkRes2 = await fetch(`${solver.baseUrl}/v1/send-links/${orderId}`);
    expect(((await linkRes2.json()) as { status: string }).status).toBe(
      'locked',
    );

    // 4. Solver locks on EVM for the enforced recipient
    const sendLinkTerms = quoteData.terms;
    const { txRef: lockTx, lockId } = await lockSendLink({
      adapter: solver.evmAdapter,
      sendLink: {
        id: orderId,
        destinationChainId: anvil.chainId,
        token: tokenAddress,
        recipientAddress: recipientAccount.address,
        amount: BigInt(sendLinkTerms.evmAmount),
        windowSeconds: 86400,
        status: 'locked',
        createdAt: Math.floor(Date.now() / 1000),
      },
      hashLock,
    });

    expect(lockTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

    // Update order with lockId and SOLVER_LOCK_SEEN
    order!.lockId = lockId;
    order!.status = 'SOLVER_LOCK_SEEN';
    order!.updatedAt = Math.floor(Date.now() / 1000);
    solver.db.saveOrder(order!);

    const onChainLock = await solver.evmAdapter.getLock(lockId);
    expect(onChainLock.status).toBe('locked');
    if (onChainLock.status === 'locked') {
      expect(onChainLock.recipient?.toLowerCase()).toBe(
        recipientAccount.address.toLowerCase(),
      );
    }

    const linkRes3 = await fetch(`${solver.baseUrl}/v1/send-links/${orderId}`);
    expect(((await linkRes3.json()) as { status: string }).status).toBe(
      'locked',
    );

    // 5. Receiver claims via /v1/orders/:id/relay-claim with secret from link
    const recipientBalBefore = (await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    })) as bigint;

    const claimRes = await fetch(
      `${solver.baseUrl}/v1/orders/${orderId}/relay-claim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          lockId,
        }),
      },
    );

    expect(claimRes.status).toBe(200);
    const claimData = (await claimRes.json()) as {
      ok: boolean;
      orderId: string;
      txHash: string;
    };
    expect(claimData.ok).toBe(true);
    expect(claimData.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Verify recipient received tokens on EVM
    const recipientBalAfter = (await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    })) as bigint;
    expect(recipientBalAfter).toBeGreaterThan(recipientBalBefore);

    // Verify solver database updated secret and status to USER_CLAIM_SEEN
    const updatedOrder = solver.db.getOrder(orderId);
    expect(updatedOrder?.secret).toBe(secret);
    expect(updatedOrder?.status).toBe('USER_CLAIM_SEEN');
    expect(updatedOrder?.userClaimTxId).toBe(claimData.txHash);

    // 6. GET /v1/send-links/:id -> status is claimed
    const linkRes4 = await fetch(`${solver.baseUrl}/v1/send-links/${orderId}`);
    expect(linkRes4.status).toBe(200);
    const linkData4 = (await linkRes4.json()) as { status: string };
    expect(linkData4.status).toBe('claimed');

    // 7. Verify expired status when deadline has passed
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredOrderId = ('0x' + 'ee'.repeat(32)) as Hex32;
    const expiredTerms = {
      ...sendLinkTerms,
      evmDeadline: nowSec - 500, // expired 500s ago
    };
    solver.db.saveOrder({
      id: expiredOrderId,
      direction: 'BCH_TO_EVM',
      status: 'QUOTED',
      userCounterAddress: recipientAccount.address,
      lockId: 'expired-lock',
      termsJson: JSON.stringify(expiredTerms, (_, v) =>
        typeof v === 'bigint' ? v.toString() + 'n' : v,
      ),
      hashLock,
      lane: 'safe',
      fastOptIn: false,
      firstSeenAtMs: Date.now(),
      needsAttention: false,
      createdAt: nowSec - 1000,
      updatedAt: nowSec - 500,
    });

    const expiredRes = await fetch(
      `${solver.baseUrl}/v1/send-links/${expiredOrderId}`,
    );
    expect(expiredRes.status).toBe(200);
    expect(((await expiredRes.json()) as { status: string }).status).toBe(
      'expired',
    );
  });
});
