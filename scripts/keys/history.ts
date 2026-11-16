import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface SecretFinding {
  where: string;
  rule: string;
}

const EVM_ASSIGNMENT =
  /(?:^|[^A-Za-z0-9_])(?:export\s+)?[A-Za-z0-9_]*PRIVATE_KEY\s*=\s*(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const WIF =
  /(?:^|[^1-9A-HJ-NP-Za-km-z])(?:5|K|L|c|9)[1-9A-HJ-NP-Za-km-z]{50,51}(?![1-9A-HJ-NP-Za-km-z])/;
const TEST_PATH = /(^|\/)(test|tests|__tests__|fixtures?)\//i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const MAX_BYTES = 2_000_000;

export function findSecretPatterns(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (EVM_ASSIGNMENT.test(line)) {
      findings.push({
        where: `line ${index + 1}`,
        rule: 'private key assignment',
      });
    }
    if (WIF.test(line)) {
      findings.push({ where: `line ${index + 1}`, rule: 'WIF-shaped string' });
    }
  }
  return findings;
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function isTestPath(path: string): boolean {
  return TEST_PATH.test(path) || TEST_FILE.test(path);
}

function textFile(path: string): string | null {
  try {
    if (statSync(path).size > MAX_BYTES) return null;
    const data = readFileSync(path);
    if (data.includes(0)) return null;
    return data.toString('utf8');
  } catch {
    return null;
  }
}

export function scanRepository(cwd = process.cwd()): SecretFinding[] {
  let files: string[];
  try {
    const tracked = git(['ls-files', '-z'], cwd).split('\0').filter(Boolean);
    const untracked = git(['ls-files', '-o', '--exclude-standard', '-z'], cwd)
      .split('\0')
      .filter(Boolean);
    files = [...new Set([...tracked, ...untracked])];
  } catch {
    files = [];
  }

  const findings: SecretFinding[] = [];
  for (const path of files) {
    if (isTestPath(path)) continue;
    const text = textFile(resolve(cwd, path));
    if (text === null) continue;
    for (const finding of findSecretPatterns(text)) {
      findings.push({ where: `${path}:${finding.where}`, rule: finding.rule });
    }
  }

  let log: string;
  try {
    log = git(['log', '--all', '--format=%H%x1f%B%x1e'], cwd);
  } catch {
    return findings;
  }
  for (const entry of log.split('\x1e')) {
    const [hash, body] = entry.trim().split('\x1f');
    if (!hash) continue;
    for (const finding of findSecretPatterns(body ?? '')) {
      findings.push({
        where: `commit ${hash.slice(0, 10)}:${finding.where}`,
        rule: finding.rule,
      });
    }
  }
  return findings;
}

export function report(findings: readonly SecretFinding[]): string {
  if (findings.length === 0) return 'No private-key-shaped strings found.';
  return [
    `Found ${findings.length} private-key-shaped string(s). Remove them; do not print the values:`,
    ...findings.map((finding) => `  ${finding.where}  [${finding.rule}]`),
  ].join('\n');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const findings = scanRepository();
  console.log(report(findings));
  process.exitCode = findings.length === 0 ? 0 : 1;
}
