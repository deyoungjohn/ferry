#!/usr/bin/env node
// Fails when private working material is mentioned anywhere in the repository:
// files (tracked and untracked), commit messages and authors, and PR text.
//
// Usage:
//   node scripts/guard/private-refs.mjs --tree                 scan files
//   node scripts/guard/private-refs.mjs --history [range]      scan commit messages and authors
//   node scripts/guard/private-refs.mjs --text < message       scan text from stdin (PR title and body)
//
// This file and its test hold the patterns themselves, so they are the only
// files excluded from the tree scan.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PATTERNS = [
  { name: 'private lab repository', re: /ferry-lab/i },
  { name: 'private lab folder', re: /(^|[^A-Za-z0-9_/-])lab\//i },
  { name: 'the lab', re: /\blab\b/i },
  { name: 'internal issue log', re: /friction[-_ ]?log/i },
  { name: 'internal playbook', re: /rebuild[-_ ]?playbook/i },
  { name: 'internal pitfalls file', re: /pitfalls\.md/i },
  { name: 'agent rules file', re: /\bAGENTS\.md\b/i },
  { name: 'agent instructions file', re: /\bCLAUDE\.md\b/i },
  { name: 'plan file', re: /\bHANDOFF\b/ },
  { name: 'prompt files', re: /\bprompts\//i },
  { name: 'agent id', re: /\bagent-[0-9]\b/i },
  { name: 'orchestrator', re: /\borchestrator\b/i },
  { name: 'internal ids', re: /\b(FL-[A-Z0-9]+-[0-9]+|P[123]-[0-9]{2})\b/ },
  { name: 'internal docs', re: /\binternal (docs?|notes?|documents?)\b/i },
  { name: 'local machine path', re: /\/home\/dell\b/ },
  { name: 'personal email', re: /iamtheyoungjohn/i },
];

// Commit-message trailers that belong to the private workflow.
export const TRAILERS = [/^Agent: /m, /^Prompt: /m];

const EXCLUDED_PATHS = [/^scripts\/guard\//, /(^|\/)pnpm-lock\.yaml$/];
const MAX_BYTES = 2_000_000;

export function scanText(text, label) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ where: `${label}:${index + 1}`, rule: name });
      }
    }
  });
  return findings;
}

export function scanMessage(message, label) {
  const findings = scanText(message, label);
  for (const trailer of TRAILERS) {
    if (trailer.test(message)) {
      findings.push({ where: label, rule: 'private workflow trailer' });
    }
  }
  return findings;
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function scanTree(cwd = process.cwd()) {
  const tracked = git(['ls-files', '-z'], cwd).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '-o', '--exclude-standard', '-z'], cwd)
    .split('\0')
    .filter(Boolean);
  const findings = [];
  for (const path of new Set([...tracked, ...untracked])) {
    if (EXCLUDED_PATHS.some((re) => re.test(path))) continue;
    let size;
    try {
      size = statSync(`${cwd}/${path}`).size;
    } catch {
      continue; // deleted in the working tree
    }
    if (size > MAX_BYTES) continue;
    const data = readFileSync(`${cwd}/${path}`);
    if (data.includes(0)) continue; // binary
    findings.push(...scanText(data.toString('utf8'), path));
    for (const { name, re } of PATTERNS) {
      if (re.test(path)) findings.push({ where: path, rule: `${name} (path)` });
    }
  }
  return findings;
}

export function scanHistory(range = '', cwd = process.cwd()) {
  const args = ['log', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e'];
  if (range) args.push(range);
  else args.push('--all');
  let out;
  try {
    out = git(args, cwd);
  } catch {
    return []; // no commits yet
  }
  const findings = [];
  for (const entry of out.split('\x1e')) {
    const [hash, an, ae, cn, ce, body] = entry.trim().split('\x1f');
    if (!hash) continue;
    const label = `commit ${hash.slice(0, 10)}`;
    findings.push(...scanMessage(body ?? '', label));
    findings.push(...scanText([an, ae, cn, ce].join('\n'), `${label} author`));
  }
  return findings;
}

export function report(findings) {
  if (findings.length === 0) return 'No private references found.';
  const lines = findings.map((f) => `  ${f.where}  [${f.rule}]`);
  return [
    `Found ${findings.length} private reference(s). Remove them (commit messages need a new commit or an amended one):`,
    ...lines,
  ].join('\n');
}

function main(argv) {
  const findings = [];
  if (argv.includes('--tree')) findings.push(...scanTree());
  if (argv.includes('--history')) {
    const at = argv.indexOf('--history');
    const next = argv[at + 1];
    findings.push(...scanHistory(next && !next.startsWith('--') ? next : ''));
  }
  if (argv.includes('--text')) {
    findings.push(...scanMessage(readFileSync(0, 'utf8'), 'text'));
  }
  console.log(report(findings));
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
