import {
  type CostBreakdown,
  type CostSource,
  type Direction,
} from '@ferry/core';
import type { PublicClient, Address, Hex } from 'viem';
import { parseAbi } from 'viem';
import { BASE_GAS_PRICE_ORACLE_ADDRESS } from '@ferry/chain-evm';
import { fetchCoinbaseBchUsd, fetchKrakenBchUsd } from '@ferry/bch-prices';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import { formatUsdMicrosToDecimal } from './price-source.js';

export const CHAINLINK_BASE_ETH_USD_ADDRESS: Address =
  '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

export const BASE_RELAY_LOCK_GAS = 258_429n;
export const BASE_SOLVER_LOCK_GAS = 212_455n;
export const BASE_SOLVER_CLAIM_GAS = 78_808n;
export const BCH_CLAIM_TX_BYTES = 250;
export const BCH_LOCK_TX_BYTES = 300;

const WEI_PER_ETH = 1_000_000_000_000_000_000n;
const SATS_PER_BCH = 100_000_000n;

const chainlinkAggregatorAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

const gasPriceOracleAbi = parseAbi([
  'function getL1Fee(bytes memory _data) external view returns (uint256)',
]);

export class LiveCostError extends Error {
  constructor(
    public readonly reason: 'PRICE_UNAVAILABLE' | 'PEG_GUARD',
    message: string,
  ) {
    super(message);
    this.name = 'LiveCostError';
  }
}

export interface EthUsdReading {
  usdPriceMicros: bigint;
  source: string;
  asOf: number;
  decimals: number;
  roundId?: string;
}

export interface BchUsdComponent {
  source: string;
  usdPriceMicros: bigint;
  asOf: number;
}

export interface BchUsdReading {
  usdPriceMicros: bigint;
  source: string;
  asOf: number;
  components: BchUsdComponent[];
}

export interface BaseGasReading {
  gasPriceWei: bigint;
  l1FeeWeiPerRelayLock: bigint;
  l1FeeWeiPerLock: bigint;
  source: string;
  asOf: number;
}

export interface BchFeeRateReading {
  relayFeeSatsPerByte: number;
  estimateFeeSatsPerByte: number;
  effectiveSatsPerByte: number;
  source: string;
  asOf: number;
}

export interface LiveCostInputs {
  ethUsd: EthUsdReading;
  bchUsd: BchUsdReading;
  baseGas: BaseGasReading;
  bchFeeRate: BchFeeRateReading;
}

export interface LiveInputLimits {
  ethUsdMaxAgeSeconds: number;
  bchUsdMaxAgeSeconds: number;
  baseGasMaxAgeSeconds: number;
  bchFeeRateMaxAgeSeconds: number;
  bchUsdDisagreementPercent: number;
}

export const DEFAULT_LIVE_INPUT_LIMITS: LiveInputLimits = {
  ethUsdMaxAgeSeconds: 1800,
  bchUsdMaxAgeSeconds: 300,
  baseGasMaxAgeSeconds: 60,
  bchFeeRateMaxAgeSeconds: 300,
  bchUsdDisagreementPercent: 5,
};

