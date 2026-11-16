import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadChainConfig } from './config.js';
import {
  probeRpcLogMaxRange,
  redactRpcSecrets,
  redactRpcUrl,
  type RpcCaller,
} from './rpc-overrides.js';

const CIRCLE_USDC_DOCS =
  'https://developers.circle.com/stablecoins/usdc-contract-addresses';
const TETHER_PROTOCOLS_DOCS = 'https://tether.to/en/supported-protocols/';

function makeRpc(): RpcCaller {
  return async <T>(
    url: string,
    method: string,
    params: unknown[],
  ): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        result?: T;
        error?: { message?: string };
      };
      if (payload.error) {
        throw new Error(
          redactRpcSecrets(payload.error.message ?? 'RPC returned an error', [
            url,
          ]),
        );
      }
      if (payload.result === undefined)
        throw new Error('RPC returned no result');
      return payload.result;
    } catch (error) {
      throw new Error(
        redactRpcSecrets(
          error instanceof Error ? error.message : String(error),
          [url],
        ),
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'ferry-preflight/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function listed(text: string | null, name: RegExp): string {
  if (text === null) return 'unknown';
  return name.test(text) ? 'yes' : 'no';
}

async function publicLogCap(
  chain: 'arc' | 'robinhood',
  rpc: RpcCaller,
): Promise<string> {
  const config = loadChainConfig({ env: {}, network: 'mainnet' });
  const facts = config.facts.find((item) => item.id === chain);
  const endpoint = facts?.rpcEndpoints.find((item) => item.source === 'public');
  if (!endpoint) return 'no public endpoint';
  const cap = await probeRpcLogMaxRange(endpoint.url, rpc);
  return cap === null
    ? `yes (${endpoint.host}; cap unknown)`
    : `yes (${redactRpcUrl(endpoint.url)}; cap ${cap} blocks)`;
}

export async function runWatchChains(): Promise<void> {
  const rpc = makeRpc();
  const [circle, tether] = await Promise.all([
    fetchText(CIRCLE_USDC_DOCS),
    fetchText(TETHER_PROTOCOLS_DOCS),
  ]);
  const arcPattern = /\barc\b/i;
  const robinhoodPattern = /\brobinhood\b/i;
  const arcLogs = await publicLogCap('arc', rpc);
  const robinhoodLogs = await publicLogCap('robinhood', rpc);

  console.log(
    `Arc: Circle USDC listed: ${listed(circle, arcPattern)}; Tether USDT listed: ${listed(tether, arcPattern)}; public log RPC: ${arcLogs}`,
  );
  console.log(
    `Robinhood Chain: Circle USDC listed: ${listed(circle, robinhoodPattern)}; Tether USDT listed: ${listed(tether, robinhoodPattern)}; public log RPC: ${robinhoodLogs}`,
  );
  console.log('No route was enabled by this check.');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runWatchChains().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
