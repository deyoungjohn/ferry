import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { decodeCashAddress } from '@ferry/core';
import { FulcrumClient, type ElectrumUtxo } from '@ferry/htlc-bch';
import { formatUnits, getAddress, isAddress } from 'viem';
import {
  loadChainConfig,
  parseFerryNetwork,
  type ChainConfig,
  type ChainFactView,
  type EvmAssetFact,
  type RouteConfig,
} from './config.js';
import {
  SELECTORS,
  decodeAbiString,
  decodeLatestRoundData,
  decodeUint,
  ethCall,
  ethGetCode,
  padAddress,
} from './evm-read.js';
import {
  parseRpcOverrides,
  probeRpcLogMaxRange,
  redactRpcSecrets,
  redactRpcUrl,
  type RpcCaller,
} from './rpc-overrides.js';
import { makeJsonRpc } from './rpc-client.js';
import { usdt0DomainSeparator } from './htlc.js';

const MAINNET_GENESIS =
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const CHIPNET_GENESIS =
  '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b';
const MAINNET_FULCRUM_URLS = [
  'wss://blackie.c3-soft.com:50004',
  'wss://bch.imaginary.cash:50004',
];
const CHIPNET_FULCRUM_URLS = [
  'wss://chipnet.imaginary.cash:50004',
  'wss://blackie.c3-soft.com:64004',
];
const PUSD_CATEGORY =
  '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const MUSD_CATEGORY =
  'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366';

const MINIMUM_TIER = {
  baseUsdcUsd: 15,
  otherStablecoinUsd: 10,
  pusd: 15,
  musd: 5,
  bchSats: 500_000n,
} as const;

export interface PreflightAddresses {
  evm: string[];
  bch: string[];
  deployerEvm: string | null;
  solverEvm: string | null;
  solverBch: string | null;
}

export interface BchBalance {
  sats: bigint;
  pusd: bigint;
  musd: bigint;
}

interface BchHostResult {
  host: string;
  genesisOk: boolean;
  tip: number;
  byAddress: Map<string, BchBalance>;
  error: string | null;
}

interface EvmChainBalance {
  chainId: string;
  native: bigint;
  assets: Map<string, bigint>;
  error: string | null;
}

interface EvmBalanceResult {
  byAddress: Map<string, EvmChainBalance[]>;
  errors: string[];
}

interface BchBalanceResult {
  byAddress: Map<string, BchBalance>;
  hostsOk: number;
  hostsTotal: number;
  errors: string[];
}

interface RoutePreflightResult {
  route: RouteConfig;
  host: string;
  cap: number | null;
  htlc: 'ok' | 'not deployed' | 'FAIL';
  factory: 'ok' | 'FAIL';
  token: 'ok' | 'FAIL';
  feed: 'ok' | 'stale' | 'fallback' | 'FAIL';
  activity: 'ok' | 'FAIL';
  decision: string;
}

