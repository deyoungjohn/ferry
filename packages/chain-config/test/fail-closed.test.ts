import { describe, expect, it } from 'vitest';
import {
  loadChainData,
  parseChainConfigData,
  routeIneligibilityReasons,
  type NetworkFacts,
  type TokenFacts,
} from '../src/index.js';

const data = parseChainConfigData(loadChainData());
const base = data.chains.base.mainnet;
const baseToken = base.tokens[0]!;

function reasons(
  chain: NetworkFacts = base,
  token: TokenFacts = baseToken,
): string[] {
  return routeIneligibilityReasons(chain, token);
}

describe('fail-closed route facts', () => {
  it('accepts a route whose address, decimals, domain, permit and finality are verified', () => {
    expect(reasons()).toEqual([]);
  });

  it('rejects an unverified token address', () => {
    const token = structuredClone(baseToken);
    token.verification.address.status = 'reported';
    expect(reasons(base, token)).toContain('token address is reported');
  });

  it('rejects a missing token address', () => {
    const token = structuredClone(baseToken);
    token.address = null;
    expect(reasons(base, token)).toContain('token address is missing');
  });

  it('rejects unverified decimals', () => {
    const token = structuredClone(baseToken);
    token.verification.decimals.status = 'unavailable';
    expect(reasons(base, token)).toContain('token decimals are unavailable');
  });

  it('rejects missing decimals', () => {
    const token = structuredClone(baseToken);
    token.decimals = null;
    expect(reasons(base, token)).toContain('token decimals are missing');
  });

  it('rejects an unverified EIP-712 domain', () => {
    const token = structuredClone(baseToken);
    token.verification.eip712.status = 'reported';
    expect(reasons(base, token)).toContain('EIP-712 domain is reported');
  });

  it('rejects an unverified permit fact', () => {
    const token = structuredClone(baseToken);
    token.verification.permit.status = 'reported';
    expect(reasons(base, token)).toContain('permit support is reported');
  });

  it('rejects a permit token with an incomplete domain', () => {
    const token = structuredClone(baseToken);
    token.version = null;
    token.domainSeparator = null;
    expect(reasons(base, token)).toEqual(
      expect.arrayContaining([
        'EIP-712 version is missing',
        'EIP-712 domain separator is missing',
      ]),
    );
  });

  it('rejects a permit token without nonces', () => {
    const token = structuredClone(baseToken);
    token.nonces = false;
    expect(reasons(base, token)).toContain('EIP-2612 nonces are unavailable');
  });

  it('rejects an unverified finality policy', () => {
    const chain = structuredClone(base);
    chain.finality.evidence.status = 'reported';
    expect(reasons(chain)).toContain('finality policy is reported');
  });

  it('rejects a finality policy whose chosen block tag is unavailable', () => {
    const chain = structuredClone(base);
    chain.finality.safeTagWorks = false;
    expect(reasons(chain)).toContain('the safe block tag is unavailable');
  });

  it('rejects fewer than two verified RPC URLs', () => {
    const chain = structuredClone(base);
    chain.rpcUrls[1]!.evidence.status = 'reported';
    expect(reasons(chain)).toContain(
      'fewer than two verified RPC URLs (1 of 2)',
    );
  });

  it('accepts a no-permit token whose domain is verified as absent', () => {
    const token = data.chains.ethereum.mainnet.tokens.find(
      (item) => item.symbol === 'USDT',
    );
    expect(token).toBeDefined();
    expect(
      routeIneligibilityReasons(data.chains.ethereum.mainnet, token!),
    ).toEqual([]);
  });
});
