import { describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { Address, Chain, PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { ChainId } from '@ferry/chain-config';
import {
  makeBchIdentity,
  startRealEngineSolver,
} from '../../e2e/test/support/real-engine-solver.js';
import { FakeBchChain } from '../../e2e/test/support/fake-bch-chain.js';
import { runForwardFlow, type FlowContext } from '../src/flows.js';
import { chainConfig, RPC_ENV } from '../src/chains.js';
import { deployHtlc } from '../src/contract.js';
import { setBalance, setIntervalMining, startFork } from '../src/fork.js';
import { setErc20Balance } from '../src/token.js';

const RUN =
  process.env['FERRY_RUN_FORK'] === '1' &&
  Boolean(process.env[RPC_ENV.base]) &&
  Boolean(process.env[RPC_ENV.arbitrum]);
const GAS = 10n ** 20n;

interface ForkedChain {
  chain: Chain;
  rpcUrl: string;
  publicClient: PublicClient;
  htlc: Address;
  token: Address;
  tokenDecimals: number;
  tokenPermit: boolean;
  explorerUrl: string;
  deployBlock: bigint;
}

async function forkChain(
  id: ChainId,
  solverKey: `0x${string}`,
  userKey: `0x${string}`,
): Promise<ForkedChain & { stop: () => Promise<void> }> {
  const facts = chainConfig().facts.find((item) => item.id === id);
  if (!facts) throw new Error(`missing ${id} facts`);
  const token = facts.assets.find(
    (asset) => asset.symbol === 'USDC' && asset.address,
  );
  if (!token?.address || token.decimals === null)
    throw new Error(`missing ${id} token`);
  const rpc = process.env[RPC_ENV[id]]!.split(',')[0]!.trim();
  const fork = await startFork(facts.chainId, rpc);
  await setIntervalMining(fork.rpcUrl, 1).catch(() => undefined);
  const chain = {
    id: facts.chainId,
    name: facts.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH' as const, decimals: 18 },
    rpcUrls: { default: { http: [fork.rpcUrl] } },
  };
  const publicClient = createPublicClient({
    chain,
    transport: http(fork.rpcUrl, { timeout: 180_000 }),
    cacheTime: 0,
    pollingInterval: 50,
  });
  const deployer = privateKeyToAccount(generatePrivateKey());
  const user = privateKeyToAccount(userKey);
  const solver = privateKeyToAccount(solverKey);
  const deployWallet = createWalletClient({
    account: deployer,
    chain,
    transport: http(fork.rpcUrl, { timeout: 180_000 }),
  });
  for (const account of [deployer.address, user.address, solver.address]) {
    await setBalance(fork.rpcUrl, account, GAS);
  }
  const deployBlock = await publicClient.getBlockNumber();
  const htlc = await deployHtlc(
    deployWallet,
    publicClient,
    deployer,
    chain,
    fork.rpcUrl,
  );
  const amount = 1_000_000n * 10n ** BigInt(token.decimals);
  await setErc20Balance({
    rpcUrl: fork.rpcUrl,
    publicClient,
    token: token.address as Address,
    account: user.address,
    amount,
  });
  await setErc20Balance({
    rpcUrl: fork.rpcUrl,
    publicClient,
    token: token.address as Address,
    account: solver.address,
    amount,
  });
  return {
    chain,
    rpcUrl: fork.rpcUrl,
    publicClient,
    htlc,
    token: token.address as Address,
    tokenDecimals: token.decimals,
    tokenPermit: token.permit,
    explorerUrl: facts.explorerUrl,
    deployBlock,
    stop: fork.stop,
  };
}

describe.skipIf(!RUN)('two chains at the same time', () => {
  it('settles a forward swap on Base and Arbitrum through one engine without sharing locks', async () => {
    const solverKey = generatePrivateKey();
    const userKey = generatePrivateKey();
    const [base, arbitrum] = await Promise.all([
      forkChain('base', solverKey, userKey),
      forkChain('arbitrum', solverKey, userKey),
    ]);
    const bch = new FakeBchChain();
    const solverBch = makeBchIdentity(0x52);
    const userBch = makeBchIdentity(0x31);
    const solver = await startRealEngineSolver({
      rpcUrl: base.rpcUrl,
      chain: base.chain,
      htlcAddress: base.htlc,
      tokenAddress: base.token,
      tokenDecimals: base.tokenDecimals,
      tokenPermit: base.tokenPermit,
      solverEvmKey: solverKey,
      bchChain: bch,
      solverBch,
      referenceActions: true,
      deployBlock: base.deployBlock,
      extraChains: [
        {
          chainKey: 'arbitrum',
          chain: arbitrum.chain,
          htlcAddress: arbitrum.htlc,
          tokenAddress: arbitrum.token,
          tokenDecimals: arbitrum.tokenDecimals,
          tokenPermit: arbitrum.tokenPermit,
          rpcUrl: arbitrum.rpcUrl,
          explorerUrl: arbitrum.explorerUrl,
          deployBlock: arbitrum.deployBlock,
        },
      ],
    });

    const userWalletBase = createWalletClient({
      account: privateKeyToAccount(userKey),
      chain: base.chain,
      transport: http(base.rpcUrl),
    });
    const userWalletArbitrum = createWalletClient({
      account: privateKeyToAccount(userKey),
      chain: arbitrum.chain,
      transport: http(arbitrum.rpcUrl),
    });
    const solverEvmAddress = privateKeyToAccount(solverKey).address;
    const baseContext: FlowContext = {
      solver,
      chain: bch,
      chainConfig: base.chain,
      publicClient: base.publicClient,
      user: privateKeyToAccount(userKey),
      userWallet: userWalletBase,
      solverEvmAddress,
      token: base.token,
      tokenDecimals: base.tokenDecimals,
      tokenPermit: base.tokenPermit,
      userBch,
      solverBch,
    };
    const arbitrumContext: FlowContext = {
      ...baseContext,
      evmAdapter: solver.evmAdapters.get('arbitrum')!,
      chainConfig: arbitrum.chain,
      publicClient: arbitrum.publicClient,
      userWallet: userWalletArbitrum,
      token: arbitrum.token,
      tokenDecimals: arbitrum.tokenDecimals,
      tokenPermit: arbitrum.tokenPermit,
    };

    try {
      let [baseResult, arbitrumResult] = ['', ''];
      try {
        [baseResult, arbitrumResult] = await Promise.all([
          runForwardFlow(baseContext),
          runForwardFlow(arbitrumContext),
        ]);
      } catch (error) {
        console.log(
          solver.db
            .listOrdersByAddress(baseContext.user.address, 10)
            .map((order) => ({
              id: order.id,
              status: order.status,
              chainId: (JSON.parse(order.termsJson) as { evmChainId: number })
                .evmChainId,
            })),
        );
        throw error;
      }
      expect(baseResult).toContain('forward done');
      expect(arbitrumResult).toContain('forward done');
      const orders = solver.db.listOrdersByAddress(
        baseContext.user.address,
        10,
      );
      expect(orders.length).toBeGreaterThanOrEqual(2);
      expect(new Set(orders.map((order) => order.id)).size).toBe(orders.length);
      expect(new Set(orders.map((order) => order.termsJson)).size).toBe(
        orders.length,
      );
    } finally {
      await solver.stop();
      await Promise.all([base.stop(), arbitrum.stop()]);
    }
  }, 600_000);
});