export function parsePreflightAddresses(
  raw: string | undefined,
): PreflightAddresses {
  const result: PreflightAddresses = {
    evm: [],
    bch: [],
    deployerEvm: null,
    solverEvm: null,
    solverBch: null,
  };
  if (raw === undefined || raw.trim() === '') return result;
  const parts = raw.split(',').map((value) => value.trim());
  if (parts.some((value) => value === '')) {
    throw new Error('PREFLIGHT_ADDRESSES contains an empty entry.');
  }
  let labelledDeployer: string | null = null;
  let labelledSolver: string | null = null;
  let labelledBch: string | null = null;

  for (const [index, rawValue] of parts.entries()) {
    const equals = rawValue.indexOf('=');
    const prefix = equals > 0 ? rawValue.slice(0, equals) : null;
    const labelled =
      prefix === 'deployer' || prefix === 'solver' || prefix === 'bch';
    const value = labelled ? rawValue.slice(equals + 1) : rawValue;
    if (value === '') {
      throw new Error(
        `Invalid PREFLIGHT_ADDRESSES entry at position ${index + 1}.`,
      );
    }

    if (isAddress(value)) {
      if (prefix === 'bch') {
        throw new Error(
          `Invalid PREFLIGHT_ADDRESSES entry at position ${index + 1}.`,
        );
      }
      const address = getAddress(value);
      if (!result.evm.includes(address)) result.evm.push(address);
      if (prefix === 'deployer') labelledDeployer = address;
      if (prefix === 'solver') labelledSolver = address;
      continue;
    }

    try {
      decodeCashAddress(value);
      if (prefix === 'deployer' || prefix === 'solver') {
        throw new Error('wrong address type');
      }
      if (!result.bch.includes(value)) result.bch.push(value);
      if (prefix === 'bch') labelledBch = value;
    } catch {
      throw new Error(
        `Invalid PREFLIGHT_ADDRESSES entry at position ${index + 1}.`,
      );
    }
  }

  result.deployerEvm = labelledDeployer ?? result.evm[0] ?? null;
  result.solverEvm = labelledSolver ?? result.evm[1] ?? result.evm[0] ?? null;
  result.solverBch = labelledBch ?? result.bch[0] ?? null;
  return result;
}

export function scripthashForCashAddress(address: string): string {
  const decoded = decodeCashAddress(address);
  const hash = createHash('sha256')
    .update(Buffer.from(decoded.lockingBytecode.slice(2), 'hex'))
    .digest();
  return Buffer.from(hash).reverse().toString('hex');
}

function normalizeCategory(value: string): string {
  return value.toLowerCase().replace(/^0x/, '');
}

export function sumBchUtxos(
  utxos: readonly ElectrumUtxo[],
  pusdCategory: string | null,
  musdCategory: string | null,
): BchBalance {
  let sats = 0n;
  let pusd = 0n;
  let musd = 0n;
  const normalizedPusd =
    pusdCategory === null ? null : normalizeCategory(pusdCategory);
  const normalizedMusd =
    musdCategory === null ? null : normalizeCategory(musdCategory);

  for (const utxo of utxos) {
    sats += BigInt(utxo.value);
    const token = utxo.token_data;
    if (!token) continue;
    const category = normalizeCategory(token.category);
    const amount = BigInt(token.amount);
    if (normalizedPusd !== null && category === normalizedPusd) pusd += amount;
    if (normalizedMusd !== null && category === normalizedMusd) musd += amount;
  }

  return { sats, pusd, musd };
}

