import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceConditions = [
  'ferry-source',
  'module',
  'browser',
  'development|production',
];

const isVitest = Boolean(process.env.VITEST);
const isMockBundled = process.env.VITE_MOCK === '1';

const mockAliases =
  !isVitest && !isMockBundled
    ? [
        {
          find: /^(.*\/)?mock-fetch(\.[a-z]+)?$/,
          replacement: path.resolve(__dirname, 'src/lib/solver/real.ts'),
        },
        {
          find: /^(.*\/)?pricing\/mock(\.[a-z]+)?$/,
          replacement: path.resolve(__dirname, 'src/lib/pricing/real.ts'),
        },
        {
          find: /^(.*\/)?activity\/mock(\.[a-z]+)?$/,
          replacement: path.resolve(__dirname, 'src/lib/activity/empty.ts'),
        },
        {
          find: /^(.*\/)?wallet\/mock(\.[a-z]+)?$/,
          replacement: path.resolve(
            __dirname,
            'src/lib/wallet/real-wallet-shim.tsx',
          ),
        },
        {
          find: /^(.*\/)?solver\/mock(\.[a-z]+)?$/,
          replacement: path.resolve(__dirname, 'src/lib/solver/real.ts'),
        },
        {
          find: /^\.\/mock$/,
          replacement: path.resolve(
            __dirname,
            'src/lib/wallet/real-wallet-shim.tsx',
          ),
        },
      ]
    : [];

export function resolveViteBase(env: {
  VITE_ROUTER?: string;
  VITE_BASE_PATH?: string;
}): string {
  // Relative base for IPFS hash router builds: base: './'
  if (env.VITE_ROUTER === 'hash') {
    return './';
  }
  const raw = env.VITE_BASE_PATH?.trim();
  if (!raw || raw === '/') {
    return '/';
  }
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig({
  base: resolveViteBase(process.env), // base: './'
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: sourceConditions,
    alias: mockAliases,
  },
  ssr: {
    resolve: {
      conditions: sourceConditions,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30_000,
    css: true,
    env: {
      VITE_NETWORK: 'testnet',
    },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
