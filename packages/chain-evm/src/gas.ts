const WEI_PER_ETH = 1e18;

/**
 * Computes estimated relay cost in USD from explicit gas, gas price, and native token price inputs.
 * Never hard-codes gas prices or native token prices.
 */
export function relayCostUsd(
  gas: bigint,
  gasPriceWei: bigint,
  nativeUsd: number,
  l1DataFeeUsd = 0,
): number {
  if (gas < 0n) {
    throw new RangeError('gas must be non-negative');
  }
  if (gasPriceWei < 0n) {
    throw new RangeError('gasPriceWei must be non-negative');
  }
  if (!Number.isFinite(nativeUsd) || nativeUsd < 0) {
    throw new RangeError('nativeUsd must be a non-negative finite number');
  }
  if (!Number.isFinite(l1DataFeeUsd) || l1DataFeeUsd < 0) {
    throw new RangeError('l1DataFeeUsd must be a non-negative finite number');
  }

  const totalWei = gas * gasPriceWei;
  return (Number(totalWei) / WEI_PER_ETH) * nativeUsd + l1DataFeeUsd;
}
