import {
  type CostBreakdown,
  type CostSource,
  type Direction,
  type CostFeedStatus,
} from '@ferry/core';
import type { PublicClient, Address, Hex } from 'viem';
import { parseAbi } from 'viem';
import { z } from 'zod';
import { BASE_GAS_PRICE_ORACLE_ADDRESS } from '@ferry/chain-evm';
import { fetchCoinbaseBchUsd, fetchKrakenBchUsd } from '@ferry/bch-prices';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import { formatUsdMicrosToDecimal } from './price-source.js';

export const CHAINLINK_BASE_ETH_USD_ADDRESS: Address =
  '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

export const DEFAULT_BITSTAMP_BCH_USD_URL =
  'https://www.bitstamp.net/api/v2/ticker/bchusd/';

const BitstampTickerSchema = z.object({
  last: z.string().regex(/^\d+(?:\.\d+)?$/),
  timestamp: z.string().optional(),
});

export function cleanSource(source: string): string {
  return source.replace(/\s*\(cached.*?\)/g, '').trim();
}

export function decimalStringToMicros(val: string): bigint {
  const [intPart = '0', fracPart = ''] = val.split('.');
  const paddedFrac = (fracPart + '000000').slice(0, 6);
  return BigInt(intPart) * 1_000_000n + BigInt(paddedFrac);
}

