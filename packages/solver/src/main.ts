import {
  createPublicClient,
  createWalletClient,
  type PublicClient,
} from 'viem';
import { rpcTransport } from '@ferry/chain-evm';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { EvmChainAdapter, type EvmChainAdapterOptions } from '@ferry/chain-evm';
import { createBchPriceSource } from '@ferry/bch-prices';
import type { ChainId } from '@ferry/chain-config';
import { buildServer } from './api/server.js';
import { BchQuorumClient } from './bch/quorum-client.js';
import { loadConfigFromEnv, type SolverConfig } from './config.js';
import { SolverDatabase } from './db/database.js';
import { createBchPort, createEvmPort } from './ports.js';
import { SolverEngine } from './engine/runner.js';
import type { BchChainPort, EvmChainPort } from './engine/types.js';
import { createSolverLogger } from './logging.js';
import { runPreflightCheck } from './ops/self-check.js';
import { buildActiveRoutes, getViemChain } from './ops/routes-config.js';
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

  const bchClient =
    overrides.bchClient ??
    new BchQuorumClient(electrumUrls, {
      network: config.network === 'mainnet' ? 'mainnet' : 'chipnet',
      tipMaxAgeBchSeconds: config.tipMaxAgeBchSeconds,
    });

  // 5. Initialize EVM Clients & Adapters for every enabled chain
  const evmAdapters = new Map<string, EvmChainAdapter>();
  const evmClients = new Map<ChainId, PublicClient>();

  const evmAccount = config.solverEvmPrivateKey
    ? privateKeyToAccount(config.solverEvmPrivateKey as `0x${string}`)
    : undefined;

  for (const coreChain of routesContext.chainConfig.coreChains) {
    const chainFact = routesContext.chainConfig.facts.find(
      (c) => c.id === coreChain.id,
    );
    const viemChain = getViemChain(coreChain.id, config.network);
    const rpcUrls =
      coreChain.rpcUrls.length > 0
        ? coreChain.rpcUrls
        : (chainFact?.rpcUrls ?? []);
    if (rpcUrls.length === 0) continue;

    // Reads and sends both fail over: a rate-limited endpoint hands over to the next one.
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: rpcTransport(rpcUrls),
    });

    const walletClient = evmAccount
      ? createWalletClient({
          account: evmAccount,
          chain: viemChain,
          transport: rpcTransport(rpcUrls),
        })
      : undefined;

    const adapter = new EvmChainAdapter({
      config: coreChain as EvmChainAdapterOptions['config'],
      client: publicClient as unknown as EvmChainAdapterOptions['client'],
      walletClient:
        walletClient as unknown as EvmChainAdapterOptions['walletClient'],
      deployBlock: chainFact?.deployment.deployBlock
        ? BigInt(chainFact.deployment.deployBlock)
        : undefined,
      maxLogRange: chainFact?.rpcEndpoints[0]?.maxLogRange
        ? BigInt(chainFact.rpcEndpoints[0].maxLogRange)
        : undefined,
    });

    evmAdapters.set(coreChain.id, adapter);
    evmAdapters.set(String(coreChain.chainId), adapter);
    evmClients.set(
      coreChain.id as ChainId,
      publicClient as unknown as PublicClient,
    );
  }

  // Base adapter fallback (guarantees base is always present)
  let baseAdapter = evmAdapters.get('base');
  if (!baseAdapter) {
    const viemChain = config.network === 'mainnet' ? base : baseSepolia;
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: rpcTransport([config.baseRpcUrl]),
    });
    const walletClient = evmAccount
      ? createWalletClient({
          account: evmAccount,
          chain: viemChain,
          transport: rpcTransport([config.baseRpcUrl]),
        })
      : undefined;
    const baseFact = routesContext.chainConfig.facts.find(
      (c) => c.id === 'base',
    );
    const baseCoreConfig = routesContext.chainConfig.coreChains.find(
      (c) => c.id === 'base',
    ) ?? {
      id: 'base' as const,
      chainId: config.baseChainId,
      rpcUrls: [config.baseRpcUrl],
      htlcAddress: (config.baseHtlcAddress ||
        baseFact?.htlcAddress ||
        baseFact?.deployment.predictedHtlcAddress ||
        '0x0000000000000000000000000000000000000000') as `0x${string}`,
      relayCostUsd: 0.05,
      // Base's `safe` block (its data is on L1) trails the head by under a minute; `finalized`
      // trails it by about 15 minutes, which is what made every swap slow.
      finality: { fast: 1, safe: 'safe' as const },
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
    baseAdapter = new EvmChainAdapter({
      config: baseCoreConfig as EvmChainAdapterOptions['config'],
      client: publicClient as unknown as EvmChainAdapterOptions['client'],
      walletClient:
        walletClient as unknown as EvmChainAdapterOptions['walletClient'],
    });
    evmAdapters.set('base', baseAdapter);
    evmAdapters.set(String(config.baseChainId), baseAdapter);
    evmClients.set('base', publicClient as unknown as PublicClient);
  }
  const evmAdapter = baseAdapter;

  // 6. Initialize Ports
  const bchPort: BchChainPort = createBchPort(bchClient);

  const evmPort: EvmChainPort = createEvmPort({
    evmAdapter,
    evmAdapters,
    evmClients,
  });

  // 7. Initialize Solver Engine
  const engine = new SolverEngine(db, bchPort, evmPort, {
    dsproofWindowMs: config.dsproofWindowMs,
    pollIntervalMs: 3000,
    solverBchWif: config.solverBchWif,
    bchNetwork: config.network === 'mainnet' ? 'mainnet' : 'chipnet',
    executionReady: config.executionReady,
    onEngineEvent: (info, message) => logger.info(info, message),
    onOrderError: (orderId, status, error) =>
      logger.error(
        {
          orderId,
          status,
          error: error instanceof Error ? error.message : String(error),
        },
        'Engine could not move the order',
      ),
  });

  // 8. Initialize Price Source (Composite from BCH & EVM facts)
  const priceSource: PriceSource =
    overrides.priceSource ??
    new RoutePriceSource({
      chainConfig: routesContext.chainConfig,
      evmClients,
      bchSource: createBchPriceSource(),
      pegToleranceUsdMicros: config.pegToleranceUsdMicros,
      sourceDisagreementWarnUsdMicros: config.sourceDisagreementWarnUsdMicros,
      sourceDisagreementRefuseUsdMicros:
        config.sourceDisagreementRefuseUsdMicros,
      paryonMaxAgeSeconds: config.paryonMaxAgeSeconds,
    });

  // 9. Build Fastify Server
  const app = buildServer({
    config,
    db,
    evmAdapter: baseAdapter,
    evmAdapters,
    evmClients,
    routesContext,
    bchClient,
    engine,
    priceSource,
    logger,
    publicClient: evmClients.get('base'),
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
