import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { EvmChainAdapter, type EvmChainAdapterOptions } from '@ferry/chain-evm';
import { createBchPriceSource } from '@ferry/bch-prices';
import { buildServer } from './api/server.js';
import { BchQuorumClient } from './bch/quorum-client.js';
import { loadConfigFromEnv, type SolverConfig } from './config.js';
import { SolverDatabase } from './db/database.js';
import { SolverEngine } from './engine/runner.js';
import type {
  BchChainPort,
  EvmChainPort,
  EvmLockState,
} from './engine/types.js';
import { createSolverLogger } from './logging.js';
import { runPreflightCheck } from './ops/self-check.js';
import { buildActiveRoutes } from './ops/routes-config.js';
import { RoutePriceSource } from './pricing/composite-source.js';
import type { PriceSource } from './pricing/price-source.js';

export interface RunningSolver {
  app: ReturnType<typeof buildServer>;
  engine: SolverEngine;
  bchClient: BchQuorumClient;
  db: SolverDatabase;
  stop: () => Promise<void>;
}

export async function startSolver(
  overrides: {
    config?: SolverConfig | undefined;
    priceSource?: PriceSource | undefined;
    bchClient?: BchQuorumClient | undefined;
    skipListen?: boolean | undefined;
  } = {},
): Promise<RunningSolver> {
  const config = overrides.config ?? loadConfigFromEnv(process.env);
  const logger = createSolverLogger({
    logFilePath: config.logFilePath,
    minLevel: config.logLevel,
  });

  // 1. Run strict preflight safety checks
  runPreflightCheck(config);
  logger.info(
    { network: config.network, host: config.host, port: config.port },
    'Preflight checks passed',
  );

  // 2. Configure routes from facts and verify mainnet profile
  const routesContext = buildActiveRoutes(config, process.env);
  logger.info(
    {
      totalRoutes: routesContext.routes.length,
      enabledRoutes: routesContext.enabledRoutes.map((r) => r.key),
    },
    'Configured routes from facts',
  );

  // 3. Initialize database
  const db = new SolverDatabase(config.dbPath);
  logger.info({ dbPath: config.dbPath }, 'Solver database initialized');

  // 4. Initialize BCH Quorum Client
  const electrumUrls = config.bchElectrumUrls
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const bchClient = overrides.bchClient ?? new BchQuorumClient(electrumUrls);

  // 5. Initialize EVM Client & Adapter
  const targetNetwork = config.network === 'mainnet' ? 'mainnet' : 'testnet';
  const chainFact = routesContext.chainConfig.facts.find(
    (c) => c.id === 'base',
  );
  if (!chainFact) {
    throw new Error(`Chain configuration for base ${targetNetwork} not found`);
  }

  const viemChain = config.network === 'mainnet' ? base : baseSepolia;
  const evmAccount = config.solverEvmPrivateKey
    ? privateKeyToAccount(config.solverEvmPrivateKey as `0x${string}`)
    : undefined;

  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(config.baseRpcUrl),
  });

  const walletClient = evmAccount
    ? createWalletClient({
        account: evmAccount,
        chain: viemChain,
        transport: http(config.baseRpcUrl),
      })
    : undefined;

  const baseCoreConfig = routesContext.chainConfig.coreChains.find(
    (c) => c.id === 'base',
  ) ?? {
    id: 'base' as const,
    chainId: config.baseChainId,
    rpcUrls: [config.baseRpcUrl],
    htlcAddress: (config.baseHtlcAddress ||
      chainFact.htlcAddress ||
      chainFact.deployment.predictedHtlcAddress) as `0x${string}`,
    relayCostUsd: 0.05,
    finality: {
      fast: 1,
      safe: 'finalized' as const,
    },
    assets: [
      {
        symbol: 'USDC' as const,
        decimals: 6,
        address: (config.baseUsdcAddress ||
          '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`,
        permit: true,
      },
    ],
  };

  const coreChainConfig = {
    ...baseCoreConfig,
    ...(config.baseHtlcAddress
      ? { htlcAddress: config.baseHtlcAddress as `0x${string}` }
      : {}),
  };

  const evmAdapter = new EvmChainAdapter({
    config: coreChainConfig as EvmChainAdapterOptions['config'],
    walletClient,
  });

  // 6. Initialize Ports
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

  // 7. Initialize Solver Engine
  const engine = new SolverEngine(db, bchPort, evmPort, {
    dsproofWindowMs: config.dsproofWindowMs,
    pollIntervalMs: 1000,
  });

  // 8. Initialize Price Source (Composite from BCH & EVM facts)
  const priceSource: PriceSource =
    overrides.priceSource ??
    new RoutePriceSource({
      chainConfig: routesContext.chainConfig,
      evmClients: new Map([['base', publicClient as unknown as PublicClient]]),
      bchSource: createBchPriceSource(),
    });

  // 9. Build Fastify Server
  const app = buildServer({
    config,
    db,
    evmAdapter,
    bchClient,
    engine,
    priceSource,
    logger,
    publicClient: publicClient as unknown as PublicClient,
  });

  // 10. Start background services
  await bchClient.connect();
  await engine.start();

  if (!overrides.skipListen) {
    const address = await app.listen({
      port: config.port,
      host: config.host,
    });
    logger.info({ address }, 'Ferry solver HTTP server listening');
  }

  const stop = async () => {
    logger.info('Stopping Ferry solver services');
    await app.close();
    await engine.stop();
    bchClient.close();
    db.close();
    logger.info('Ferry solver stopped cleanly');
  };

  return {
    app,
    engine,
    bchClient,
    db,
    stop,
  };
}

if (process.env.NODE_ENV !== 'test' && !process.env.FERRY_TEST_MODE) {
  const isDirectRun =
    typeof process.argv[1] === 'string' &&
    (process.argv[1].endsWith('main.ts') ||
      process.argv[1].endsWith('main.js'));
  if (isDirectRun) {
    startSolver()
      .then((running) => {
        const shutdown = async (signal: string) => {
          console.log(`Received ${signal}, shutting down...`);
          try {
            await running.stop();
            process.exit(0);
          } catch (err) {
            console.error('Error during shutdown:', err);
            process.exit(1);
          }
        };
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));
      })
      .catch((err) => {
        console.error('Fatal solver startup error:', err);
        process.exit(1);
      });
  }
}