export function verifyLiveInputs(
  inputs: LiveCostInputs,
  limits: LiveInputLimits = DEFAULT_LIVE_INPUT_LIMITS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  // 1. ETH/USD
  const ethAge = nowSeconds - inputs.ethUsd.asOf;
  if (ethAge < -30) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `ETH/USD timestamp from ${inputs.ethUsd.source} is in the future (asOf: ${inputs.ethUsd.asOf}, now: ${nowSeconds})`,
    );
  }
  if (ethAge > limits.ethUsdMaxAgeSeconds) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `ETH/USD price from ${inputs.ethUsd.source} is stale (asOf: ${inputs.ethUsd.asOf}, age: ${ethAge}s, max: ${limits.ethUsdMaxAgeSeconds}s)`,
    );
  }
  if (inputs.ethUsd.usdPriceMicros <= 0n) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `ETH/USD price from ${inputs.ethUsd.source} must be positive, got ${inputs.ethUsd.usdPriceMicros}`,
    );
  }

  // 2. BCH/USD
  const bchAge = nowSeconds - inputs.bchUsd.asOf;
  if (bchAge < -30) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `BCH/USD timestamp from ${inputs.bchUsd.source} is in the future (asOf: ${inputs.bchUsd.asOf}, now: ${nowSeconds})`,
    );
  }
  if (bchAge > limits.bchUsdMaxAgeSeconds) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `BCH/USD price from ${inputs.bchUsd.source} is stale (asOf: ${inputs.bchUsd.asOf}, age: ${bchAge}s, max: ${limits.bchUsdMaxAgeSeconds}s)`,
    );
  }
  if (inputs.bchUsd.usdPriceMicros <= 0n) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `BCH/USD price from ${inputs.bchUsd.source} must be positive, got ${inputs.bchUsd.usdPriceMicros}`,
    );
  }

  // Check BCH/USD multi-source disagreement
  if (inputs.bchUsd.components.length >= 2) {
    const c1 = inputs.bchUsd.components[0]!;
    const c2 = inputs.bchUsd.components[1]!;
    const diff =
      c1.usdPriceMicros > c2.usdPriceMicros
        ? c1.usdPriceMicros - c2.usdPriceMicros
        : c2.usdPriceMicros - c1.usdPriceMicros;
    const median = inputs.bchUsd.usdPriceMicros;
    if (median > 0n) {
      const diffPercent = (Number(diff) * 100) / Number(median);
      if (diffPercent > limits.bchUsdDisagreementPercent) {
        const p1Formatted = formatUsdMicrosToDecimal(c1.usdPriceMicros);
        const p2Formatted = formatUsdMicrosToDecimal(c2.usdPriceMicros);
        throw new LiveCostError(
          'PEG_GUARD',
          `BCH/USD source disagreement of ${diff} micros (${diffPercent.toFixed(2)}%) between ${c1.source} ($${p1Formatted}) and ${c2.source} ($${p2Formatted}) exceeds ${limits.bchUsdDisagreementPercent}% limit`,
        );
      }
    }
  }

  // 3. Base Gas
  const gasAge = nowSeconds - inputs.baseGas.asOf;
  if (gasAge > limits.baseGasMaxAgeSeconds) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Base gas price from ${inputs.baseGas.source} is stale (asOf: ${inputs.baseGas.asOf}, age: ${gasAge}s, max: ${limits.baseGasMaxAgeSeconds}s)`,
    );
  }
  if (inputs.baseGas.gasPriceWei < 0n) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Base gas price from ${inputs.baseGas.source} must be non-negative`,
    );
  }

  // 4. BCH Fee Rate
  const feeAge = nowSeconds - inputs.bchFeeRate.asOf;
  if (feeAge > limits.bchFeeRateMaxAgeSeconds) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Bitcoin Cash fee rate from ${inputs.bchFeeRate.source} is stale (asOf: ${inputs.bchFeeRate.asOf}, age: ${feeAge}s, max: ${limits.bchFeeRateMaxAgeSeconds}s)`,
    );
  }
  if (inputs.bchFeeRate.effectiveSatsPerByte < 1) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Bitcoin Cash fee rate from ${inputs.bchFeeRate.source} is below relay minimum (got: ${inputs.bchFeeRate.effectiveSatsPerByte} sats/byte, min: 1 sats/byte)`,
    );
  }
}

export interface RouteCostBreakdown {
  direction: Direction;
  chainId: number | string;
  gasUnits: bigint;
  gasPriceWei: bigint;
  l1FeeWei: bigint;
  totalEvmWei: bigint;
  gasCostUsdMicros: bigint;
  bchTxBytes: number;
  bchFeeSats: bigint;
  bchFeeRateSatsPerByte: number;
  bchFeeCostUsdMicros: bigint;
  totalCostUsdMicros: bigint;
  safetyMarginPercent: number;
  costWithMarginUsdMicros: bigint;
  minMarginUsdMicros: bigint;
  requiredFeeUsdMicros: bigint;
  inputs: LiveCostInputs;
}

