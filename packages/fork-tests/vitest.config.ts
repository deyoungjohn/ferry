import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['ferry-source', 'module', 'browser', 'development|production'],
  },
  ssr: {
    resolve: {
      conditions: ['ferry-source', 'node', 'module', 'development'],
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    sequence: { groupOrder: 99 },
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
