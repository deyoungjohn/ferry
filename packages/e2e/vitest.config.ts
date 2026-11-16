import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    conditions: ['ferry-source'],
    alias: {
      '@ferry/solver': fileURLToPath(
        new URL('../solver/src/index.ts', import.meta.url),
      ),
    },
  },
  ssr: {
    resolve: {
      conditions: ['ferry-source', 'node', 'module', 'development'],
    },
  },
  test: {
    name: 'e2e',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
