import { type PublicClient, createPublicClient, http, fallback } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EvmChainAdapter, type EvmChainAdapterOptions } from '@ferry/chain-evm';
import { createBchPriceSource } from '@ferry/bch-prices';
import type { FastifyInstance } from 'fastify';
import type { SolverRoutesContext } from './routes-config.js';
import { loadConfigFromEnv, type SolverConfig } from '../config.js';
import { buildActiveRoutes, getViemChain } from './routes-config.js';
import { BchQuorumClient } from '../bch/quorum-client.js';
import { InventoryReader } from '../pricing/inventory-reader.js';
import { RoutePriceSource } from '../pricing/composite-source.js';
import type { PriceSource } from '../pricing/price-source.js';
import { formatUsdMicrosToDecimal } from '../pricing/price-source.js';
import {
  LiveCostModelReader,
  calculateRouteCost,
  applyCostModelToQuote,
  type LiveCostInputs,
} from '../pricing/cost-model.js';
import { buildServer } from '../api/server.js';
import { SolverDatabase } from '../db/database.js';
import { SolverEngine } from '../engine/runner.js';
import type { BchChainPort, EvmChainPort } from '../engine/types.js';

export interface RouteSelfCheckVerdict {
  routeKey: string;
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
  accepted: boolean;
  verdict: string;
}

export interface SelfCheckReport {
  passed: boolean;
  output: string;
  verdicts: RouteSelfCheckVerdict[];
}

export interface SelfCheckOptions {
  config?: SolverConfig | undefined;
  env?: Record<string, string | undefined> | undefined;
  app?: FastifyInstance | undefined;
  bchClient?: BchQuorumClient | undefined;
  inventoryReader?: InventoryReader | undefined;
  priceSource?: PriceSource | undefined;
  costModelReader?: LiveCostModelReader | undefined;
  evmAdapters?: Map<string, EvmChainAdapter> | undefined;
  evmClients?: Map<string, PublicClient> | undefined;
  routesContext?: SolverRoutesContext | undefined;
  db?: SolverDatabase | undefined;
  out?: ((line: string) => void) | undefined;
}

