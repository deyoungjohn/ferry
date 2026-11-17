// Usage: node scripts/verify/run-mutation.mjs <timing|pricing|liquidity>
// One module per run. For long runs use: nohup … > log &
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleName = process.argv[2];
const config = fileURLToPath(
  new URL('./stryker.core.config.mjs', import.meta.url),
);
const result = spawnSync(
  fileURLToPath(new URL('../../node_modules/.bin/stryker', import.meta.url)),
  ['run', config],
  {
    cwd: fileURLToPath(new URL('../../packages/core', import.meta.url)),
    stdio: 'inherit',
    env: { ...process.env, MUTATION_MODULE: moduleName },
  },
);
rmSync(
  fileURLToPath(new URL(`./.stryker-tmp-${moduleName}`, import.meta.url)),
  {
    recursive: true,
    force: true,
  },
);
process.exit(result.status ?? 1);
