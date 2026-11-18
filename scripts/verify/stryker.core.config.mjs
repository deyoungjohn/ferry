// Mutation testing for the pure modules of @ferry/core.
// Pick one module per run: MUTATION_MODULE=timing|pricing|liquidity.
// Reports go to the system temp folder. The sandbox must sit at the same depth as the package (relative tsconfig paths); the runner deletes it afterwards.
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
  tempDirName: `../../scripts/verify/.stryker-tmp-${moduleName}`,
  thresholds: { high: 90, low: 80, break: null },
  timeoutMS: 20000,
  concurrency: 4,
};
