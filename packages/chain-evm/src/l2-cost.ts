import {
  encodeFunctionData,
  parseAbi,
  serializeTransaction,
  zeroAddress,
} from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import type { EvmChainId } from '@ferry/core';
import { relayCostUsd } from './gas.js';

const WEI_PER_ETH = 1e18;

/**
 * OP-Stack GasPriceOracle predeploy on Base (chain ID 8453 / 84532).
 * Source: https://docs.optimism.io/builders/app-developers/transactions/fees#l1-data-fee
 */
export const BASE_GAS_PRICE_ORACLE_ADDRESS: Address =
  '0x420000000000000000000000000000000000000F';

/**
 * Arbitrum Nitro NodeInterface precompile (chain ID 42161 / 421614).
 * Source: https://docs.arbitrum.io/build-decentralized-apps/nodeinterface/reference
 */
export const ARBITRUM_NODE_INTERFACE_ADDRESS: Address =
  '0x00000000000000000000000000000000000000C8';

const gasPriceOracleAbi = parseAbi([
  'function getL1Fee(bytes memory _data) external view returns (uint256)',
]);

const nodeInterfaceAbi = parseAbi([
  'function gasEstimateComponents(address to, bool contractCreation, bytes calldata data) external payable returns (uint64 gasEstimate, uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)',
]);

export async function estimateBaseL1FeeWei(
  client: PublicClient,
  serializedTxBytes: Hex,
): Promise<bigint> {
  return client.readContract({
    address: BASE_GAS_PRICE_ORACLE_ADDRESS,
    abi: gasPriceOracleAbi,
    functionName: 'getL1Fee',
    args: [serializedTxBytes],
  });
}

export interface ArbitrumGasComponents {
  gasEstimate: bigint;
  gasEstimateForL1: bigint;
  baseFee: bigint;
  l1BaseFeeEstimate: bigint;
  l2Gas: bigint;
  l1FeeWei: bigint;
}

export async function estimateArbitrumGasComponents(
  client: PublicClient,
  params: {
    to: Address;
    data: Hex;
    contractCreation?: boolean;
  },
): Promise<ArbitrumGasComponents> {
  const result = await client.simulateContract({
    address: ARBITRUM_NODE_INTERFACE_ADDRESS,
    abi: nodeInterfaceAbi,
    functionName: 'gasEstimateComponents',
    args: [params.to, params.contractCreation ?? false, params.data],
  });

  const [gasEstimate, gasEstimateForL1, baseFee, l1BaseFeeEstimate] =
    result.result;
  const l2Gas =
    gasEstimate > gasEstimateForL1 ? gasEstimate - gasEstimateForL1 : 0n;
  const l1FeeWei = gasEstimateForL1 * baseFee;

  return {
    gasEstimate,
    gasEstimateForL1,
    baseFee,
    l1BaseFeeEstimate,
    l2Gas,
    l1FeeWei,
  };
}

export interface EstimateRelayCostUsdParams {
  chain: EvmChainId;
  calldata: Hex;
  client: PublicClient;
  nativeUsd: number;
  to?: Address | undefined;
  gasUsed?: bigint | undefined;
  gasPriceWei?: bigint | undefined;
  serializedTx?: Hex | undefined;
}

export interface RelayCostEstimate {
  chain: EvmChainId;
  executionGas: bigint;
  gasPriceWei: bigint;
  l1FeeWei: bigint;
  totalWei: bigint;
  l2ExecutionUsd: number;
  l1DataFeeUsd: number;
  totalUsd: number;
}

/**
 * Estimates the total relay cost in USD (execution gas + L1 data fee where applicable).
 * Base uses OP-Stack GasPriceOracle (`getL1Fee`); Arbitrum uses NodeInterface (`gasEstimateComponents`);
 * Ethereum, BNB, Arc, and Robinhood have zero L1 data fee.
 */
export async function estimateRelayCostUsd(
  params: EstimateRelayCostUsdParams,
): Promise<RelayCostEstimate> {
  if (!Number.isFinite(params.nativeUsd) || params.nativeUsd < 0) {
    throw new RangeError('nativeUsd must be a non-negative finite number');
  }

  const gasPriceWei = params.gasPriceWei ?? (await params.client.getGasPrice());
  if (gasPriceWei < 0n) {
    throw new RangeError('gasPriceWei must be non-negative');
  }

  let executionGas: bigint;
  let l1FeeWei = 0n;

  if (params.chain === 'arbitrum') {
    const components = await estimateArbitrumGasComponents(params.client, {
      to: params.to ?? zeroAddress,
      data: params.calldata,
    });
    l1FeeWei = components.l1FeeWei;
    executionGas = params.gasUsed ?? components.l2Gas;
  } else {
    if (params.gasUsed !== undefined) {
      executionGas = params.gasUsed;
    } else if (params.to !== undefined) {
      executionGas = await params.client.estimateGas({
        to: params.to,
        data: params.calldata,
      });
    } else {
      executionGas = 0n;
    }

    if (params.chain === 'base') {
      const txBytes =
        params.serializedTx ??
        serializeTransaction({
          type: 'eip1559',
          chainId: 8453,
          to: params.to ?? zeroAddress,
          data: params.calldata,
          gas: executionGas > 0n ? executionGas : 260_000n,
          maxFeePerGas: gasPriceWei,
          maxPriorityFeePerGas: 0n,
          nonce: 0,
        });
      l1FeeWei = await estimateBaseL1FeeWei(params.client, txBytes);
    }
  }

  const l1DataFeeUsd = (Number(l1FeeWei) / WEI_PER_ETH) * params.nativeUsd;
  const l2ExecutionUsd = relayCostUsd(
    executionGas,
    gasPriceWei,
    params.nativeUsd,
    0,
  );
  const totalUsd = relayCostUsd(
    executionGas,
    gasPriceWei,
    params.nativeUsd,
    l1DataFeeUsd,
  );
  const totalWei = executionGas * gasPriceWei + l1FeeWei;

  return {
    chain: params.chain,
    executionGas,
    gasPriceWei,
    l1FeeWei,
    totalWei,
    l2ExecutionUsd,
    l1DataFeeUsd,
    totalUsd,
  };
}

export function encodeNodeInterfaceCall(to: Address, data: Hex): Hex {
  return encodeFunctionData({
    abi: nodeInterfaceAbi,
    functionName: 'gasEstimateComponents',
    args: [to, false, data],
  });
}
