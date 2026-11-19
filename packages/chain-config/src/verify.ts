import { getAddress } from 'viem';
import {
  CHAIN_IDS,
  NETWORKS,
  isVerified,
  parseChainConfigData,
  type ChainConfigData,
  type FactEvidence,
  type NetworkFacts,
  type PriceFeedFacts,
  type RpcFact,
  type TokenFacts,
} from './schema.js';
import {
  loadChainData,
  parseFerryNetwork,
  routeIneligibilityReasons,
} from './config.js';
import {
  predictHtlcAddress,
  usdgDomainSeparator,
  usdt0DomainSeparator,
} from './htlc.js';
import {
  parseRpcOverrides,
  probeRpcLogMaxRange,
  redactRpcSecrets,
  redactRpcUrl,
} from './rpc-overrides.js';

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: JsonRpcError;
}

interface BlockHeader {
  number: string;
  timestamp: string;
}

interface Difference {
  network: string;
  fact: string;
  expected: string;
  actual: string;
}

interface Summary {
  checked: number;
  skipped: number;
  differences: Difference[];
}

class RpcError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

function hexToNumber(value: string): number {
  return Number(BigInt(value));
}

function hexToBigInt(value: string): bigint {
  return BigInt(value);
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function decodeAbiString(value: string): string {
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (body.length < 128) return '';
  const offsetBytes = Number(BigInt(`0x${body.slice(0, 64)}`));
  const lengthBytes = Number(
    BigInt(`0x${body.slice(offsetBytes * 2, offsetBytes * 2 + 64)}`),
  );
  if (lengthBytes <= 0 || lengthBytes > 4096) return '';
  const dataStart = offsetBytes * 2 + 64;
  return Buffer.from(
    body.slice(dataStart, dataStart + lengthBytes * 2),
    'hex',
  ).toString('utf8');
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new RpcError(payload.error.message, payload.error.code);
    }
    if (payload.result === undefined) {
      throw new RpcError('RPC returned no result');
    }
    return payload.result;
  } catch (error) {
    if (error instanceof RpcError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RpcError(redactRpcSecrets(message, [url]));
  } finally {
    clearTimeout(timer);
  }
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.trim() === '') return true;
  return /rate limit|rate-limited|request limit|too many|limit exceeded|timeout|aborted|fetch failed|temporarily|try again|beyond current head|head block/i.test(
    message,
  );
}

async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function record(
  summary: Summary,
  network: string,
  fact: string,
  expected: string,
  actual: string,
): void {
  summary.differences.push({ network, fact, expected, actual });
}

function check(
  value: boolean,
  summary: Summary,
  network: string,
  fact: string,
  expected: string,
  actual: string,
): void {
  summary.checked += 1;
  if (!value) record(summary, network, fact, expected, actual);
}

function skip(summary: Summary): void {
  summary.skipped += 1;
}

