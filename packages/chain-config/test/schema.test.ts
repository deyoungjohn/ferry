import { describe, expect, it } from 'vitest';
import {
  ChainConfigDataError,
  loadChainData,
  parseChainConfigData,
  type ChainConfigData,
} from '../src/index.js';

function validData(): ChainConfigData {
  return parseChainConfigData(loadChainData());
}

function issues(mutate: (data: ChainConfigData) => void): string[] {
  const data = structuredClone(validData());
  mutate(data);
  try {
    parseChainConfigData(data);
    return [];
  } catch (error) {
    if (error instanceof ChainConfigDataError) return error.issues;
    throw error;
  }
}

describe('chainConfigDataSchema', () => {
  it('parses the committed facts file', () => {
    expect(validData().generatedAt).toBe('2026-11-16');
  });

  it('requires every chain', () => {
    const data = structuredClone(validData()) as unknown as Record<
      string,
      unknown
    >;
    const chains = data.chains as Record<string, unknown>;
    delete chains.robinhood;
    expect(() => parseChainConfigData(data)).toThrow(ChainConfigDataError);
  });

  it('requires at least two RPC URLs per network', () => {
    expect(
      issues((data) => {
        data.chains.base.mainnet.rpcUrls.pop();
        data.chains.base.mainnet.rpcUrls.pop();
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('rpcUrls')]));
  });

  it('rejects a malformed token address', () => {
    expect(
      issues((data) => {
        data.chains.base.mainnet.tokens[0]!.address = '0x1234';
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('20-byte hex address')]),
    );
  });

  it('rejects an unknown fact status', () => {
    expect(
      issues((data) => {
        (
          data.chains.base.mainnet.tokens[0]!.verification.address as {
            status: string;
          }
        ).status = 'assumed';
      }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('Invalid option')]),
    );
  });

  it('rejects a malformed evidence date', () => {
    expect(
      issues((data) => {
        data.chains.base.mainnet.finality.evidence.date = '15-11-2026';
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('ISO date')]));
  });
});
