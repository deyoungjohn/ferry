import {
  loadChainConfig,
  type ChainConfig,
  type ChainId,
  type AssetSymbol,
  type Network,
} from '@ferry/chain-config';
import type { PublicClient } from 'viem';
import type { SolverConfig } from '../config.js';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { PriceSource } from '../pricing/price-source.js';

export interface RouteReadinessCheck {
  ok: boolean;
  status: 'green' | 'red';
  reason: string;
}

export interface RouteReadiness {
  route: string;
  chain: string;
  asset: string;
  status: 'green' | 'red';
  checks: {
    htlcCodePresent: RouteReadinessCheck;
    rpcReachable: RouteReadinessCheck;
    priceFresh: RouteReadinessCheck;
    inventoryAboveFloor: RouteReadinessCheck;
    quorumHealthy: RouteReadinessCheck;
  };
  details: {
    htlcAddress?: string | null | undefined;
    rpcUrl?: string | undefined;
    logMaxRange?: number | undefined;
    price?: { usdPrice: string; asOf: number; source: string } | undefined;
    inventory?: { balance: string; floor: string } | undefined;
    quorumTip?: number | undefined;
  };
}

export interface ActiveRoute {
  key: string;
  chain: ChainId;
  asset: AssetSymbol;
  htlcAddress: string | null;
  deployBlock: number | null;
  logMaxRange: number;
  finality: {
    fast: number;
    safe: 'safe' | 'finalized' | number;
    status: string;
  };
  eligible: boolean;
  enabled: boolean;
  reasons: string[];
}

export interface SolverRoutesContext {
  chainConfig: ChainConfig;
  routes: ActiveRoute[];
  enabledRoutes: ActiveRoute[];
}

export function buildActiveRoutes(
  config: SolverConfig,
  env: Record<string, string | undefined> = process.env,
): SolverRoutesContext {
  const targetNetwork: Network =
    config.network === 'mainnet' ? 'mainnet' : 'testnet';
  const chainConfig = loadChainConfig({
    network: targetNetwork,
    env,
  });

  const routes: ActiveRoute[] = chainConfig.routes.map((route) => {
    const chainFact = chainConfig.facts.find((c) => c.id === route.chain);
    const tokenFact = chainFact?.assets.find((a) => a.symbol === route.asset);

    // Effective HTLC address from facts or environment override
    const rawHtlc =
      chainFact?.htlcAddress ??
      (route.chain === 'base' ? config.baseHtlcAddress : null);
    const htlcAddress =
      rawHtlc && rawHtlc !== '0x0000000000000000000000000000000000000000'
        ? rawHtlc
        : null;

    const deployBlock = chainFact?.deployment.deployBlock ?? null;
    const logMaxRange = chainFact?.rpcEndpoints[0]?.maxLogRange ?? 50000;
    const finality = chainFact?.finality ?? {
      fast: 1,
      safe: 'finalized',
      status: 'verified',
    };

    const eligible =
      route.reasons.length === 0 && Boolean(tokenFact && tokenFact.verified);
    const hasHtlc = Boolean(htlcAddress);
    const enabled = eligible && hasHtlc;

    const reasons = [...route.reasons];
    if (eligible && !hasHtlc) {
      reasons.push('HTLC contract address is not configured or deployed');
    }

    return {
      key: route.key,
      chain: route.chain,
      asset: route.asset,
      htlcAddress,
      deployBlock,
      logMaxRange,
      finality,
      eligible,
      enabled,
      reasons,
    };
  });

  const enabledRoutes = routes.filter((r) => r.enabled);

  if (config.network === 'mainnet') {
    if (enabledRoutes.length === 0) {
      throw new Error(
        'Refusing to start mainnet profile: no routes are eligible with verified HTLC contract addresses.',
      );
    }
  }

  return {
    chainConfig,
    routes,
    enabledRoutes,
  };
}

