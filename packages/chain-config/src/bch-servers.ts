import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { decodeCashAddress } from '@ferry/core';
import { FulcrumClient } from '@ferry/htlc-bch';
import { redactRpcSecrets } from './rpc-overrides.js';

const MAINNET_GENESIS =
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const PUSD_HOLDER_PROBE =
  'bitcoincash:pdl8y563h887re3r8g4sv76y29jt6vhtpzy9fc8qshmc8x30zjunj7cqx5ee3';

interface Candidate {
  url: string;
  source: string;
}

const CANDIDATES: readonly Candidate[] = [
  {
    url: 'wss://bch.imaginary.cash:50004',
    source: 'solver configuration; Imaginary.cash wiki',
  },
  {
    url: 'wss://blackie.c3-soft.com:50004',
    source: 'solver configuration',
  },
  {
    url: 'wss://electrum.imaginary.cash:50004',
    source: 'Imaginary.cash wiki',
  },
  {
    url: 'wss://bch.loping.net:50004',
    source: 'public BCH Electrum server list',
  },
  {
    url: 'wss://bch.soul-dev.com:50004',
    source: 'public BCH Electrum server list',
  },
  {
    url: 'wss://electron.jochen-hoenicke.de:51004',
    source: 'public BCH Electrum server list',
  },
  {
    url: 'wss://electrumx-bch.cryptonermal.net:50004',
    source: 'public BCH Electrum server list',
  },
  {
    url: 'wss://cashnode.bch.ninja:443',
    source: 'BCH Ninja public server page',
  },
  {
    url: 'wss://electroncash.dk:50004',
    source: 'public BCH Electrum server list',
  },
];

interface Geo {
  country: string;
  org: string;
  asn: string;
}

interface ServerResult {
  host: string;
  ip: string;
  geo: Geo;
  reachable: boolean;
  genesisOk: boolean;
  tip: number | null;
  latencyMs: number | null;
  dsproofGet: 'yes' | 'no' | 'unknown';
  broadcast: 'not invoked';
  tokenUtxos: 'yes' | 'no' | 'unknown';
  error: string | null;
}

function scripthashForCashAddress(address: string): string {
  const decoded = decodeCashAddress(address);
  const hash = createHash('sha256')
    .update(Buffer.from(decoded.lockingBytecode.slice(2), 'hex'))
    .digest();
  return Buffer.from(hash).reverse().toString('hex');
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function geoFor(hostname: string): Promise<{ ip: string; geo: Geo }> {
  try {
    const address = await lookup(hostname, { family: 4 });
    const response = await fetch(`https://ipwho.is/${address.address}`, {
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json()) as {
      success?: boolean;
      country?: string;
      connection?: { org?: string; isp?: string; asn?: number };
    };
    return {
      ip: address.address,
      geo: {
        country:
          payload.success === true ? (payload.country ?? 'unknown') : 'unknown',
        org:
          payload.success === true
            ? (payload.connection?.org ?? payload.connection?.isp ?? 'unknown')
            : 'unknown',
        asn:
          payload.success === true && payload.connection?.asn !== undefined
            ? `AS${payload.connection.asn}`
            : 'unknown',
      },
    };
  } catch {
    return {
      ip: 'unknown',
      geo: { country: 'unknown', org: 'unknown', asn: 'unknown' },
    };
  }
}

async function survey(candidate: Candidate): Promise<ServerResult> {
  const url = new URL(candidate.url);
  const hostname = url.hostname;
  const host = url.port === '' ? `${hostname}:443` : url.host;
  const { ip, geo } = await geoFor(hostname);
  const client = new FulcrumClient(candidate.url, { timeoutMs: 10_000 });
  try {
    await client.connect();
    const features = await client.request<{
      genesis_hash?: string;
      dsproof?: boolean;
    }>('server.features');
    const genesisOk =
      typeof features.genesis_hash === 'string' &&
      features.genesis_hash.toLowerCase() === MAINNET_GENESIS;
    if (!genesisOk) {
      return {
        host,
        ip,
        geo,
        reachable: true,
        genesisOk: false,
        tip: null,
        latencyMs: null,
        dsproofGet: 'unknown',
        broadcast: 'not invoked',
        tokenUtxos: 'unknown',
        error: 'genesis hash mismatch',
      };
    }

    const tip = await client.getTipHeight();
    const samples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const start = performance.now();
      await client.request('server.ping', []);
      samples.push(performance.now() - start);
    }

    let dsproofGet: 'yes' | 'no' = 'no';
    try {
      await client.request('blockchain.transaction.dsproof.get', [
        `0x${'00'.repeat(32)}`,
      ]);
      dsproofGet = 'yes';
    } catch {
      dsproofGet = 'no';
    }

    let tokenUtxos: 'yes' | 'no' = 'no';
    try {
      const utxos = await client.listUnspent(
        scripthashForCashAddress(PUSD_HOLDER_PROBE),
        'include_tokens',
      );
      tokenUtxos = utxos.some((utxo) => utxo.token_data !== undefined)
        ? 'yes'
        : 'no';
    } catch {
      tokenUtxos = 'no';
    }

    return {
      host,
      ip,
      geo,
      reachable: true,
      genesisOk: true,
      tip,
      latencyMs: median(samples),
      dsproofGet,
      broadcast: 'not invoked',
      tokenUtxos,
      error: null,
    };
  } catch (error) {
    return {
      host,
      ip,
      geo,
      reachable: false,
      genesisOk: false,
      tip: null,
      latencyMs: null,
      dsproofGet: 'unknown',
      broadcast: 'not invoked',
      tokenUtxos: 'unknown',
      error: redactRpcSecrets(
        error instanceof Error ? error.message : String(error),
        [candidate.url],
      ),
    };
  } finally {
    client.close();
  }
}

export async function runBchServers(): Promise<void> {
  const results: ServerResult[] = [];
  for (const candidate of CANDIDATES) {
    results.push(await survey(candidate));
  }
  const tips = results
    .filter((item) => item.tip !== null)
    .map((item) => item.tip as number);
  const maxTip = tips.length > 0 ? Math.max(...tips) : null;
  const minTip = tips.length > 0 ? Math.min(...tips) : null;

  console.log('BCH mainnet Fulcrum survey (host names only)');
  console.log(
    'Host | IP | Country | Org | Genesis | Tip | Median | dsproof.get | broadcast | token UTXOs | Note',
  );
  for (const result of results) {
    const tipOffset =
      result.tip !== null && maxTip !== null ? ` (${result.tip - maxTip})` : '';
    console.log(
      [
        result.host,
        result.ip,
        result.geo.country,
        result.geo.org,
        result.genesisOk ? 'ok' : 'FAIL',
        result.tip === null ? 'n/a' : `${result.tip}${tipOffset}`,
        result.latencyMs === null ? 'n/a' : `${result.latencyMs.toFixed(1)}ms`,
        result.dsproofGet,
        result.broadcast,
        result.tokenUtxos,
        result.error ?? '',
      ].join(' | '),
    );
  }
  console.log(
    `Tip spread: ${minTip ?? 'n/a'} to ${maxTip ?? 'n/a'} (${tips.length} reachable).`,
  );
  console.log(
    'Recommended: pick two or three with distinct operator/country and matching genesis.',
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runBchServers().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
