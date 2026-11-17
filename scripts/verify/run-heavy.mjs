// Usage: node scripts/verify/run-heavy.mjs [runs]
// Runs every fast-check property test of @ferry/core at a high run count, one
// file at a time, and prints a summary. A failing property prints its seed in
// the test output: keep it, then replay with the same seed to debug.
// For long runs use: nohup node scripts/verify/run-heavy.mjs > log &
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runs = process.argv[2] ?? '5000';
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = ['timing', 'pricing', 'send-link', 'terms'];
const summary = [];

for (const name of files) {
  const started = Date.now();
  const result = spawnSync(
    `${root}node_modules/.bin/vitest`,
    ['run', '--project', 'core', `test/${name}.test.ts`],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, FERRY_FC_RUNS: runs },
    },
  );
  summary.push({
    file: name,
    runs,
    passed: result.status === 0,
    seconds: Math.round((Date.now() - started) / 1000),
  });
}

console.table(summary);
process.exit(summary.every((row) => row.passed) ? 0 : 1);