function bchConfig(
  env: Record<string, string | undefined>,
  network: 'mainnet' | 'testnet',
): {
  urls: string[];
  genesis: string;
  pusdCategory: string | null;
  musdCategory: string | null;
} {
  const rawUrls =
    network === 'mainnet'
      ? env.BCH_ELECTRUM_URLS
      : env.BCH_CHIPNET_ELECTRUM_URLS || env.BCH_ELECTRUM_URLS;
  const urls = (rawUrls ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const defaults =
    network === 'mainnet' ? MAINNET_FULCRUM_URLS : CHIPNET_FULCRUM_URLS;
  const finalUrls = urls.length > 0 ? urls : defaults;
  if (finalUrls.length < 2) {
    throw new Error(
      'BCH preflight needs two Fulcrum hosts in the configuration.',
    );
  }
  const genesis =
    env.BCH_GENESIS_HASH ??
    (network === 'mainnet' ? MAINNET_GENESIS : CHIPNET_GENESIS);
  return {
    urls: finalUrls,
    genesis,
    pusdCategory:
      env.PUSD_CATEGORY ?? (network === 'mainnet' ? PUSD_CATEGORY : null),
    musdCategory:
      env.MUSD_CATEGORY ?? (network === 'mainnet' ? MUSD_CATEGORY : null),
  };
}

async function readBchHost(
  url: string,
  addresses: readonly string[],
  genesis: string,
  pusdCategory: string | null,
  musdCategory: string | null,
): Promise<BchHostResult> {
  const host = redactRpcUrl(url);
  const client = new FulcrumClient(url, { timeoutMs: 15_000 });
  try {
    await client.connect();
    const features = await client.request<{ genesis_hash?: string }>(
      'server.features',
    );
    const genesisOk =
      typeof features.genesis_hash === 'string' &&
      features.genesis_hash.toLowerCase() === genesis.toLowerCase();
    if (!genesisOk) {
      return {
        host,
        genesisOk: false,
        tip: 0,
        byAddress: new Map(),
        error: 'genesis hash mismatch',
      };
    }
    const tip = await client.getTipHeight();
    const byAddress = new Map<string, BchBalance>();
    for (const address of addresses) {
      const utxos = await client.listUnspent(
        scripthashForCashAddress(address),
        'include_tokens',
      );
      byAddress.set(address, sumBchUtxos(utxos, pusdCategory, musdCategory));
    }
    return { host, genesisOk: true, tip, byAddress, error: null };
  } catch (error) {
    return {
      host,
      genesisOk: false,
      tip: 0,
      byAddress: new Map(),
      error: redactRpcSecrets(
        error instanceof Error ? error.message : String(error),
        [url],
      ),
    };
  } finally {
    client.close();
  }
}

async function readBchBalances(
  addresses: readonly string[],
  env: Record<string, string | undefined>,
  network: 'mainnet' | 'testnet',
): Promise<BchBalanceResult> {
  const config = bchConfig(env, network);
  const results: BchHostResult[] = [];
  for (const url of config.urls) {
    results.push(
      await readBchHost(
        url,
        addresses,
        config.genesis,
        config.pusdCategory,
        config.musdCategory,
      ),
    );
  }

  const good = results.filter((item) => item.error === null && item.genesisOk);
  const byAddress = new Map<string, BchBalance>();
  if (good.length > 0) {
    for (const address of addresses) {
      const balance = good[0]!.byAddress.get(address);
      if (balance) byAddress.set(address, balance);
    }
  }

  if (good.length > 1) {
    for (const address of addresses) {
      const first = good[0]!.byAddress.get(address);
      for (const other of good.slice(1)) {
        const second = other.byAddress.get(address);
        if (
          first &&
          second &&
          (first.sats !== second.sats ||
            first.pusd !== second.pusd ||
            first.musd !== second.musd)
        ) {
          console.log(
            `  ! BCH balance mismatch for ${address} between ${good[0]!.host} and ${other.host}`,
          );
        }
      }
    }
  }

  return {
    byAddress,
    hostsOk: good.length,
    hostsTotal: results.length,
    errors: results
      .filter((item) => item.error !== null)
      .map((item) => `${item.host}: ${item.error}`),
  };
}

function enabledRoutesByChain(config: ChainConfig): Map<string, RouteConfig[]> {
  const byChain = new Map<string, RouteConfig[]>();
  for (const route of config.routes) {
    if (!route.enabled) continue;
    const list = byChain.get(route.chain) ?? [];
    list.push(route);
    byChain.set(route.chain, list);
  }
  return byChain;
}

async function readEvmBalances(
  addresses: readonly string[],
  config: ChainConfig,
  rpc: RpcCaller,
): Promise<EvmBalanceResult> {
  const byAddress = new Map<string, EvmChainBalance[]>();
  const errors: string[] = [];
  const enabled = enabledRoutesByChain(config);

  for (const address of addresses) {
    const chainBalances: EvmChainBalance[] = [];
    for (const chain of config.facts) {
      const routes = enabled.get(chain.id) ?? [];
      if (routes.length === 0) continue;
      const endpoint = chain.rpcEndpoints[0];
      if (!endpoint) continue;
      try {
        const native = BigInt(
          await rpc<string>(endpoint.url, 'eth_getBalance', [
            address,
            'latest',
          ]),
        );
        const assets = new Map<string, bigint>();
        for (const route of routes) {
          const token = chain.assets.find(
            (item) => item.symbol === route.asset && item.verified,
          );
          if (!token || !token.address || token.decimals === null) continue;
          const raw = await ethCall(
            rpc,
            endpoint.url,
            token.address,
            `${SELECTORS.balanceOf}${padAddress(address)}`,
          );
          assets.set(route.asset, decodeUint(raw));
        }
        chainBalances.push({
          chainId: chain.id,
          native,
          assets,
          error: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`EVM balance ${chain.id}: ${message}`);
        chainBalances.push({
          chainId: chain.id,
          native: 0n,
          assets: new Map(),
          error: message,
        });
      }
    }
    byAddress.set(address, chainBalances);
  }

  return { byAddress, errors };
}

function feedIsFresh(ageSeconds: number, heartbeatSeconds: number): boolean {
  return ageSeconds >= -600 && ageSeconds <= heartbeatSeconds * 2;
}

async function checkRoute(
  route: RouteConfig,
  config: ChainConfig,
  rpc: RpcCaller,
): Promise<RoutePreflightResult> {
  const chain = config.facts.find((item) => item.id === route.chain);
  const core = config.coreChains.find((item) => item.id === route.chain);
  if (!chain || !core) {
    return {
      route,
      host: '-',
      cap: null,
      htlc: 'FAIL',
      factory: 'FAIL',
      token: 'FAIL',
      feed: 'FAIL',
      activity: 'FAIL',
      decision: 'NO-GO (chain config missing)',
    };
  }

  const endpoint = chain.rpcEndpoints[0];
  const token = chain.assets.find((item) => item.symbol === route.asset);
  if (!endpoint || !token) {
    return {
      route,
      host: endpoint?.host ?? '-',
      cap: endpoint?.maxLogRange ?? null,
      htlc: 'FAIL',
      factory: 'FAIL',
      token: 'FAIL',
      feed: 'FAIL',
      activity: 'FAIL',
      decision: 'NO-GO (route config missing)',
    };
  }

  let rpcOk: boolean;
  try {
    const chainId = await rpc<string>(endpoint.url, 'eth_chainId', []);
    rpcOk = Number(BigInt(chainId)) === chain.chainId;
  } catch {
    rpcOk = false;
  }

  let factoryOk: boolean;
  try {
    const code = await ethGetCode(
      rpc,
      endpoint.url,
      chain.create2Factory.address,
    );
    factoryOk = code !== '0x';
  } catch {
    factoryOk = false;
  }

  let htlcCode: string;
  try {
    htlcCode = await ethGetCode(rpc, endpoint.url, core.htlcAddress);
  } catch {
    htlcCode = '0x';
  }
  const htlcDeployed = htlcCode !== '0x';

  let tokenOk = token.address !== null && token.decimals !== null;
  if (tokenOk && token.address && token.decimals !== null) {
    try {
      const code = await ethGetCode(rpc, endpoint.url, token.address);
      const decimals = Number(
        decodeUint(
          await ethCall(rpc, endpoint.url, token.address, SELECTORS.decimals),
        ),
      );
      tokenOk = code !== '0x' && decimals === token.decimals;
      if (tokenOk && token.permit) {
        const name =
          token.name === null
            ? null
            : decodeAbiString(
                await ethCall(rpc, endpoint.url, token.address, SELECTORS.name),
              );
        const domain = await ethCall(
          rpc,
          endpoint.url,
          token.address,
          SELECTORS.domainSeparator,
        );
        let versionOk = true;
        if (token.version !== null) {
          if (token.name === 'USD₮0') {
            versionOk =
              usdt0DomainSeparator(
                chain.chainId,
                getAddress(token.address),
              ).toLowerCase() === domain.toLowerCase();
          } else {
            const version = decodeAbiString(
              await ethCall(
                rpc,
                endpoint.url,
                token.address,
                SELECTORS.version,
              ),
            );
            versionOk = version === token.version;
          }
        }
        const nonces = await ethCall(
          rpc,
          endpoint.url,
          token.address,
          `${SELECTORS.nonces}${padAddress(addressZero())}`,
        );
        tokenOk =
          (token.name === null || name === token.name) &&
          versionOk &&
          (token.domainSeparator === null ||
            domain.toLowerCase() === token.domainSeparator.toLowerCase()) &&
          nonces.length > 2;
      }
    } catch {
      tokenOk = false;
    }
  }

  const feed = chain.priceFeeds.find((item) => item.asset === route.asset);
  let feedStatus: RoutePreflightResult['feed'] = 'fallback';
  if (feed) {
    try {
      const round = decodeLatestRoundData(
        await ethCall(
          rpc,
          endpoint.url,
          feed.address,
          SELECTORS.latestRoundData,
        ),
      );
      const age = Math.floor(Date.now() / 1000) - Number(round.updatedAt);
      feedStatus =
        round.answer > 0n && feedIsFresh(age, feed.heartbeatSeconds)
          ? 'ok'
          : 'stale';
    } catch {
      feedStatus = 'FAIL';
    }
  }

  const failures: string[] = [];
  if (!rpcOk) failures.push('RPC unreachable or wrong chain');
  if (!factoryOk) failures.push('factory missing');
  if (!tokenOk) failures.push('token facts differ');
  if (feedStatus === 'stale' || feedStatus === 'FAIL') {
    failures.push('price feed stale or unavailable');
  }
  const activityOk = chain.activityLog.available;
  if (!activityOk) {
    failures.push('no activity log range of at least 1,000 blocks');
  }

  const decision =
    failures.length > 0
      ? `NO-GO (${failures.join('; ')})`
      : htlcDeployed
        ? 'GO'
        : 'NO-GO (HTLC not deployed)';

  return {
    route,
    host: endpoint.host,
    cap: endpoint.maxLogRange,
    htlc: htlcDeployed ? 'ok' : 'not deployed',
    factory: factoryOk ? 'ok' : 'FAIL',
    token: tokenOk ? 'ok' : 'FAIL',
    feed: feedStatus,
    activity: activityOk ? 'ok' : 'FAIL',
    decision,
  };
}

function addressZero(): string {
  return '0x0000000000000000000000000000000000000000';
}

function printRoutes(results: readonly RoutePreflightResult[]): void {
  const header = [
    'Route'.padEnd(17),
    'RPC'.padEnd(34),
    'Cap'.padEnd(12),
    'HTLC'.padEnd(13),
    'Factory'.padEnd(8),
    'Token'.padEnd(6),
    'Feed'.padEnd(9),
    'Activity'.padEnd(9),
    'Decision',
  ].join(' ');
  console.log('Route preflight');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const result of results) {
    console.log(
      [
        result.route.key.padEnd(17),
        result.host.padEnd(34),
        `${result.cap === null ? 'unknown' : result.cap}`.padEnd(12),
        result.htlc.padEnd(13),
        result.factory.padEnd(8),
        result.token.padEnd(6),
        result.feed.padEnd(9),
        result.activity.padEnd(9),
        result.decision,
      ].join(' '),
    );
  }
}

function printBalances(
  evm: EvmBalanceResult,
  bch: BchBalanceResult,
  addresses: PreflightAddresses,
  config: ChainConfig,
): void {
  console.log('');
  console.log('Balances');
  if (addresses.evm.length === 0) {
    console.log(
      '- No EVM address in PREFLIGHT_ADDRESSES; EVM balances skipped.',
    );
  }
  for (const address of addresses.evm) {
    console.log(`- EVM ${address}`);
    for (const balance of evm.byAddress.get(address) ?? []) {
      const chain = config.facts.find((item) => item.id === balance.chainId);
      if (!chain) continue;
      const assetText = [...balance.assets.entries()]
        .map(([symbol, value]) => {
          const token = chain.assets.find((item) => item.symbol === symbol);
          return `${symbol} ${token?.decimals === null || token?.decimals === undefined ? value.toString() : formatUnits(value, token.decimals)}`;
        })
        .join('; ');
      console.log(
        `  ${chain.id}: native ${formatUnits(balance.native, 18)} ${chain.nativeGas}${assetText ? `; ${assetText}` : ''}${balance.error ? `; ERROR ${balance.error}` : ''}`,
      );
    }
  }

  if (addresses.bch.length === 0) {
    console.log(
      '- No BCH address in PREFLIGHT_ADDRESSES; BCH balances skipped.',
    );
  }
  for (const address of addresses.bch) {
    const balance = bch.byAddress.get(address);
    console.log(
      `- BCH ${address}: ${balance ? `${balance.sats} sats; PUSD ${formatUnits(balance.pusd, 2)}; MUSD ${formatUnits(balance.musd, 2)}` : 'unavailable'}`,
    );
  }
  if (bch.hostsTotal > 0) {
    console.log(
      `- Fulcrum hosts: ${bch.hostsOk}/${bch.hostsTotal} validated for genesis and tip.`,
    );
  }
  for (const error of [...evm.errors, ...bch.errors]) {
    console.log(`  ! ${error}`);
  }
}

function printFunding(
  config: ChainConfig,
  evm: EvmBalanceResult,
  bch: BchBalanceResult,
  addresses: PreflightAddresses,
): void {
  console.log('');
  console.log('Minimum-tier funding checklist');
  const enabled = config.routes.filter((route) => route.enabled);
  if (addresses.evm.length === 0) {
    console.log(
      '- Add the solver EVM address to PREFLIGHT_ADDRESSES to get exact EVM funding lines.',
    );
  }
  for (const address of addresses.evm) {
    const chainBalances = evm.byAddress.get(address) ?? [];
    for (const route of enabled) {
      const chain = config.facts.find((item) => item.id === route.chain);
      const token = chain?.assets.find((item) => item.symbol === route.asset);
      if (!chain || !token || token.decimals === null) continue;
      const balance = chainBalances
        .find((item) => item.chainId === route.chain)
        ?.assets.get(route.asset);
      const targetUsd =
        route.chain === 'base' && route.asset === 'USDC'
          ? MINIMUM_TIER.baseUsdcUsd
          : MINIMUM_TIER.otherStablecoinUsd;
      const target = BigInt(targetUsd) * 10n ** BigInt(token.decimals);
      if (balance === undefined) {
        console.log(
          `- ${route.asset} on ${route.chain}: fund ${address} (balance unavailable; target ~$${targetUsd})`,
        );
      } else if (balance < target) {
        console.log(
          `- ${route.asset} on ${route.chain}: fund ${address} (target ~$${targetUsd}; current ${formatUnits(balance, token.decimals)})`,
        );
      }
    }
    for (const chain of config.facts) {
      if (!enabled.some((route) => route.chain === chain.id)) continue;
      const balance = chainBalances.find((item) => item.chainId === chain.id);
      if (!balance) continue;
      console.log(
        `- Native ${chain.nativeGas} on ${chain.id}: ${address} (current ${formatUnits(balance.native, 18)} ${chain.nativeGas}; target per blueprint §21${balance.native === 0n ? '; BELOW (zero)' : ''})`,
      );
    }
  }

  if (addresses.bch.length === 0) {
    console.log(
      '- Add the solver BCH address to PREFLIGHT_ADDRESSES to get exact PUSD, MUSD and BCH funding lines.',
    );
  }
  for (const address of addresses.bch) {
    const balance = bch.byAddress.get(address);
    if (!balance) {
      console.log(
        `- BCH ${address}: fund PUSD ${MINIMUM_TIER.pusd}, MUSD ${MINIMUM_TIER.musd} and ${formatUnits(MINIMUM_TIER.bchSats, 8)} BCH (balance unavailable)`,
      );
      continue;
    }
    const pusdTarget = BigInt(MINIMUM_TIER.pusd) * 100n;
    const musdTarget = BigInt(MINIMUM_TIER.musd) * 100n;
    if (balance.pusd < pusdTarget) {
      console.log(
        `- PUSD on Bitcoin Cash: fund ${address} (target ${MINIMUM_TIER.pusd}; current ${formatUnits(balance.pusd, 2)})`,
      );
    }
    if (balance.musd < musdTarget) {
      console.log(
        `- MUSD on Bitcoin Cash: fund ${address} (target ${MINIMUM_TIER.musd}; current ${formatUnits(balance.musd, 2)})`,
      );
    }
    if (balance.sats < MINIMUM_TIER.bchSats) {
      console.log(
        `- BCH fees: fund ${address} (target ${formatUnits(MINIMUM_TIER.bchSats, 8)} BCH; current ${formatUnits(balance.sats, 8)})`,
      );
    }
  }
}

function routeMinimumTarget(
  chainId: string,
  symbol: string,
  decimals: number,
): bigint {
  const usd =
    chainId === 'base' && symbol === 'USDC'
      ? MINIMUM_TIER.baseUsdcUsd
      : MINIMUM_TIER.otherStablecoinUsd;
  return BigInt(usd) * 10n ** BigInt(decimals);
}

function fundingShortReason(
  route: RouteConfig,
  chain: ChainFactView,
  token: EvmAssetFact,
  solver: string,
  evm: EvmBalanceResult,
): string | null {
  const chainBalance = evm.byAddress
    .get(solver)
    ?.find((item) => item.chainId === route.chain);
  if (!chainBalance) return 'balance unavailable';
  if (chainBalance.error) return `balance read failed (${chainBalance.error})`;
  const balance = chainBalance.assets.get(route.asset);
  if (balance === undefined) return 'stablecoin balance unavailable';
  if (
    balance < routeMinimumTarget(chain.id, token.symbol, token.decimals ?? 0)
  ) {
    return 'stablecoin below the Minimum tier';
  }
  if (chainBalance.native === 0n) return 'native gas is zero';
  return null;
}

function printNextActions(
  config: ChainConfig,
  results: readonly RoutePreflightResult[],
  addresses: PreflightAddresses,
  evm: EvmBalanceResult,
  bch: BchBalanceResult,
): void {
  const deployer = addresses.deployerEvm ?? '<deployer EVM address>';
  const solver = addresses.solverEvm ?? '<solver EVM address>';
  const bchAddress = addresses.solverBch ?? '<BCH address>';

  console.log('');
  console.log('Next actions');
  for (const route of config.routes) {
    const chain = config.facts.find((item) => item.id === route.chain);
    const result = results.find((item) => item.route.key === route.key);
    if (!chain) {
      console.log(`- ${route.key}: SKIP (chain config missing)`);
      continue;
    }
    if (route.reasons.length > 0) {
      console.log(`- ${route.key}: SKIP (${route.reasons.join('; ')})`);
      continue;
    }
    if (!chain.activityLog.available) {
      console.log(
        `- ${route.key}: FIX (add an RPC with at least ${chain.activityLog.minRange} blocks per eth_getLogs for activity reads)`,
      );
      continue;
    }
    if (!route.enabled) {
      if (result?.htlc === 'not deployed') {
        console.log(
          `- ${route.key}: DEPLOY (deploy FerryHTLC on ${chain.id} with ${deployer}; then add ${route.key} to ENABLED_ROUTES)`,
        );
      } else {
        console.log(
          `- ${route.key}: ENABLE (add ${route.key} to ENABLED_ROUTES)`,
        );
      }
      continue;
    }
    if (!result || result.htlc === 'not deployed') {
      console.log(
        `- ${route.key}: DEPLOY (deploy FerryHTLC on ${chain.id} with ${deployer}; then rerun preflight)`,
      );
      continue;
    }
    const token = chain.assets.find((item) => item.symbol === route.asset);
    if (!token || token.decimals === null) {
      console.log(`- ${route.key}: FUND (token config missing)`);
      continue;
    }
    if (addresses.solverEvm === null) {
      console.log(
        `- ${route.key}: FUND (set PREFLIGHT_ADDRESSES=solver=0x...; fund ${route.asset} and ${chain.nativeGas} on ${chain.id})`,
      );
      continue;
    }
    const reason = fundingShortReason(
      route,
      chain,
      token,
      addresses.solverEvm,
      evm,
    );
    if (reason !== null) {
      console.log(
        `- ${route.key}: FUND (${reason}; fund ${route.asset} and ${chain.nativeGas} to ${solver} on ${chain.id})`,
      );
      continue;
    }
    const htlc = config.coreChains.find(
      (item) => item.id === route.chain,
    )?.htlcAddress;
    console.log(
      `- ${route.key}: VERIFY (verify ${htlc ?? 'the deployed HTLC'} on ${chain.explorerUrl} with ${deployer}; then rerun preflight)`,
    );
  }

  if (addresses.solverBch === null) {
    console.log(
      '- BCH: FUND (set PREFLIGHT_ADDRESSES=bch=bitcoincash:...; fund PUSD, MUSD and BCH)',
    );
  } else {
    const balance = bch.byAddress.get(addresses.solverBch);
    const short =
      !balance ||
      balance.pusd < BigInt(MINIMUM_TIER.pusd) * 100n ||
      balance.musd < BigInt(MINIMUM_TIER.musd) * 100n ||
      balance.sats < MINIMUM_TIER.bchSats;
    console.log(
      short
        ? `- BCH: FUND (fund PUSD, MUSD and BCH to ${bchAddress})`
        : `- BCH: READY (${bchAddress} meets the Minimum tier)`,
    );
  }
}

export async function runPreflight(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const network = parseFerryNetwork(env.FERRY_NETWORK);
  const overrides = parseRpcOverrides(env);
  const overrideUrls = Object.values(overrides).flatMap((urls) => urls ?? []);
  const secrets = overrideUrls;
  const rpc = makeJsonRpc(secrets, { attempts: 3, baseDelayMs: 250 });
  const rpcCaps: Record<string, number> = {};

  console.log(`Preflight (${network}, read-only)`);
  if (overrideUrls.length > 0) {
    console.log('RPC overrides (hosts only):');
    for (const url of overrideUrls) {
      const cap = await probeRpcLogMaxRange(url, rpc);
      if (cap !== null) rpcCaps[url] = cap;
      console.log(
        `- ${redactRpcUrl(url)}: log cap ${cap === null ? 'unknown' : `${cap} blocks`}`,
      );
    }
  }

  const config = loadChainConfig({ env, rpcCaps });
  if (config.enabledRoutes.length === 0) {
    console.log(
      'No routes enabled. Set ENABLED_ROUTES to the routes to preflight.',
    );
    return;
  }

  const results: RoutePreflightResult[] = [];
  for (const route of config.routes.filter((item) => item.enabled)) {
    results.push(await checkRoute(route, config, rpc));
  }
  printRoutes(results);

  const addresses = parsePreflightAddresses(env.PREFLIGHT_ADDRESSES);
  const evm = await readEvmBalances(addresses.evm, config, rpc);
  const bch =
    addresses.bch.length > 0
      ? await readBchBalances(addresses.bch, env, network)
      : {
          byAddress: new Map<string, BchBalance>(),
          hostsOk: 0,
          hostsTotal: 0,
          errors: [],
        };
  printBalances(evm, bch, addresses, config);
  printFunding(config, evm, bch, addresses);
  printNextActions(config, results, addresses, evm, bch);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPreflight().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
