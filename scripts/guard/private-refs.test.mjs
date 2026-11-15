import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  scanHistory,
  scanMessage,
  scanText,
  scanTree,
} from './private-refs.mjs';

const root = new URL('../..', import.meta.url).pathname;

describe('private reference matcher', () => {
  it.each([
    'see the lab for details',
    'read lab/decisions.md first',
    'cloned from ferry-lab',
    'check the friction log',
    'see the rebuild playbook',
    'per AGENTS.md',
    'per CLAUDE.md',
    'see HANDOFF',
    'prompts/agent-1.md',
    'the orchestrator merged it',
    'regression test for FL-OR-063',
    'task P2-23',
    'based on internal docs',
    'path /home/dell/Projects',
    'author iamtheyoungjohn@example.com',
  ])('flags: %s', (line) => {
    expect(scanText(line, 'x').length).toBeGreaterThan(0);
  });

  it.each([
    'Rebalancing playbook for solver inventory',
    'import { cauldron } from "@cashlab/cauldron"',
    'Client handoff to the wallet',
    'ferry-testnet is the disclosed prior work',
    'a swarm of AI agents built this under human direction',
    'collaborate with the label printer',
    'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>',
  ])('allows: %s', (line) => {
    expect(scanText(line, 'x')).toEqual([]);
  });

  it('flags the private workflow trailers in commit messages', () => {
    expect(scanMessage('feat: x\n\nAgent: 2\nPrompt: B2-01', 'c').length).toBe(
      2,
    );
    expect(scanMessage('feat: x\n\nCo-Authored-By: Claude', 'c')).toEqual([]);
  });
});

describe('scanning a repository', () => {
  it('finds private references in files and in commit messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-guard-'));
    try {
      const run = (...args) =>
        execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      run('init', '-q');
      run('config', 'user.email', 'dev@example.com');
      run('config', 'user.name', 'Dev');
      writeFileSync(join(dir, 'a.ts'), '// see the lab for context\n');
      run('add', '.');
      run('commit', '-q', '-m', 'feat: add a (FL-OR-001)');
      expect(scanTree(dir).length).toBe(1);
      expect(scanHistory('', dir).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('this repository', () => {
  it('has no private references in any file, tracked or not', () => {
    expect(scanTree(root)).toEqual([]);
  });

  it('has no private references in any commit message or author', () => {
    expect(scanHistory('', root)).toEqual([]);
  });
});