export async function fetchBitstampBchUsd(
  options: {
    url?: string | undefined;
    timeoutMs?: number | undefined;
    fetchFn?: typeof fetch | undefined;
    nowSeconds?: (() => number) | undefined;
  } = {},
): Promise<BchUsdComponent & { usdPrice: bigint }> {
  const url = options.url ?? DEFAULT_BITSTAMP_BCH_USD_URL;
  const timeoutMs = options.timeoutMs ?? 3000;
  const fetchFn = options.fetchFn ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Bitstamp HTTP ${res.status}`);
    }
    const json = (await res.json()) as unknown;
    const parsed = BitstampTickerSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Unexpected Bitstamp BCHUSD response');
    }
    const asOf = parsed.data.timestamp
      ? parseInt(parsed.data.timestamp, 10)
      : Math.floor((options.nowSeconds ?? (() => Date.now() / 1000))());
    const usdPriceMicros = decimalStringToMicros(parsed.data.last);
    return {
      source: 'bitstamp-bch-usd',
      usdPrice: usdPriceMicros,
      usdPriceMicros,
      asOf,
    };
  } finally {
    clearTimeout(timer);
  }
}

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
  costFeedGraceSeconds?: number | undefined;
}

export const DEFAULT_LIVE_INPUT_LIMITS: LiveInputLimits = {
  ethUsdMaxAgeSeconds: 1800,
  bchUsdMaxAgeSeconds: 300,
  baseGasMaxAgeSeconds: 60,
  bchFeeRateMaxAgeSeconds: 300,
  bchUsdDisagreementPercent: 5,
  costFeedGraceSeconds: 900,
};

export function verifyLiveInputs(
  inputs: LiveCostInputs,
  limits: LiveInputLimits = DEFAULT_LIVE_INPUT_LIMITS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  const graceSeconds = limits.costFeedGraceSeconds ?? 900;

  // 1. ETH/USD
  const isEthCached = inputs.ethUsd.source.includes('(cached');
  const maxEthAge = isEthCached ? graceSeconds : limits.ethUsdMaxAgeSeconds;
  const ethAge = nowSeconds - inputs.ethUsd.asOf;
  if (ethAge < -30) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `ETH/USD timestamp from ${inputs.ethUsd.source} is in the future (asOf: ${inputs.ethUsd.asOf}, now: ${nowSeconds})`,
    );
  }
  if (ethAge > maxEthAge) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `ETH/USD price from ${inputs.ethUsd.source} is stale (asOf: ${inputs.ethUsd.asOf}, age: ${ethAge}s, max: ${maxEthAge}s)`,
    );
  }
  if (inputs.ethUsd.usdPriceMicros <= 0n) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `ETH/USD price from ${inputs.ethUsd.source} must be positive, got ${inputs.ethUsd.usdPriceMicros}`,
    );
  }

  // 2. BCH/USD
  const isBchCached = inputs.bchUsd.source.includes('(cached');
  const maxBchAge = isBchCached ? graceSeconds : limits.bchUsdMaxAgeSeconds;
  const bchAge = nowSeconds - inputs.bchUsd.asOf;
  if (bchAge < -30) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `BCH/USD timestamp from ${inputs.bchUsd.source} is in the future (asOf: ${inputs.bchUsd.asOf}, now: ${nowSeconds})`,
    );
  }
  if (bchAge > maxBchAge) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `BCH/USD price from ${inputs.bchUsd.source} is stale (asOf: ${inputs.bchUsd.asOf}, age: ${bchAge}s, max: ${maxBchAge}s)`,
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
    const sorted = [...inputs.bchUsd.components].sort((a, b) =>
      a.usdPriceMicros < b.usdPriceMicros ? -1 : 1,
    );
    const minC = sorted[0]!;
    const maxC = sorted[sorted.length - 1]!;
    const diff = maxC.usdPriceMicros - minC.usdPriceMicros;
    const median = inputs.bchUsd.usdPriceMicros;
    if (median > 0n) {
      const diffPercent = (Number(diff) * 100) / Number(median);
      if (diffPercent > limits.bchUsdDisagreementPercent) {
        const p1Formatted = formatUsdMicrosToDecimal(minC.usdPriceMicros);
        const p2Formatted = formatUsdMicrosToDecimal(maxC.usdPriceMicros);
        throw new LiveCostError(
          'PEG_GUARD',
          `BCH/USD source disagreement of ${diff} micros (${diffPercent.toFixed(2)}%) between ${minC.source} ($${p1Formatted}) and ${maxC.source} ($${p2Formatted}) exceeds ${limits.bchUsdDisagreementPercent}% limit`,
        );
      }
    }
  }

  // 3. Base Gas
  const isGasCached = inputs.baseGas.source.includes('(cached');
  const maxGasAge = isGasCached ? graceSeconds : limits.baseGasMaxAgeSeconds;
  const gasAge = nowSeconds - inputs.baseGas.asOf;
  if (gasAge > maxGasAge) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Base gas price from ${inputs.baseGas.source} is stale (asOf: ${inputs.baseGas.asOf}, age: ${gasAge}s, max: ${maxGasAge}s)`,
    );
  }
  if (inputs.baseGas.gasPriceWei < 0n) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Base gas price from ${inputs.baseGas.source} must be non-negative`,
    );
  }

  // 4. BCH Fee Rate
  const isFeeCached = inputs.bchFeeRate.source.includes('(cached');
  const maxFeeAge = isFeeCached ? graceSeconds : limits.bchFeeRateMaxAgeSeconds;
  const feeAge = nowSeconds - inputs.bchFeeRate.asOf;
  if (feeAge > maxFeeAge) {
    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `Bitcoin Cash fee rate from ${inputs.bchFeeRate.source} is stale (asOf: ${inputs.bchFeeRate.asOf}, age: ${feeAge}s, max: ${maxFeeAge}s)`,
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
  gasPriceWei?: bigint | undefined;
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

  const isRobinhood =
    params.chainId === 4663 ||
    params.chainId === '4663' ||
    params.chainId === 'robinhood';

  const effectiveGasPrice = params.gasPriceWei ?? baseGas.gasPriceWei;

  let gasUnits: bigint;
  let l1FeeWei: bigint;
  let bchTxBytes: number;
  let bchFeeSats: bigint;

  if (params.direction === 'EVM_TO_BCH') {
    // Solver pays: the relayed EVM lock, its own Bitcoin Cash lock (with the carry
    // placed in the covenant output).
    gasUnits = relayLockGas;
    l1FeeWei = isRobinhood ? 0n : baseGas.l1FeeWeiPerRelayLock;
    bchTxBytes = BCH_LOCK_TX_BYTES;
    const lockMinerSats = BigInt(
      Math.max(1, Math.ceil(bchTxBytes * bchFeeRate.effectiveSatsPerByte)),
    );
    bchFeeSats = lockMinerSats + bchCarrySats;
  } else {
    // Solver pays: its EVM lock and the Bitcoin Cash claim; the carry comes back.
    gasUnits = solverLockGas;
    l1FeeWei = isRobinhood ? 0n : baseGas.l1FeeWeiPerLock;
    bchTxBytes = BCH_CLAIM_TX_BYTES;
    bchFeeSats = BigInt(
      Math.max(1, Math.ceil(bchTxBytes * bchFeeRate.effectiveSatsPerByte)),
    );
  }

  const totalEvmWei = gasUnits * effectiveGasPrice + l1FeeWei;
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
    gasPriceWei: effectiveGasPrice,
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
    pricingChoice,
    gasUnits: params.routeCost.gasUnits.toString(),
    bchTxBytes: params.routeCost.bchTxBytes,
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
  clients?: PublicClient[] | undefined;
  bchClient?: BchQuorumClient | undefined;
  ethUsdFeedAddress?: Address | undefined;
  limits?: Partial<LiveInputLimits> | undefined;
  costSafetyPercent?: number | undefined;
  minMarginUsdMicros?: bigint | undefined;
  cacheTtlSeconds?: number | undefined;
  costFeedGraceSeconds?: number | undefined;
  fakeInputs?: LiveCostInputs | undefined;
  fetchCoinbaseFn?: typeof fetchCoinbaseBchUsd | undefined;
  fetchKrakenFn?: typeof fetchKrakenBchUsd | undefined;
  fetchBitstampFn?: typeof fetchBitstampBchUsd | undefined;
  robinhoodClient?: PublicClient | undefined;
  robinhoodClients?: PublicClient[] | undefined;
  robinhoodGasPriceWei?: bigint | undefined;
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
  private readonly costFeedGraceSeconds: number;
  private readonly clients: PublicClient[];
  private readonly robinhoodClients: PublicClient[];
  private readonly robinhoodGasPriceWei?: bigint | undefined;
  private readonly fetchCoinbase: typeof fetchCoinbaseBchUsd;
  private readonly fetchKraken: typeof fetchKrakenBchUsd;
  private readonly fetchBitstamp: typeof fetchBitstampBchUsd;

  private ethUsdState: {
    lastGood?: EthUsdReading | undefined;
    lastSuccessTime?: number | undefined;
    lastError?: string | undefined;
    lastErrorTime?: number | undefined;
  } = {};

  private bchUsdState: {
    lastGood?: BchUsdReading | undefined;
    lastSuccessTime?: number | undefined;
    lastError?: string | undefined;
    lastErrorTime?: number | undefined;
  } = {};

  private baseGasState: {
    lastGood?: BaseGasReading | undefined;
    lastSuccessTime?: number | undefined;
    lastError?: string | undefined;
    lastErrorTime?: number | undefined;
  } = {};

  private robinhoodGasState: {
    lastGood?: BaseGasReading | undefined;
    lastSuccessTime?: number | undefined;
    lastError?: string | undefined;
    lastErrorTime?: number | undefined;
  } = {};

  private bchFeeRateState: {
    lastGood?: BchFeeRateReading | undefined;
    lastSuccessTime?: number | undefined;
    lastError?: string | undefined;
    lastErrorTime?: number | undefined;
  } = {};

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
    this.costFeedGraceSeconds =
      options.costFeedGraceSeconds ??
      options.limits?.costFeedGraceSeconds ??
      900;
    this.clients =
      options.clients && options.clients.length > 0
        ? options.clients
        : options.client
          ? [options.client]
          : [];
    this.robinhoodClients =
      options.robinhoodClients && options.robinhoodClients.length > 0
        ? options.robinhoodClients
        : options.robinhoodClient
          ? [options.robinhoodClient]
          : [];
    this.robinhoodGasPriceWei = options.robinhoodGasPriceWei;
    this.fetchCoinbase = options.fetchCoinbaseFn ?? fetchCoinbaseBchUsd;
    this.fetchKraken = options.fetchKrakenFn ?? fetchKrakenBchUsd;
    this.fetchBitstamp = options.fetchBitstampFn ?? fetchBitstampBchUsd;
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
      try {
        verifyLiveInputs(this.cache.inputs, this.limits, now);
        return this.cache.inputs;
      } catch {
        // Cache expired according to age limits, fall through to refresh
      }
    }

    // 1. ETH/USD
    let ethUsd: EthUsdReading;
    try {
      ethUsd = await this.readEthUsd();
      this.ethUsdState.lastGood = ethUsd;
      this.ethUsdState.lastSuccessTime = now;
      this.ethUsdState.lastError = undefined;
      this.ethUsdState.lastErrorTime = undefined;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.ethUsdState.lastError = errMsg;
      this.ethUsdState.lastErrorTime = now;
      if (this.ethUsdState.lastGood) {
        const age = now - this.ethUsdState.lastGood.asOf;
        if (age <= this.costFeedGraceSeconds) {
          ethUsd = {
            ...this.ethUsdState.lastGood,
            source: `${cleanSource(this.ethUsdState.lastGood.source)} (cached, ${age}s old)`,
          };
        } else {
          throw new LiveCostError(
            'PRICE_UNAVAILABLE',
            `ETH/USD feed failed (${errMsg}) and last known good reading is expired (age: ${age}s, grace: ${this.costFeedGraceSeconds}s)`,
          );
        }
      } else {
        throw err;
      }
    }

    // 2. BCH/USD
    let bchUsd: BchUsdReading;
    try {
      bchUsd = await this.readBchUsd();
      this.bchUsdState.lastGood = bchUsd;
      this.bchUsdState.lastSuccessTime = now;
      this.bchUsdState.lastError = undefined;
      this.bchUsdState.lastErrorTime = undefined;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.bchUsdState.lastError = errMsg;
      this.bchUsdState.lastErrorTime = now;
      if (this.bchUsdState.lastGood) {
        const age = now - this.bchUsdState.lastGood.asOf;
        if (age <= this.costFeedGraceSeconds) {
          bchUsd = {
            ...this.bchUsdState.lastGood,
            source: `${cleanSource(this.bchUsdState.lastGood.source)} (cached, ${age}s old)`,
          };
        } else {
          throw new LiveCostError(
            'PRICE_UNAVAILABLE',
            `BCH/USD feed failed (${errMsg}) and last known good reading is expired (age: ${age}s, grace: ${this.costFeedGraceSeconds}s)`,
          );
        }
      } else {
        throw err;
      }
    }

    // 3. Base Gas
    let baseGas: BaseGasReading;
    try {
      baseGas = await this.readBaseGas();
      this.baseGasState.lastGood = baseGas;
      this.baseGasState.lastSuccessTime = now;
      this.baseGasState.lastError = undefined;
      this.baseGasState.lastErrorTime = undefined;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.baseGasState.lastError = errMsg;
      this.baseGasState.lastErrorTime = now;
      if (this.baseGasState.lastGood) {
        const age = now - this.baseGasState.lastGood.asOf;
        if (age <= this.costFeedGraceSeconds) {
          baseGas = {
            ...this.baseGasState.lastGood,
            source: `${cleanSource(this.baseGasState.lastGood.source)} (cached, ${age}s old)`,
          };
        } else {
          throw new LiveCostError(
            'PRICE_UNAVAILABLE',
            `Base gas feed failed (${errMsg}) and last known good reading is expired (age: ${age}s, grace: ${this.costFeedGraceSeconds}s)`,
          );
        }
      } else {
        throw err;
      }
    }

    // 4. BCH Fee Rate
    let bchFeeRate: BchFeeRateReading;
    try {
      bchFeeRate = await this.readBchFeeRate();
      this.bchFeeRateState.lastGood = bchFeeRate;
      this.bchFeeRateState.lastSuccessTime = now;
      this.bchFeeRateState.lastError = undefined;
      this.bchFeeRateState.lastErrorTime = undefined;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.bchFeeRateState.lastError = errMsg;
      this.bchFeeRateState.lastErrorTime = now;
      if (this.bchFeeRateState.lastGood) {
        const age = now - this.bchFeeRateState.lastGood.asOf;
        if (age <= this.costFeedGraceSeconds) {
          bchFeeRate = {
            ...this.bchFeeRateState.lastGood,
            source: `${cleanSource(this.bchFeeRateState.lastGood.source)} (cached, ${age}s old)`,
          };
        } else {
          throw new LiveCostError(
            'PRICE_UNAVAILABLE',
            `BCH fee rate feed failed (${errMsg}) and last known good reading is expired (age: ${age}s, grace: ${this.costFeedGraceSeconds}s)`,
          );
        }
      } else {
        throw err;
      }
    }

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
    if (this.clients.length === 0) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        'No EVM client configured for ETH/USD feed',
      );
    }
    const errors: string[] = [];
    for (let i = 0; i < this.clients.length; i++) {
      const client = this.clients[i]!;
      try {
        const [decimals, round] = await Promise.all([
          client.readContract({
            address: this.feedAddress,
            abi: chainlinkAggregatorAbi,
            functionName: 'decimals',
          }),
          client.readContract({
            address: this.feedAddress,
            abi: chainlinkAggregatorAbi,
            functionName: 'latestRoundData',
          }),
        ]);

        const [roundId, answer, , updatedAt] = round;
        if (answer <= 0n) {
          throw new Error(
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
      } catch (err) {
        errors.push(
          `RPC[${i}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `All Base RPCs failed for ETH/USD feed: ${errors.join('; ')}`,
    );
  }

  async readBchUsd(): Promise<BchUsdReading> {
    const components: BchUsdComponent[] = [];
    const errors: string[] = [];

    const [cbRes, krRes, bsRes] = await Promise.allSettled([
      this.fetchCoinbase({ timeoutMs: 3000 }),
      this.fetchKraken({ timeoutMs: 3000 }),
      this.fetchBitstamp({ timeoutMs: 3000 }),
    ]);

    if (cbRes.status === 'fulfilled' && cbRes.value.usdPrice > 0n) {
      components.push({
        source: cbRes.value.source,
        usdPriceMicros: cbRes.value.usdPrice,
        asOf: cbRes.value.asOf,
      });
    } else if (cbRes.status === 'rejected') {
      errors.push(
        `Coinbase: ${cbRes.reason instanceof Error ? cbRes.reason.message : String(cbRes.reason)}`,
      );
    }

    if (krRes.status === 'fulfilled' && krRes.value.usdPrice > 0n) {
      components.push({
        source: krRes.value.source,
        usdPriceMicros: krRes.value.usdPrice,
        asOf: krRes.value.asOf,
      });
    } else if (krRes.status === 'rejected') {
      errors.push(
        `Kraken: ${krRes.reason instanceof Error ? krRes.reason.message : String(krRes.reason)}`,
      );
    }

    if (bsRes.status === 'fulfilled' && bsRes.value.usdPriceMicros > 0n) {
      components.push({
        source: bsRes.value.source,
        usdPriceMicros: bsRes.value.usdPriceMicros,
        asOf: bsRes.value.asOf,
      });
    } else if (bsRes.status === 'rejected') {
      errors.push(
        `Bitstamp: ${bsRes.reason instanceof Error ? bsRes.reason.message : String(bsRes.reason)}`,
      );
    }

    if (components.length < 2) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        `Fewer than two public BCH/USD sources available (got ${components.length}, errors: ${errors.join('; ')})`,
      );
    }

    // Sort components by price ascending
    const sorted = [...components].sort((a, b) =>
      a.usdPriceMicros < b.usdPriceMicros ? -1 : 1,
    );

    const minC = sorted[0]!;
    const maxC = sorted[sorted.length - 1]!;

    const medianMicros =
      sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]!.usdPriceMicros
        : (sorted[sorted.length / 2 - 1]!.usdPriceMicros +
            sorted[sorted.length / 2]!.usdPriceMicros) /
          2n;

    // Disagreement check between min and max
    const diff = maxC.usdPriceMicros - minC.usdPriceMicros;
    if (medianMicros > 0n) {
      const diffPercent = (Number(diff) * 100) / Number(medianMicros);
      if (diffPercent > this.limits.bchUsdDisagreementPercent) {
        const minP = formatUsdMicrosToDecimal(minC.usdPriceMicros);
        const maxP = formatUsdMicrosToDecimal(maxC.usdPriceMicros);
        throw new LiveCostError(
          'PEG_GUARD',
          `BCH/USD source disagreement of ${diff} micros (${diffPercent.toFixed(2)}%) between ${minC.source} ($${minP}) and ${maxC.source} ($${maxP}) exceeds ${this.limits.bchUsdDisagreementPercent}% limit`,
        );
      }
    }

    const minAsOf = Math.min(...components.map((c) => c.asOf));

    return {
      usdPriceMicros: medianMicros,
      source: 'bch-usd-median',
      asOf: minAsOf,
      components,
    };
  }

  async readBaseGas(): Promise<BaseGasReading> {
    if (this.clients.length === 0) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        'No EVM client configured for Base gas',
      );
    }
    const errors: string[] = [];
    for (let i = 0; i < this.clients.length; i++) {
      const client = this.clients[i]!;
      try {
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
      } catch (err) {
        errors.push(
          `RPC[${i}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    throw new LiveCostError(
      'PRICE_UNAVAILABLE',
      `All Base RPCs failed for Base gas: ${errors.join('; ')}`,
    );
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

  async readRobinhoodGas(nowSeconds?: number): Promise<BaseGasReading> {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);

    if (this.robinhoodGasPriceWei !== undefined) {
      return {
        gasPriceWei: this.robinhoodGasPriceWei,
        l1FeeWeiPerRelayLock: 0n,
        l1FeeWeiPerLock: 0n,
        source: 'robinhood-configured-gas',
        asOf: now,
      };
    }
    if (typeof process !== 'undefined' && process.env.ROBINHOOD_GAS_PRICE_WEI) {
      return {
        gasPriceWei: BigInt(process.env.ROBINHOOD_GAS_PRICE_WEI),
        l1FeeWeiPerRelayLock: 0n,
        l1FeeWeiPerLock: 0n,
        source: 'robinhood-env-gas',
        asOf: now,
      };
    }

    if (this.robinhoodClients.length > 0) {
      const errors: string[] = [];
      for (let i = 0; i < this.robinhoodClients.length; i++) {
        const client = this.robinhoodClients[i]!;
        try {
          const gasPriceWei = await client.getGasPrice();
          const reading: BaseGasReading = {
            gasPriceWei,
            l1FeeWeiPerRelayLock: 0n,
            l1FeeWeiPerLock: 0n,
            source: 'robinhood-rpc',
            asOf: now,
          };
          this.robinhoodGasState.lastGood = reading;
          this.robinhoodGasState.lastSuccessTime = now;
          this.robinhoodGasState.lastError = undefined;
          this.robinhoodGasState.lastErrorTime = undefined;
          return reading;
        } catch (err) {
          errors.push(
            `RPC[${i}]: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.robinhoodGasState.lastError = errors.join('; ');
      this.robinhoodGasState.lastErrorTime = now;
      if (this.robinhoodGasState.lastGood) {
        const age = now - this.robinhoodGasState.lastGood.asOf;
        if (age <= this.costFeedGraceSeconds) {
          return {
            ...this.robinhoodGasState.lastGood,
            source: `${this.robinhoodGasState.lastGood.source} (cached, ${age}s old)`,
          };
        }
      }
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        `All Robinhood RPCs failed for gas: ${errors.join('; ')}`,
      );
    }

    if (
      typeof process !== 'undefined' &&
      process.env.ROBINHOOD_GAS_REQUIRED === 'true'
    ) {
      throw new LiveCostError(
        'PRICE_UNAVAILABLE',
        'No EVM client or gas price configured for Robinhood gas',
      );
    }

    const baseGas = await this.readBaseGas();
    return {
      gasPriceWei: baseGas.gasPriceWei,
      l1FeeWeiPerRelayLock: 0n,
      l1FeeWeiPerLock: 0n,
      source: `${baseGas.source} (fallback)`,
      asOf: now,
    };
  }

  getFeedStatuses(nowSeconds?: number): Record<string, CostFeedStatus> {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);

    const getStatus = <T extends { source: string; asOf: number }>(state: {
      lastGood?: T | undefined;
      lastSuccessTime?: number | undefined;
      lastError?: string | undefined;
      lastErrorTime?: number | undefined;
    }): CostFeedStatus => {
      const ageSeconds = state.lastGood
        ? Math.max(0, now - state.lastGood.asOf)
        : undefined;
      const cached = state.lastError != null && state.lastGood != null;
      return {
        lastSuccessTime: state.lastSuccessTime ?? null,
        lastError: state.lastError ?? null,
        lastErrorTime: state.lastErrorTime ?? null,
        source: state.lastGood ? cleanSource(state.lastGood.source) : undefined,
        cached,
        ageSeconds,
      };
    };

    return {
      ethUsd: getStatus(this.ethUsdState),
      bchUsd: getStatus(this.bchUsdState),
      baseGas: getStatus(this.baseGasState),
      bchFeeRate: getStatus(this.bchFeeRateState),
    };
  }

  async getRouteCost(
    direction: Direction,
    chainId?: number | string | undefined,
    nowSeconds?: number | undefined,
  ): Promise<RouteCostBreakdown> {
    const inputs = await this.readLiveInputs(nowSeconds);
    const isRobinhood =
      chainId === 4663 || chainId === '4663' || chainId === 'robinhood';

    let gasPriceWei: bigint | undefined;
    if (isRobinhood) {
      const rhGas = await this.readRobinhoodGas(nowSeconds);
      gasPriceWei = rhGas.gasPriceWei;
    }

    return calculateRouteCost({
      direction,
      chainId,
      inputs,
      gasPriceWei,
      safetyMarginPercent: this.costSafetyPercent,
      minMarginUsdMicros: this.minMarginUsdMicros,
    });
  }
}
