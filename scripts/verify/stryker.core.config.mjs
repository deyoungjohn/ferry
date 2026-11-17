// Mutation testing for the pure modules of @ferry/core.
// Pick one module per run: MUTATION_MODULE=timing|pricing|liquidity.
// Reports and sandboxes go to the system temp folder (ferry-mutation) so the repository stays clean.
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const moduleName = process.env.MUTATION_MODULE ?? 'timing';
const allowed = ['timing', 'pricing', 'liquidity'];
if (!allowed.includes(moduleName)) {
  throw new Error(`MUTATION_MODULE must be one of ${allowed.join(', ')}`);
}

export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts', related: true },
  mutate: [`src/${moduleName}.ts`],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'json'],
  jsonReporter: {
    fileName: relative(
      process.cwd(),
      join(tmpdir(), 'ferry-mutation', `mutation-${moduleName}.json`),
    ),
  },
  tempDirName: relative(
    process.cwd(),
    join(tmpdir(), 'ferry-mutation', `sandbox-${moduleName}`),
  ),
  thresholds: { high: 90, low: 80, break: null },
  timeoutMS: 20000,
  concurrency: 4,
};
