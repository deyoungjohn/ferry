import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runUrlCheck } from './url-check.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  if (urlIndex !== -1) {
    const rawUrl = args[urlIndex + 1];
    if (rawUrl === undefined || rawUrl.startsWith('-')) {
      console.error('preflight --url needs an http(s) URL');
      process.exitCode = 1;
      return;
    }
    if (args.length !== urlIndex + 2) {
      console.error('preflight --url takes only one URL');
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runUrlCheck(rawUrl);
    return;
  }

  const root = fileURLToPath(new URL('../..', import.meta.url));
  const result = spawnSync(
    'pnpm',
    ['--dir', root, '--filter', '@ferry/chain-config', 'preflight', ...args],
    { stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