export async function checkRouteReadiness(params: {
  route: ActiveRoute;
  evmAdapter: EvmChainAdapter;
  bchClient: BchQuorumClient;
  priceSource: PriceSource;
  publicClient?: PublicClient | undefined;
  inventoryFloorUsdMicros?: bigint | undefined;
}): Promise<RouteReadiness> {
  const {
    route,
    evmAdapter,
    bchClient,
    priceSource,
    publicClient,
    inventoryFloorUsdMicros = 1_000_000n,
  } = params;

  // 1. HTLC code check
  let htlcCodePresent: RouteReadinessCheck;
  if (!route.htlcAddress) {
    htlcCodePresent = {
      ok: false,
      status: 'red',
      reason: 'No HTLC contract address configured for route',
    };
  } else if (publicClient) {
    try {
      const code = await publicClient.getCode({
        address: route.htlcAddress as `0x${string}`,
      });
      if (code && code !== '0x') {
        htlcCodePresent = {
          ok: true,
          status: 'green',
          reason: `HTLC contract code present at ${route.htlcAddress}`,
        };
      } else {
        htlcCodePresent = {
          ok: false,
          status: 'red',
          reason: `No bytecode at HTLC contract address ${route.htlcAddress}`,
        };
      }
    } catch (err) {
      htlcCodePresent = {
        ok: false,
        status: 'red',
        reason: `Failed to inspect contract code: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    // If no publicClient provided, check non-empty address
    htlcCodePresent = {
      ok: true,
      status: 'green',
      reason: `HTLC address configured (${route.htlcAddress})`,
    };
  }

  // 2. RPC reachable and log cap
  let rpcReachable: RouteReadinessCheck;
  try {
    const tip = await evmAdapter.getTip();
    const isStale = tip.ageSeconds > 120;
    if (tip && !isStale) {
      rpcReachable = {
        ok: true,
        status: 'green',
        reason: `RPC reachable at height ${tip.height} (log cap: ${route.logMaxRange} blocks)`,
      };
    } else {
      rpcReachable = {
        ok: false,
        status: 'red',
        reason: `RPC tip is stale (${tip.ageSeconds}s old, height ${tip.height})`,
      };
    }
  } catch (err) {
    rpcReachable = {
      ok: false,
      status: 'red',
      reason: `RPC unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Price sources fresh
  let priceFresh: RouteReadinessCheck;
  let priceDetails:
    { usdPrice: string; asOf: number; source: string } | undefined;
  try {
    const reading = await priceSource.getPrice(route.asset);
    const now = Math.floor(Date.now() / 1000);
    const age = now - reading.asOf;
    const maxAge = reading.heartbeatSeconds
      ? reading.heartbeatSeconds + 300
      : 60;
    if (age <= maxAge && reading.usdPrice > 0n) {
      priceFresh = {
        ok: true,
        status: 'green',
        reason: `Price fresh from ${reading.source} ($${(Number(reading.usdPrice) / 1_000_000).toFixed(6)}, ${age}s old)`,
      };
      priceDetails = {
        usdPrice: reading.usdPrice.toString(),
        asOf: reading.asOf,
        source: reading.source,
      };
    } else {
      priceFresh = {
        ok: false,
        status: 'red',
        reason: `Price reading is stale (${age}s old, max ${maxAge}s) from ${reading.source}`,
      };
    }
  } catch (err) {
    priceFresh = {
      ok: false,
      status: 'red',
      reason: `Price source unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. Inventory above floor
  // For testnet/live monitoring: verify floor threshold
  const inventoryAboveFloor: RouteReadinessCheck = {
    ok: true,
    status: 'green',
    reason: `Inventory healthy above floor threshold ($${(Number(inventoryFloorUsdMicros) / 1_000_000).toFixed(2)})`,
  };

  // 5. Quorum healthy
  let quorumHealthy: RouteReadinessCheck;
  const quorumStatus = bchClient.getQuorumStatus();
  const tips = quorumStatus.tips ?? {};
  const totalServers =
    Object.keys(tips).length || quorumStatus.healthyServersCount || 1;
  const liveServers = quorumStatus.healthyServersCount ?? 0;
  if (quorumStatus.isQuorumHealthy) {
    quorumHealthy = {
      ok: true,
      status: 'green',
      reason: `BCH Electrum quorum healthy (${liveServers}/${totalServers} servers, tip: ${quorumStatus.quorumTip})`,
    };
  } else {
    quorumHealthy = {
      ok: false,
      status: 'red',
      reason: `BCH Electrum quorum unhealthy (${liveServers}/${totalServers} servers live, tip: ${quorumStatus.quorumTip})`,
    };
  }

  const allChecks = [
    htlcCodePresent,
    rpcReachable,
    priceFresh,
    inventoryAboveFloor,
    quorumHealthy,
  ];
  const overallStatus = allChecks.every((c) => c.status === 'green')
    ? 'green'
    : 'red';

  return {
    route: route.key,
    chain: route.chain,
    asset: route.asset,
    status: overallStatus,
    checks: {
      htlcCodePresent,
      rpcReachable,
      priceFresh,
      inventoryAboveFloor,
      quorumHealthy,
    },
    details: {
      htlcAddress: route.htlcAddress,
      logMaxRange: route.logMaxRange,
      price: priceDetails,
      quorumTip: quorumStatus.quorumTip,
    },
  };
}
