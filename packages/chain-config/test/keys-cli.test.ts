import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadChainConfig } from '../src/index.js';
import { parseKeyFile } from '../src/key-file.js';
import type { RandomSource } from '../src/key-material.js';
import { runGenerate } from '../../../scripts/keys/generate.js';
import { runCheck } from '../../../scripts/keys/check.js';
import { checkOnlineCodes } from '../../../scripts/keys/online.js';
import { assertNewKeyPath } from '../../../scripts/keys/paths.js';
import { findSecretPatterns } from '../../../scripts/keys/history.js';

function bytes(seed: number): Uint8Array {
  return Uint8Array.from(
    { length: 32 },
    (_, index) => (index * 11 + seed) & 0xff,
  );
}

function sequence(values: Uint8Array[]): RandomSource {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error('random source exhausted');
    return value;
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    text: () => [...out, ...err].join('\n'),
  };
}

function keyValues(file: string): string[] {
  const parsed = parseKeyFile(readFileSync(file, 'utf8'));
  return [
    parsed.values.get('DEPLOYER_EVM_PRIVATE_KEY')!,
    parsed.values.get('SOLVER_EVM_PRIVATE_KEY')!,
    parsed.values.get('SOLVER_BCH_WIF')!,
  ];
}

describe('keys CLI output', () => {
  it('writes a 0600 file and prints only public addresses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-keys-'));
    try {
      const file = join(dir, 'keys.env');
      const output = capture();
      const code = runGenerate({
        file,
        cwd: dir,
        random: sequence([bytes(4), bytes(5), bytes(6)]),
        now: new Date(0),
        stdout: output.stdout,
        stderr: output.stderr,
      });
      expect(code).toBe(0);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const text = output.text();
      for (const key of keyValues(file)) expect(text).not.toContain(key);
      expect(text).toContain(materialAddress(file, 'DEPLOYER_EVM_ADDRESS'));
      expect(text).toContain('Key file:');
      expect(text).toContain('Ready-to-commit block');

      const checkOutput = capture();
      const checkCode = await runCheck({
        file,
        cwd: dir,
        stdout: checkOutput.stdout,
        stderr: checkOutput.stderr,
      });
      expect(checkCode).toBe(0);
      const checkText = checkOutput.text();
      for (const key of keyValues(file)) expect(checkText).not.toContain(key);
      expect(checkText).toContain('PASS: key file is ready for mainnet');
      expect(checkText).toContain('Funding targets');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing file without printing a key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-keys-'));
    try {
      const file = join(dir, 'keys.env');
      const first = capture();
      expect(
        runGenerate({
          file,
          cwd: dir,
          random: sequence([bytes(7), bytes(8), bytes(9)]),
          stdout: first.stdout,
          stderr: first.stderr,
        }),
      ).toBe(0);
      const second = capture();
      expect(
        runGenerate({
          file,
          cwd: dir,
          random: sequence([bytes(10), bytes(11), bytes(12)]),
          stdout: second.stdout,
          stderr: second.stderr,
        }),
      ).toBe(1);
      for (const key of keyValues(file)) {
        expect(second.text()).not.toContain(key);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails check for a group-readable file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-keys-'));
    try {
      const file = join(dir, 'keys.env');
      const generate = capture();
      expect(
        runGenerate({
          file,
          cwd: dir,
          random: sequence([bytes(13), bytes(14), bytes(15)]),
          stdout: generate.stdout,
          stderr: generate.stderr,
        }),
      ).toBe(0);
      chmodSync(file, 0o644);
      const output = capture();
      const code = await runCheck({
        file,
        cwd: dir,
        stdout: output.stdout,
        stderr: output.stderr,
      });
      expect(code).toBe(1);
      expect(output.text()).toContain('FAIL file mode 0600');
      for (const key of keyValues(file))
        expect(output.text()).not.toContain(key);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function materialAddress(file: string, name: string): string {
  return parseKeyFile(readFileSync(file, 'utf8')).recorded.get(name)!;
}

describe('key path safety', () => {
  it('allows an ignored path inside a repository and rejects a tracked path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-keys-git-'));
    try {
      const run = (...args: string[]) =>
        execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      run('init', '-q');
      run('config', 'user.email', 'dev@example.com');
      run('config', 'user.name', 'Dev');
      writeFileSync(join(dir, '.gitignore'), '.env.*\n');
      expect(assertNewKeyPath('.env.mainnet.local', dir)).toBe(
        join(dir, '.env.mainnet.local'),
      );
      expect(() => assertNewKeyPath('keys.env', dir)).toThrow(/gitignored/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('online account checks', () => {
  const config = loadChainConfig({ env: {} });
  const deployerEvm = '0x1111111111111111111111111111111111111111';
  const solverEvm = '0x2222222222222222222222222222222222222222';

  it('fails a delegated account and passes empty accounts', async () => {
    const checks = await checkOnlineCodes(
      config,
      { deployerEvm, solverEvm },
      async (chain, address) =>
        chain.id === 'base' && address === deployerEvm
          ? `0xef0100${'00'.repeat(20)}`
          : '0x',
    );
    expect(checks).toHaveLength(config.facts.length * 2);
    expect(
      checks.find((item) => item.name === 'online base deployer')?.detail,
    ).toBe('EIP-7702 delegation');
    expect(checks.filter((item) => !item.ok)).toHaveLength(1);

    const clean = await checkOnlineCodes(
      config,
      { deployerEvm, solverEvm },
      async () => '0x',
    );
    expect(clean.every((item) => item.ok)).toBe(true);
  });

  it('fails closed when every endpoint fails', async () => {
    const checks = await checkOnlineCodes(
      config,
      { deployerEvm, solverEvm },
      async () => {
        throw new Error('rpc down');
      },
    );
    expect(checks.every((item) => !item.ok)).toBe(true);
    expect(checks[0]?.detail).toMatch(/RPC read failed/);
  });
});

describe('history secret patterns', () => {
  it('finds private-key assignments and WIF-shaped strings without values', () => {
    const key = `0x${'ab'.repeat(32)}`;
    const wif = `L${'1'.repeat(51)}`;
    const findings = findSecretPatterns(
      `SOLVER_EVM_PRIVATE_KEY=${key}\nWIF=${wif}`,
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((item) => item.rule)).toEqual([
      'private key assignment',
      'WIF-shaped string',
    ]);
    expect(JSON.stringify(findings)).not.toContain(key);
    expect(JSON.stringify(findings)).not.toContain(wif);
  });

  it('allows public addresses and public keys', () => {
    expect(
      findSecretPatterns(
        'DEPLOYER_EVM_ADDRESS=0x1111111111111111111111111111111111111111',
      ),
    ).toEqual([]);
    expect(findSecretPatterns(`PUBLIC_KEY=0x${'ab'.repeat(32)}`)).toEqual([]);
  });
});
