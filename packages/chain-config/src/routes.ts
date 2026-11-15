import {
  ASSET_SYMBOLS,
  CHAIN_IDS,
  type AssetSymbol,
  type ChainId,
} from './schema.js';

export interface RouteKey {
  asset: AssetSymbol;
  chain: ChainId;
  key: string;
}

export class EnabledRoutesError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Invalid ENABLED_ROUTES:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'EnabledRoutesError';
    this.issues = issues;
  }
}

export function formatRouteKey(asset: AssetSymbol, chain: ChainId): string {
  return `${asset.toLowerCase()}:${chain}`;
}

function isAssetSymbol(value: string): value is AssetSymbol {
  return (ASSET_SYMBOLS as readonly string[]).includes(value.toUpperCase());
}

function isChainId(value: string): value is ChainId {
  return (CHAIN_IDS as readonly string[]).includes(value);
}

function normalizeAsset(value: string): AssetSymbol {
  return value.toUpperCase() as AssetSymbol;
}

export function parseEnabledRoutes(raw: string | null | undefined): RouteKey[] {
  if (raw === null || raw === undefined || raw.trim() === '') return [];

  const issues: string[] = [];
  const routes: RouteKey[] = [];
  const seen = new Set<string>();

  raw.split(',').forEach((rawSegment, index) => {
    const segment = rawSegment.trim();
    if (segment === '') {
      issues.push(`segment ${index + 1} is empty`);
      return;
    }

    const parts = segment.split(':');
    if (parts.length !== 2) {
      issues.push(
        `segment ${index + 1} ("${segment}") must have the form <asset>:<chain>`,
      );
      return;
    }

    const rawAsset = parts[0]?.trim() ?? '';
    const rawChain = parts[1]?.trim() ?? '';
    if (rawAsset === '' || rawChain === '') {
      issues.push(
        `segment ${index + 1} ("${segment}") has an empty asset or chain`,
      );
      return;
    }

    const asset = normalizeAsset(rawAsset);
    if (!isAssetSymbol(asset)) {
      issues.push(
        `segment ${index + 1} ("${segment}") has unknown asset "${rawAsset}"; expected one of ${ASSET_SYMBOLS.join(', ')}`,
      );
      return;
    }

    const chain = rawChain.toLowerCase();
    if (!isChainId(chain)) {
      issues.push(
        `segment ${index + 1} ("${segment}") has unknown chain "${rawChain}"; expected one of ${CHAIN_IDS.join(', ')}`,
      );
      return;
    }

    const key = formatRouteKey(asset, chain);
    if (seen.has(key)) {
      issues.push(`route "${key}" is listed more than once`);
      return;
    }

    seen.add(key);
    routes.push({ asset, chain, key });
  });

  if (issues.length > 0) throw new EnabledRoutesError(issues);
  return routes;
}
