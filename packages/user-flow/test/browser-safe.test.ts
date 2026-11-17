import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packages = resolve(here, '../..');

const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'readline',
  'stream',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
];

/** Entry files of this package and of the workspace packages it imports. */
const ENTRIES = [
  'user-flow/src/index.ts',
  'core/src/index.ts',
  'core/src/api/index.ts',
  'htlc-bch/src/index.ts',
  'solver-client/src/index.ts',
];

function localImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs = [...text.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)].map(
    (m) => m[1]!,
  );
  return specs.map((spec) =>
    resolve(dirname(file), spec.replace(/\.js$/, '.ts')),
  );
}

function graph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    // Directory imports resolve to their index file.
    try {
      stack.push(...localImports(file));
    } catch {
      /* a JSON or declaration file: nothing to follow */
    }
  }
  return [...seen].filter((f) => f.endsWith('.ts'));
}

function offenders(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(
    /import\s+(?!type\b)(?!\*)[^;]*?from\s+'([^']+)'/gs,
  )) {
    const spec = match[1]!;
    const bare = spec.replace(/^node:/, '');
    if (spec.startsWith('node:') || NODE_BUILTINS.includes(bare)) {
      found.push(spec);
    }
  }
  return found;
}

describe('browser-safe', () => {
  it('actually walks the import graph', () => {
    const files = graph(resolve(packages, 'user-flow/src/index.ts'));
    expect(files.some((f) => f.endsWith('session.ts'))).toBe(true);
    expect(
      graph(resolve(packages, 'htlc-bch/src/index.ts')).length,
    ).toBeGreaterThan(8);
  });

  it.each(ENTRIES)('%s reaches no Node built-in by name', (entry) => {
    const bad: string[] = [];
    for (const file of graph(resolve(packages, entry))) {
      for (const spec of offenders(file)) {
        bad.push(`${file.replace(packages, '')}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('this package does not use Node-only globals', () => {
    const bad: string[] = [];
    for (const file of graph(resolve(packages, 'user-flow/src/index.ts'))) {
      const text = readFileSync(file, 'utf8');
      if (/\bBuffer\b|\bprocess\.|\brequire\(/.test(text)) {
        bad.push(file.replace(packages, ''));
      }
    }
    expect(bad).toEqual([]);
  });
});
