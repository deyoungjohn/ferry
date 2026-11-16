import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadChainConfig } from './config.js';
import { ethGetCode } from './evm-read.js';
import {
  parseRpcOverrides,
  probeRpcLogMaxRange,
  type RpcCaller,
} from './rpc-overrides.js';
import { makeJsonRpc } from './rpc-client.js';

const CIRCLE_USDC_DOCS =
  'https://developers.circle.com/stablecoins/usdc-contract-addresses';
const TETHER_PROTOCOLS_DOCS = 'https://tether.to/en/supported-protocols/';
const ROBINHOOD_CHAINLINK_FEEDS =
  'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json';

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

async function fetchJson(url: string): Promise<unknown | null> {
  const text = await fetchText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function listed(text: string | null, name: RegExp): string {
  if (text === null) return 'unknown';
  return name.test(text) ? 'yes' : 'no';
}

function chainlinkRobinhoodFeed(directory: unknown | null): string {
  if (!Array.isArray(directory)) return 'unknown';
  return directory.some(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      (entry as { name?: unknown }).name === 'USDC / USD',
  )
    ? 'yes'
    : 'no';
}

async function watchChain(
  chainId: 'arc' | 'robinhood',
  rpc: RpcCaller,
  circle: string | null,
  tether: string | null,
  robinhoodFeeds: unknown | null,
  env: Record<string, string | undefined>,
): Promise<void> {
  const config = loadChainConfig({ env, network: 'mainnet' });
  const chain = config.facts.find((item) => item.id === chainId);
  if (!chain) {
    console.log(`${chainId}: chain config missing`);
    return;
  }
  const endpoint = chain.rpcEndpoints[0];
  if (!endpoint) {
    console.log(`${chainId}: no RPC endpoint`);
    return;
  }

  let chainIdOk: boolean;
  try {
    const actual = Number(
      BigInt(await rpc<string>(endpoint.url, 'eth_chainId', [])),
    );
    chainIdOk = actual === chain.chainId;
  } catch {
    chainIdOk = false;
  }

  let factory: string;
  try {
    const code = await ethGetCode(
      rpc,
      endpoint.url,
      chain.create2Factory.address,
    );
    factory = code !== '0x' ? 'ok' : 'FAIL';
  } catch {
    factory = 'FAIL';
  }

  const token = chain.assets.find((item) => item.symbol === 'USDC');
  let tokenStatus = token ? 'no address' : 'none';
  if (token?.address) {
    try {
      const code = await ethGetCode(rpc, endpoint.url, token.address);
      tokenStatus = code !== '0x' ? 'ok' : 'FAIL';
    } catch {
      tokenStatus = 'FAIL';
    }
  }

  const cap = await probeRpcLogMaxRange(endpoint.url, rpc);
  const name = chainId === 'arc' ? 'Arc' : 'Robinhood Chain';
  const chainlink =
    chainId === 'robinhood'
      ? chainlinkRobinhoodFeed(robinhoodFeeds)
      : chain.priceFeeds.some((feed) => feed.pair === 'USDC/USD')
        ? 'yes'
        : 'no';
  const circlePattern = /\barc\b/i;
  const robinhoodPattern = /\brobinhood\b/i;
  const pattern = chainId === 'arc' ? circlePattern : robinhoodPattern;

  console.log(
    `${name}: host=${endpoint.host}; chainId=${chain.chainId} (${chainIdOk ? 'ok' : 'FAIL'}); factory=${factory}; USDC token=${tokenStatus}; log cap=${cap === null ? 'unknown' : `${cap} blocks`}; Circle USDC=${listed(circle, pattern)}; Tether USDT=${listed(tether, pattern)}; Chainlink USDC/USD=${chainlink}`,
  );
}

export async function runWatchChains(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const overrides = parseRpcOverrides(env);
  const urls = Object.values(overrides).flatMap((list) => list ?? []);
  const rpc = makeJsonRpc(urls);
  const [circle, tether, robinhoodFeeds] = await Promise.all([
    fetchText(CIRCLE_USDC_DOCS),
    fetchText(TETHER_PROTOCOLS_DOCS),
    fetchJson(ROBINHOOD_CHAINLINK_FEEDS),
  ]);

  await watchChain('arc', rpc, circle, tether, robinhoodFeeds, env);
  await watchChain('robinhood', rpc, circle, tether, robinhoodFeeds, env);
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
