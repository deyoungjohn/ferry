import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import {
  decodeHtlcLog,
  EvmChainAdapter,
  type EvmChainAdapterOptions,
} from '@ferry/chain-evm';
import type { Hex32, OrderTerms } from '@ferry/core';
import { createBchPriceSource } from '@ferry/bch-prices';
import type { ChainId } from '@ferry/chain-config';
import { buildServer } from './api/server.js';
import { extractSecretFromSpendTx } from './bch/lock-builder.js';
import { BchQuorumClient } from './bch/quorum-client.js';
import { loadConfigFromEnv, type SolverConfig } from './config.js';
import { SolverDatabase } from './db/database.js';
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

    const publicClient = createPublicClient({
      chain: viemChain,
      transport:
        rpcUrls.length === 1
          ? http(rpcUrls[0])
          : fallback(rpcUrls.map((u) => http(u))),
    });

    const walletClient = evmAccount
      ? createWalletClient({
          account: evmAccount,
          chain: viemChain,
          transport: http(rpcUrls[0]),
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
      transport: http(config.baseRpcUrl),
    });
    const walletClient = evmAccount
      ? createWalletClient({
          account: evmAccount,
          chain: viemChain,
          transport: http(config.baseRpcUrl),
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
      finality: { fast: 1, safe: 'finalized' as const },
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
    async isOnChain(txid: string) {
      try {
        const tx = await bchClient.getTransaction(txid, false);
        return tx !== null && tx !== undefined;
      } catch {
        return false;
      }
    },
    async getScriptHashHistory(hash: string) {
      const entries = await bchClient.getHistory(hash);
      return entries.map((e) => ({ tx_hash: e.tx_hash, height: e.height }));
    },
    waitForDoubleSpendProof(txid: string, windowMs?: number) {
      return bchClient.waitForDoubleSpendProof(txid, windowMs);
    },
    async listUnspent(
      scriptHash: string,
      filter?: 'include_tokens' | 'tokens_only' | 'exclude_tokens',
    ) {
      return bchClient.listUnspent(scriptHash, filter ?? 'include_tokens');
    },
    async extractSecretFromSpend(txid: string, hashLock?: string) {
      try {
        const raw = (await bchClient.getTransaction(txid, false)) as string;
        if (!raw || typeof raw !== 'string') return null;
        return extractSecretFromSpendTx(raw, hashLock);
      } catch {
        return null;
      }
    },
  };

  const evmPort: EvmChainPort = {
    async getTip() {
      const tip = await evmAdapter.getTip();
      return { height: tip.height, finalized: tip.ageSeconds <= 60 };
    },
    async getLock(lockId: string) {
      const lock = await evmAdapter.getLock(lockId);
      return {
        status: lock.status === 'absent' ? 'none' : lock.status,
        txid:
          lock.status === 'locked'
            ? lock.lockTx.txId
            : lock.status === 'claimed'
              ? lock.claimTx.txId
              : lock.status === 'refunded'
                ? lock.refundTx?.txId
                : undefined,
        secret:
          lock.status === 'claimed' && lock.secret ? lock.secret : undefined,
      };
    },
    async isFinal(txid: string, lane: 'safe' | 'fast') {
      return evmAdapter.isFinal(
        { chain: evmAdapter.id, txId: txid as Hex32 },
        lane,
      );
    },
    async broadcast(txHex: string) {
      if (txHex.startsWith('0x') && txHex.length > 66) {
        const publicClient =
          evmClients.get('base') ??
          (evmAdapter as unknown as { client: PublicClient }).client;
        return publicClient.sendRawTransaction({
          serializedTransaction: txHex as `0x${string}`,
        });
      }
      return txHex;
    },
    async isOnChain(txid: string) {
      try {
        const publicClient =
          evmClients.get('base') ??
          (evmAdapter as unknown as { client: PublicClient }).client;
        const receipt = await publicClient.getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        return receipt !== null && receipt.status === 'success';
      } catch {
        return false;
      }
    },
    async extractSecretFromClaim(txid: string) {
      try {
        const publicClient =
          evmClients.get('base') ??
          (evmAdapter as unknown as { client: PublicClient }).client;
        const receipt = await publicClient.getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        if (!receipt) return null;
        for (const log of receipt.logs) {
          if (
            log.address.toLowerCase() !== evmAdapter.htlcAddress.toLowerCase()
          )
            continue;
          const event = decodeHtlcLog(log, evmAdapter.id, evmAdapter.assets);
          if (event?.type === 'Claimed' && event.secret) {
            return event.secret;
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    async lock(terms: OrderTerms) {
      const adapter = evmAdapters.get(String(terms.evmChainId)) ?? evmAdapter;
      const ref = await adapter.lock(terms);
      return { txid: ref.txId, txHex: ref.txId };
    },
    async claim(lockId: string, secret: `0x${string}`) {
      const ref = await evmAdapter.claim(lockId, secret);
      return { txid: ref.txId, txHex: ref.txId };
    },
  };

  // 7. Initialize Solver Engine
  const engine = new SolverEngine(db, bchPort, evmPort, {
    dsproofWindowMs: config.dsproofWindowMs,
    pollIntervalMs: 1000,
    solverBchWif: config.solverBchWif,
    bchNetwork: config.network === 'mainnet' ? 'mainnet' : 'chipnet',
    executionReady: config.executionReady,
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
