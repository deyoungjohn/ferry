import { readFileSync } from 'node:fs';
import {
  EvmChainConfigSchema,
  type EvmChainConfig as CoreEvmChainConfig,
} from '@ferry/core';
import { getAddress } from 'viem';
import {
  CHAIN_IDS,
  NETWORKS,
  type AssetSymbol,
  type ChainConfigData,
  type ChainId,
  type FactStatus,
  type Network,
  type NetworkFacts,
  type PriceFeedFacts,
  type TokenFacts,
  isVerified,
  parseChainConfigData,
} from './schema.js';
import { predictHtlcAddress } from './htlc.js';
import { parseEnabledRoutes, type RouteKey } from './routes.js';

export interface EvmAssetFact {
  symbol: AssetSymbol;
  decimals: number | null;
  address: string | null;
  permit: boolean;
  issuer: string;
  nativeOrBridged: TokenFacts['nativeOrBridged'];
  verified: boolean;
  notes: string | null;
}

export interface ChainDeploymentFactView {
  htlcAddress: string | null;
  deployBlock: number | null;
  relayCostUsd: number | null;
  predictedHtlcAddress: string;
  status: FactStatus;
}

export interface ChainFactView {
  id: ChainId;
  name: string;
  network: Network;
  chainId: number;
  rpcUrls: string[];
  explorerUrl: string;
  nativeGas: NetworkFacts['nativeGas'];
  finality: {
    fast: number;
    safe: 'safe' | 'finalized' | number;
    status: FactStatus;
  };
  create2Factory: {
    address: string;
    hasCode: boolean;
  };
  htlcAddress: string | null;
  relayCostUsd: number | null;
  deployment: ChainDeploymentFactView;
  assets: EvmAssetFact[];
  priceFeeds: PriceFeedFacts[];
  notes: string | null;
}

export interface RouteConfig {
  key: string;
  asset: AssetSymbol;
  chain: ChainId;
  enabled: boolean;
  reasons: string[];
}

export interface ChainConfig {
  generatedAt: string;
  network: Network;
  chains: ChainFactView[];
  facts: ChainFactView[];
  coreChains: CoreEvmChainConfig[];
  routes: RouteConfig[];
  enabledRoutes: string[];
}

export interface ChainDisplayConfig {
  id: ChainId;
  name: string;
  chainId: number;
  explorerUrl: string;
  tokenSymbols: AssetSymbol[];
  enabled: boolean;
  disabledReason: string | null;
  priceSource: string;
}

export interface ChainDisplayResult {
  generatedAt: string;
  network: Network;
  chains: ChainDisplayConfig[];
}

export class RouteConfigurationError extends Error {
  readonly route: string | null;
  readonly reasons: string[];

  constructor(message: string, route: string | null, reasons: string[]) {
    super(message);
    this.name = 'RouteConfigurationError';
    this.route = route;
    this.reasons = reasons;
  }
}