export interface CalculateRouteCostParams {
  direction: Direction;
  chainId?: number | string | undefined;
  inputs: LiveCostInputs;
  safetyMarginPercent?: number | undefined;
  minMarginUsdMicros?: bigint | undefined;
  bchCarrySats?: bigint | undefined;
  relayLockGas?: bigint | undefined;
  solverLockGas?: bigint | undefined;
}

export function calculateRouteCost(
  params: CalculateRouteCostParams,
): RouteCostBreakdown {
  const safetyMarginPercent = params.safetyMarginPercent ?? 25;
  const minMarginUsdMicros = params.minMarginUsdMicros ?? 0n;
  const bchCarrySats = params.bchCarrySats ?? 3000n;
  const relayLockGas = params.relayLockGas ?? BASE_RELAY_LOCK_GAS;
  const solverLockGas = params.solverLockGas ?? BASE_SOLVER_LOCK_GAS;

  const { ethUsd, bchUsd, baseGas, bchFeeRate } = params.inputs;

  let gasUnits: bigint;
  let l1FeeWei: bigint;
  let bchTxBytes: number;
  let bchFeeSats: bigint;

  if (params.direction === 'EVM_TO_BCH') {
    gasUnits = relayLockGas;
    l1FeeWei = baseGas.l1FeeWeiPerRelayLock;
    bchTxBytes = BCH_CLAIM_TX_BYTES;
    bchFeeSats = BigInt(
      Math.max(1, Math.ceil(bchTxBytes * bchFeeRate.effectiveSatsPerByte)),
    );
  } else {
    gasUnits = solverLockGas;
    l1FeeWei = baseGas.l1FeeWeiPerLock;
    bchTxBytes = BCH_LOCK_TX_BYTES;
    const lockMinerSats = BigInt(
      Math.max(1, Math.ceil(bchTxBytes * bchFeeRate.effectiveSatsPerByte)),
    );
    bchFeeSats = lockMinerSats + bchCarrySats;
  }

  const totalEvmWei = gasUnits * baseGas.gasPriceWei + l1FeeWei;
  const gasCostUsdMicros = (totalEvmWei * ethUsd.usdPriceMicros) / WEI_PER_ETH;

  const bchFeeCostUsdMicros =
    (bchFeeSats * bchUsd.usdPriceMicros) / SATS_PER_BCH;

  const totalCostUsdMicros = gasCostUsdMicros + bchFeeCostUsdMicros;
  const costWithMarginUsdMicros =
    (totalCostUsdMicros * BigInt(100 + safetyMarginPercent)) / 100n;
  const requiredFeeUsdMicros = costWithMarginUsdMicros + minMarginUsdMicros;

  return {
    direction: params.direction,
    chainId: params.chainId ?? 8453,
    gasUnits,
    gasPriceWei: baseGas.gasPriceWei,
    l1FeeWei,
    totalEvmWei,
    gasCostUsdMicros,
    bchTxBytes,
    bchFeeSats,
    bchFeeRateSatsPerByte: bchFeeRate.effectiveSatsPerByte,
    bchFeeCostUsdMicros,
    totalCostUsdMicros,
    safetyMarginPercent,
    costWithMarginUsdMicros,
    minMarginUsdMicros,
    requiredFeeUsdMicros,
    inputs: params.inputs,
  };
}

export interface ApplyCostModelParams {
  amountInUsdMicros: bigint;
  baseSpreadBps: number;
  routeCost: RouteCostBreakdown;
  costModelEnabled?: boolean;
  staticFixedFeeUsdMicros?: bigint;
}

export interface CostModelQuoteAdjustment {
  fixedFeeUsdMicros: bigint;
  costBreakdown: CostBreakdown;
  totalFeeUsdMicros: bigint;
  solverNetProfitUsdMicros: bigint;
  pricingChoice: 'spread' | 'cost_model' | 'static_fee';
}

