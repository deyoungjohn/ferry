import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CHAIN_IDS, type ChainId } from './schema.js';
import {
  parseRpcOverrides,
  probeRpcLogMaxRange,
  redactRpcUrl,
} from './rpc-overrides.js';
import { makeJsonRpc } from './rpc-client.js';

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

async function blockTagWorks(
  rpc: ReturnType<typeof makeJsonRpc>,
  url: string,
  tag: 'safe' | 'finalized',
): Promise<boolean> {
  try {
    const block = await rpc<unknown>(url, 'eth_getBlockByNumber', [tag, false]);
    return block !== null;
  } catch {
    return false;
  }
}

async function measureChain(
  chain: ChainId,
  urls: readonly string[],
  rpc: ReturnType<typeof makeJsonRpc>,
): Promise<void> {
  for (const url of urls) {
    const host = redactRpcUrl(url);
    try {
      const chainId = Number(BigInt(await rpc<string>(url, 'eth_chainId', [])));
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const start = performance.now();
        await rpc<string>(url, 'eth_blockNumber', []);
        samples.push(performance.now() - start);
      }
      const latency = median(samples);

      const burstStart = performance.now();
      const burstResults = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          rpc<string>(url, 'eth_blockNumber', []),
        ),
      );
      const burstOk = burstResults.filter(
        (result) => result.status === 'fulfilled',
      ).length;
      const burstMs = performance.now() - burstStart;

      const safe = await blockTagWorks(rpc, url, 'safe');
      const finalized = await blockTagWorks(rpc, url, 'finalized');
      const cap = await probeRpcLogMaxRange(url, rpc);

      console.log(
        [
          chain.padEnd(10),
          host.padEnd(38),
          String(chainId).padEnd(8),
          `${cap === null ? 'unknown' : cap}`.padEnd(9),
          `${latency.toFixed(1)}ms`.padEnd(10),
          `${burstOk}/20 in ${burstMs.toFixed(0)}ms`.padEnd(20),
          safe ? 'yes' : 'no',
          finalized ? 'yes' : 'no',
        ].join(' '),
      );
    } catch (error) {
      console.log(
        `${chain.padEnd(10)} ${host.padEnd(38)} ERROR ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export async function runMeasureRpc(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const overrides = parseRpcOverrides(env);
  const urls = Object.values(overrides).flatMap((list) => list ?? []);
  const rpc = makeJsonRpc(urls, { attempts: 1 });

  console.log('Paid endpoint measurements (host names only)');
  console.log(`Read at: ${new Date().toISOString()}`);
  console.log(
    [
      'Chain'.padEnd(10),
      'Host'.padEnd(38),
      'Chain ID'.padEnd(8),
      'Log cap'.padEnd(9),
      'Median'.padEnd(10),
      'Burst'.padEnd(20),
      'Safe',
      'Finalized',
    ].join(' '),
  );
  console.log('-'.repeat(120));

  for (const chain of CHAIN_IDS) {
    const chainUrls = overrides[chain] ?? [];
    if (chainUrls.length === 0) {
      console.log(`${chain.padEnd(10)} no override`);
      continue;
    }
    await measureChain(chain, chainUrls, rpc);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runMeasureRpc().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
