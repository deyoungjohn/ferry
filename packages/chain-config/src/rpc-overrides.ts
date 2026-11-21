import { CHAIN_IDS, type ChainId, type RpcFact } from './schema.js';

export const RPC_OVERRIDE_ENV_NAMES: Record<ChainId, string> = {
  base: 'RPC_URL_BASE',
  ethereum: 'RPC_URL_ETHEREUM',
  arbitrum: 'RPC_URL_ARBITRUM',
  arc: 'RPC_URL_ARC',
  bnb: 'RPC_URL_BNB',
  robinhood: 'RPC_URL_ROBINHOOD',
};

export type RpcEndpointSource = 'override' | 'public';

export interface RpcEndpointView {
  url: string;
  host: string;
  maxLogRange: number | null;
  source: RpcEndpointSource;
}

export class RpcOverrideError extends Error {
  readonly variable: string;

  constructor(variable: string, reason: string) {
    super(`Invalid ${variable}: ${reason}. The value is not printed.`);
    this.name = 'RpcOverrideError';
    this.variable = variable;
  }
}

export type RpcOverrides = Partial<Record<ChainId, string[]>>;

function parseUrlList(variable: string, raw: string): string[] {
  const parts = raw.split(',').map((value) => value.trim());
  if (parts.some((value) => value === '')) {
    throw new RpcOverrideError(variable, 'the list contains an empty URL');
  }
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of parts) {
    let parsed: URL;
    try {
      parsed = new URL(part);
    } catch {
      throw new RpcOverrideError(
        variable,
        'expected a comma-separated list of http(s) URLs',
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new RpcOverrideError(
        variable,
        'only http and https URLs are supported',
      );
    }
    if (parsed.hostname === '') {
      throw new RpcOverrideError(variable, 'a URL has no host name');
    }
    if (!seen.has(part)) {
      seen.add(part);
      urls.push(part);
    }
  }
  return urls;
}

export function parseRpcOverrides(
  env: Record<string, string | undefined>,
): RpcOverrides {
  const overrides: RpcOverrides = {};
  for (const chain of CHAIN_IDS) {
    const variable = RPC_OVERRIDE_ENV_NAMES[chain];
    // The main endpoint first (RPC_URL_<CHAIN>, which may itself be a list), then the fallbacks
    // RPC_URL_<CHAIN>_1 to _3 in that order. A rate-limited endpoint hands over to the next.
    const urls: string[] = [];
    for (const name of [
      variable,
      `${variable}_1`,
      `${variable}_2`,
      `${variable}_3`,
    ]) {
      const raw = env[name];
      if (raw === undefined || raw.trim() === '') continue;
      for (const url of parseUrlList(name, raw)) {
        if (!urls.includes(url)) urls.push(url);
      }
    }
    if (urls.length === 0) continue;
    overrides[chain] = urls;
  }
  return overrides;
}

export function redactRpcUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.host || '[invalid-rpc-url]';
  } catch {
    return '[invalid-rpc-url]';
  }
}

export function redactRpcSecrets(
  message: string,
  urls: readonly string[],
): string {
  let result = message;
  for (const url of urls) {
    result = result.split(url).join(redactRpcUrl(url));
  }
  return result;
}

export type RpcCaller = <T>(
  url: string,
  method: string,
  params: unknown[],
) => Promise<T>;

export async function probeRpcLogMaxRange(
  url: string,
  call: RpcCaller,
): Promise<number | null> {
  let latest: number;
  try {
    latest = Number(BigInt(await call<string>(url, 'eth_blockNumber', [])));
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(latest) || latest < 2) return 0;

  const head = latest - 1;
  let best = 0;
  for (const range of [10, 100, 1_000, 10_000, 50_000, 100_000, 500_000]) {
    if (head < range) break;
    const fromBlock = head - range + 1;
    try {
      await call<unknown[]>(url, 'eth_getLogs', [
        {
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${head.toString(16)}`,
          address: '0x0000000000000000000000000000000000000001',
        },
      ]);
      best = range;
    } catch {
      break;
    }
  }
  return best;
}

export function buildRpcEndpoints(
  publicRpcs: readonly RpcFact[],
  overrideUrls: readonly string[],
  rpcCaps?: Record<string, number>,
): RpcEndpointView[] {
  const endpoints: RpcEndpointView[] = overrideUrls.map((url) => ({
    url,
    host: redactRpcUrl(url),
    maxLogRange: rpcCaps?.[url] ?? null,
    source: 'override',
  }));
  for (const rpc of publicRpcs) {
    endpoints.push({
      url: rpc.url,
      host: redactRpcUrl(rpc.url),
      maxLogRange: rpc.getLogsMaxRange,
      source: 'public',
    });
  }
  return endpoints;
}
