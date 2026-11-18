import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url).pathname;
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** An exact version, a pinned alias (`npm:name@1.2.3`) or a workspace link. */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A git dependency pinned to a release tag or a full commit; the lockfile records the commit. */
const GIT_PINNED = /^github:[\w.-]+\/[\w.-]+#(?:v?\d+\.\d+\.\d+|[0-9a-f]{40})$/;

export function isPinned(spec) {
  if (spec.startsWith('workspace:')) return true;
  if (spec.startsWith('github:')) return GIT_PINNED.test(spec);
  if (spec.startsWith('npm:')) {
    const at = spec.lastIndexOf('@');
    return at > 4 && EXACT.test(spec.slice(at + 1));
  }
  return EXACT.test(spec);
}

function manifests() {
  const out = execFileSync('git', ['ls-files', '--', '*package.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function unpinned(manifest) {
  const pkg = JSON.parse(readFileSync(`${root}${manifest}`, 'utf8'));
  const found = [];
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!isPinned(String(spec)))
        found.push(`${manifest} ${field} ${name}@${spec}`);
    }
  }
  for (const [name, spec] of Object.entries(pkg.pnpm?.overrides ?? {})) {
    if (!isPinned(String(spec)))
      found.push(`${manifest} overrides ${name}@${spec}`);
  }
  return found;
}

describe('supply chain: exact dependency pins', () => {
  it('finds the workspace manifests', () => {
    expect(manifests().length).toBeGreaterThan(5);
  });

  it.each([
    '^1.2.3',
    '~1.2.3',
    '*',
    'latest',
    '1.x',
    '>=1.0.0',
    '1.2',
    'next',
    'github:foundry-rs/forge-std#master',
    'github:foundry-rs/forge-std',
  ])('rejects the range %s', (spec) => {
    expect(isPinned(spec)).toBe(false);
  });

  it.each([
    '1.2.3',
    '0.0.1-beta.2',
    'workspace:*',
    'npm:left-pad@1.3.0',
    'github:foundry-rs/forge-std#v1.9.7',
  ])('accepts %s', (spec) => {
    expect(isPinned(spec)).toBe(true);
  });

  it('uses an exact version in every package.json', () => {
    expect(manifests().flatMap(unpinned)).toEqual([]);
  });
});
