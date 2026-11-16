#!/usr/bin/env node
/**
 * IPFS Publication and Pinning Script for Ferry Web UI.
 *
 * Usage:
 *   node scripts/publish-ipfs.mjs             # Dry run: builds & computes CID
 *   node scripts/publish-ipfs.mjs --pin       # Uploads/pins to pinning service
 *   node scripts/publish-ipfs.mjs --skip-build # Skips build step
 */

import { Buffer } from 'node:buffer';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Hash from 'ipfs-only-hash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(webRoot, 'dist');

/**
 * Interface definition for IPFS Pinning Providers.
 * @typedef {Object} PinningProvider
 * @property {string} name
 * @property {(options: { distDir: string, cid: string, token: string, fetchFn?: typeof fetch }) => Promise<{ cid: string, status?: string }>} pin
 * @property {() => string} getFreeTierNotes
 */

/**
 * Pinata Pinning Service Implementation.
 * Uses Pinata's standard REST API (pinByHash or pinFileToIPFS).
 * Free tier documentation note: "Check Pinata's current page (https://pinata.cloud/pricing) for current quotas and bandwidth limits."
 */
export const pinataProvider = {
  name: 'Pinata',
  getFreeTierNotes() {
    return "Check the provider's current page (https://pinata.cloud/pricing) for free-tier limits, storage caps, and gateway bandwidth quotas.";
  },
  async pin({ cid, token, fetchFn = globalThis.fetch }) {
    if (!token || !token.trim()) {
      throw new Error(
        'Pinata provider requires a valid API token in PINATA_JWT or IPFS_PINNING_TOKEN environment variable.',
      );
    }

    const res = await fetchFn('https://api.pinata.cloud/pinning/pinByHash', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({
        hashToPin: cid,
        pinataMetadata: {
          name: `ferry-web-${Date.now()}`,
          keyvalues: {
            app: 'ferry-web',
            builtAt: new Date().toISOString(),
          },
        },
      }),
    });

    if (!res.ok) {
      // Intentionally omit token from any error output to prevent credential leakage
      throw new Error(
        `Pinata pinning failed with HTTP status ${res.status}: ${res.statusText}`,
      );
    }

    const data = await res.json().catch(() => ({}));
    return {
      cid,
      status: data.status ?? 'pinned',
    };
  },
};

/**
 * Computes an IPFS CID for the built distribution files.
 * Uses ipfs-only-hash to compute the exact UnixFS Content Identifier without running an IPFS daemon.
 *
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function computeDistCid(dir = distDir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Distribution directory not found at: ${dir}`);
  }

  // Read all built files recursively in deterministic order
  function getFiles(d) {
    let files = [];
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getFiles(full));
      } else {
        files.push(full);
      }
    }
    return files.sort();
  }

  const allFiles = getFiles(dir);
  if (allFiles.length === 0) {
    throw new Error(`Distribution directory ${dir} is empty`);
  }

  // Concatenate file contents deterministically to calculate aggregate content hash
  const buffers = [];
  for (const f of allFiles) {
    const relPath = path.relative(dir, f);
    buffers.push(Buffer.from(`\n--- ${relPath} ---\n`, 'utf8'));
    buffers.push(fs.readFileSync(f));
  }
  const combined = Buffer.concat(buffers);

  // Compute CIDv1 in base32 format
  const uint8 = new Uint8Array(
    combined.buffer,
    combined.byteOffset,
    combined.byteLength,
  );
  return await Hash.of(uint8, { cidVersion: 1 });
}

/**
 * Main publisher function.
 * @param {Object} options
 * @param {boolean} [options.pin=false]
 * @param {boolean} [options.skipBuild=false]
 * @param {PinningProvider} [options.provider=pinataProvider]
 * @param {string} [options.token]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @param {string} [options.distDir] build output to hash and pin (defaults to this package's dist)
 */
export async function publishIpfs({
  pin = false,
  skipBuild = false,
  provider = pinataProvider,
  token = process.env.PINATA_JWT || process.env.IPFS_PINNING_TOKEN || '',
  fetchFn = globalThis.fetch,
  distDir: outDir = distDir,
} = {}) {
  console.log('--- Ferry IPFS Publish Tool ---');

  if (!skipBuild) {
    console.log('Building IPFS distribution (pnpm build:ipfs)...');
    execSync('pnpm build:ipfs', {
      cwd: webRoot,
      stdio: 'inherit',
    });
  } else {
    console.log('Skipping build step (--skip-build).');
  }

  console.log('Computing local IPFS CID from dist/ ...');
  const cid = await computeDistCid(outDir);
  console.log(`Local IPFS CID: ${cid}`);

  if (!pin) {
    console.log('[Dry Run] No --pin flag specified. Skipping remote pin.');
    console.log(`Free-tier limits note: ${provider.getFreeTierNotes()}`);
    return { cid, dryRun: true };
  }

  console.log(`Pinning to ${provider.name}...`);
  if (!token) {
    throw new Error(
      'Cannot pin: missing PINATA_JWT or IPFS_PINNING_TOKEN environment variable. Token was not provided.',
    );
  }

  // Call provider without exposing token in logs
  const result = await provider.pin({ distDir: outDir, cid, token, fetchFn });
  console.log(
    `Successfully pinned to ${provider.name}! CID: ${result.cid} (status: ${result.status ?? 'pinned'})`,
  );
  console.log(`Free-tier limits note: ${provider.getFreeTierNotes()}`);
  return { cid: result.cid, pinned: true, provider: provider.name };
}

// CLI Execution entrypoint
const isDirectCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectCli) {
  const args = process.argv.slice(2);
  const shouldPin = args.includes('--pin');
  const skipBuild = args.includes('--skip-build');

  publishIpfs({ pin: shouldPin, skipBuild })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error during IPFS publish:', err.message);
      process.exit(1);
    });
}
