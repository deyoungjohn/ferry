// @vitest-environment node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../..');
const distDir = path.resolve(webRoot, 'dist');
const assetsDir = path.resolve(distDir, 'assets');

describe('Performance Budget Test (Task B3-09)', () => {
  it('enforces home route gzipped JS is within 200 kB and total dist is within 8 MB', () => {
    if (!fs.existsSync(distDir) || !fs.existsSync(assetsDir)) {
      // Skip if dist has not been generated yet
      return;
    }

    // 1. Find home route entrypoint bundle index-*.js
    const files = fs.readdirSync(assetsDir);
    const indexFile = files.find((f) => /^index-[a-zA-Z0-9_-]+\.js$/.test(f));
    expect(
      indexFile,
      'index-*.js bundle must exist in dist/assets',
    ).toBeDefined();

    const indexPath = path.join(assetsDir, indexFile!);
    const rawContent = fs.readFileSync(indexPath);
    const rawSizeKb = rawContent.byteLength / 1024;
    const gzipped = zlib.gzipSync(rawContent);
    const gzippedSizeKb = gzipped.byteLength / 1024;

    console.log(`[Performance Budget] Home Route (index-*.js):`);
    console.log(`  - Raw Size: ${rawSizeKb.toFixed(2)} kB`);
    console.log(`  - Gzipped Size: ${gzippedSizeKb.toFixed(2)} kB`);
    console.log(`  - Budget Limit: 200.00 kB`);

    // Must be <= 200 kB (204,800 bytes)
    expect(
      gzipped.byteLength,
      `Home route gzipped size (${gzippedSizeKb.toFixed(2)} kB) exceeds 200 kB budget`,
    ).toBeLessThanOrEqual(200 * 1024);

    // 2. Measure total dist directory size
    function calculateTotalDirSize(dir: string): number {
      let total = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          total += calculateTotalDirSize(full);
        } else {
          total += fs.statSync(full).size;
        }
      }
      return total;
    }

    const totalDistBytes = calculateTotalDirSize(distDir);
    const totalDistMb = totalDistBytes / (1024 * 1024);

    console.log(`[Performance Budget] Total dist/ Size:`);
    console.log(`  - Total Size: ${totalDistMb.toFixed(2)} MB`);
    console.log(`  - Budget Limit: 8.00 MB`);

    // Must be <= 8 MB (8,388,608 bytes)
    expect(
      totalDistBytes,
      `Total dist size (${totalDistMb.toFixed(2)} MB) exceeds 8 MB budget`,
    ).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
