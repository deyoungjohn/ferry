import type { AssetSymbol, ChainId } from './schema.js';

/** Minimum-tier operational sizing from the blueprint. */
export const MINIMUM_TIER = {
  baseUsdcUsd: 15,
  otherStablecoinUsd: 10,
  pusd: 15,
  musd: 5,
  bchSats: 100_000n,
} as const;

/** Stablecoin floor in base units for a chain/asset pair. */
export function routeMinimumTarget(
  chainId: ChainId | string,
  symbol: AssetSymbol | string,
  decimals: number,
): bigint {
  const usd =
    chainId === 'base' && symbol === 'USDC'
      ? MINIMUM_TIER.baseUsdcUsd
      : MINIMUM_TIER.otherStablecoinUsd;
  return BigInt(usd) * 10n ** BigInt(decimals);
}
