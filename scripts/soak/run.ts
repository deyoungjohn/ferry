import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCashAddress } from '../../packages/core/src/index.js';
import {
  loadChainConfig,
  redactRpcUrl,
  type ChainId,
} from '../../packages/chain-config/src/index.js';
import { makeJsonRpc } from '../../packages/chain-config/src/rpc-client.js';
import { BchQuorumClient } from '../../packages/solver/src/bch/quorum-client.js';
import {
  DEFAULT_PEG_TOLERANCE_MICROS,
  createBchUsdSource,
  createCauldronPriceSource,
  createParyonPriceSource,
  evaluatePegGuard,
  type AssetPriceReading,
} from '../../packages/bch-prices/src/index.js';
import {
  ChainlinkPriceSource,
  type ChainlinkReader,
} from '../../packages/evm-prices/src/index.js';

const DEFAULT_FULCRUM_URLS = [
  'wss://electron.jochen-hoenicke.de:51004',
  'wss://electroncash.dk:50004',
  'wss://bch.imaginary.cash:50004',
] as const;

const PUBLIC_PUSD_ADDRESS =
  'bitcoincash:pdl8y563h887re3r8g4sv76y29jt6vhtpzy9fc8qshmc8x30zjunj7cqx5ee3';

const EVM_CHAINS: readonly ChainId[] = ['base', 'ethereum', 'arbitrum', 'bnb'];

const BCH_PRICE_MAX_AGE_S = 300;
const SOLVER_PEG_GUARD_MICROS = 20_000n;

function makeChainlinkReader(
  rpc: ReturnType<typeof makeJsonRpc>,
  rpcUrl: string,
): ChainlinkReader {
  return {
    async decimals(feed): Promise<number> {
      const hex = await rpc<string>(rpcUrl, 'eth_call', [
        { to: feed, data: '0x313ce567' },
        'latest',
      ]);
      return Number(BigInt(hex));
    },
    async latestRoundData(feed) {
      const hex = await rpc<string>(rpcUrl, 'eth_call', [
        { to: feed, data: '0xfeaf968c' },
        'latest',
      ]);
      const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
      if (raw.length < 320) {
        throw new Error(`Unexpected latestRoundData length: ${raw.length}`);
      }
      const word = (idx: number): bigint =>
        BigInt(`0x${raw.slice(idx * 64, (idx + 1) * 64)}`);
      const rawAnswer = word(1);
      const signedAnswer =
        rawAnswer >= 1n << 255n ? rawAnswer - (1n << 256n) : rawAnswer;
      return {
        roundId: word(0),
        answer: signedAnswer,
        startedAt: word(2),
        updatedAt: word(3),
        answeredInRound: word(4),
      };
    },
  };
}

interface SourceStats {
  name: string;
  host: string;
  samples: number;
  successes: number;
  failures: number;
  staleCount: number;
  latenciesMs: number[];
  currentOutageStartMs: number | null;
  longestOutageSeconds: number;
  lastError: string | null;
}

interface PegDisagreementEvent {
  at: string;
  toleranceMicros: string;
  reason: string;
  maxSpreadMicros: string;
  maxPegDeviationMicros: string;
}

function scripthashForCashAddress(address: string): string {
  const decoded = decodeCashAddress(address);
  const hash = createHash('sha256')
    .update(Buffer.from(decoded.lockingBytecode.slice(2), 'hex'))
    .digest();
  return Buffer.from(hash).reverse().toString('hex');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return redactRpcUrl(url);
  }
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx]!);
}

function parseArgs(argv: readonly string[]): {
  minutes: number;
  outDir: string;
} {
  let minutes = 120;
  let outDir = resolve(fileURLToPath(new URL('.', import.meta.url)));

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--minutes' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --minutes value: ${argv[i + 1]}`);
      }
      minutes = parsed;
      i++;
    } else if (arg === '--out' && argv[i + 1]) {
      outDir = resolve(argv[i + 1]!);
      i++;
    }
  }
  return { minutes, outDir };
}

function createStats(name: string, host: string): SourceStats {
  return {
    name,
    host,
    samples: 0,
    successes: 0,
    failures: 0,
    staleCount: 0,
    latenciesMs: [],
    currentOutageStartMs: null,
    longestOutageSeconds: 0,
    lastError: null,
  };
}

