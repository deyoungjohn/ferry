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
import {
  SEND_LINK_WINDOWS_SECONDS,
  parseEvmChainConfig,
  parseSendLink,
} from '@ferry/core';
import type { EvmChainConfig } from '@ferry/core';
import {
  EvmChainAdapter,
  SendLinkRecipientError,
  checkRecipientCanReceiveToken,
  claimSendLink,
  lockSendLink,
} from '../src/index.js';
import type { AnvilInstance } from './anvil.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const deployerAccount = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const solverAccount = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const recipientAccount = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);

const mockTokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
]);

describe('send-link EVM flow', () => {
  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let solverClient: WalletClient;
  let recipientClient: WalletClient;
  let htlcAddress: Address;
  let usdcAddress: Address;
  let chainConfig: EvmChainConfig;
  let adapter: EvmChainAdapter;

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    const deployerClient = createWalletClient({
      account: deployerAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    solverClient = createWalletClient({
      account: solverAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    recipientClient = createWalletClient({
      account: recipientAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });

    const deploy = async (artifactPath: string) => {
      const artifact = loadForgeArtifact(artifactPath);
      const hash = await deployerClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        account: deployerAccount,
        chain: foundry,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt.contractAddress!;
    };

    htlcAddress = await deploy('FerryHTLC.sol/FerryHTLC.json');
    usdcAddress = await deploy(
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );

    const mintHash = await deployerClient.writeContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'mint',
      args: [solverAccount.address, 500_000_000n],
      account: deployerAccount,
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });

    chainConfig = parseEvmChainConfig({
      id: 'base',
      chainId: foundry.id,
      rpcUrls: [anvil.rpcUrl],
      explorerUrl: 'https://basescan.org',
      htlcAddress,
      nativeGas: 'ETH',
      finality: { fast: 2, safe: 'finalized' },
      assets: [
        { symbol: 'USDC', decimals: 6, address: usdcAddress, permit: true },
      ],
      relayCostUsd: 0.02,
    });

    adapter = new EvmChainAdapter({
      config: chainConfig,
      client: publicClient,
      walletClient: solverClient,
    });
  });

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
    }
  });

  it('locks with a 24h window and supports relayed claim', async () => {
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const now = Number(latest.timestamp);
    const secret = sha256(stringToHex('send-link-24h'));
    const hashLock = sha256(secret);

    const link = parseSendLink({
      id: hashLock,
      destinationChainId: foundry.id,
      token: usdcAddress,
      recipientAddress: recipientAccount.address,
      amount: 10_000_000n,
      windowSeconds: SEND_LINK_WINDOWS_SECONDS['24h'],
      status: 'quoted',
      createdAt: now,
    });

    const lockRes = await lockSendLink({
      adapter,
      sendLink: link,
      hashLock,
    });

    expect(lockRes.deadline).toBe(now + 86_400);
    expect(lockRes.isContractRecipient).toBe(false);
    expect(lockRes.caveats).toHaveLength(0);

    const beforeBalance = await publicClient.readContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    });

    // Relayed claim (no recipientClient passed)
    await claimSendLink({
      adapter,
      lockId: lockRes.lockId,
      secret,
    });

    const afterBalance = await publicClient.readContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    });
    expect(afterBalance - beforeBalance).toBe(10_000_000n);
  });

  it('locks with a 7d window and supports self-paid recipient claim', async () => {
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const now = Number(latest.timestamp);
    const secret = sha256(stringToHex('send-link-7d'));
    const hashLock = sha256(secret);

    const link = parseSendLink({
      id: hashLock,
      destinationChainId: foundry.id,
      token: usdcAddress,
      recipientAddress: recipientAccount.address,
      amount: 25_000_000n,
      windowSeconds: SEND_LINK_WINDOWS_SECONDS['7d'],
      status: 'quoted',
      createdAt: now,
    });

    const lockRes = await lockSendLink({
      adapter,
      sendLink: link,
      hashLock,
    });
    expect(lockRes.deadline).toBe(now + 7 * 86_400);

    const beforeBalance = await publicClient.readContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    });

    // Self-paid claim by recipient
    await claimSendLink({
      adapter,
      lockId: lockRes.lockId,
      secret,
      recipientClient,
    });

    const afterBalance = await publicClient.readContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    });
    expect(afterBalance - beforeBalance).toBe(25_000_000n);
  });

  it('flags contract-wallet recipients and refuses blocklisted recipients', async () => {
    const contractRecipient = '0x1000000000000000000000000000000000000001';
    await publicClient.request({
      method: 'anvil_setCode' as never,
      params: [contractRecipient, '0x60006000f3'] as never,
    });

    const contractCheck = await checkRecipientCanReceiveToken({
      client: publicClient,
      token: usdcAddress,
      recipient: contractRecipient,
    });
    expect(contractCheck.ok).toBe(true);
    expect(contractCheck.isContract).toBe(true);
    expect(contractCheck.caveats[0]).toMatch(/contract address/i);

    const mockClient = {
      getCode: async () => '0x60006000f3',
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === 'isBlacklisted',
    } as unknown as PublicClient;

    const blockedCheck = await checkRecipientCanReceiveToken({
      client: mockClient,
      token: usdcAddress,
      recipient: recipientAccount.address,
    });
    expect(blockedCheck.ok).toBe(false);
    expect(blockedCheck.reason).toBe('blocklisted');

    // lockSendLink refuses zero-address recipient before any tx
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const now = Number(latest.timestamp);
    const secret = sha256(stringToHex('send-link-zero'));
    const hashLock = sha256(secret);
    const badLink = parseSendLink({
      id: hashLock,
      destinationChainId: foundry.id,
      token: usdcAddress,
      recipientAddress: '0x0000000000000000000000000000000000000000',
      amount: 1_000_000n,
      windowSeconds: SEND_LINK_WINDOWS_SECONDS['24h'],
      status: 'quoted',
      createdAt: now,
    });

    await expect(
      lockSendLink({ adapter, sendLink: badLink, hashLock }),
    ).rejects.toBeInstanceOf(SendLinkRecipientError);
  });
});