async function checkRpc(
  network: string,
  rpcFact: RpcFact,
  chain: NetworkFacts,
  summary: Summary,
): Promise<void> {
  const host = redactRpcUrl(rpcFact.url);
  try {
    const chainIdHex = await withRetry(() =>
      rpc<string>(rpcFact.url, 'eth_chainId', []),
    );
    const expectedChainId = `0x${chain.chainId.toString(16)}`;
    check(
      normalizeHex(chainIdHex) === expectedChainId,
      summary,
      network,
      `rpc ${host} chainId`,
      expectedChainId,
      normalizeHex(chainIdHex),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `rpc ${host} chainId`,
        `0x${chain.chainId.toString(16)}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const maxRange = rpcFact.getLogsMaxRange;
  if (maxRange === null || maxRange === 0) {
    skip(summary);
  } else {
    try {
      const latest = hexToNumber(
        await withRetry(() => rpc<string>(rpcFact.url, 'eth_blockNumber', [])),
      );
      const head = latest - 1;
      const fromBlock = `0x${(head - maxRange + 1).toString(16)}`;
      const toBlock = `0x${head.toString(16)}`;
      await withRetry(
        () =>
          rpc<unknown[]>(
            rpcFact.url,
            'eth_getLogs',
            [
              {
                fromBlock,
                toBlock,
                address: '0x0000000000000000000000000000000000000001',
              },
            ],
            45_000,
          ),
        2,
      );
      check(
        true,
        summary,
        network,
        `rpc ${host} eth_getLogs range`,
        `${maxRange} blocks accepted`,
        'accepted',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTransient(error)) {
        skip(summary);
      } else {
        record(
          summary,
          network,
          `rpc ${host} eth_getLogs range`,
          `${maxRange} blocks accepted`,
          message,
        );
      }
    }
  }

  try {
    const safe = await withRetry(() =>
      rpc<BlockHeader | null>(rpcFact.url, 'eth_getBlockByNumber', [
        'safe',
        false,
      ]),
    );
    check(
      (safe !== null) === chain.finality.safeTagWorks,
      summary,
      network,
      `rpc ${host} safe tag`,
      String(chain.finality.safeTagWorks),
      String(safe !== null),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `rpc ${host} safe tag`,
        String(chain.finality.safeTagWorks),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const finalized = await withRetry(() =>
      rpc<BlockHeader | null>(rpcFact.url, 'eth_getBlockByNumber', [
        'finalized',
        false,
      ]),
    );
    check(
      (finalized !== null) === chain.finality.finalizedTagWorks,
      summary,
      network,
      `rpc ${host} finalized tag`,
      String(chain.finality.finalizedTagWorks),
      String(finalized !== null),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `rpc ${host} finalized tag`,
        String(chain.finality.finalizedTagWorks),
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function checkChainFacts(
  network: string,
  chain: NetworkFacts,
  rpcFact: RpcFact,
  summary: Summary,
): Promise<void> {
  try {
    const latest = await withRetry(() =>
      rpc<BlockHeader | null>(rpcFact.url, 'eth_getBlockByNumber', [
        'latest',
        false,
      ]),
    );
    if (!latest || hexToNumber(latest.number) < 51) {
      skip(summary);
    } else {
      const older = await withRetry(() =>
        rpc<BlockHeader | null>(rpcFact.url, 'eth_getBlockByNumber', [
          `0x${(hexToNumber(latest.number) - 50).toString(16)}`,
          false,
        ]),
      );
      if (!older) {
        skip(summary);
      } else {
        const measured =
          (hexToNumber(latest.timestamp) - hexToNumber(older.timestamp)) / 50;
        const expected = chain.finality.blockTimeSeconds;
        const tolerance = Math.max(0.2, expected * 0.5);
        check(
          Math.abs(measured - expected) <= tolerance,
          summary,
          network,
          'typical block time',
          `${expected}s (+/-${tolerance.toFixed(2)}s)`,
          `${measured.toFixed(2)}s`,
        );
      }
    }
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        'typical block time',
        `${chain.finality.blockTimeSeconds}s`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const code = await withRetry(() =>
      rpc<string>(rpcFact.url, 'eth_getCode', [
        chain.create2Factory.address,
        'latest',
      ]),
    );
    check(
      (code !== '0x') === chain.create2Factory.hasCode,
      summary,
      network,
      'CREATE2 factory code',
      String(chain.create2Factory.hasCode),
      String(code !== '0x'),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        'CREATE2 factory code',
        String(chain.create2Factory.hasCode),
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function ethCall(
  url: string,
  token: string,
  data: string,
): Promise<string> {
  return rpc<string>(url, 'eth_call', [{ to: token, data }, 'latest']);
}

async function checkToken(
  network: string,
  chainId: number,
  token: TokenFacts,
  url: string,
  summary: Summary,
): Promise<void> {
  if (token.address === null) {
    skip(summary);
    return;
  }
  const address = token.address;

  try {
    const code = await withRetry(() =>
      rpc<string>(url, 'eth_getCode', [address, 'latest']),
    );
    check(
      code !== '0x',
      summary,
      network,
      `${token.symbol} code exists`,
      'true',
      String(code !== '0x'),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `${token.symbol} code exists`,
        'true',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (token.decimals !== null) {
    try {
      const raw = await withRetry(() => ethCall(url, address, '0x313ce567'));
      const actual = Number(hexToBigInt(raw));
      check(
        actual === token.decimals,
        summary,
        network,
        `${token.symbol} decimals`,
        String(token.decimals),
        String(actual),
      );
    } catch (error) {
      if (isTransient(error)) {
        skip(summary);
      } else {
        record(
          summary,
          network,
          `${token.symbol} decimals`,
          String(token.decimals),
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  if (token.permit) {
    if (token.name !== null) {
      try {
        const raw = await withRetry(() => ethCall(url, address, '0x06fdde03'));
        const actual = decodeAbiString(raw);
        check(
          actual === token.name,
          summary,
          network,
          `${token.symbol} name`,
          token.name,
          actual,
        );
      } catch (error) {
        if (isTransient(error)) {
          skip(summary);
        } else {
          record(
            summary,
            network,
            `${token.symbol} name`,
            token.name,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (token.version !== null) {
      try {
        const raw = await withRetry(() => ethCall(url, address, '0x54fd4d50'));
        const actual = decodeAbiString(raw);
        check(
          actual === token.version,
          summary,
          network,
          `${token.symbol} EIP-712 version`,
          token.version,
          actual,
        );
      } catch (error) {
        if (isTransient(error) || token.domainSeparator !== null) {
          skip(summary);
        } else {
          record(
            summary,
            network,
            `${token.symbol} EIP-712 version`,
            token.version,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (token.domainSeparator !== null) {
      try {
        const raw = await withRetry(() => ethCall(url, address, '0x3644e515'));
        check(
          normalizeHex(raw) === normalizeHex(token.domainSeparator),
          summary,
          network,
          `${token.symbol} DOMAIN_SEPARATOR`,
          token.domainSeparator,
          raw,
        );
      } catch (error) {
        if (isTransient(error)) {
          skip(summary);
        } else {
          record(
            summary,
            network,
            `${token.symbol} DOMAIN_SEPARATOR`,
            token.domainSeparator,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (token.name === 'USD₮0' && token.domainSeparator !== null) {
      try {
        const computed = usdt0DomainSeparator(chainId, getAddress(address));
        check(
          normalizeHex(computed) === normalizeHex(token.domainSeparator),
          summary,
          network,
          `${token.symbol} USDT0 domain reconstruction`,
          token.domainSeparator,
          computed,
        );
      } catch (error) {
        if (isTransient(error)) {
          skip(summary);
        } else {
          record(
            summary,
            network,
            `${token.symbol} USDT0 domain reconstruction`,
            token.domainSeparator,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (
      (token.name === 'Global Dollar' || token.symbol === 'USDG') &&
      token.domainSeparator !== null
    ) {
      try {
        const computed = usdgDomainSeparator(chainId, getAddress(address));
        check(
          normalizeHex(computed) === normalizeHex(token.domainSeparator),
          summary,
          network,
          `${token.symbol} USDG domain reconstruction`,
          token.domainSeparator,
          computed,
        );
      } catch (error) {
        if (isTransient(error)) {
          skip(summary);
        } else {
          record(
            summary,
            network,
            `${token.symbol} USDG domain reconstruction`,
            token.domainSeparator,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    try {
      const raw = await withRetry(() =>
        ethCall(
          url,
          address,
          `0x7ecebe00${padAddress('0x0000000000000000000000000000000000000000')}`,
        ),
      );
      check(
        raw.length > 2,
        summary,
        network,
        `${token.symbol} nonces`,
        'returns a value',
        'empty',
      );
    } catch (error) {
      if (isTransient(error)) {
        skip(summary);
      } else {
        record(
          summary,
          network,
          `${token.symbol} nonces`,
          'returns a value',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  } else {
    try {
      await ethCall(url, address, '0x3644e515');
      record(
        summary,
        network,
        `${token.symbol} permit absence`,
        'DOMAIN_SEPARATOR reverts',
        'returned a value',
      );
    } catch (error) {
      if (isTransient(error)) {
        skip(summary);
      } else {
        check(
          true,
          summary,
          network,
          `${token.symbol} permit absence`,
          'DOMAIN_SEPARATOR reverts',
          'reverts',
        );
      }
    }
  }
}

interface LatestRoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

function decodeLatestRoundData(value: string): LatestRoundData {
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (body.length < 320)
    throw new Error('latestRoundData returned too few words');
  const word = (index: number): bigint =>
    BigInt(`0x${body.slice(index * 64, (index + 1) * 64)}`);
  return {
    roundId: word(0),
    answer: word(1),
    startedAt: word(2),
    updatedAt: word(3),
    answeredInRound: word(4),
  };
}

async function checkPriceFeed(
  network: string,
  feed: PriceFeedFacts,
  url: string,
  summary: Summary,
): Promise<void> {
  const label = `${feed.asset}/USD`;

  try {
    const code = await withRetry(() =>
      rpc<string>(url, 'eth_getCode', [feed.address, 'latest']),
    );
    check(
      code !== '0x',
      summary,
      network,
      `${label} feed code exists`,
      'true',
      String(code !== '0x'),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `${label} feed code exists`,
        'true',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const raw = await withRetry(() => ethCall(url, feed.address, '0x7284e416'));
    const description = decodeAbiString(raw);
    check(
      description === `${feed.asset} / USD`,
      summary,
      network,
      `${label} feed description`,
      `${feed.asset} / USD`,
      description,
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `${label} feed description`,
        `${feed.asset} / USD`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const raw = await withRetry(() => ethCall(url, feed.address, '0x313ce567'));
    const decimals = Number(hexToBigInt(raw));
    check(
      decimals === feed.decimals,
      summary,
      network,
      `${label} feed decimals`,
      String(feed.decimals),
      String(decimals),
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `${label} feed decimals`,
        String(feed.decimals),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    const raw = await withRetry(() => ethCall(url, feed.address, '0xfeaf968c'));
    const round = decodeLatestRoundData(raw);
    const now = Math.floor(Date.now() / 1000);
    const age = now - Number(round.updatedAt);
    check(
      round.answer > 0n,
      summary,
      network,
      `${label} feed answer`,
      '> 0',
      round.answer.toString(),
    );
    check(
      round.updatedAt > 0n,
      summary,
      network,
      `${label} feed updatedAt`,
      '> 0',
      round.updatedAt.toString(),
    );
    check(
      age >= -600 && age <= feed.heartbeatSeconds * 2,
      summary,
      network,
      `${label} feed freshness`,
      `age <= ${feed.heartbeatSeconds * 2}s`,
      `${age}s`,
    );
    console.log(
      `  - feed ${label}: ${round.answer.toString()} at ${round.updatedAt.toString()} (age ${age}s; heartbeat ${feed.heartbeatSeconds}s)`,
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        `${label} feed read`,
        'latestRoundData succeeds',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function checkDeployment(
  network: string,
  chain: NetworkFacts,
  url: string,
  summary: Summary,
): Promise<void> {
  const configured = chain.deployment.htlcAddress;
  if (configured === null) {
    console.log(
      `  - HTLC deployment: not deployed; predicted ${predictHtlcAddress()}`,
    );
    skip(summary);
    return;
  }

  try {
    const code = await withRetry(() =>
      rpc<string>(url, 'eth_getCode', [configured, 'latest']),
    );
    check(
      code !== '0x',
      summary,
      network,
      'HTLC contract code',
      'true',
      String(code !== '0x'),
    );
    check(
      normalizeHex(configured) === normalizeHex(predictHtlcAddress()),
      summary,
      network,
      'HTLC address matches CREATE2 prediction',
      predictHtlcAddress(),
      configured,
    );
  } catch (error) {
    if (isTransient(error)) {
      skip(summary);
    } else {
      record(
        summary,
        network,
        'HTLC contract code',
        'true',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (chain.deployment.deployBlock !== null) {
    try {
      const block = await withRetry(() =>
        rpc<BlockHeader | null>(url, 'eth_getBlockByNumber', [
          `0x${chain.deployment.deployBlock!.toString(16)}`,
          false,
        ]),
      );
      check(
        block !== null,
        summary,
        network,
        'HTLC deployBlock exists',
        String(chain.deployment.deployBlock),
        block === null ? 'missing' : String(hexToNumber(block.number)),
      );
    } catch (error) {
      if (isTransient(error)) {
        skip(summary);
      } else {
        record(
          summary,
          network,
          'HTLC deployBlock exists',
          String(chain.deployment.deployBlock),
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

function evidenceLabel(evidence: FactEvidence): string {
  return `${evidence.status} (${evidence.source})`;
}

async function main(): Promise<void> {
  const data: ChainConfigData = parseChainConfigData(loadChainData());
  const summary: Summary = { checked: 0, skipped: 0, differences: [] };
  const selectedNetwork = parseFerryNetwork(process.env.FERRY_NETWORK);
  const overrides = parseRpcOverrides(process.env);
  const rpcCaps: Record<string, number> = {};

  console.log('Chain facts verification');
  console.log(`Baseline date: ${data.generatedAt}`);
  console.log('Read-only JSON-RPC calls; no transaction is sent.');
  console.log('');

  const overrideUrls = Object.values(overrides).flatMap((urls) => urls ?? []);
  if (overrideUrls.length > 0) {
    console.log(`RPC overrides for ${selectedNetwork} (hosts only):`);
    for (const url of overrideUrls) {
      const cap = await probeRpcLogMaxRange(url, rpc);
      if (cap !== null) rpcCaps[url] = cap;
      console.log(
        `  - ${redactRpcUrl(url)}: log cap ${cap === null ? 'unknown' : `${cap} blocks`}`,
      );
    }
    console.log('');
  }

  for (const id of CHAIN_IDS) {
    for (const network of NETWORKS) {
      const chain = data.chains[id][network];
      const label = `${id}/${network}`;
      console.log(`- ${label}: chain ${chain.chainId}`);

      for (const rpcFact of chain.rpcUrls) {
        if (!isVerified(rpcFact.evidence)) {
          console.log(
            `  - rpc ${rpcFact.url}: ${evidenceLabel(rpcFact.evidence)}`,
          );
          continue;
        }
        await checkRpc(label, rpcFact, chain, summary);
      }

      const firstRpc = chain.rpcUrls.find((rpcFact) =>
        isVerified(rpcFact.evidence),
      );
      if (!firstRpc) {
        console.log('  - no verified RPC URL; chain facts not checked');
        continue;
      }

      await checkChainFacts(label, chain, firstRpc, summary);
      await checkDeployment(label, chain, firstRpc.url, summary);

      for (const token of chain.tokens) {
        if (token.address === null) {
          console.log(`  - ${token.symbol}: no address; skipped`);
          skip(summary);
          continue;
        }
        await checkToken(label, chain.chainId, token, firstRpc.url, summary);
      }

      for (const feed of chain.priceFeeds) {
        await checkPriceFeed(label, feed, firstRpc.url, summary);
      }
    }
  }

  console.log('');
  console.log(
    `Checked ${summary.checked} facts, skipped ${summary.skipped}, differences ${summary.differences.length}.`,
  );

  console.log('');
  console.log('Routes:');
  for (const id of CHAIN_IDS) {
    const mainnet = data.chains[id].mainnet;
    for (const token of mainnet.tokens) {
      const key = `${token.symbol.toLowerCase()}:${id}`;
      const reasons = routeIneligibilityReasons(mainnet, token);
      if (reasons.length === 0) {
        console.log(`  ${key}: eligible`);
      } else {
        console.log(`  ${key}: disabled (${reasons.join('; ')})`);
      }
    }
  }

  if (summary.differences.length > 0) {
    console.log('');
    console.log('Differences:');
    for (const difference of summary.differences) {
      console.log(
        `  ${difference.network} ${difference.fact}: expected ${difference.expected}, got ${difference.actual}`,
      );
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
