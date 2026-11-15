import { readFileSync } from 'node:fs';
import {
  CHAIN_IDS,
  NETWORKS,
  type AssetSymbol,
  type ChainConfigData,
  type ChainId,
  type FactStatus,
  type Network,
  type NetworkFacts,
  type TokenFacts,
  isVerified,
  parseChainConfigData,
} from './schema.js';
import { parseEnabledRoutes, type RouteKey } from './routes.js';

export interface EvmAssetConfig {
  symbol: AssetSymbol;
  decimals: number | null;
  address: string | null;
  permit: boolean;
  issuer: string;
  nativeOrBridged: TokenFacts['nativeOrBridged'];
  verified: boolean;
  notes: string | null;
}

export interface EvmChainConfig {
  id: ChainId;
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
  assets: EvmAssetConfig[];
  relayCostUsd: number | null;
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
  chains: EvmChainConfig[];
  routes: RouteConfig[];
  enabledRoutes: string[];
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

export function loadChainData(): unknown {
  const dataUrl = new URL('./data/chains.json', import.meta.url);
  return JSON.parse(readFileSync(dataUrl, 'utf8')) as unknown;
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

function toAssetConfig(token: TokenFacts): EvmAssetConfig {
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

function toChainConfig(
  id: ChainId,
  network: Network,
  chain: NetworkFacts,
): EvmChainConfig {
  return {
    id,
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
    htlcAddress: null,
    assets: chain.tokens.map(toAssetConfig),
    relayCostUsd: null,
    notes: chain.notes ?? null,
  };
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
}

export function loadChainConfig(
  options: LoadChainConfigOptions = {},
): ChainConfig {
  const data: ChainConfigData = parseChainConfigData(
    options.data ?? loadChainData(),
  );
  const requested = parseEnabledRoutes(
    (options.env ?? process.env).ENABLED_ROUTES,
  );

  const chains: EvmChainConfig[] = [];
  for (const id of CHAIN_IDS) {
    for (const network of NETWORKS) {
      chains.push(toChainConfig(id, network, data.chains[id][network]));
    }
  }

  const routes: RouteConfig[] = [];
  for (const id of CHAIN_IDS) {
    const mainnet = data.chains[id].mainnet;
    for (const token of mainnet.tokens) {
      const key = `${token.symbol.toLowerCase()}:${id}`;
      routes.push({
        key,
        asset: token.symbol,
        chain: id,
        enabled: false,
        reasons: routeIneligibilityReasons(mainnet, token),
      });
    }
  }

  const routesByKey = new Map(routes.map((route) => [route.key, route]));
  const enabledKeys = requestedRouteKeys(requested, routesByKey);

  for (const route of routes) {
    route.enabled = enabledKeys.has(route.key);
  }

  return {
    generatedAt: data.generatedAt,
    chains,
    routes,
    enabledRoutes: requested
      .filter((route) => enabledKeys.has(route.key))
      .map((route) => route.key),
  };
}
