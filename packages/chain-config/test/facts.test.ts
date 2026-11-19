import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  NETWORKS,
  PREDICTED_FERRY_HTLC_ADDRESS,
  loadChainData,
  parseChainConfigData,
  routeIneligibilityReasons,
} from '../src/index.js';

const data = parseChainConfigData(loadChainData());

describe('chain fact data', () => {
  it('covers all six chains on mainnet and testnet', () => {
    for (const id of CHAIN_IDS) {
      expect(data.chains[id].mainnet.chainId).toBeGreaterThan(0);
      expect(data.chains[id].testnet.chainId).toBeGreaterThan(0);
    }
  });

  it('gives every network two distinct public RPC URLs', () => {
    for (const id of CHAIN_IDS) {
      for (const network of NETWORKS) {
        const urls = data.chains[id][network].rpcUrls.map((rpc) => rpc.url);
        expect(urls.length).toBeGreaterThanOrEqual(2);
        expect(new Set(urls).size).toBe(urls.length);
      }
    }
  });

  it('records verified finality and a CREATE2 factory on every network', () => {
    for (const id of CHAIN_IDS) {
      for (const network of NETWORKS) {
        const facts = data.chains[id][network];
        expect(facts.finality.evidence.status).toBe('verified');
        expect(facts.finality.safeTagWorks).toBe(true);
        expect(facts.finality.finalizedTagWorks).toBe(true);
        expect(facts.create2Factory.hasCode).toBe(true);
      }
    }
  });

  it('never leaves a permit token without a complete EIP-712 domain', () => {
    for (const id of CHAIN_IDS) {
      for (const network of NETWORKS) {
        for (const token of data.chains[id][network].tokens) {
          if (token.permit) {
            expect(token.nonces).toBe(true);
            expect(token.name).not.toBeNull();
            expect(token.version).not.toBeNull();
            expect(token.domainSeparator).not.toBeNull();
            expect(token.verification.eip712.status).toBe('verified');
          } else {
            expect(token.nonces).toBe(false);
            expect(token.version).toBeNull();
            expect(token.domainSeparator).toBeNull();
            expect(token.verification.eip712.status).toBe('verified');
          }
        }
      }
    }
  });

  it('keeps deployment facts null until a reviewed deployment fills them', () => {
    for (const id of CHAIN_IDS) {
      for (const network of NETWORKS) {
        const deployment = data.chains[id][network].deployment;
        // Base was recorded on 2026-11-17 and the other five mainnets on 2026-11-19; testnets stay null.
        const deployed: Record<string, number> = {
          base: 58633459,
          ethereum: 26450983,
          arbitrum: 525697203,
          arc: 32096216,
          bnb: 134553116,
          robinhood: 118437901,
        };
        if (network === 'mainnet') {
          expect(deployment.htlcAddress).toBe(PREDICTED_FERRY_HTLC_ADDRESS);
          expect(deployment.deployBlock).toBe(deployed[id]);
          expect(deployment.evidence.status).toBe('verified');
          continue;
        }
        expect(deployment.htlcAddress).toBeNull();
        expect(deployment.deployBlock).toBeNull();
        expect(deployment.relayCostUsd).toBeNull();
        expect(deployment.evidence.status).toBe('unavailable');
      }
    }
  });

  it('records the expected mainnet price feeds and no testnet feeds', () => {
    const expected: Record<string, string[]> = {
      base: ['USDC'],
      ethereum: ['USDC', 'USDT'],
      arbitrum: ['USDC', 'USDT'],
      arc: ['USDC'],
      bnb: ['USDC', 'USDT'],
      robinhood: ['USDG'],
    };
    for (const id of CHAIN_IDS) {
      const feeds = data.chains[id].mainnet.priceFeeds;
      expect(feeds.map((feed) => feed.asset).sort()).toEqual(
        expected[id]!.sort(),
      );
      for (const feed of feeds) {
        expect(feed.source).toBe('Chainlink');
        expect(feed.decimals).toBe(8);
        expect(feed.heartbeatSeconds).toBeGreaterThan(0);
        expect(feed.deviationThresholdPercent).toBeGreaterThan(0);
        expect(feed.sampleAnswer).toMatch(/^\d+$/);
        expect(feed.sampleUpdatedAt).toBeGreaterThan(0);
        expect(feed.evidence.status).toBe('verified');
      }
      expect(data.chains[id].testnet.priceFeeds).toEqual([]);
    }
  });

  it('keeps the known route set and the deliberate disablement of BNB USDC', () => {
    const routes = new Map(
      CHAIN_IDS.flatMap((id) =>
        data.chains[id].mainnet.tokens.map((token) => [
          `${token.symbol.toLowerCase()}:${id}`,
          routeIneligibilityReasons(data.chains[id].mainnet, token),
        ]),
      ),
    );
    expect([...routes.keys()].sort()).toEqual([
      'usdc:arbitrum',
      'usdc:arc',
      'usdc:base',
      'usdc:bnb',
      'usdc:ethereum',
      'usdg:robinhood',
      'usdt:arbitrum',
      'usdt:bnb',
      'usdt:ethereum',
    ]);
    expect(routes.get('usdc:base')).toEqual([]);
    expect(routes.get('usdt:bnb')).toEqual([]);
    expect(routes.get('usdg:robinhood')).toEqual([]);
    expect(routes.get('usdc:bnb')).toContain('token address is reported');
    expect(routes.has('usdc:robinhood')).toBe(false);
  });
});