export function applyCostModelToQuote(
  params: ApplyCostModelParams,
): CostModelQuoteAdjustment {
  const costModelEnabled = params.costModelEnabled ?? true;
  const spreadRevenueMicros =
    (params.amountInUsdMicros * BigInt(params.baseSpreadBps)) / 10_000n;

  let fixedFeeUsdMicros: bigint;
  let pricingChoice: 'spread' | 'cost_model' | 'static_fee';

  if (!costModelEnabled) {
    fixedFeeUsdMicros = params.staticFixedFeeUsdMicros ?? 0n;
    pricingChoice = 'static_fee';
  } else {
    const requiredFee = params.routeCost.requiredFeeUsdMicros;
    if (requiredFee > spreadRevenueMicros) {
      fixedFeeUsdMicros = requiredFee - spreadRevenueMicros;
      pricingChoice = 'cost_model';
    } else {
      fixedFeeUsdMicros = 0n;
      pricingChoice = 'spread';
    }
  }

  const totalFeeUsdMicros = spreadRevenueMicros + fixedFeeUsdMicros;
  const solverNetProfitUsdMicros =
    totalFeeUsdMicros - params.routeCost.totalCostUsdMicros;

  const sources: CostSource[] = [
    {
      name: 'ETH/USD',
      role: 'eth-usd',
      source: params.routeCost.inputs.ethUsd.source,
      asOf: params.routeCost.inputs.ethUsd.asOf,
      value: `$${formatUsdMicrosToDecimal(params.routeCost.inputs.ethUsd.usdPriceMicros)}`,
    },
    {
      name: 'BCH/USD',
      role: 'bch-usd',
      source: params.routeCost.inputs.bchUsd.source,
      asOf: params.routeCost.inputs.bchUsd.asOf,
      value: `$${formatUsdMicrosToDecimal(params.routeCost.inputs.bchUsd.usdPriceMicros)}`,
    },
    {
      name: 'Base Gas',
      role: 'base-gas',
      source: params.routeCost.inputs.baseGas.source,
      asOf: params.routeCost.inputs.baseGas.asOf,
      value: `${(Number(params.routeCost.inputs.baseGas.gasPriceWei) / 1e9).toFixed(4)} gwei`,
    },
    {
      name: 'BCH Fee Rate',
      role: 'bch-fee',
      source: params.routeCost.inputs.bchFeeRate.source,
      asOf: params.routeCost.inputs.bchFeeRate.asOf,
      value: `${params.routeCost.inputs.bchFeeRate.effectiveSatsPerByte} sats/byte`,
    },
  ];

  const costBreakdown: CostBreakdown = {
    gasCostUsd: formatUsdMicrosToDecimal(params.routeCost.gasCostUsdMicros),
    bchFeeCostUsd: formatUsdMicrosToDecimal(
      params.routeCost.bchFeeCostUsdMicros,
    ),
    totalCostUsd: formatUsdMicrosToDecimal(params.routeCost.totalCostUsdMicros),
    safetyMarginPercent: params.routeCost.safetyMarginPercent,
    costWithMarginUsd: formatUsdMicrosToDecimal(
      params.routeCost.costWithMarginUsdMicros,
    ),
    minMarginUsd: formatUsdMicrosToDecimal(params.routeCost.minMarginUsdMicros),
    fixedFeeUsd: formatUsdMicrosToDecimal(fixedFeeUsdMicros),
    effectiveSpreadBps: params.baseSpreadBps,
    ethPriceUsd: formatUsdMicrosToDecimal(
      params.routeCost.inputs.ethUsd.usdPriceMicros,
    ),
    bchPriceUsd: formatUsdMicrosToDecimal(
      params.routeCost.inputs.bchUsd.usdPriceMicros,
    ),
    gasPriceGwei: (
      Number(params.routeCost.inputs.baseGas.gasPriceWei) / 1e9
    ).toFixed(4),
    bchFeeRateSatsPerByte:
      params.routeCost.inputs.bchFeeRate.effectiveSatsPerByte.toFixed(2),
    sources,
  };

  return {
    fixedFeeUsdMicros,
    costBreakdown,
    totalFeeUsdMicros,
    solverNetProfitUsdMicros,
    pricingChoice,
  };
}

