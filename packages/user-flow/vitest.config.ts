import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['ferry-source'] },
  ssr: {
    resolve: { conditions: ['ferry-source', 'node', 'module', 'development'] },
  },
  test: {
    name: 'user-flow',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],

      thresholds: {
        lines: 90,
      },
    },
  },
});
