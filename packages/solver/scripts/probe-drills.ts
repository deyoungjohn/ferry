import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  runProbe,
  createDefaultEvmPort,
  createDefaultBchPort,
  type BchRpcTransport,
  type ProbeEvidence,
} from '../../probe/src/index.js';
import { loadChainConfig } from '@ferry/chain-config';
import { startSolver } from '../src/main.js';
import { loadConfigFromEnv } from '../src/config.js';
import type { PriceSource } from '../src/pricing/price-source.js';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_HTLC = '0x8b968625F983420B571C102eC0b57F7e509c916e';

class TestnetFixedPriceSource implements PriceSource {
  async getPrice(asset: string) {
    const symbol = asset.toUpperCase();
    return {
      usdPrice: 1_000_000n, // $1.000000
      source: `testnet-feed:${symbol}`,
      asOf: Math.floor(Date.now() / 1000) - 10,
      heartbeatSeconds: 86400,
    };
  }
}

async function main() {
  const env = process.env;
  const rawEvmKey = env.SOLVER_EVM_PRIVATE_KEY || env.USER_EVM_PRIVATE_KEY;
  if (!rawEvmKey) {
    throw new Error(
      'SOLVER_EVM_PRIVATE_KEY or USER_EVM_PRIVATE_KEY is required',
    );
  }
  const evmPrivateKey = (
    rawEvmKey.startsWith('0x') ? rawEvmKey : `0x${rawEvmKey}`
  ) as Hex;
  const rpcUrl = env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';

  // 1. Safety verification: refuse if mainnet
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Refusing to run testnet drill: expected Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}), got ${chainId}`,
    );
  }

  // 2. Start live solver with testnet configuration on port 8789
  const config = loadConfigFromEnv({
    ...env,
    PORT: '8789',
    HOST: '127.0.0.1',
    NETWORK: 'testnet',
    BASE_HTLC_ADDRESS: BASE_SEPOLIA_HTLC,
    BASE_RPC_URL: rpcUrl,
    DATABASE_PATH: '/tmp/solver-drill.db',
    OPERATOR_TOKEN: '0123456789abcdef0123456789abcdef',
  });

  const solverInstance = await startSolver({
    config,
    priceSource: new TestnetFixedPriceSource(),
  });

  const chainConfig = loadChainConfig({ network: 'testnet' });
  const rawEvmConfig = chainConfig.coreChains.find(
    (c) => c.chainId === BASE_SEPOLIA_CHAIN_ID,
  );
  if (!rawEvmConfig) {
    throw new Error('No core chain config found for Base Sepolia');
  }
  const evmConfig = {
    ...rawEvmConfig,
    htlcAddress: BASE_SEPOLIA_HTLC,
  };

  const userAccount = privateKeyToAccount(evmPrivateKey);
  const walletClient = createWalletClient({
    account: userAccount,
    transport: http(rpcUrl),
  });

  const evmPort = createDefaultEvmPort({
    chainConfig: evmConfig,
    publicClient,
    walletClient,
    userAddress: userAccount.address,
  });

  const bchTransport: BchRpcTransport = {
    getTipHeight: async () => solverInstance.bchClient.getTip(),
    getUtxos: async () => [],
    broadcast: async () => '0x' + '00'.repeat(32),
  };
  const bchPort = createDefaultBchPort(bchTransport, 'chipnet');

  const results: Record<string, ProbeEvidence | { error: string }> = {};

  try {
    // Drill 1: Forward Swap (EVM_TO_BCH)
    process.stderr.write(
      'Running Drill 1: Forward swap probe (EVM_TO_BCH)...\n',
    );
    results.forward = await runProbe(
      {
        network: 'testnet',
        execute: false,
        direction: 'EVM_TO_BCH',
        mode: 'swap',
        token: 'PUSD',
        chainId: BASE_SEPOLIA_CHAIN_ID,
        amountUsd: 1,
        maxUsd: 1,
        solverUrl: 'http://127.0.0.1:8789',
        recoveryDir: '.probe-recovery',
        pollIntervalMs: 1000,
        timeoutMs: 30000,
        bchFeeRateSatPerByte: 1.2,
      },
      {
        evmPort,
        bchPort,
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
    );

    // Drill 2: Reverse Swap (BCH_TO_EVM)
    process.stderr.write(
      'Running Drill 2: Reverse swap probe (BCH_TO_EVM)...\n',
    );
    results.reverse = await runProbe(
      {
        network: 'testnet',
        execute: false,
        direction: 'BCH_TO_EVM',
        mode: 'swap',
        token: 'PUSD',
        chainId: BASE_SEPOLIA_CHAIN_ID,
        amountUsd: 1,
        maxUsd: 1,
        solverUrl: 'http://127.0.0.1:8789',
        recoveryDir: '.probe-recovery',
        pollIntervalMs: 1000,
        timeoutMs: 30000,
        bchFeeRateSatPerByte: 1.2,
      },
      {
        evmPort,
        bchPort,
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
    );

    // Drill 3: Refund Drill
    process.stderr.write('Running Drill 3: Refund drill...\n');
    results.refund = await runProbe(
      {
        network: 'testnet',
        execute: false,
        direction: 'EVM_TO_BCH',
        mode: 'refund',
        token: 'PUSD',
        chainId: BASE_SEPOLIA_CHAIN_ID,
        amountUsd: 1,
        maxUsd: 1,
        solverUrl: 'http://127.0.0.1:8789',
        recoveryDir: '.probe-recovery',
        pollIntervalMs: 1000,
        timeoutMs: 30000,
        bchFeeRateSatPerByte: 1.2,
      },
      {
        evmPort,
        bchPort,
        nowSeconds: () => Math.floor(Date.now() / 1000),
      },
    );

    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } finally {
    await solverInstance.stop();
  }
}

main().catch((err) => {
  console.error('Drill failed:', err);
  process.exit(1);
});
