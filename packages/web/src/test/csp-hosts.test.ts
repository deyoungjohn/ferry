import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import chainsData from '../../../chain-config/src/data/chains.json';

describe('content security policy', () => {
  it('allows every RPC host in the chain facts, so the page can read each chain', () => {
    const caddy = readFileSync(
      resolve(__dirname, '../../../../deploy/Caddyfile'),
      'utf8',
    );
    const connect = /connect-src ([^;]*);/.exec(caddy)?.[1] ?? '';
    const chains = (
      chainsData as unknown as {
        chains: Record<
          string,
          { mainnet: { rpcUrls: Array<{ url: string }> } }
        >;
      }
    ).chains;
    const missing: string[] = [];
    for (const chain of Object.values(chains)) {
      for (const { url } of chain.mainnet.rpcUrls) {
        const origin = new URL(url).origin;
        if (!connect.split(' ').includes(origin)) missing.push(origin);
      }
    }
    expect(missing).toEqual([]);
  });
});
