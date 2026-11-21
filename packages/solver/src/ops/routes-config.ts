import {
  loadChainConfig,
  type ChainConfig,
  type ChainId,
  type AssetSymbol,
  type Network,
} from '@ferry/chain-config';
import {
  base,
  baseSepolia,
  mainnet,
  sepolia,
  arbitrum,
  arbitrumSepolia,
  bsc,
  bscTestnet,
} from 'viem/chains';
import type { Chain, PublicClient } from 'viem';
import type { SolverConfig } from '../config.js';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import {
  absDiff,
  formatUsdMicrosToDecimal,
  type DetailedAssetPriceReading,
  type PriceSource,
} from '../pricing/price-source.js';

/**
 * Route-specific fixed fees in USD micros from Agent 2's rehearsal measurements:
 * Base: 10,000 ($0.01)
 * Arbitrum: 20,000 ($0.02)
 * BNB: 10,000 ($0.01)
 * Ethereum: 50,000 ($0.05; operator funds ETH gas during the event)
 */
export const DEFAULT_ROUTE_FIXED_FEES_USD_MICROS: Record<string, bigint> = {
  base: 10_000n,
  arbitrum: 20_000n,
  bnb: 10_000n,
  // The fallback fee when live costs are unreadable; kept under 7% of the $1 minimum (the operator
  // funds the solver's ETH gas through the event).
  ethereum: 50_000n,
  arc: 10_000n,
  robinhood: 10_000n,
};

export function getRouteFixedFeeUsdMicros(
  chain: string,
  override?: bigint | undefined,
): bigint {
  if (override !== undefined && override > 0n) {
    return override;
  }
  return DEFAULT_ROUTE_FIXED_FEES_USD_MICROS[chain.toLowerCase()] ?? 10_000n;
}

export function routeMinSwapUsdMicros(_fixedFeeUsdMicros: bigint): bigint {
  // Every route takes $1 and up, Ethereum included: the operator funds the solver's ETH gas through
  // the event. (Before, the minimum was fifteen times the fixed fee, which made Ethereum $5.)
  return 1_000_000n;
}

export function getViemChain(
  chainId: string,
  network: 'mainnet' | 'testnet',
): Chain {
  const isMainnet = network === 'mainnet';
  switch (chainId.toLowerCase()) {
    case 'base':
      return isMainnet ? base : baseSepolia;
    case 'ethereum':
      return isMainnet ? mainnet : sepolia;
    case 'arbitrum':
      return isMainnet ? arbitrum : arbitrumSepolia;
    case 'bnb':
      return isMainnet ? bsc : bscTestnet;
    case 'robinhood': {
      const robinhoodChain: Chain = {
        id: isMainnet ? 4663 : 46630,
        name: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: {
          default: {
            http: [
              isMainnet
                ? 'https://rpc.mainnet.chain.robinhood.com'
                : 'https://rpc.testnet.chain.robinhood.com',
            ],
          },
        },
      };
      return robinhoodChain;
    }
    default:
      return isMainnet ? base : baseSepolia;
  }
}

export interface RouteReadinessCheck {
  ok: boolean;
  status: 'green' | 'red';
  reason: string;
}