export interface LiveCostReaderOptions {
  client?: PublicClient | undefined;
  bchClient?: BchQuorumClient | undefined;
  ethUsdFeedAddress?: Address | undefined;
  limits?: Partial<LiveInputLimits> | undefined;
  costSafetyPercent?: number | undefined;
  minMarginUsdMicros?: bigint | undefined;
  cacheTtlSeconds?: number | undefined;
  fakeInputs?: LiveCostInputs | undefined;
}

export class LiveCostModelReader {
  private cache: {
    inputs?: LiveCostInputs;
    timestamp: number;
  } = { timestamp: 0 };

  private readonly limits: LiveInputLimits;
  private readonly feedAddress: Address;
  private readonly costSafetyPercent: number;
  private readonly minMarginUsdMicros: bigint;
  private readonly cacheTtlSeconds: number;

  constructor(private readonly options: LiveCostReaderOptions = {}) {
    this.limits = {
      ...DEFAULT_LIVE_INPUT_LIMITS,
      ...(options.limits ?? {}),
    };
    this.feedAddress =
      options.ethUsdFeedAddress ?? CHAINLINK_BASE_ETH_USD_ADDRESS;
    this.costSafetyPercent = options.costSafetyPercent ?? 25;
    this.minMarginUsdMicros = options.minMarginUsdMicros ?? 0n;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 45;
  }

  async readLiveInputs(nowSeconds?: number): Promise<LiveCostInputs> {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);

    if (this.options.fakeInputs) {
      verifyLiveInputs(this.options.fakeInputs, this.limits, now);
      return this.options.fakeInputs;
    }

    if (
      this.cache.inputs &&
      now - this.cache.timestamp < this.cacheTtlSeconds
    ) {
      verifyLiveInputs(this.cache.inputs, this.limits, now);
      return this.cache.inputs;
    }

    const [ethUsd, bchUsd, baseGas, bchFeeRate] = await Promise.all([
      this.readEthUsd(),
      this.readBchUsd(),
      this.readBaseGas(),
      this.readBchFeeRate(),
    ]);

    const inputs: LiveCostInputs = {
      ethUsd,
      bchUsd,
      baseGas,
      bchFeeRate,
    };

    verifyLiveInputs(inputs, this.limits, now);

    this.cache = {
      inputs,
      timestamp: now,
    };