function recordSuccess(
  stats: SourceStats,
  latencyMs: number,
  nowMs: number,
  stale = false,
): void {
  stats.samples++;
  stats.successes++;
  stats.latenciesMs.push(latencyMs);
  if (stale) stats.staleCount++;
  if (stats.currentOutageStartMs !== null) {
    const dur = (nowMs - stats.currentOutageStartMs) / 1000;
    if (dur > stats.longestOutageSeconds) {
      stats.longestOutageSeconds = Math.round(dur);
    }
    stats.currentOutageStartMs = null;
  }
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/https?:\/\/[^\s)]+|wss?:\/\/[^\s)]+/gi, (u) => {
      try {
        const parsed = new URL(u);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return '[redacted-url]';
      }
    })
    .slice(0, 200);
}

function recordFailure(stats: SourceStats, err: unknown, nowMs: number): void {
  stats.samples++;
  stats.failures++;
  if (stats.currentOutageStartMs === null) {
    stats.currentOutageStartMs = nowMs;
  } else {
    const dur = (nowMs - stats.currentOutageStartMs) / 1000;
    if (dur > stats.longestOutageSeconds) {
      stats.longestOutageSeconds = Math.round(dur);
    }
  }
  stats.lastError = sanitizeError(err);
}

function formatPct(ok: number, total: number): string {
  if (total === 0) return '0.00%';
  return `${((ok / total) * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const { minutes, outDir } = parseArgs(process.argv.slice(2));
  const startMs = Date.now();
  const startMonotonicMs = performance.now();
  const deadlineMonotonicMs = startMonotonicMs + minutes * 60_000;

  const fulcrumUrlsRaw = process.env['BCH_ELECTRUM_URLS']?.trim();
  const fulcrumUrls = fulcrumUrlsRaw
    ? fulcrumUrlsRaw
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
    : [...DEFAULT_FULCRUM_URLS];

  const cfg = loadChainConfig({ network: 'mainnet' });
  const rpc = makeJsonRpc([], { attempts: 2 });
  const statsMap = new Map<string, SourceStats>();
  const getStats = (name: string, host: string): SourceStats => {
    let s = statsMap.get(name);
    if (!s) {
      s = createStats(name, host);
      statsMap.set(name, s);
    }
    return s;
  };

  const bchQuorumHosts = fulcrumUrls.map(hostOf).join(', ');
  const bchQuorum = new BchQuorumClient(fulcrumUrls, { network: 'mainnet' });

  let quorumLostCount = 0;
  let serverBehindCount = 0;
  let bchTipMin: number | null = null;
  let bchTipMax: number | null = null;
  let prevBchTip: number | null = null;
  let maxBchTipAgeSeconds = 0;
  let maxBchLivenessAgeSeconds = 0;
  const genesisMismatches: string[] = [];
  const tipMismatches: string[] = [];
  const pegDisagreements1Pct: PegDisagreementEvent[] = [];
  const pegDisagreements2Pct: PegDisagreementEvent[] = [];

  try {
    await bchQuorum.connect();
    const dropped = bchQuorum.getDroppedTransports();
    for (const d of dropped) {
      genesisMismatches.push(
        `BCH Fulcrum dropped on connect: ${hostOf(d.url)}`,
      );
    }
  } catch (err) {
    genesisMismatches.push(`BCH quorum connect error: ${sanitizeError(err)}`);
  }

  const pusdScripthash = scripthashForCashAddress(PUBLIC_PUSD_ADDRESS);
  const bchUsdSource = createBchUsdSource({ timeoutMs: 10_000 });
  const cauldronSource = createCauldronPriceSource({
    bchUsdSource,
    timeoutMs: 10_000,
  });
  const paryonSource = createParyonPriceSource({ timeoutMs: 10_000 });

  const latestStableReadings = new Map<string, AssetPriceReading>();

  interface EvmContext {
    chainId: ChainId;
    expectedChainId: number;
    rpcUrl: string;
    host: string;
    logAddress: string;
    feeds: readonly string[];
    chainlink: ChainlinkPriceSource;
    prevTip: bigint | null;
    maxTipAgeSeconds: number;
  }

  const evmContexts: EvmContext[] = [];
  for (const chainId of EVM_CHAINS) {
    const facts = cfg.facts.find((c) => c.id === chainId);
    if (!facts || facts.rpcUrls.length === 0) {
      throw new Error(`Missing mainnet config or RPCs for ${chainId}`);
    }
    const primaryUrl = facts.rpcUrls[0]!;
    const host = hostOf(primaryUrl);
    const tokenAsset = facts.assets.find((a) => a.address);
    if (!tokenAsset?.address) {
      throw new Error(`No token address configured for ${chainId}`);
    }
    const chainlink = new ChainlinkPriceSource({
      chain: facts,
      reader: makeChainlinkReader(rpc, primaryUrl),
    });
    try {
      const hexChainId = await rpc<string>(primaryUrl, 'eth_chainId', []);
      const actualChainId = Number(BigInt(hexChainId));
      if (actualChainId !== facts.chainId) {
        genesisMismatches.push(
          `EVM ${chainId} (${host}) chainId mismatch: expected ${facts.chainId}, got ${actualChainId}`,
        );
      }
    } catch (err) {
      genesisMismatches.push(
        `EVM ${chainId} (${host}) startup chainId check failed: ${sanitizeError(err)}`,
      );
    }

    evmContexts.push({
      chainId,
      expectedChainId: facts.chainId,
      rpcUrl: primaryUrl,
      host,
      logAddress: tokenAsset.address,
      feeds: facts.priceFeeds.map((f) => f.asset),
      chainlink,
      prevTip: null,
      maxTipAgeSeconds: 0,
    });
  }

  async function sampleBchAndBchPrices(): Promise<void> {
    const nowMs = Date.now();

    // 1. BCH Quorum status + ping
    const quorumStats = getStats('bch-quorum-tip', bchQuorumHosts);
    try {
      const t0 = performance.now();
      await bchQuorum.pingAll();
      const status = bchQuorum.getQuorumStatus();
      const latency = performance.now() - t0;

      const tips = Object.values(status.tips);
      if (tips.length > 1) {
        const spread = Math.max(...tips) - Math.min(...tips);
        if (spread > 1) {
          serverBehindCount++;
        }
      }
      if (!status.isQuorumHealthy) {
        quorumLostCount++;
        recordFailure(
          quorumStats,
          new Error(`Quorum unhealthy: ${status.quotingState}`),
          nowMs,
        );
      } else {
        const stale = status.ageSeconds > 7200;
        recordSuccess(quorumStats, latency, nowMs, stale);
      }
      if (status.quorumTip > 0) {
        if (bchTipMin === null || status.quorumTip < bchTipMin) {
          bchTipMin = status.quorumTip;
        }
        if (bchTipMax === null || status.quorumTip > bchTipMax) {
          bchTipMax = status.quorumTip;
        }
        if (prevBchTip !== null && status.quorumTip < prevBchTip) {
          tipMismatches.push(
            `BCH quorum tip regressed from ${prevBchTip} to ${status.quorumTip}`,
          );
        }
        prevBchTip = status.quorumTip;
      }
      if (
        Number.isFinite(status.ageSeconds) &&
        status.ageSeconds > maxBchTipAgeSeconds
      ) {
        maxBchTipAgeSeconds = status.ageSeconds;
      }
      if (
        Number.isFinite(status.livenessAgeSeconds) &&
        status.livenessAgeSeconds > maxBchLivenessAgeSeconds
      ) {
        maxBchLivenessAgeSeconds = status.livenessAgeSeconds;
      }
    } catch (err) {
      quorumLostCount++;
      recordFailure(quorumStats, err, nowMs);
    }

    // 2. Fulcrum history
    const histStats = getStats('bch-fulcrum-history', bchQuorumHosts);
    try {
      const t0 = performance.now();
      await bchQuorum.getHistory(pusdScripthash);
      recordSuccess(histStats, performance.now() - t0, nowMs);
    } catch (err) {
      recordFailure(histStats, err, nowMs);
    }

    // 3. Fulcrum listunspent
    const utxoStats = getStats('bch-fulcrum-listunspent', bchQuorumHosts);
    try {
      const t0 = performance.now();
      await bchQuorum.listUnspent(pusdScripthash, 'tokens_only');
      recordSuccess(utxoStats, performance.now() - t0, nowMs);
    } catch (err) {
      recordFailure(utxoStats, err, nowMs);
    }

    // 4. BCH/USD spot
    const bchUsdStats = getStats('bch-usd', 'api.coinbase.com,api.kraken.com');
    try {
      const t0 = performance.now();
      const reading = await bchUsdSource.getPrice('BCH');
      const age = Math.floor(Date.now() / 1000) - reading.asOf;
      recordSuccess(
        bchUsdStats,
        performance.now() - t0,
        nowMs,
        age < 0 || age > BCH_PRICE_MAX_AGE_S,
      );
    } catch (err) {
      recordFailure(bchUsdStats, err, nowMs);
    }

    // 5. Cauldron PUSD & MUSD
    for (const sym of ['PUSD', 'MUSD'] as const) {
      const st = getStats(
        `cauldron-${sym.toLowerCase()}`,
        'indexer.cauldron.quest',
      );
      try {
        const t0 = performance.now();
        const reading = await cauldronSource.getPrice(sym);
        const age = Math.floor(Date.now() / 1000) - reading.asOf;
        const stale = age < 0 || age > BCH_PRICE_MAX_AGE_S;
        recordSuccess(st, performance.now() - t0, nowMs, stale);
        if (!stale) latestStableReadings.set(`cauldron:${sym}`, reading);
      } catch (err) {
        recordFailure(st, err, nowMs);
      }
    }

    // 6. Paryon PUSD
    const paryonStats = getStats('paryon-pusd', 'mainnet-v1.paryonusd.com');
    try {
      const t0 = performance.now();
      const reading = await paryonSource.getPrice('PUSD');
      const age = Math.floor(Date.now() / 1000) - reading.asOf;
      const stale = age < 0 || age > BCH_PRICE_MAX_AGE_S;
      recordSuccess(paryonStats, performance.now() - t0, nowMs, stale);
      if (!stale) latestStableReadings.set('paryon:PUSD', reading);
    } catch (err) {
      recordFailure(paryonStats, err, nowMs);
    }

    // 7. Cross-source peg guard check
    const readings = [...latestStableReadings.values()];
    if (readings.length >= 2) {
      const eval1 = evaluatePegGuard({
        readings,
        toleranceUsdMicros: DEFAULT_PEG_TOLERANCE_MICROS,
      });
      if (eval1.status === 'refuse') {
        pegDisagreements1Pct.push({
          at: new Date(nowMs).toISOString(),
          toleranceMicros: DEFAULT_PEG_TOLERANCE_MICROS.toString(),
          reason: eval1.reason ?? 'PEG_DEVIATION',
          maxSpreadMicros: eval1.maxSpreadMicros.toString(),
          maxPegDeviationMicros: eval1.maxPegDeviationMicros.toString(),
        });
      }
      const eval2 = evaluatePegGuard({
        readings,
        toleranceUsdMicros: SOLVER_PEG_GUARD_MICROS,
      });
      if (eval2.status === 'refuse') {
        pegDisagreements2Pct.push({
          at: new Date(nowMs).toISOString(),
          toleranceMicros: SOLVER_PEG_GUARD_MICROS.toString(),
          reason: eval2.reason ?? 'PEG_DEVIATION',
          maxSpreadMicros: eval2.maxSpreadMicros.toString(),
          maxPegDeviationMicros: eval2.maxPegDeviationMicros.toString(),
        });
      }
    }
  }

  async function sampleEvm(): Promise<void> {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    await Promise.all(
      evmContexts.map(async (ctx) => {
        // 1. EVM tip + block age
        const tipStats = getStats(`evm-tip-${ctx.chainId}`, ctx.host);
        let tip: bigint | null = null;
        try {
          const t0 = performance.now();
          const tipHex = await rpc<string>(ctx.rpcUrl, 'eth_blockNumber', []);
          tip = BigInt(tipHex);
          const block = await rpc<{ timestamp?: string }>(
            ctx.rpcUrl,
            'eth_getBlockByNumber',
            [`0x${tip.toString(16)}`, false],
          );
          const latency = performance.now() - t0;
          const blockTs = block?.timestamp
            ? Number(BigInt(block.timestamp))
            : 0;
          const tipAge = blockTs > 0 ? Math.max(0, nowSec - blockTs) : 0;
          if (tipAge > ctx.maxTipAgeSeconds) {
            ctx.maxTipAgeSeconds = tipAge;
          }
          if (ctx.prevTip !== null && tip < ctx.prevTip) {
            tipMismatches.push(
              `EVM ${ctx.chainId} (${ctx.host}) tip regressed from ${ctx.prevTip} to ${tip}`,
            );
          }
          ctx.prevTip = tip;
          recordSuccess(tipStats, latency, nowMs, tipAge > 120);
        } catch (err) {
          recordFailure(tipStats, err, nowMs);
        }

        // 2. EVM 100-block eth_getLogs
        const logsStats = getStats(`evm-getlogs-${ctx.chainId}`, ctx.host);
        const currentTip = tip;
        if (currentTip !== null && currentTip >= 100n) {
          try {
            const t0 = performance.now();
            await rpc<unknown[]>(ctx.rpcUrl, 'eth_getLogs', [
              {
                address: ctx.logAddress,
                fromBlock: `0x${(currentTip - 99n).toString(16)}`,
                toBlock: `0x${currentTip.toString(16)}`,
              },
            ]);
            recordSuccess(logsStats, performance.now() - t0, nowMs);
          } catch (err) {
            recordFailure(logsStats, err, nowMs);
          }
        }

        // 3. Chainlink feeds
        for (const asset of ctx.feeds) {
          const feedStats = getStats(
            `chainlink-${ctx.chainId}-${asset.toLowerCase()}`,
            ctx.host,
          );
          try {
            const t0 = performance.now();
            const reading = await ctx.chainlink.getPrice(asset);
            recordSuccess(feedStats, performance.now() - t0, nowMs, false);
            latestStableReadings.set(`${ctx.chainId}:${asset}`, reading);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('stale')) {
              recordSuccess(feedStats, 0, nowMs, true);
            } else {
              recordFailure(feedStats, err, nowMs);
            }
          }
        }
      }),
    );
  }

  let bchTimer: ReturnType<typeof setInterval> | null = null;
  let evmTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const finalize = async (reason: string): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (bchTimer) clearInterval(bchTimer);
    if (evmTimer) clearInterval(evmTimer);
    bchQuorum.close();

    const endMs = Date.now();
    const durationMin = (
      (performance.now() - startMonotonicMs) /
      60_000
    ).toFixed(1);

    const rows = [...statsMap.values()].map((s) => ({
      name: s.name,
      host: s.host,
      samples: s.samples,
      successes: s.successes,
      failures: s.failures,
      successRate: formatPct(s.successes, s.samples),
      successRateNum: s.samples === 0 ? 0 : s.successes / s.samples,
      p50Ms: percentile(s.latenciesMs, 50),
      p95Ms: percentile(s.latenciesMs, 95),
      longestOutageSeconds: s.longestOutageSeconds,
      staleCount: s.staleCount,
      lastError: s.lastError,
    }));

    const leastReliable = [...rows].sort((a, b) => {
      if (a.successRateNum !== b.successRateNum) {
        return a.successRateNum - b.successRateNum;
      }
      if (a.longestOutageSeconds !== b.longestOutageSeconds) {
        return b.longestOutageSeconds - a.longestOutageSeconds;
      }
      return (b.p95Ms ?? 0) - (a.p95Ms ?? 0);
    })[0];

    const maxEvmTipAge = Math.max(
      0,
      ...evmContexts.map((c) => c.maxTipAgeSeconds),
    );
    const maxP95 = Math.max(0, ...rows.map((r) => r.p95Ms ?? 0));

    const recTipAgeBch = Math.max(7200, maxBchTipAgeSeconds + 600);
    const recTipAgeEvm = Math.max(120, maxEvmTipAge + 60);
    const recPriceAge = 300;
    const recQuorumTimeoutMs = Math.max(10_000, Math.min(30_000, maxP95 * 3));

    const summary = {
      startedAt: new Date(startMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      durationMinutes: Number(durationMin),
      stopReason: reason,
      sources: rows,
      bchQuorum: {
        hosts: bchQuorumHosts,
        quorumLostCount,
        serverBehindCount,
        tipMin: bchTipMin,
        tipMax: bchTipMax,
        maxTipAgeSeconds: maxBchTipAgeSeconds,
        maxLivenessAgeSeconds: maxBchLivenessAgeSeconds,
      },
      genesisMismatches,
      tipMismatches,
      pegDisagreements1PctCount: pegDisagreements1Pct.length,
      pegDisagreements2PctCount: pegDisagreements2Pct.length,
      pegDisagreementsSample: pegDisagreements1Pct.slice(0, 10),
      leastReliable: leastReliable
        ? {
            name: leastReliable.name,
            host: leastReliable.host,
            successRate: leastReliable.successRate,
            p95Ms: leastReliable.p95Ms,
            longestOutageSeconds: leastReliable.longestOutageSeconds,
            lastError: leastReliable.lastError,
          }
        : null,
      recommendedRunbookThresholds: {
        bchTipMaxAgeSeconds: recTipAgeBch,
        evmTipMaxAgeSeconds: recTipAgeEvm,
        bchHttpPriceMaxAgeSeconds: recPriceAge,
        quorumRequestTimeoutMs: recQuorumTimeoutMs,
      },
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      resolve(outDir, 'report.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    );

    const mdLines = [
      '# Live Data Source Soak Report',
      '',
      `- **Started:** ${summary.startedAt}`,
      `- **Ended:** ${summary.endedAt}`,
      `- **Duration:** ${durationMin} minutes (${reason})`,
      `- **BCH Quorum Hosts:** ${bchQuorumHosts}`,
      '',
      '## Per-Source Metrics',
      '',
      '| Source | Host | Samples | Success Rate | p50 (ms) | p95 (ms) | Longest Outage (s) | Stale | Last Error |',
      '|---|---|---:|---:|---:|---:|---:|---:|---|',
      ...rows.map(
        (r) =>
          `| ${r.name} | ${r.host} | ${r.samples} | ${r.successRate} | ${r.p50Ms ?? 'n/a'} | ${r.p95Ms ?? 'n/a'} | ${r.longestOutageSeconds} | ${r.staleCount} | ${r.lastError ?? 'none'} |`,
      ),
      '',
      '## Quorum, Peg & Integrity Summary',
      '',
      `- **BCH Quorum Lost Ticks:** ${quorumLostCount}`,
      `- **BCH Server >1 Block Behind Ticks:** ${serverBehindCount}`,
      `- **BCH Quorum Tip Range:** ${bchTipMin ?? 'n/a'} .. ${bchTipMax ?? 'n/a'}`,
      `- **Max BCH Tip Age:** ${maxBchTipAgeSeconds}s (max liveness age: ${maxBchLivenessAgeSeconds}s)`,
      `- **Max EVM Tip Age (across Base/Ethereum/Arbitrum/BNB):** ${maxEvmTipAge}s`,
      `- **Peg Disagreements (>1% / 10,000 micros):** ${pegDisagreements1Pct.length}`,
      `- **Peg Disagreements (>2% / 20,000 micros):** ${pegDisagreements2Pct.length}`,
      `- **Genesis Mismatches:** ${genesisMismatches.length === 0 ? 'None' : genesisMismatches.join('; ')}`,
      `- **Tip Regressions / Mismatches:** ${tipMismatches.length === 0 ? 'None' : tipMismatches.join('; ')}`,
      '',
      '## Least Reliable Source',
      '',
      leastReliable
        ? `- **${leastReliable.name}** (\`${leastReliable.host}\`): ${leastReliable.successRate} success, p95=${leastReliable.p95Ms ?? 'n/a'} ms, longest outage=${leastReliable.longestOutageSeconds}s${leastReliable.lastError ? `, last error: \`${leastReliable.lastError}\`` : ''}`
        : '- None recorded.',
      '',
      '## Recommended Thresholds for `RUNBOOK.md`',
      '',
      `- **BCH tip max age:** \`${recTipAgeBch}s\` (observed max: ${maxBchTipAgeSeconds}s)`,
      `- **EVM tip max age:** \`${recTipAgeEvm}s\` (observed max: ${maxEvmTipAge}s)`,
      `- **BCH HTTP price max age:** \`${recPriceAge}s\` (Chainlink feeds use per-feed heartbeat + margin)`,
      `- **Quorum / RPC request timeout:** \`${recQuorumTimeoutMs}ms\` (observed max p95: ${maxP95}ms)`,
      '',
    ];

    writeFileSync(
      resolve(outDir, 'REPORT.md'),
      `${mdLines.join('\n')}\n`,
      'utf8',
    );
    console.log(
      `Soak finished (${durationMin}m, ${reason}). Wrote ${resolve(outDir, 'REPORT.md')}`,
    );
  };

  process.on('SIGINT', () => {
    void finalize('SIGINT').then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void finalize('SIGTERM').then(() => process.exit(0));
  });

  console.log(`Starting read-only live data soak for ${minutes} minute(s)...`);
  await Promise.all([sampleBchAndBchPrices(), sampleEvm()]);

  if (performance.now() < deadlineMonotonicMs) {
    bchTimer = setInterval(() => {
      void sampleBchAndBchPrices();
    }, 30_000);
    evmTimer = setInterval(() => {
      void sampleEvm();
    }, 60_000);

    await new Promise<void>((resolveWait) => {
      const check = setInterval(() => {
        if (performance.now() >= deadlineMonotonicMs || stopped) {
          clearInterval(check);
          resolveWait();
        }
      }, 5_000);
    });
  }

  await finalize('completed');
}

void main();