export async function runSelfCheck(
  options: SelfCheckOptions = {},
): Promise<SelfCheckReport> {
  const lines: string[] = [];
  const log = (line: string = '') => {
    lines.push(line);
    if (options.out) {
      options.out(line);
    }
  };

  const config =
    options.config ?? loadConfigFromEnv(options.env ?? process.env);
  const routesContext = buildActiveRoutes(config, options.env ?? process.env);

  // Effective policy calculation
  const defaultReservationCap =
    config.maxSwapUsdMicros * 2n < config.maxExposureUsdMicros
      ? config.maxSwapUsdMicros * 2n
      : config.maxExposureUsdMicros;
  const reservationCapPerAddress =
    config.reservationCapPerAddressUsdMicros ?? defaultReservationCap;
  const reservationCapPerIp =
    config.reservationCapPerIpUsdMicros ?? defaultReservationCap;

  log('================================================================');
  log('                   FERRY SOLVER SELF-CHECK                      ');
  log('================================================================');
  log('');
  log('1. Effective Policy:');
  log(`   - Network:                ${config.network}`);
  log(
    `   - Minimum Swap:           $${(Number(config.minSwapUsdMicros) / 1e6).toFixed(2)} (${config.minSwapUsdMicros} micros)`,
  );
  log(
    `   - Maximum Swap (Cap):     $${(Number(config.maxSwapUsdMicros) / 1e6).toFixed(2)} (${config.maxSwapUsdMicros} micros)`,
  );
  log(
    `   - Maximum Exposure:       $${(Number(config.maxExposureUsdMicros) / 1e6).toFixed(2)} (${config.maxExposureUsdMicros} micros)`,
  );
  log(
    `   - Reservation Cap (Addr): $${(Number(reservationCapPerAddress) / 1e6).toFixed(2)} (${reservationCapPerAddress} micros)`,
  );
  log(
    `   - Reservation Cap (IP):   $${(Number(reservationCapPerIp) / 1e6).toFixed(2)} (${reservationCapPerIp} micros)`,
  );
  log(`   - Base Spread:            ${config.spreadBps} bps`);
  log(
    `   - Fixed Route Fee:        $${(Number(config.fixedFeeUsdMicros) / 1e6).toFixed(2)} (${config.fixedFeeUsdMicros} micros)`,
  );
  log(`   - Quote TTL:              ${config.quoteTtlSeconds}s`);
  log(`   - Max Skew:               ${config.skewMaxBps} bps`);
  log('');

  // 2. Initialize BCH Quorum Client if not provided
  const electrumUrls = config.bchElectrumUrls
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const bchClient =
    options.bchClient ??
    new BchQuorumClient(electrumUrls, {
      network: config.network === 'mainnet' ? 'mainnet' : 'chipnet',
      tipMaxAgeBchSeconds: config.tipMaxAgeBchSeconds,
    });

  if (!options.bchClient) {
    try {
      await bchClient.connect();
    } catch (err) {
      log(
        `   ! BCH Electrum connection error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Initialize EVM Adapters and Clients
  const evmAdapters = options.evmAdapters ?? new Map<string, EvmChainAdapter>();
  const evmClients = options.evmClients ?? new Map<string, PublicClient>();
  const solverAccount = privateKeyToAccount(
    config.solverEvmPrivateKey as `0x${string}`,
  );

  if (!options.evmAdapters) {
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

      const adapter = new EvmChainAdapter({
        config: coreChain as EvmChainAdapterOptions['config'],
        client: publicClient as unknown as EvmChainAdapterOptions['client'],
        deployBlock: chainFact?.deployment.deployBlock
          ? BigInt(chainFact.deployment.deployBlock)
          : undefined,
        maxLogRange: chainFact?.rpcEndpoints[0]?.maxLogRange
          ? BigInt(chainFact.rpcEndpoints[0].maxLogRange)
          : undefined,
      });

      evmAdapters.set(coreChain.id, adapter);
      evmAdapters.set(String(coreChain.chainId), adapter);
      evmClients.set(coreChain.id, publicClient as unknown as PublicClient);
    }
  }

  // 4. Initialize Inventory Reader
  const baseAdapter =
    evmAdapters.get('base') ?? evmAdapters.get(String(config.baseChainId));
  const inventoryReader =
    options.inventoryReader ??
    new InventoryReader({
      config,
      bchClient,
      evmAdapter: baseAdapter!,
      evmAdapters,
      evmClients: evmClients as Map<string, PublicClient>,
      solverEvmAddress: solverAccount.address,
    });

  // 5. Initialize Price Source
  const priceSource =
    options.priceSource ??
    new RoutePriceSource({
      chainConfig: routesContext.chainConfig,
      evmClients: evmClients as unknown as Map<
        import('@ferry/chain-config').ChainId,
        PublicClient
      >,
      bchSource: createBchPriceSource(),
      pegToleranceUsdMicros: config.pegToleranceUsdMicros,
      sourceDisagreementWarnUsdMicros: config.sourceDisagreementWarnUsdMicros,
      sourceDisagreementRefuseUsdMicros:
        config.sourceDisagreementRefuseUsdMicros,
      paryonMaxAgeSeconds: config.paryonMaxAgeSeconds,
    });

  // 6. Inspect Chain Tips
  log('2. Chain Tips & Node Freshness:');
  const quorum = bchClient.getQuorumStatus();
  const bchAge =
    quorum.ageSeconds === Infinity ? 'unknown' : `${quorum.ageSeconds}s`;
  log(
    `   - Bitcoin Cash:  tip height ${quorum.quorumTip ?? 0}, age ${bchAge} (max: ${config.tipMaxAgeBchSeconds}s, healthy: ${quorum.isQuorumHealthy})`,
  );

  for (const enabledRoute of routesContext.enabledRoutes) {
    const chainKey = enabledRoute.chain.toLowerCase();
    const adapter = evmAdapters.get(chainKey);
    if (adapter) {
      try {
        const tip = await adapter.getTip();
        log(
          `   - EVM (${chainKey.padEnd(8)}): tip block ${tip.height}, age ${tip.ageSeconds}s (max: ${config.tipMaxAgeBaseSeconds}s, stale: ${Boolean((tip as { stale?: boolean }).stale)})`,
        );
      } catch (err) {
        log(
          `   - EVM (${chainKey.padEnd(8)}): tip read failed (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
  }
  log('');

  // 7. Inspect Real Inventory
  log('3. Real Wallet Inventory:');
  try {
    const bchInv = await inventoryReader.getBchInventory();
    log(
      `   - BCH PUSD:      ${(Number(bchInv.pusd) / 100).toFixed(2)} PUSD (${bchInv.pusd} atoms)`,
    );
    log(
      `   - BCH MUSD:      ${(Number(bchInv.musd) / 100).toFixed(2)} MUSD (${bchInv.musd} atoms)`,
    );
    log(
      `   - BCH Fee Sats:  ${bchInv.sats} satoshis (${(Number(bchInv.sats) / 1e8).toFixed(8)} BCH)`,
    );
  } catch (err) {
    log(
      `   - BCH Inventory: read failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  for (const enabledRoute of routesContext.enabledRoutes) {
    const chainKey = enabledRoute.chain.toLowerCase();
    const tokenSymbol = enabledRoute.asset;
    try {
      const evmInv = await inventoryReader.getEvmInventory(chainKey);
      const chainFact = routesContext.chainConfig.facts.find(
        (f) => f.id === chainKey,
      );
      const tokenFact = chainFact?.assets.find((a) => a.symbol === tokenSymbol);
      const decimals = tokenFact?.decimals ?? 6;
      const tokBal = tokenFact?.address
        ? (evmInv.tokens.get(tokenFact.address.toLowerCase()) ?? 0n)
        : 0n;

      log(
        `   - EVM (${chainKey.padEnd(8)}): native gas ${(Number(evmInv.nativeWei) / 1e18).toFixed(6)} (${evmInv.nativeWei} wei)`,
      );
      log(
        `   - EVM (${chainKey.padEnd(8)}): ${tokenSymbol} balance ${(Number(tokBal) / 10 ** decimals).toFixed(decimals)} (${tokBal} base units)`,
      );
    } catch (err) {
      log(
        `   - EVM (${chainKey.padEnd(8)}): read failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  log('');

  // 8. Inspect Price Feed Readings
  log('4. Price Feed Readings:');
  const assetsToCheck = ['PUSD', 'MUSD', 'USDC'];
  for (const asset of assetsToCheck) {
    try {
      const reading = priceSource.getDetailedPrice
        ? await priceSource.getDetailedPrice(asset)
        : await priceSource.getPrice(asset);
      log(
        `   - ${asset.padEnd(6)}: $${formatUsdMicrosToDecimal(reading.usdPrice)} (${reading.source}, asOf: ${reading.asOf})`,
      );
    } catch (err) {
      log(
        `   - ${asset.padEnd(6)}: price read failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  log('');

  // 9. Build or use Fastify app for $1 dryRun quotes
  const db = options.db ?? new SolverDatabase(':memory:');
  const dummyBchPort: BchChainPort = {
    async getTip() {
      return { height: quorum.quorumTip, hash: '' };
    },
    isQuorumHealthy() {
      return quorum.isQuorumHealthy;
    },
    isQuotingEnabled() {
      return quorum.isQuorumHealthy;
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
    async waitForDoubleSpendProof(txid: string, windowMs?: number) {
      const res = await bchClient.waitForDoubleSpendProof(txid, windowMs);
      return res ?? { hasProof: false };
    },
  };

  const dummyEvmPort: EvmChainPort = {
    async getTip() {
      return { height: 1, finalized: true };
    },
    async getLock() {
      return { status: 'none' as const };
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

  const engine = new SolverEngine(db, dummyBchPort, dummyEvmPort, {
    dsproofWindowMs: config.dsproofWindowMs,
  });

  const liveCostClient =
    evmClients.get('base') ??
    (baseAdapter as unknown as { client?: PublicClient })?.client;

  const costModelReader =
    options.costModelReader ??
    (liveCostClient
      ? new LiveCostModelReader({
          client: liveCostClient,
          bchClient,
          ethUsdFeedAddress: config.ethUsdFeedAddress as `0x${string}`,
          limits: {
            ethUsdMaxAgeSeconds: config.ethUsdMaxAgeSeconds,
            bchUsdMaxAgeSeconds: config.bchUsdMaxAgeSeconds,
            baseGasMaxAgeSeconds: config.baseGasMaxAgeSeconds,
            bchFeeRateMaxAgeSeconds: config.bchFeeRateMaxAgeSeconds,
            bchUsdDisagreementPercent: config.bchUsdDisagreementPercent,
          },
          costSafetyPercent: config.costSafetyPercent,
          minMarginUsdMicros: config.minMarginUsdMicros,
          cacheTtlSeconds: config.costCacheTtlSeconds,
        })
      : undefined);

  const app =
    options.app ??
    buildServer({
      config,
      db,
      evmAdapter: baseAdapter!,
      evmAdapters,
      evmClients: evmClients as Map<string, PublicClient>,
      routesContext,
      bchClient,
      engine,
      priceSource,
      inventoryReader,
      costModelReader,
    });

  // 10. Inspect Live Cost Model Inputs & Route Economics
  log('5. Live Cost Model Inputs & Route Economics:');
  let liveInputs: LiveCostInputs | undefined;
  let allPassed = true;
  if (!costModelReader) {
    if (options.evmAdapters) {
      log('   - Live cost model reader: not configured for mock EVM adapters');
    } else {
      allPassed = false;
      log(
        '   [FAIL] No Base EVM client configured to read live cost model inputs',
      );
    }
  } else {
    try {
      liveInputs = await costModelReader.readLiveInputs();
      const now = Math.floor(Date.now() / 1000);
      const ethAge = now - liveInputs.ethUsd.asOf;
      const bchAge = now - liveInputs.bchUsd.asOf;
      const gasAge = now - liveInputs.baseGas.asOf;
      const feeAge = now - liveInputs.bchFeeRate.asOf;

      log(
        `   - ETH/USD:       $${formatUsdMicrosToDecimal(liveInputs.ethUsd.usdPriceMicros)} (${liveInputs.ethUsd.source}, asOf: ${liveInputs.ethUsd.asOf}, age: ${ethAge}s)`,
      );
      log(
        `   - BCH/USD:       $${formatUsdMicrosToDecimal(liveInputs.bchUsd.usdPriceMicros)} (${liveInputs.bchUsd.source}, asOf: ${liveInputs.bchUsd.asOf}, age: ${bchAge}s)`,
      );
      if (liveInputs.bchUsd.components.length > 0) {
        for (const comp of liveInputs.bchUsd.components) {
          log(
            `     * component:   $${formatUsdMicrosToDecimal(comp.usdPriceMicros)} (${comp.source}, age: ${now - comp.asOf}s)`,
          );
        }
      }
      log(
        `   - Base Gas:      ${(Number(liveInputs.baseGas.gasPriceWei) / 1e9).toFixed(4)} gwei (${liveInputs.baseGas.source}, age: ${gasAge}s)`,
      );
      log(
        `   - BCH Fee Rate:  ${liveInputs.bchFeeRate.effectiveSatsPerByte} sats/byte (${liveInputs.bchFeeRate.source}, age: ${feeAge}s)`,
      );

      for (const enabledRoute of routesContext.enabledRoutes) {
        for (const dir of ['EVM_TO_BCH', 'BCH_TO_EVM'] as const) {
          const routeCost = calculateRouteCost({
            direction: dir,
            chainId: enabledRoute.chain,
            inputs: liveInputs,
            safetyMarginPercent: config.costSafetyPercent,
            minMarginUsdMicros: config.minMarginUsdMicros,
            bchCarrySats: config.bchCarrySats,
          });

          const gasCostUsd = formatUsdMicrosToDecimal(
            routeCost.gasCostUsdMicros,
          );
          const bchCostUsd = formatUsdMicrosToDecimal(
            routeCost.bchFeeCostUsdMicros,
          );
          const totalCostUsd = formatUsdMicrosToDecimal(
            routeCost.totalCostUsdMicros,
          );
          const withMarginUsd = formatUsdMicrosToDecimal(
            routeCost.costWithMarginUsdMicros,
          );

          log(
            `   - ${enabledRoute.key} (${dir}): gas $${gasCostUsd} + bch $${bchCostUsd} = cost $${totalCostUsd} (with ${routeCost.safetyMarginPercent}% margin: $${withMarginUsd})`,
          );

          for (const testAmountUsd of [1, 5, 50]) {
            const amountMicros = BigInt(testAmountUsd) * 1_000_000n;
            const adj = applyCostModelToQuote({
              amountInUsdMicros: amountMicros,
              baseSpreadBps: config.spreadBps,
              routeCost,
              costModelEnabled: config.costModelEnabled,
              staticFixedFeeUsdMicros: config.fixedFeeUsdMicros,
            });

            const feeUsd = formatUsdMicrosToDecimal(adj.totalFeeUsdMicros);
            const netUsd = formatUsdMicrosToDecimal(
              adj.solverNetProfitUsdMicros,
            );
            const sign = adj.solverNetProfitUsdMicros >= 0n ? '+' : '';
            log(
              `     * $${testAmountUsd} swap: fee $${feeUsd} (${adj.pricingChoice}), solver net: ${sign}$${netUsd}`,
            );
          }
        }
      }
    } catch (err) {
      allPassed = false;
      log(
        `   [FAIL] Live cost inputs error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  log('');

  // 11. Execute $1 dryRun Quote for Each Enabled Route
  log('6. Dry-Run $1 Quote Verification for Enabled Routes:');
  const verdicts: RouteSelfCheckVerdict[] = [];

  for (const enabledRoute of routesContext.enabledRoutes) {
    const chainFact = routesContext.chainConfig.facts.find(
      (f) => f.id === enabledRoute.chain,
    );
    const tokenFact = chainFact?.assets.find(
      (a) => a.symbol === enabledRoute.asset,
    );
    const requestedChainId = chainFact?.chainId ?? config.baseChainId;
    const requestedToken = tokenFact?.address ?? config.baseUsdcAddress;
    const evmDecimals = tokenFact?.decimals ?? 6;

    // Test A: EVM_TO_BCH ($1 swap: 10^decimals base units, e.g. 1_000_000 for 6 dec)
    const evmAmountIn = (10n ** BigInt(evmDecimals)).toString();
    const fwdRes = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      payload: {
        direction: 'EVM_TO_BCH',
        bchToken: 'PUSD',
        evmChainId: requestedChainId,
        evmToken: requestedToken,
        amountIn: evmAmountIn,
        userEvmAddress: '0x1111111111111111111111111111111111111111',
        userBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        hashLock:
          '0x1111111111111111111111111111111111111111111111111111111111111111',
        dryRun: true,
      },
    });

    const fwdBody = JSON.parse(fwdRes.body);
    if (fwdRes.statusCode === 200) {
      const outAmount = (Number(fwdBody.terms.bchTokenAmount) / 100).toFixed(2);
      const details = `ACCEPTED: pay 1.00 ${enabledRoute.asset} -> receive ${outAmount} PUSD (spread: ${fwdBody.terms.pricing.spreadBps} bps, fixedFee: ${fwdBody.terms.pricing.fixedFeeBase})`;
      verdicts.push({
        routeKey: enabledRoute.key,
        direction: 'EVM_TO_BCH',
        accepted: true,
        verdict: details,
      });
      log(`   [PASS] ${enabledRoute.key.padEnd(14)} (EVM->BCH): ${details}`);
    } else {
      allPassed = false;
      const details = `REFUSED (${fwdBody.reason}): ${fwdBody.message ?? 'Unknown reason'}`;
      verdicts.push({
        routeKey: enabledRoute.key,
        direction: 'EVM_TO_BCH',
        accepted: false,
        verdict: details,
      });
      log(`   [FAIL] ${enabledRoute.key.padEnd(14)} (EVM->BCH): ${details}`);
    }

    // Test B: BCH_TO_EVM ($1 swap: 100 atoms PUSD)
    const bchAmountIn = '100';
    const revRes = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      payload: {
        direction: 'BCH_TO_EVM',
        bchToken: 'PUSD',
        evmChainId: requestedChainId,
        evmToken: requestedToken,
        amountIn: bchAmountIn,
        userEvmAddress: '0x1111111111111111111111111111111111111111',
        userBchLockingBytecode:
          '0x76a914111111111111111111111111111111111111111188ac',
        hashLock:
          '0x1111111111111111111111111111111111111111111111111111111111111111',
        dryRun: true,
      },
    });

    const revBody = JSON.parse(revRes.body);
    if (revRes.statusCode === 200) {
      const outAmount = (
        Number(revBody.terms.evmAmount) /
        10 ** evmDecimals
      ).toFixed(2);
      const details = `ACCEPTED: pay 1.00 PUSD -> receive ${outAmount} ${enabledRoute.asset} (spread: ${revBody.terms.pricing.spreadBps} bps, fixedFee: ${revBody.terms.pricing.fixedFeeBase})`;
      verdicts.push({
        routeKey: enabledRoute.key,
        direction: 'BCH_TO_EVM',
        accepted: true,
        verdict: details,
      });
      log(`   [PASS] ${enabledRoute.key.padEnd(14)} (BCH->EVM): ${details}`);
    } else {
      allPassed = false;
      const details = `REFUSED (${revBody.reason}): ${revBody.message ?? 'Unknown reason'}`;
      verdicts.push({
        routeKey: enabledRoute.key,
        direction: 'BCH_TO_EVM',
        accepted: false,
        verdict: details,
      });
      log(`   [FAIL] ${enabledRoute.key.padEnd(14)} (BCH->EVM): ${details}`);
    }
  }

  log('');
  log('================================================================');
  log(
    `OVERALL VERDICT: ${allPassed ? 'READY FOR $1 SWAP (PASS)' : 'NOT READY - ONE OR MORE ROUTES REFUSED (FAIL)'}`,
  );
  log('================================================================');

  if (!options.app) {
    await app.close();
  }
  if (!options.bchClient) {
    bchClient.close();
  }
  if (!options.db) {
    db.close();
  }

  return {
    passed: allPassed,
    output: lines.join('\n'),
    verdicts,
  };
}
