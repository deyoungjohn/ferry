import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function localImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found = [...text.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1]!);
  return found.map((spec) =>
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
    stack.push(...localImports(file));
  }
  return [...seen];
}

describe('browser entry', () => {
  it('imports no Node built-in by name (it would crash a browser at load)', () => {
    const offenders: string[] = [];
    for (const file of graph(resolve(srcDir, 'browser.ts'))) {
      const text = readFileSync(file, 'utf8');
      // Namespace imports are fine: they only fail if a member is read.
      const named = [
        ...text.matchAll(
          /import\s+(?!type\b)(?!\*)[^;]*?from\s+'node:[^']+'/gs,
        ),
      ];
      if (named.length > 0) offenders.push(file.replace(srcDir, 'src'));
    }
    expect(offenders).toEqual([]);
  });
});
