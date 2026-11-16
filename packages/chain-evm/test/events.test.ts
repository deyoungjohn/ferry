import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  parseEventLogs,
  parseSignature,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { evmLockId } from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import { fetchChainLocks } from '../src/index.js';
import type { AnvilInstance } from './anvil.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const DEPLOYER_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_KEY: Hex =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const RECIPIENT_KEY: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const deployer = privateKeyToAccount(DEPLOYER_KEY);
const user = privateKeyToAccount(USER_KEY);
const recipient = privateKeyToAccount(RECIPIENT_KEY);

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external',
  'function nonces(address owner) external view returns (uint256)',
]);

describe('FerryHTLC event log completeness', () => {
  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerClient: WalletClient;
  let userClient: WalletClient;
  let htlcAddress: Address;
  let tokenAddress: Address;

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    deployerClient = createWalletClient({
      account: deployer,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    userClient = createWalletClient({
      account: user,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });

    const deploy = async (artifactPath: string, args: unknown[] = []) => {
      const artifact = loadForgeArtifact(artifactPath);
      const hash = await deployerClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
        account: deployer,
        chain: foundry,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt.contractAddress!;
    };

    htlcAddress = await deploy('FerryHTLC.sol/FerryHTLC.json');
    tokenAddress = await deploy(
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );
  });

  afterAll(async () => {
    await anvil.stop();
  });

  it('emits complete Locked, Claimed, and Refunded logs for activity reader and recovery CLI', async () => {
    const startBlock = await publicClient.getBlockNumber();
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const deadline = latest.timestamp + 120n;
    const intentDeadline = latest.timestamp + 60n;
    const amount = 2_500_000n;

    await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'mint',
        args: [user.address, amount * 2n],
        account: deployer,
        chain: foundry,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await userClient.writeContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'approve',
        args: [htlcAddress, amount],
        account: user,
        chain: foundry,
      }),
    });

    // 1. Standard lock -> Claimed
    const secret1 = sha256(stringToHex('event-completeness-claim'));
    const hashLock1 = sha256(secret1);
    const lock1Receipt = await publicClient.waitForTransactionReceipt({
      hash: await userClient.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [tokenAddress, recipient.address, amount, hashLock1, deadline],
        account: user,
        chain: foundry,
      }),
    });
    const lock1Events = parseEventLogs({
      abi: ferryHtlcAbi,
      logs: lock1Receipt.logs,
      eventName: 'Locked',
    });
    expect(lock1Events).toHaveLength(1);
    expect(lock1Events[0]?.args).toEqual({
      id: evmLockId(user.address, hashLock1),
      sender: user.address,
      recipient: recipient.address,
      token: getAddress(tokenAddress),
      amount,
      hashLock: hashLock1,
      deadline,
    });

    const claimReceipt = await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'claim',
        args: [evmLockId(user.address, hashLock1), secret1],
        account: deployer,
        chain: foundry,
      }),
    });
    const claimEvents = parseEventLogs({
      abi: ferryHtlcAbi,
      logs: claimReceipt.logs,
      eventName: 'Claimed',
    });
    expect(claimEvents).toHaveLength(1);
    expect(claimEvents[0]?.args).toEqual({
      id: evmLockId(user.address, hashLock1),
      secret: secret1,
    });

    // 2. lockWithIntent -> Refunded
    const secret2 = sha256(stringToHex('event-completeness-refund'));
    const hashLock2 = sha256(secret2);
    const nonce = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'nonces',
      args: [user.address],
    });
    const permitSig = parseSignature(
      await userClient.signTypedData({
        account: user,
        domain: {
          name: 'Mock USDC',
          version: '1',
          chainId: foundry.id,
          verifyingContract: tokenAddress,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: user.address,
          spender: htlcAddress,
          value: amount,
          nonce,
          deadline: intentDeadline,
        },
      }),
    );
    const intentSig = await userClient.signTypedData({
      account: user,
      domain: {
        name: 'FerryHTLC',
        version: '1',
        chainId: foundry.id,
        verifyingContract: htlcAddress,
      },
      types: {
        LockIntent: [
          { name: 'token', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'hashLock', type: 'bytes32' },
          { name: 'deadline', type: 'uint64' },
          { name: 'intentDeadline', type: 'uint256' },
        ],
      },
      primaryType: 'LockIntent',
      message: {
        token: getAddress(tokenAddress),
        recipient: recipient.address,
        amount,
        hashLock: hashLock2,
        deadline,
        intentDeadline,
      },
    });
    const lock2Receipt = await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lockWithIntent',
        args: [
          user.address,
          tokenAddress,
          recipient.address,
          amount,
          hashLock2,
          deadline,
          intentDeadline,
          intentSig,
          intentDeadline,
          Number(permitSig.v ?? (permitSig.yParity === 0 ? 27 : 28)),
          permitSig.r,
          permitSig.s,
        ],
        account: deployer,
        chain: foundry,
      }),
    });
    const lock2Events = parseEventLogs({
      abi: ferryHtlcAbi,
      logs: lock2Receipt.logs,
      eventName: 'Locked',
    });
    expect(lock2Events).toHaveLength(1);
    expect(lock2Events[0]?.args).toEqual({
      id: evmLockId(user.address, hashLock2),
      sender: user.address,
      recipient: recipient.address,
      token: getAddress(tokenAddress),
      amount,
      hashLock: hashLock2,
      deadline,
    });

    await publicClient.request({
      method: 'evm_increaseTime' as never,
      params: [200] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });

    const refundReceipt = await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'refund',
        args: [evmLockId(user.address, hashLock2)],
        account: deployer,
        chain: foundry,
      }),
    });
    const refundEvents = parseEventLogs({
      abi: ferryHtlcAbi,
      logs: refundReceipt.logs,
      eventName: 'Refunded',
    });
    expect(refundEvents).toHaveLength(1);
    expect(refundEvents[0]?.args).toEqual({
      id: evmLockId(user.address, hashLock2),
    });

    const endBlock = await publicClient.getBlockNumber();
    const activity = await fetchChainLocks({
      client: publicClient,
      htlc: htlcAddress,
      user: user.address,
      fromBlock: startBlock,
      toBlock: endBlock,
      deployBlock: startBlock,
    });
    expect(activity.locks).toHaveLength(2);
    expect(activity.locks.map((l) => l.status).sort()).toEqual([
      'claimed',
      'refunded',
    ]);
  });
});
