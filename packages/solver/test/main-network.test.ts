import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The production entry point builds the Bitcoin Cash quorum client itself, and a client
// built without a network verifies against the chipnet genesis hash, so every mainnet
// server is rejected and the solver exits at start. Keep the network wired through.
describe('solver entry point', () => {
  it('builds the quorum client for the configured network', () => {
    const main = readFileSync(
      new URL('../src/main.ts', import.meta.url),
      'utf8',
    );
    expect(main).toMatch(/new BchQuorumClient\(electrumUrls, \{/);
    expect(main).toMatch(
      /network: config\.network === 'mainnet' \? 'mainnet' : 'chipnet'/,
    );
  });
});
