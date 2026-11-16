import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmAssetConfig } from '@ferry/core';
import { fetchChainLocks, inspectEvmWalletRecovery } from '../src/index.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const DEPLOYER_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_KEY: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const RECIPIENT_KEY: Hex =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external',
]);

const htlcAbi = parseAbi([
  'function lock(address token, address recipient, uint256 amount, bytes32 hashLock, uint64 deadline) external returns (bytes32)',
  'function lockId(address sender, bytes32 hashLock) external pure returns (bytes32)',
]);

describe('Scan cost per provider cap over 1,000,000 blocks', () => {
  let stopAnvil: () => Promise<void>;
  let rpcUrl: string;
  let htlcAddress: Address;
  let tokenAddress: Address;
  let assets: EvmAssetConfig[];
  let lockId: Hex;
  let hashLock: Hex;

  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const user = privateKeyToAccount(USER_KEY);
  const recipient = privateKeyToAccount(RECIPIENT_KEY);

  beforeAll(async () => {
    const anvil = await startAnvil();
    stopAnvil = anvil.stop;
    rpcUrl = anvil.rpcUrl;

    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(rpcUrl),
      cacheTime: 0,
    });
    const deployerWallet = createWalletClient({
      account: deployer,
      chain: foundry,
      transport: http(rpcUrl),
    });
    const userWallet = createWalletClient({
      account: user,
      chain: foundry,
      transport: http(rpcUrl),
    });

    const deploy = async (
      artifactPath: string,
      args: unknown[] = [],
    ): Promise<Address> => {
      const artifact = loadForgeArtifact(artifactPath);
      const hash = await deployerWallet.deployContract({
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

    assets = [
      {
        symbol: 'USDC',
        address: tokenAddress.toLowerCase() as Address,
        decimals: 6,
        permit: true,
      },
    ];

    await publicClient.waitForTransactionReceipt({
      hash: await deployerWallet.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'mint',
        args: [user.address, 10_000_000n],
        account: deployer,
        chain: null,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await userWallet.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [htlcAddress, 10_000_000n],
        account: user,
        chain: null,
      }),
    });

    const secret = sha256(stringToHex('scan-cost-secret'));
    hashLock = sha256(secret);
    const latest = await publicClient.getBlock({ blockTag: 'latest' });
    await publicClient.waitForTransactionReceipt({
      hash: await userWallet.writeContract({
        address: htlcAddress,
        abi: htlcAbi,
        functionName: 'lock',
        args: [
          tokenAddress,
          recipient.address,
          1_000_000n,
          hashLock,
          latest.timestamp + 3600n,
        ],
        account: user,
        chain: null,
      }),
    });

    lockId = await publicClient.readContract({
      address: htlcAddress,
      abi: htlcAbi,
      functionName: 'lockId',
      args: [user.address, hashLock],
    });
  }, 30_000);

  afterAll(async () => {
    await stopAnvil?.();
  });

  function createCountedClient(
    maxProviderCap: bigint,
    anvilHeadBlock: bigint,
  ): {
    client: PublicClient;
    getCounts: () => { total: number; getLogs: number };
    reset: () => void;
  } {
    let total = 0;
    let getLogs = 0;

    const baseFetch = globalThis.fetch;
    const client = createPublicClient({
      transport: http(rpcUrl, {
        fetchFn: async (input, init) => {
          const bodyStr = typeof init?.body === 'string' ? init.body : '';
          const parsed = bodyStr
            ? (JSON.parse(bodyStr) as {
                method?: string;
                params?: Array<{ fromBlock?: string; toBlock?: string }>;
              })
            : {};
          total++;
          if (parsed.method === 'eth_getLogs') {
            getLogs++;
            const p = parsed.params?.[0];
            if (p?.fromBlock && p?.toBlock) {
              const from = BigInt(p.fromBlock);
              const to = BigInt(p.toBlock);
              const span = to - from + 1n;
              if (span > maxProviderCap) {
                return new Response(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    error: {
                      code: -32602,
                      message: `eth_getLogs range ${span} exceeds provider cap ${maxProviderCap}`,
                    },
                  }),
                  {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  },
                );
              }
              if (from > anvilHeadBlock) {
                return new Response(
                  JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }),
                  {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  },
                );
              }
              if (to > anvilHeadBlock) {
                p.toBlock = `0x${anvilHeadBlock.toString(16)}`;
                return baseFetch(input, {
                  ...init,
                  body: JSON.stringify(parsed),
                });
              }
            }
          }
          return baseFetch(input, init);
        },
      }),
      cacheTime: 0,
    });

    return {
      client,
      getCounts: () => ({ total, getLogs }),
      reset: () => {
        total = 0;
        getLogs = 0;
      },
    };
  }

  it('fails closed at cap=10 over 1,000,000 blocks and measures caps 1,000 / 10,000 / 100,000', async () => {
    const rawClient = createPublicClient({
      chain: foundry,
      transport: http(rpcUrl),
      cacheTime: 0,
    });
    const headBlock = await rawClient.getBlockNumber();

    // 1. Cap = 10 blocks must fail closed before issuing 100,000 getLogs calls
    const cap10 = createCountedClient(10n, headBlock);
    const t0 = performance.now();
    await expect(
      fetchChainLocks({
        client: cap10.client,
        htlc: htlcAddress,
        user: user.address,
        chain: 'base',
        assets,
        fromBlock: 0n,
        toBlock: 1_000_000n,
        maxRange: 10n,
      }),
    ).rejects.toThrow(/exceeding limit/i);
    const failMs = performance.now() - t0;
    expect(cap10.getCounts().getLogs).toBe(0);

    // 2. Measure caps 100,000, 10,000, 1,000 over 1,000,000 blocks
    const rows: Array<{
      cap: string;
      getLogsCalls: number;
      totalRpcCalls: number;
      ms: number;
    }> = [
      {
        cap: '10 (fail-closed)',
        getLogsCalls: cap10.getCounts().getLogs,
        totalRpcCalls: cap10.getCounts().total,
        ms: Number(failMs.toFixed(2)),
      },
    ];

    for (const cap of [100_000n, 10_000n, 1_000n] as const) {
      const metered = createCountedClient(cap, headBlock);
      const start = performance.now();
      const res = await fetchChainLocks({
        client: metered.client,
        htlc: htlcAddress,
        user: user.address,
        chain: 'base',
        assets,
        fromBlock: 0n,
        toBlock: 1_000_000n,
        settleToBlock: 1_000_000n,
        maxRange: cap,
      });
      const elapsed = performance.now() - start;
      expect(res.locks).toHaveLength(1);
      expect(res.locks[0]!.lockId).toBe(lockId);

      const counts = metered.getCounts();
      rows.push({
        cap: cap.toString(),
        getLogsCalls: counts.getLogs,
        totalRpcCalls: counts.total,
        ms: Number(elapsed.toFixed(2)),
      });
    }

    // 3. Recovery reader (direct contract read, independent of block range cap)
    const recMetered = createCountedClient(10n, headBlock);
    const recStart = performance.now();
    const recPlan = await inspectEvmWalletRecovery({
      client: recMetered.client,
      htlc: htlcAddress,
      lockId: lockId as `0x${string}`,
      blockTimeSeconds: 2,
    });
    const recMs = performance.now() - recStart;
    expect(recPlan.status).toBe('locked');
    expect(recMetered.getCounts().getLogs).toBe(0);
    expect(recMetered.getCounts().total).toBeLessThanOrEqual(3);

    console.log(
      'SCAN_COST_REPORT',
      JSON.stringify({
        fetchChainLocks: rows,
        recoveryReader: {
          cap: '10 (direct read)',
          getLogsCalls: recMetered.getCounts().getLogs,
          totalRpcCalls: recMetered.getCounts().total,
          ms: Number(recMs.toFixed(2)),
        },
      }),
    );
  }, 60_000);
});
