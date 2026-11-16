import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { foundry } from 'viem/chains';
import { evmLockId } from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  getEvmWalletRecoveryActions,
  inspectEvmWalletRecovery,
} from '../src/index.js';
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

const mockTokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external',
]);

describe('EVM wallet recovery actions', () => {
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
    tokenAddress = await deploy('MockERC20.sol/MockERC20.json', [
      'USD Coin',
      'USDC',
      6,
    ]);
  });

  afterAll(async () => {
    await anvil.stop();
  });

  it('returns claim now, wait for N blocks, refund after deadline, and settled states', () => {
    const secret = sha256(stringToHex('wallet-recovery-pure'));
    const hashLock = sha256(secret);

    // 1. Locked before deadline without secret -> wait for N blocks
    const waitPlan = getEvmWalletRecoveryActions({
      status: 'locked',
      deadline: 1_000_120,
      nowSeconds: 1_000_000,
      hashLock,
      blockTimeSeconds: 2,
    });
    expect(waitPlan.actions).toEqual([]);
    expect(waitPlan.blocksRemaining).toBe(60);
    expect(waitPlan.waits[0]?.waitingFor).toContain('Wait 60 blocks');

    // 2. Locked before deadline with valid secret -> claim now
    const claimPlan = getEvmWalletRecoveryActions({
      status: 'locked',
      deadline: 1_000_120,
      nowSeconds: 1_000_000,
      hashLock,
      secret,
      blockTimeSeconds: 2,
    });
    expect(claimPlan.actions).toEqual([{ chain: 'EVM', action: 'claim' }]);

    // 3. Locked at/after deadline -> refund available
    const refundPlan = getEvmWalletRecoveryActions({
      status: 'locked',
      deadline: 1_000_120,
      nowSeconds: 1_000_120,
      hashLock,
    });
    expect(refundPlan.actions).toEqual([{ chain: 'EVM', action: 'refund' }]);

    // 4. Already claimed -> no actions
    const settledPlan = getEvmWalletRecoveryActions({
      status: 'claimed',
      deadline: 1_000_120,
      nowSeconds: 1_000_120,
      hashLock,
    });
    expect(settledPlan.actions).toEqual([]);
    expect(settledPlan.summary).toContain('claimed');
  });

  it('inspects live Anvil lock state before and after deadline', async () => {
    const secret = sha256(stringToHex('wallet-recovery-anvil'));
    const hashLock = sha256(secret);
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const deadline = Number(latest.timestamp) + 60;
    const amount = 5_000_000n;

    await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: tokenAddress,
        abi: mockTokenAbi,
        functionName: 'mint',
        args: [user.address, amount],
        account: deployer,
        chain: foundry,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await userClient.writeContract({
        address: tokenAddress,
        abi: mockTokenAbi,
        functionName: 'approve',
        args: [htlcAddress, amount],
        account: user,
        chain: foundry,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await userClient.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [
          tokenAddress,
          recipient.address,
          amount,
          hashLock,
          BigInt(deadline),
        ],
        account: user,
        chain: foundry,
      }),
    });

    const id = evmLockId(user.address, hashLock);
    const beforePlan = await inspectEvmWalletRecovery({
      client: publicClient,
      htlc: htlcAddress,
      lockId: id,
      blockTimeSeconds: 2,
    });
    expect(beforePlan.status).toBe('locked');
    expect(beforePlan.actions).toEqual([]);
    expect(beforePlan.blocksRemaining).toBeGreaterThan(0);

    await publicClient.request({
      method: 'evm_increaseTime' as never,
      params: [120] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });

    const afterPlan = await inspectEvmWalletRecovery({
      client: publicClient,
      htlc: htlcAddress,
      lockId: id,
      secret,
      blockTimeSeconds: 2,
    });
    expect(afterPlan.actions).toEqual([
      { chain: 'EVM', action: 'claim' },
      { chain: 'EVM', action: 'refund' },
    ]);
  });
});
