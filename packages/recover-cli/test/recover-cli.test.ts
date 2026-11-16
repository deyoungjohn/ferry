import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildRecoveryFile,
  orderId,
  serializeRecoveryFile,
  type Hex32,
  type RecoveryFile,
  type RecoveryTerms,
} from '@ferry/core';
import { deriveHtlcAddresses, encodeHtlcParameters } from '@ferry/htlc-bch';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
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
import {
  executeBchRecovery,
  executeEvmRecovery,
  planRecovery,
  probeEvmLockStatus,
  runRecoverCli,
} from '../src/index.js';
import type { AnvilInstance } from './anvil.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const DEPLOYER_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SOLVER_KEY: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const USER_KEY: Hex =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const deployer = privateKeyToAccount(DEPLOYER_KEY);
const solver = privateKeyToAccount(SOLVER_KEY);
const user = privateKeyToAccount(USER_KEY);

const mockTokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external',
]);

function toHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('@ferry/recover-cli', () => {
  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerClient: WalletClient;
  let solverClient: WalletClient;
  let userClient: WalletClient;
  let htlcAddress: Address;
  let tokenAddress: Address;
  let tempDir: string;

  beforeAll(async () => {
    anvil = await startAnvil();
    tempDir = mkdtempSync(join(tmpdir(), 'ferry-recover-cli-'));
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
    solverClient = createWalletClient({
      account: solver,
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
    rmSync(tempDir, { recursive: true, force: true });
    await anvil.stop();
  });

  function makeRecoveryFile(params: {
    direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
    hashLock: Hex32;
    evmDeadline: number;
    secret?: Hex32;
  }): RecoveryFile {
    const terms: RecoveryTerms = {
      version: 1,
      direction: params.direction,
      bchToken: 'PUSD',
      bchTokenCategory:
        '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
      bchTokenAmount: 1000n,
      evmAmount: 10_000_000n,
      evmToken: tokenAddress,
      evmChainId: foundry.id,
      evmHtlc: htlcAddress,
      userEvmAddress: user.address,
      userBchLockingBytecode:
        '0x76a914111111111111111111111111111111111111111188ac',
      solverEvmAddress: solver.address,
      solverBchLockingBytecode:
        '0x76a914222222222222222222222222222222222222222288ac',
      hashLock: params.hashLock,
      evmDeadline: params.evmDeadline,
      bchRefundHeight: 500_000,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: `q-${params.direction.toLowerCase()}`,
      quoteExpiry: params.evmDeadline - 100,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.000',
            source: 'cauldron',
            asOf: params.evmDeadline - 200,
          },
          {
            asset: 'USDC',
            usdPrice: '1.000',
            source: 'chainlink:base:usdc-usd',
            asOf: params.evmDeadline - 200,
          },
        ],
        spreadBps: 40,
        fixedFeeBase: 20n,
        rounding: 'floor',
      },
    };

    const htlcParams = encodeHtlcParameters(terms);
    const bchAddrs = deriveHtlcAddresses(htlcParams, 'chipnet');

    return buildRecoveryFile({
      orderId: orderId(terms),
      terms,
      solverSignature: `0x${'ab'.repeat(65)}`,
      ...(params.secret !== undefined ? { secret: params.secret } : {}),
      createdAt: params.evmDeadline - 200,
      contracts: {
        evm: {
          chainId: foundry.id,
          htlcAddress,
          tokenAddress,
        },
        bch: {
          network: 'chipnet',
          htlcAddress: bchAddrs.p2sh32Address,
          tokenAddress: bchAddrs.tokenAddress,
          redeemScript: toHex(bchAddrs.redeemScript),
          lockingBytecode: toHex(bchAddrs.lockingBytecode),
        },
      },
    });
  }

  it('dry-runs and broadcasts EVM refund after deadline on Anvil (EVM_TO_BCH)', async () => {
    const secret = sha256(stringToHex('recover-refund-secret'));
    const hashLock = sha256(secret);
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const deadline = Number(latest.timestamp) + 60;
    const amount = 10_000_000n;

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
          solver.address,
          amount,
          hashLock,
          BigInt(deadline),
        ],
        account: user,
        chain: foundry,
      }),
    });

    const file = makeRecoveryFile({
      direction: 'EVM_TO_BCH',
      hashLock,
      evmDeadline: deadline,
    });
    const filePath = join(tempDir, 'refund-recovery.json');
    writeFileSync(filePath, serializeRecoveryFile(file), 'utf8');

    // Before deadline: must wait
    const beforeProbe = await probeEvmLockStatus(file, anvil.rpcUrl);
    expect(beforeProbe.lockStatus).toBe('locked');
    const beforePlan = planRecovery(file, {
      nowSeconds: beforeProbe.nowSeconds,
      bchTipHeight: 0,
      evmLock: { state: beforeProbe.lockStatus },
      bchLock: { state: 'none' },
    });
    expect(beforePlan.actions).toEqual([]);
    expect(beforePlan.waits.some((w) => w.action === 'refund')).toBe(true);

    // Advance past deadline
    await publicClient.request({
      method: 'evm_increaseTime' as never,
      params: [120] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });

    // Dry run (default): prints transaction without sending
    const dryLogs: string[] = [];
    await runRecoverCli([filePath, '--rpc', anvil.rpcUrl], {
      log: (line) => dryLogs.push(line),
    });
    const dryText = dryLogs.join('\n');
    expect(dryText).toContain('Ready [EVM refund]');
    expect(dryText).toContain('"mode": "dry-run"');
    expect((await probeEvmLockStatus(file, anvil.rpcUrl)).lockStatus).toBe(
      'locked',
    );

    // Broadcast with private key from env var (never printed)
    const balBefore = await publicClient.readContract({
      address: tokenAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [user.address],
    });
    process.env['FERRY_RECOVER_PRIVATE_KEY'] = USER_KEY;
    try {
      const txLogs: string[] = [];
      await runRecoverCli([filePath, '--rpc', anvil.rpcUrl, '--broadcast'], {
        log: (line) => txLogs.push(line),
      });
      const txText = txLogs.join('\n');
      expect(txText).toContain('"mode": "broadcast"');
      expect(txText).toContain('"status": "success"');
      expect(txText).not.toContain(USER_KEY);
    } finally {
      delete process.env['FERRY_RECOVER_PRIVATE_KEY'];
    }

    const balAfter = await publicClient.readContract({
      address: tokenAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [user.address],
    });
    expect(balAfter - balBefore).toBe(amount);
    expect((await probeEvmLockStatus(file, anvil.rpcUrl)).lockStatus).toBe(
      'refunded',
    );
  });

  it('dry-runs and broadcasts EVM claim with secret on Anvil (BCH_TO_EVM)', async () => {
    const secret = sha256(stringToHex('recover-claim-secret'));
    const hashLock = sha256(secret);
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    const deadline = Number(latest.timestamp) + 600;
    const amount = 10_000_000n;

    await publicClient.waitForTransactionReceipt({
      hash: await deployerClient.writeContract({
        address: tokenAddress,
        abi: mockTokenAbi,
        functionName: 'mint',
        args: [solver.address, amount],
        account: deployer,
        chain: foundry,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await solverClient.writeContract({
        address: tokenAddress,
        abi: mockTokenAbi,
        functionName: 'approve',
        args: [htlcAddress, amount],
        account: solver,
        chain: foundry,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await solverClient.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [tokenAddress, user.address, amount, hashLock, BigInt(deadline)],
        account: solver,
        chain: foundry,
      }),
    });

    const file = makeRecoveryFile({
      direction: 'BCH_TO_EVM',
      hashLock,
      evmDeadline: deadline,
      secret,
    });

    const dryRes = await executeEvmRecovery({
      file,
      rpcUrl: anvil.rpcUrl,
      broadcast: false,
    });
    expect(dryRes.mode).toBe('dry-run');
    expect(dryRes.calldata.action).toBe('claim');

    const balBefore = await publicClient.readContract({
      address: tokenAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [user.address],
    });

    const broadcastRes = await executeEvmRecovery({
      file,
      rpcUrl: anvil.rpcUrl,
      broadcast: true,
      env: { FERRY_RECOVER_PRIVATE_KEY: USER_KEY },
    });
    expect(broadcastRes.mode).toBe('broadcast');
    expect(broadcastRes.status).toBe('success');

    const balAfter = await publicClient.readContract({
      address: tokenAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [user.address],
    });
    expect(balAfter - balBefore).toBe(amount);
    expect((await probeEvmLockStatus(file, anvil.rpcUrl)).lockStatus).toBe(
      'claimed',
    );
  });

  it('builds raw BCH recovery transaction hex via @ferry/htlc-bch', async () => {
    const secret = sha256(stringToHex('recover-bch-secret'));
    const hashLock = sha256(secret);
    const file = makeRecoveryFile({
      direction: 'EVM_TO_BCH',
      hashLock,
      evmDeadline: 1_794_850_000,
      secret,
    });

    const bchRes = executeBchRecovery({
      file,
      utxos: [
        {
          txid: '11'.repeat(32),
          vout: 0,
          satoshis: 3000n,
          lockingBytecode: file.contracts.bch.lockingBytecode,
        },
      ],
    });

    expect(bchRes.action).toBe('claim');
    expect(bchRes.txHex).toMatch(/^[0-9a-f]+$/);
    expect(bchRes.txid).toMatch(/^[0-9a-f]{64}$/);
  });
});
