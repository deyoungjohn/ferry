import { formatEther } from 'viem';

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

export interface EstimateDeployFundingInput {
  chain: string;
  nativeGasSymbol: string;
  deployGas: bigint;
  gasPriceWei: bigint;
  safetyMarginBps?: number;
  nativeUsd?: number;
}

export interface DeployFundingEstimate {
  chain: string;
  nativeGasSymbol: string;
  deployGas: bigint;
  gasPriceWei: bigint;
  safetyMarginBps: number;
  requiredWei: bigint;
  requiredNative: string;
  estimatedUsd?: number;
}

/**
 * Estimates native gas funding required to deploy FerryHTLC on a chain from
 * measured deployment gas and an explicit gas price input (plus optional safety margin).
 */
export function estimateDeployFunding(
  input: EstimateDeployFundingInput,
): DeployFundingEstimate {
  const safetyMarginBps = input.safetyMarginBps ?? 2000;
  if (input.deployGas < 0n) {
    throw new RangeError('deployGas must be non-negative');
  }
  if (input.gasPriceWei < 0n) {
    throw new RangeError('gasPriceWei must be non-negative');
  }
  if (
    !Number.isInteger(safetyMarginBps) ||
    safetyMarginBps < 0 ||
    safetyMarginBps > 50_000
  ) {
    throw new RangeError('safetyMarginBps must be an integer in [0, 50000]');
  }

  const baseWei = input.deployGas * input.gasPriceWei;
  const requiredWei =
    baseWei + (baseWei * BigInt(safetyMarginBps) + 9_999n) / 10_000n;

  const estimatedUsd =
    input.nativeUsd !== undefined
      ? relayCostUsd(
          (input.deployGas * BigInt(10_000 + safetyMarginBps)) / 10_000n,
          input.gasPriceWei,
          input.nativeUsd,
        )
      : undefined;

  return {
    chain: input.chain,
    nativeGasSymbol: input.nativeGasSymbol,
    deployGas: input.deployGas,
    gasPriceWei: input.gasPriceWei,
    safetyMarginBps,
    requiredWei,
    requiredNative: formatEther(requiredWei),
    ...(estimatedUsd !== undefined ? { estimatedUsd } : {}),
  };
}

export function formatDeployFundingTable(
  estimates: readonly DeployFundingEstimate[],
): string {
  const lines = [
    'Chain | Native | Deploy Gas | Gas Price (wei) | Required Native | Est. USD',
    '----- | ------ | ---------- | --------------- | --------------- | --------',
  ];
  for (const e of estimates) {
    const usd =
      e.estimatedUsd !== undefined ? `$${e.estimatedUsd.toFixed(4)}` : 'n/a';
    lines.push(
      `${e.chain} | ${e.nativeGasSymbol} | ${e.deployGas.toString()} | ${e.gasPriceWei.toString()} | ${e.requiredNative} ${e.nativeGasSymbol} | ${usd}`,
    );
  }
  return lines.join('\n');
}
