import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import type { Hex32 } from '@ferry/core';
import { evmLockId } from '@ferry/core';
import { fetchChainLocks } from '../src/index.js';
import type { AnvilInstance } from './anvil.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const deployerAccount = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const aliceAccount = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const bobAccount = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);
const carolAccount = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
);

const mockTokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
]);

describe('fetchChainLocks', () => {
  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerClient: WalletClient;
  let aliceClient: WalletClient;
  let bobClient: WalletClient;
  let carolClient: WalletClient;
  let htlcAddress: Address;
  let tokenAddress: Address;
  let deployBlock: bigint;

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    deployerClient = createWalletClient({
      account: deployerAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    aliceClient = createWalletClient({
      account: aliceAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    bobClient = createWalletClient({
      account: bobAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    carolClient = createWalletClient({
      account: carolAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });

    const deployContract = async (
      artifactPath: string,
      args: readonly unknown[] = [],
    ): Promise<{ address: Address; blockNumber: bigint }> => {
      const artifact = loadForgeArtifact(artifactPath);
      const hash = await deployerClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [...args],
        account: deployerAccount,
        chain: foundry,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) {
        throw new Error(`Missing contractAddress for ${artifactPath}`);
      }
      return {
        address: receipt.contractAddress,
        blockNumber: receipt.blockNumber,
      };
    };

    const tokenDeploy = await deployContract(
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );
    tokenAddress = tokenDeploy.address;

    // Mine a couple of blocks before deploying HTLC so deployBlock > 0n
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });

    const htlcDeploy = await deployContract('FerryHTLC.sol/FerryHTLC.json');
    htlcAddress = htlcDeploy.address;
    deployBlock = htlcDeploy.blockNumber;

    for (const acct of [aliceAccount, bobAccount, carolAccount]) {
      const mintHash = await deployerClient.writeContract({
        address: tokenAddress,
        abi: mockTokenAbi,
        functionName: 'mint',
        args: [acct.address, 1_000_000_000n],
        account: deployerAccount,
        chain: foundry,
      });
      await publicClient.waitForTransactionReceipt({ hash: mintHash });
    }
  });

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
    }
  });

  async function createLock(
    senderClient: WalletClient,
    recipient: Address,
    amount: bigint,
    label: string,
    deadlineOffset = 3600,
  ): Promise<{
    lockId: Hex32;
    secret: Hex32;
    hashLock: Hex32;
    txHash: Hex32;
    blockNumber: bigint;
    timestamp: number;
  }> {
    const sender = senderClient.account!;
    const secret = sha256(stringToHex(label));
    const hashLock = sha256(secret);
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const deadline = latest.timestamp + BigInt(deadlineOffset);

    const approveHash = await senderClient.writeContract({
      address: tokenAddress,
      abi: mockTokenAbi,
      functionName: 'approve',
      args: [htlcAddress, amount],
      account: sender,
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const txHash = await senderClient.writeContract({
      address: htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'lock',
      args: [tokenAddress, recipient, amount, hashLock, deadline],
      account: sender,
      chain: foundry,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const block = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    return {
      lockId: evmLockId(sender.address, hashLock),
      secret,
      hashLock,
      txHash: txHash as Hex32,
      blockNumber: receipt.blockNumber,
      timestamp: Number(block.timestamp),
    };
  }

  it('returns locks where user is sender or recipient, including claimed and refunded states and block timestamps', async () => {
    // 1. Alice -> Bob (remains locked)
    const lock1 = await createLock(
      aliceClient,
      bobAccount.address,
      10_000_000n,
      'act-locked',
    );

    // 2. Bob -> Alice (claimed by Alice)
    const lock2 = await createLock(
      bobClient,
      aliceAccount.address,
      20_000_000n,
      'act-claimed',
    );
    const claimHash = await aliceClient.writeContract({
      address: htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'claim',
      args: [lock2.lockId, lock2.secret],
      account: aliceAccount,
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: claimHash });

    // 3. Alice -> Carol (refunded after deadline)
    const lock3 = await createLock(
      aliceClient,
      carolAccount.address,
      30_000_000n,
      'act-refunded',
      60,
    );
    await publicClient.request({
      method: 'evm_increaseTime' as never,
      params: [120] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });
    const refundHash = await aliceClient.writeContract({
      address: htlcAddress,
      abi: ferryHtlcAbi,
      functionName: 'refund',
      args: [lock3.lockId],
      account: aliceAccount,
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: refundHash });

    // 4. Bob -> Carol (unrelated to Alice, must not be returned for Alice)
    await createLock(
      bobClient,
      carolAccount.address,
      5_000_000n,
      'act-unrelated',
    );

    const result = await fetchChainLocks({
      client: publicClient,
      htlc: htlcAddress,
      user: aliceAccount.address,
      chain: 'base',
      deployBlock,
    });

    expect(result.hasMore).toBe(false);
    expect(result.nextToBlock).toBeNull();
    expect(result.locks).toHaveLength(3);

    const byId = new Map(result.locks.map((l) => [l.lockId, l]));

    const item1 = byId.get(lock1.lockId)!;
    expect(item1.role).toBe('sender');
    expect(item1.status).toBe('locked');
    expect(item1.amount).toBe(10_000_000n);
    expect(item1.lockedAt).toBe(lock1.timestamp);
    expect(item1.lockTx.txId).toBe(lock1.txHash);

    const item2 = byId.get(lock2.lockId)!;
    expect(item2.role).toBe('recipient');
    expect(item2.status).toBe('claimed');
    expect(item2.secret).toBe(lock2.secret);
    expect(item2.claimTx?.txId).toBe(claimHash);
    expect(item2.lockedAt).toBe(lock2.timestamp);

    const item3 = byId.get(lock3.lockId)!;
    expect(item3.role).toBe('sender');
    expect(item3.status).toBe('refunded');
    expect(item3.refundTx?.txId).toBe(refundHash);
    expect(item3.lockedAt).toBe(lock3.timestamp);
  });

  it('supports resumable backward windows and never scans earlier than deployBlock', async () => {
    const requestedFromBlocks: bigint[] = [];
    const spyingClient = {
      getBlockNumber: () => publicClient.getBlockNumber(),
      getBlock: (args: Parameters<PublicClient['getBlock']>[0]) =>
        publicClient.getBlock(args),
      getLogs: async (args: Parameters<PublicClient['getLogs']>[0]) => {
        if (typeof args?.fromBlock === 'bigint') {
          requestedFromBlocks.push(args.fromBlock);
        }
        return publicClient.getLogs(args);
      },
    } as unknown as PublicClient;

    const allLockIds: Hex32[] = [];
    let cursorTo: bigint | undefined = undefined;
    let pages = 0;

    while (true) {
      const page = await fetchChainLocks({
        client: spyingClient,
        htlc: htlcAddress,
        user: aliceAccount.address,
        deployBlock,
        toBlock: cursorTo,
        windowSize: 4n,
      });
      pages += 1;
      for (const lock of page.locks) {
        allLockIds.push(lock.lockId);
      }
      if (!page.hasMore) {
        expect(page.nextToBlock).toBeNull();
        expect(page.fromBlock).toBe(deployBlock);
        break;
      }
      expect(page.nextToBlock).not.toBeNull();
      cursorTo = page.nextToBlock!;
    }

    expect(pages).toBeGreaterThan(1);
    expect(allLockIds.length).toBeGreaterThanOrEqual(3);
    for (const fb of requestedFromBlocks) {
      expect(fb).toBeGreaterThanOrEqual(deployBlock);
    }
  });

  it('chunks and halves eth_getLogs ranges when an RPC refuses wide ranges', async () => {
    const lock = await createLock(
      carolClient,
      aliceAccount.address,
      7_000_000n,
      'act-chunked',
    );
    let refusedWide = false;

    const restrictedClient = {
      getBlockNumber: () => publicClient.getBlockNumber(),
      getBlock: (args: Parameters<PublicClient['getBlock']>[0]) =>
        publicClient.getBlock(args),
      getLogs: async (args: Parameters<PublicClient['getLogs']>[0]) => {
        const from = typeof args?.fromBlock === 'bigint' ? args.fromBlock : 0n;
        const to = typeof args?.toBlock === 'bigint' ? args.toBlock : 0n;
        if (to - from > 2n) {
          refusedWide = true;
          throw new Error('query returned more than 10000 results');
        }
        return publicClient.getLogs(args);
      },
    } as unknown as PublicClient;

    const result = await fetchChainLocks({
      client: restrictedClient,
      htlc: htlcAddress,
      user: aliceAccount.address,
      fromBlock: lock.blockNumber - 4n,
      toBlock: lock.blockNumber,
      deployBlock,
    });

    expect(refusedWide).toBe(true);
    expect(result.locks.some((l) => l.lockId === lock.lockId)).toBe(true);
  });
});