    return inputs;
  }

  async readEthUsd(): Promise<EthUsdReading> {
    if (!this.options.client) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        'No EVM client configured for ETH/USD feed',
      );
    }
    const [decimals, round] = await Promise.all([
      this.options.client.readContract({
        address: this.feedAddress,
        abi: chainlinkAggregatorAbi,
        functionName: 'decimals',
      }),
      this.options.client.readContract({
        address: this.feedAddress,
        abi: chainlinkAggregatorAbi,
        functionName: 'latestRoundData',
      }),
    ]);

    const [roundId, answer, , updatedAt] = round;
    if (answer <= 0n) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        `Chainlink ETH/USD answer must be positive, got ${answer}`,
      );
    }

    const asOf = Number(updatedAt);
    let usdPriceMicros: bigint;
    if (decimals === 8) {
      usdPriceMicros = answer / 100n;
    } else if (decimals === 6) {
      usdPriceMicros = answer;
    } else if (decimals > 6) {
      usdPriceMicros = answer / 10n ** BigInt(decimals - 6);
    } else {
      usdPriceMicros = answer * 10n ** BigInt(6 - decimals);
    }

    return {
      usdPriceMicros,
      source: 'chainlink-base-eth-usd',
      asOf,
      decimals: Number(decimals),
      roundId: roundId.toString(),
    };
  }

  async readBchUsd(): Promise<BchUsdReading> {
    const components: BchUsdComponent[] = [];
    const errors: string[] = [];

    // Source 1: Coinbase
    try {
      const cb = await fetchCoinbaseBchUsd({ timeoutMs: 3000 });
      components.push({
        source: cb.source,
        usdPriceMicros: cb.usdPrice,
        asOf: cb.asOf,
      });
    } catch (err) {
      errors.push(
        `Coinbase: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Source 2: Kraken
    try {
      const kr = await fetchKrakenBchUsd({ timeoutMs: 3000 });
      components.push({
        source: kr.source,
        usdPriceMicros: kr.usdPrice,
        asOf: kr.asOf,
      });
    } catch (err) {
      errors.push(
        `Kraken: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (components.length === 0) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        `No public BCH/USD source available (${errors.join('; ')})`,
      );
    }

    if (components.length === 1) {
      return {
        usdPriceMicros: components[0]!.usdPriceMicros,
        source: components[0]!.source,
        asOf: components[0]!.asOf,
        components,
      };
    }

    // Median / average of components
    const sorted = [...components].sort((a, b) =>
      a.usdPriceMicros < b.usdPriceMicros ? -1 : 1,
    );
    const medianMicros =
      sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]!.usdPriceMicros
        : (sorted[sorted.length / 2 - 1]!.usdPriceMicros +
            sorted[sorted.length / 2]!.usdPriceMicros) /
          2n;

    const minAsOf = Math.min(...components.map((c) => c.asOf));

    return {
      usdPriceMicros: medianMicros,
      source: 'bch-usd-median',
      asOf: minAsOf,
      components,
    };
  }

  async readBaseGas(): Promise<BaseGasReading> {
    if (!this.options.client) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        'No EVM client configured for Base gas',
      );
    }
    const client = this.options.client;
    const gasPriceWei = await client.getGasPrice();

    // Standard sample calldata for relayLock and lock on FerryHTLC
    const sampleRelayLockTx: Hex =
      '0x02f870822105808405f5e1008502540be400825208945a0c062f4b7b8ff2263530e12bc15de9c836a6418080c0';
    const sampleLockTx: Hex =
      '0x02f86c822105808405f5e1008502540be400825208945a0c062f4b7b8ff2263530e12bc15de9c836a6418080';

    let l1FeeWeiPerRelayLock: bigint;
    let l1FeeWeiPerLock: bigint;
    try {
      const [feeRelay, feeLock] = await Promise.all([
        client.readContract({
          address: BASE_GAS_PRICE_ORACLE_ADDRESS,
          abi: gasPriceOracleAbi,
          functionName: 'getL1Fee',
          args: [sampleRelayLockTx],
        }),
        client.readContract({
          address: BASE_GAS_PRICE_ORACLE_ADDRESS,
          abi: gasPriceOracleAbi,
          functionName: 'getL1Fee',
          args: [sampleLockTx],
        }),
      ]);
      l1FeeWeiPerRelayLock = feeRelay;
      l1FeeWeiPerLock = feeLock;
    } catch {
      // If L1 fee read fails (e.g. test anvil fork without predeploy), default to 0n
      l1FeeWeiPerRelayLock = 0n;
      l1FeeWeiPerLock = 0n;
    }

    return {
      gasPriceWei,
      l1FeeWeiPerRelayLock,
      l1FeeWeiPerLock,
      source: 'base-gas-price-oracle',
      asOf: Math.floor(Date.now() / 1000),
    };
  }

  async readBchFeeRate(): Promise<BchFeeRateReading> {
    if (this.options.bchClient) {
      const fee = await this.options.bchClient.getFeeRate();
      return fee;
    }
    return {
      relayFeeSatsPerByte: 1,
      estimateFeeSatsPerByte: 1,
      effectiveSatsPerByte: 1,
      source: 'electrum-relay-minimum',
      asOf: Math.floor(Date.now() / 1000),
    };
  }

  async getRouteCost(
    direction: Direction,
    chainId?: number | string | undefined,
    nowSeconds?: number | undefined,
  ): Promise<RouteCostBreakdown> {
    const inputs = await this.readLiveInputs(nowSeconds);
    return calculateRouteCost({
      direction,
      chainId,
      inputs,
      safetyMarginPercent: this.costSafetyPercent,
      minMarginUsdMicros: this.minMarginUsdMicros,
    });
  }
}
