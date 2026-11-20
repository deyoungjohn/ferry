import type { LiquidityResponse, RouteLiquidity } from '@ferry/core/api';

export interface ReceiverRouteOption {
  readonly routeKey: string;
  readonly asset: string;
  readonly chain: string;
  readonly chainId?: number | undefined;
  readonly availableUsd: number;
  readonly hasLiquidity: boolean;
}

/**
 * Extracts asset symbol and chain slug from route key (e.g. "usdc:base" -> { asset: "USDC", chain: "base" }).
 */
export function parseRouteKey(routeKey: string): {
  asset: string;
  chain: string;
} {
  const [assetPart, ...chainParts] = routeKey.split(':');
  return {
    asset: (assetPart ?? '').toUpperCase(),
    chain: chainParts.join(':').toLowerCase(),
  };
}

/**
 * Normalizes chain name / slug to a canonical key format.
 */
export function normalizeChainKey(chain: string): string {
  const lower = chain.toLowerCase().trim();
  if (lower.includes('base')) return 'base';
  if (lower.includes('arbitrum') || lower.includes('arb')) return 'arbitrum';
  if (lower.includes('optimism') || lower.includes('op')) return 'optimism';
  if (lower.includes('polygon') || lower.includes('pol')) return 'polygon';
  if (lower.includes('avalanche') || lower.includes('avax')) return 'avalanche';
  if (
    lower.includes('ethereum') ||
    lower.includes('mainnet') ||
    lower.includes('eth')
  )
    return 'ethereum';
  return lower;
}

/**
 * Converts atoms string with decimals to USD floating point estimate.
 */
export function atomsToUsd(atomsStr: string, decimals: number): number {
  try {
    const raw = BigInt(atomsStr);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const rem = raw % divisor;
    const fraction = Number(rem) / 10 ** decimals;
    return Number(whole) + fraction;
  } catch {
    return 0;
  }
}

/**
 * Evaluates liquidity across routes for a given send link USD amount.
 */
export function evaluateReceiverRoutes(
  liquidity: LiquidityResponse | null | undefined,
  requiredAmountUsd: number,
): readonly ReceiverRouteOption[] {
  if (!liquidity || !Array.isArray(liquidity.routes)) {
    return [];
  }

  return liquidity.routes.map((r: RouteLiquidity) => {
    const availableUsd = atomsToUsd(r.available, r.decimals);
    const { asset, chain } = parseRouteKey(r.route);
    return {
      routeKey: r.route,
      asset: r.asset || asset,
      chain,
      availableUsd,
      hasLiquidity: availableUsd >= requiredAmountUsd,
    };
  });
}

/**
 * Finds alternative routes that currently have sufficient liquidity for the required amount.
 */
export function findAlternativeRoutes(
  liquidity: LiquidityResponse | null | undefined,
  currentRouteKey: string,
  requiredAmountUsd: number,
): readonly ReceiverRouteOption[] {
  const allRoutes = evaluateReceiverRoutes(liquidity, requiredAmountUsd);
  return allRoutes
    .filter(
      (r) =>
        r.routeKey !== currentRouteKey &&
        r.hasLiquidity &&
        r.availableUsd >= requiredAmountUsd,
    )
    .sort((a, b) => b.availableUsd - a.availableUsd);
}
