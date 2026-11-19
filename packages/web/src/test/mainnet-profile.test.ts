import { afterEach, describe, expect, it, vi } from 'vitest';

describe('mainnet profile built from the recorded facts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads under the production profile and leaves out tokens whose address is not verified', async () => {
    vi.stubEnv('VITE_NETWORK', 'mainnet');
    vi.stubEnv('VITE_ENABLED_ROUTES', '');
    vi.resetModules();
    const { loadFarChainsFromFacts } = await import('../lib/network');
    const chains = loadFarChainsFromFacts('mainnet');
    expect(chains.length).toBeGreaterThan(0);
    const bnb = chains.find((c) => c.chainKey === 'bnb');
    expect(bnb?.tokenSymbols ?? []).not.toContain('USDC');
  });
});
