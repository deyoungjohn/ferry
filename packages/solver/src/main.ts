import { loadConfigFromEnv } from './config.js';
import { createSolverLogger } from './logging.js';
import { runPreflightCheck } from './ops/self-check.js';
import { SolverDatabase } from './db/database.js';
import { BchQuorumClient } from './bch/quorum-client.js';
import { EvmChainAdapter, type EvmChainAdapterOptions } from '@ferry/chain-evm';
import { loadChainConfig } from '@ferry/chain-config';
import { SolverEngine } from './engine/runner.js';
import { MockPriceSource, type PriceSource } from './pricing/price-source.js';
import { buildServer } from './api/server.js';
import type {
  BchChainPort,
  EvmChainPort,
  EvmLockState,
} from './engine/types.js';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';

export async function startSolver(): Promise<void> {
  const config = loadConfigFromEnv(process.env);
  const logger = createSolverLogger();

  // 1. Run strict preflight safety checks
  runPreflightCheck(config);
  logger.info(
    { network: config.network, host: config.host, port: config.port },
    'Preflight checks passed',
  );

  // 2. Initialize database
  const db = new SolverDatabase(config.dbPath);
  logger.info({ dbPath: config.dbPath }, 'Solver database initialized');

  // 3. Initialize BCH Quorum Client
  const electrumUrls = config.bchElectrumUrls
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const bchClient = new BchQuorumClient(electrumUrls);

  // 4. Initialize EVM Client & Adapter
  const targetNetwork = config.network === 'mainnet' ? 'mainnet' : 'testnet';
  const fullChainConfig = loadChainConfig();
  const chainConfig = fullChainConfig.chains.find(
    (c) => c.id === 'base' && c.network === targetNetwork,
  );
  if (!chainConfig) {
    throw new Error(`Chain configuration for base ${targetNetwork} not found`);
  }

  const viemChain = config.network === 'mainnet' ? base : baseSepolia;
  const evmAccount = config.solverEvmPrivateKey
    ? privateKeyToAccount(config.solverEvmPrivateKey as `0x${string}`)
    : undefined;

  const walletClient = evmAccount
    ? createWalletClient({
        account: evmAccount,
        chain: viemChain,
        transport: http(config.baseRpcUrl),
      })
    : undefined;

  const evmAdapter = new EvmChainAdapter({
    config: chainConfig as unknown as EvmChainAdapterOptions['config'],
    walletClient,
  });

  // 5. Initialize Ports
  const bchPort: BchChainPort = {
    async getTip() {
      const q = bchClient.getQuorumStatus();
      return { height: q.quorumTip, hash: '' };
    },
    isQuorumHealthy() {
      return bchClient.getQuorumStatus().isQuorumHealthy;
    },
    isQuotingEnabled() {
      return bchClient.getQuorumStatus().isQuorumHealthy;
    },
    async broadcast(txHex: string) {
      return bchClient.broadcast(txHex);
    },
    async isOnChain() {
      return true;
    },
    async getScriptHashHistory(hash: string) {
      const entries = await bchClient.getHistory(hash);
      return entries.map((e) => ({ tx_hash: e.tx_hash, height: e.height }));
    },
    waitForDoubleSpendProof(txid: string, windowMs?: number) {
      return bchClient.waitForDoubleSpendProof(txid, windowMs);
    },
  };

  const evmPort: EvmChainPort = {
    async getTip() {
      const tip = await evmAdapter.getTip();
      return { height: tip.height, finalized: tip.ageSeconds <= 60 };
    },
    async getLock(lockId: string) {
      const lock = await evmAdapter.getLock(lockId);
      return { status: lock.status as unknown as EvmLockState['status'] };
    },
    async isFinal() {
      return true;
    },
    async broadcast(txHex: string) {
      return txHex;
    },
    async isOnChain() {
      return true;
    },
  };

  // 6. Initialize Solver Engine
  const engine = new SolverEngine(db, bchPort, evmPort, {
    dsproofWindowMs: config.dsproofWindowMs,
    pollIntervalMs: 1000,
  });

  // 7. Initialize Price Source
  const priceSource: PriceSource = new MockPriceSource(
    new Map([
      [
        'usdc',
        {
          usdPrice: 1_000_000n,
          source: 'chainlink-base-0.3%',
          asOf: Math.floor(Date.now() / 1000),
          heartbeatSeconds: 86_400,
        },
      ],
      [
        'pusd',
        {
          usdPrice: 1_000_000n,
          source: 'cauldron-chipnet',
          asOf: Math.floor(Date.now() / 1000),
        },
      ],
      [
        'musd',
        {
          usdPrice: 1_000_000n,
          source: 'paryon-chipnet',
          asOf: Math.floor(Date.now() / 1000),
        },
      ],
    ]),
  );

  // 8. Build Fastify Server
  const app = buildServer({
    config,
    db,
    evmAdapter,
    bchClient,
    engine,
    priceSource,
    logger,
  });

  // 9. Start background services
  await bchClient.connect();
  await engine.start();

  const address = await app.listen({
    port: config.port,
    host: config.host,
  });
  logger.info({ address }, 'Ferry solver HTTP server listening');

  // 10. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down Ferry solver');
    try {
      await app.close();
      await engine.stop();
      bchClient.close();
      db.close();
      logger.info('Ferry solver stopped cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test' && !process.env.FERRY_TEST_MODE) {
  const isDirectRun =
    typeof process.argv[1] === 'string' &&
    (process.argv[1].endsWith('main.ts') ||
      process.argv[1].endsWith('main.js'));
  if (isDirectRun) {
    startSolver().catch((err) => {
      console.error('Fatal solver startup error:', err);
      process.exit(1);
    });
  }
}