export class NetworkConfigurationError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid FERRY_NETWORK "${value}"; expected "mainnet" or "testnet".`);
    this.name = 'NetworkConfigurationError';
    this.value = value;
  }
}

export class DeploymentAddressError extends Error {
  constructor(
    readonly chain: ChainId,
    readonly configured: string,
    readonly predicted: string,
  ) {
    super(
      `Configured HTLC address ${configured} on ${chain} does not match the CREATE2 prediction ${predicted}.`,
    );
    this.name = 'DeploymentAddressError';
  }
}

export function loadChainData(): unknown {
  const dataUrl = new URL('./data/chains.json', import.meta.url);
  return JSON.parse(readFileSync(dataUrl, 'utf8')) as unknown;
}

export function parseFerryNetwork(raw: string | null | undefined): Network {
  if (raw === null || raw === undefined || raw.trim() === '') return 'mainnet';
  const value = raw.trim().toLowerCase();
  if (value === 'mainnet' || value === 'testnet') return value;
  throw new NetworkConfigurationError(raw);
}

function tokenIneligibilityReasons(token: TokenFacts): string[] {
  const reasons: string[] = [];

  if (token.address === null) {
    reasons.push('token address is missing');
  } else if (!isVerified(token.verification.address)) {
    reasons.push(`token address is ${token.verification.address.status}`);
  }

  if (token.decimals === null) {
    reasons.push('token decimals are missing');
  } else if (!isVerified(token.verification.decimals)) {
    reasons.push(`token decimals are ${token.verification.decimals.status}`);
  }

  if (!isVerified(token.verification.eip712)) {
    reasons.push(`EIP-712 domain is ${token.verification.eip712.status}`);
  }

  if (!isVerified(token.verification.permit)) {
    reasons.push(`permit support is ${token.verification.permit.status}`);
  }

  if (token.permit) {
    if (!token.nonces) reasons.push('EIP-2612 nonces are unavailable');
    if (token.name === null) reasons.push('EIP-712 name is missing');
    if (token.version === null) reasons.push('EIP-712 version is missing');
    if (token.domainSeparator === null) {
      reasons.push('EIP-712 domain separator is missing');
    }
  } else if (token.version !== null || token.domainSeparator !== null) {
    reasons.push(
      'token exposes an EIP-712 domain but permit is marked unavailable',
    );
  }

  return reasons;
}

function chainIneligibilityReasons(chain: NetworkFacts): string[] {
  const reasons: string[] = [];

  const verifiedRpcs = chain.rpcUrls.filter((rpc) => isVerified(rpc.evidence));
  if (verifiedRpcs.length < 2) {
    reasons.push(
      `fewer than two verified RPC URLs (${verifiedRpcs.length} of ${chain.rpcUrls.length})`,
    );
  }

  if (!isVerified(chain.finality.evidence)) {
    reasons.push(`finality policy is ${chain.finality.evidence.status}`);
  }

  if (chain.finality.safeTag === 'safe' && !chain.finality.safeTagWorks) {
    reasons.push('the safe block tag is unavailable');
  }
  if (
    chain.finality.safeTag === 'finalized' &&
    !chain.finality.finalizedTagWorks
  ) {
    reasons.push('the finalized block tag is unavailable');
  }

  return reasons;
}

export function routeIneligibilityReasons(
  chain: NetworkFacts,
  token: TokenFacts,
): string[] {
  return [
    ...chainIneligibilityReasons(chain),
    ...tokenIneligibilityReasons(token),
  ];
}

function toAssetFact(token: TokenFacts): EvmAssetFact {
  return {
    symbol: token.symbol,
    decimals: token.decimals,
    address: token.address,
    permit: token.permit,
    issuer: token.issuer,
    nativeOrBridged: token.nativeOrBridged,
    verified: tokenIneligibilityReasons(token).length === 0,
    notes: token.notes ?? null,
  };
}

function toChainFactView(
  id: ChainId,
  name: string,
  network: Network,
  chain: NetworkFacts,
): ChainFactView {
  return {
    id,
    name,
    network,
    chainId: chain.chainId,
    rpcUrls: chain.rpcUrls.map((rpc) => rpc.url),
    explorerUrl: chain.explorerUrl,
    nativeGas: chain.nativeGas,
    finality: {
      fast: chain.finality.fastBlocks,
      safe: chain.finality.safeTag,
      status: chain.finality.evidence.status,
    },
    create2Factory: {
      address: chain.create2Factory.address,
      hasCode: chain.create2Factory.hasCode,
    },
    htlcAddress:
      chain.deployment.htlcAddress === null
        ? null
        : getAddress(chain.deployment.htlcAddress),
    relayCostUsd: chain.deployment.relayCostUsd,
    deployment: {
      htlcAddress:
        chain.deployment.htlcAddress === null
          ? null
          : getAddress(chain.deployment.htlcAddress),
      deployBlock: chain.deployment.deployBlock,
      relayCostUsd: chain.deployment.relayCostUsd,
      predictedHtlcAddress: predictHtlcAddress(),
      status: chain.deployment.evidence.status,
    },
    assets: chain.tokens.map(toAssetFact),
    priceFeeds: chain.priceFeeds,
    notes: chain.notes ?? null,
  };
}

function toCoreChainConfig(
  id: ChainId,
  network: Network,
  chain: NetworkFacts,
): CoreEvmChainConfig | null {
  const assets = chain.tokens.flatMap((token) => {
    if (token.address === null || token.decimals === null) return [];
    if (tokenIneligibilityReasons(token).length > 0) return [];
    return [
      {
        symbol: token.symbol,
        decimals: token.decimals,
        address: token.address,
        permit: token.permit,
      },
    ];
  });

  if (assets.length === 0) return null;

  const predicted = predictHtlcAddress();
  const configured = chain.deployment.htlcAddress;
  if (configured !== null && getAddress(configured) !== predicted) {
    throw new DeploymentAddressError(id, configured, predicted);
  }

  const candidate: Record<string, unknown> = {
    id,
    chainId: chain.chainId,
    rpcUrls: chain.rpcUrls.map((rpc) => rpc.url),
    explorerUrl: chain.explorerUrl,
    htlcAddress: configured ?? predicted,
    nativeGas: chain.nativeGas,
    finality: {
      fast: chain.finality.fastBlocks,
      safe: chain.finality.safeTag,
    },
    assets,
    relayCostUsd: chain.deployment.relayCostUsd ?? 0,
  };
  if (chain.deployment.deployBlock !== null) {
    candidate.deployBlock = chain.deployment.deployBlock;
  }

  const parsed = EvmChainConfigSchema.parse(candidate);
  return { ...parsed, htlcAddress: getAddress(parsed.htlcAddress) };
}

function buildRoutes(network: Network, data: ChainConfigData): RouteConfig[] {
  const routes: RouteConfig[] = [];
  for (const id of CHAIN_IDS) {
    const chain = data.chains[id][network];
    for (const token of chain.tokens) {
      const key = `${token.symbol.toLowerCase()}:${id}`;
      routes.push({
        key,
        asset: token.symbol,
        chain: id,
        enabled: false,
        reasons: routeIneligibilityReasons(chain, token),
      });
    }
  }
  return routes;
}

function requestedRouteKeys(
  requested: RouteKey[],
  routesByKey: Map<string, RouteConfig>,
): Set<string> {
  const enabled = new Set<string>();
  const known = [...routesByKey.keys()].sort();

  for (const route of requested) {
    const configured = routesByKey.get(route.key);
    if (!configured) {
      throw new RouteConfigurationError(
        `Route "${route.key}" is not defined. Known routes: ${known.join(', ') || 'none'}.`,
        route.key,
        [],
      );
    }
    if (configured.reasons.length > 0) {
      throw new RouteConfigurationError(
        `Route "${route.key}" cannot be enabled: ${configured.reasons.join('; ')}. An environment flag cannot override unverified facts.`,
        route.key,
        configured.reasons,
      );
    }
    enabled.add(route.key);
  }

  return enabled;
}

export interface LoadChainConfigOptions {
  env?: Record<string, string | undefined>;
  data?: unknown;
  network?: Network;
}

export function loadChainConfig(
  options: LoadChainConfigOptions = {},
): ChainConfig {
  const environment = options.env ?? process.env;
  const network =
    options.network ?? parseFerryNetwork(environment.FERRY_NETWORK);
  const data: ChainConfigData = parseChainConfigData(
    options.data ?? loadChainData(),
  );
  const requested = parseEnabledRoutes(environment.ENABLED_ROUTES);

  const chains = CHAIN_IDS.flatMap((id) =>
    NETWORKS.map((item) =>
      toChainFactView(id, data.chains[id].name, item, data.chains[id][item]),
    ),
  );
  const facts = chains.filter((chain) => chain.network === network);
  const routes = buildRoutes(network, data);
  const routesByKey = new Map(routes.map((route) => [route.key, route]));
  const enabledKeys = requestedRouteKeys(requested, routesByKey);

  for (const route of routes) {
    route.enabled = enabledKeys.has(route.key);
  }

  const coreChains = CHAIN_IDS.flatMap((id) => {
    const chain = toCoreChainConfig(id, network, data.chains[id][network]);
    return chain === null ? [] : [chain];
  });

  return {
    generatedAt: data.generatedAt,
    network,
    chains,
    facts,
    coreChains,
    routes,
    enabledRoutes: requested
      .filter((route) => enabledKeys.has(route.key))
      .map((route) => route.key),
  };
}

function disabledReasonFor(routes: RouteConfig[]): string | null {
  if (routes.length === 0) return 'No canonical USDC or USDT route';
  const parts = routes
    .filter((route) => !route.enabled)
    .map((route) =>
      route.reasons.length > 0
        ? `${route.key}: ${route.reasons.join('; ')}`
        : `${route.key}: route not enabled`,
    );
  return parts.length === 0 ? null : parts.join(' | ');
}

function priceSourceFor(facts: ChainFactView, routes: RouteConfig[]): string {
  if (routes.length === 0) return 'Fallback (no route)';
  const enabledAssets = routes
    .filter((route) => route.enabled)
    .map((route) => route.asset);
  const assets =
    enabledAssets.length > 0
      ? enabledAssets
      : facts.assets.map((asset) => asset.symbol);
  const feeds = facts.priceFeeds.filter((feed) => assets.includes(feed.asset));
  if (feeds.length > 0) {
    return feeds.map((feed) => `Chainlink ${feed.pair}`).join(', ');
  }
  return 'Issuer/independent fallback';
}

export function loadChainDisplay(
  options: LoadChainConfigOptions = {},
): ChainDisplayResult {
  const config = loadChainConfig(options);
  const chains = config.facts.map((facts) => {
    const routes = config.routes.filter((route) => route.chain === facts.id);
    const enabled = routes.some((route) => route.enabled);
    const tokenSymbols = facts.assets
      .filter((asset) => asset.verified)
      .map((asset) => asset.symbol)
      .filter((symbol, index, all) => all.indexOf(symbol) === index);
    return {
      id: facts.id,
      name: facts.name,
      chainId: facts.chainId,
      explorerUrl: facts.explorerUrl,
      tokenSymbols,
      enabled,
      disabledReason: enabled ? null : disabledReasonFor(routes),
      priceSource: priceSourceFor(facts, routes),
    };
  });

  return {
    generatedAt: config.generatedAt,
    network: config.network,
    chains,
  };
}