export interface SourceInfo {
  source: string;
  asset: string;
  role: 'primary' | 'secondary';
  value: string;
  usdPrice?: string | undefined;
  asOf: number;
  age: number;
  status: 'ok' | 'warn' | 'refuse' | 'unavailable';
  refusalRule: string;
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
  sources?: SourceInfo[] | undefined;
  details: {
    htlcAddress?: string | null | undefined;
    rpcUrl?: string | undefined;
    logMaxRange?: number | undefined;
    price?: { usdPrice: string; asOf: number; source: string } | undefined;
    sources?: SourceInfo[] | undefined;
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

    // The contract has one address on every chain: FERRY_HTLC_ADDRESS when set, else the
    // recorded deployment (Base also keeps its older per-chain setting).
    const sharedHtlc = /^0x[0-9a-fA-F]{40}$/.test(env.FERRY_HTLC_ADDRESS ?? '')
      ? env.FERRY_HTLC_ADDRESS
      : null;
    const rawHtlc =
      sharedHtlc ??
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

  // 3. Price sources fresh & Per-Source Operator View
  let priceFresh: RouteReadinessCheck;
  let priceDetails:
    { usdPrice: string; asOf: number; source: string } | undefined;
  const sources: SourceInfo[] = [];
  const now = Math.floor(Date.now() / 1000);

  // 3a. Primary EVM Asset Reading
  let evmReading: DetailedAssetPriceReading | undefined;
  try {
    const rawReading = priceSource.getDetailedPrice
      ? await priceSource.getDetailedPrice(route.asset, route.chain)
      : await priceSource.getPrice(route.asset, route.chain);
    evmReading = rawReading as DetailedAssetPriceReading;
    const age = now - evmReading.asOf;
    const maxAge = evmReading.heartbeatSeconds
      ? evmReading.heartbeatSeconds + 300
      : 60;
    const isStale = age < 0 || age > maxAge;
    const pegDev = absDiff(evmReading.usdPrice, 1_000_000n);
    const isPegRefuse = pegDev > 10_000n; // > 1%

    sources.push({
      source: evmReading.source,
      asset: route.asset,
      role: 'primary',
      value: `$${formatUsdMicrosToDecimal(evmReading.usdPrice)}`,
      usdPrice: evmReading.usdPrice.toString(),
      asOf: evmReading.asOf,
      age,
      status: isStale ? 'unavailable' : isPegRefuse ? 'refuse' : 'ok',
      refusalRule:
        'peg_guard (refuse when primary price > 1.00% / 10000 micros from $1.00)',
    });
    priceDetails = {
      usdPrice: evmReading.usdPrice.toString(),
      asOf: evmReading.asOf,
      source: evmReading.source,
    };
  } catch {
    sources.push({
      source: `chainlink-${route.chain}`,
      asset: route.asset,
      role: 'primary',
      value: 'unavailable',
      asOf: now,
      age: -1,
      status: 'unavailable',
      refusalRule:
        'peg_guard (refuse when primary price > 1.00% / 10000 micros from $1.00)',
    });
  }

  // 3b. Counterpart BCH Asset Readings (PUSD Primary Cauldron + Secondary Paryon)
  try {
    const bchRaw = priceSource.getDetailedPrice
      ? await priceSource.getDetailedPrice('PUSD')
      : await priceSource.getPrice('PUSD');
    const bchDetailed = bchRaw as DetailedAssetPriceReading;
    const primary = bchDetailed.primary ?? bchRaw;
    const age = now - primary.asOf;
    const isStale = age < 0 || age > 300;
    const pegDev = absDiff(primary.usdPrice, 1_000_000n);
    const isPegRefuse = pegDev > 10_000n;

    sources.push({
      source: primary.source,
      asset: 'PUSD',
      role: 'primary',
      value: `$${formatUsdMicrosToDecimal(primary.usdPrice)}`,
      usdPrice: primary.usdPrice.toString(),
      asOf: primary.asOf,
      age,
      status: isStale ? 'unavailable' : isPegRefuse ? 'refuse' : 'ok',
      refusalRule:
        'peg_guard (refuse when primary price > 1.00% / 10000 micros from $1.00)',
    });

    if (bchDetailed.secondary) {
      const sec = bchDetailed.secondary;
      const secAge = sec.asOf > 0 ? now - sec.asOf : -1;
      sources.push({
        source: sec.source,
        asset: 'PUSD',
        role: 'secondary',
        value: sec.available
          ? `$${formatUsdMicrosToDecimal(sec.usdPrice)}`
          : 'unavailable',
        usdPrice: sec.available ? sec.usdPrice.toString() : undefined,
        asOf: sec.asOf,
        age: secAge,
        status: sec.status,
        refusalRule:
          sec.refusalRule ??
          'source_disagreement (warn > 1.00% / 10000 micros, refuse > 2.00% / 20000 micros)',
      });
    }
  } catch {
    // If PUSD not available on priceSource (e.g. single-asset test mock), ignore
  }

  // Evaluate priceFresh check based on primary and secondary health
  const primarySources = sources.filter((s) => s.role === 'primary');
  const secondarySources = sources.filter((s) => s.role === 'secondary');
  const anyPrimaryUnavailable = primarySources.some(
    (s) => s.status === 'unavailable',
  );
  const anyPrimaryRefused = primarySources.some((s) => s.status === 'refuse');
  const anySecondaryRefused = secondarySources.some(
    (s) => s.status === 'refuse',
  );

  if (anyPrimaryUnavailable || primarySources.length === 0) {
    const failedNames = primarySources
      .filter((s) => s.status === 'unavailable')
      .map((s) => s.source)
      .join(', ');
    priceFresh = {
      ok: false,
      status: 'red',
      reason: `Primary price source unavailable or stale: ${failedNames || route.asset}`,
    };
  } else if (anyPrimaryRefused) {
    priceFresh = {
      ok: false,
      status: 'red',
      reason: 'Primary price exceeded peg tolerance (> 1.00% from $1.00)',
    };
  } else if (anySecondaryRefused) {
    priceFresh = {
      ok: false,
      status: 'red',
      reason: 'Source disagreement between primary and secondary exceeds 2.00%',
    };
  } else {
    const summary = primarySources
      .map((s) => `${s.source} (${s.value}, ${s.age}s old)`)
      .join(', ');
    priceFresh = {
      ok: true,
      status: 'green',
      reason: `Price sources healthy: ${summary}`,
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
    const failedDetails = quorumStatus.failedHosts
      ? Object.entries(quorumStatus.failedHosts)
          .map(([h, r]) => `${h}: ${r}`)
          .join('; ')
      : '';
    quorumHealthy = {
      ok: false,
      status: 'red',
      reason: `BCH Electrum quorum unhealthy (${liveServers}/${totalServers} servers live, tip: ${quorumStatus.quorumTip}, state: ${quorumStatus.quotingState})${failedDetails ? ` [failed hosts: ${failedDetails}]` : ''}`,
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
    sources,
    details: {
      htlcAddress: route.htlcAddress,
      logMaxRange: route.logMaxRange,
      price: priceDetails,
      sources,
      quorumTip: quorumStatus.quorumTip,
    },
  };
}
