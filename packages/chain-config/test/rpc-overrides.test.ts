import { describe, expect, it } from 'vitest';
import {
  RpcOverrideError,
  loadChainConfig,
  parseRpcOverrides,
  probeRpcLogMaxRange,
  redactRpcSecrets,
  redactRpcUrl,
  type RpcCaller,
} from '../src/index.js';

const fakeRpc = 'https://paid.example.com/v1/SECRET_KEY?api_key=TOPSECRET';

function overrideError(
  env: Record<string, string | undefined>,
): RpcOverrideError {
  try {
    parseRpcOverrides(env);
  } catch (error) {
    if (error instanceof RpcOverrideError) return error;
    throw error;
  }
  throw new Error('expected an RpcOverrideError');
}

describe('RPC overrides', () => {
  it('adds the fallbacks RPC_URL_<CHAIN>_1 to _3 after the main endpoint, in order', () => {
    expect(
      parseRpcOverrides({
        RPC_URL_BASE: 'https://main.example.com',
        RPC_URL_BASE_2: 'https://two.example.com',
        RPC_URL_BASE_1: 'https://one.example.com',
        RPC_URL_BASE_3: 'https://three.example.com, https://main.example.com',
        RPC_URL_ARBITRUM_1: 'https://arb-fallback.example.com',
      }),
    ).toEqual({
      base: [
        'https://main.example.com',
        'https://one.example.com',
        'https://two.example.com',
        'https://three.example.com',
      ],
      arbitrum: ['https://arb-fallback.example.com'],
    });
  });

  it('parses a comma-separated list in order', () => {
    expect(
      parseRpcOverrides({
        RPC_URL_BASE: `${fakeRpc}, https://second.example.com`,
      }),
    ).toEqual({
      base: [fakeRpc, 'https://second.example.com'],
    });
  });

  it('ignores empty and unknown variables', () => {
    expect(
      parseRpcOverrides({
        RPC_URL_BASE: '   ',
        RPC_URL_UNKNOWN: fakeRpc,
      }),
    ).toEqual({});
  });

  it('prints only the host name, never the path, query or credentials', () => {
    expect(redactRpcUrl(fakeRpc)).toBe('paid.example.com');
    expect(
      redactRpcUrl(
        'https://user:password@paid.example.com:8545/v1/key?api_key=TOPSECRET',
      ),
    ).toBe('paid.example.com:8545');
  });

  it('redacts a URL inside an error or log message', () => {
    expect(redactRpcSecrets(`request to ${fakeRpc} failed`, [fakeRpc])).toBe(
      'request to paid.example.com failed',
    );
  });

  it('names the variable but never the value in a malformed URL error', () => {
    const error = overrideError({
      RPC_URL_BASE: 'https://[invalid/SECRET_KEY?api_key=TOPSECRET',
    });
    const text = `${error.message}\n${String(error)}`;
    expect(text).toContain('RPC_URL_BASE');
    expect(text).not.toContain('SECRET_KEY');
    expect(text).not.toContain('TOPSECRET');
    expect(text).not.toContain('invalid');
  });

  it('rejects empty list entries without printing the value', () => {
    const error = overrideError({
      RPC_URL_BASE: `${fakeRpc},`,
    });
    expect(error.variable).toBe('RPC_URL_BASE');
    expect(error.message).not.toContain('TOPSECRET');
  });

  it('rejects non-http protocols without printing the value', () => {
    const error = overrideError({
      RPC_URL_BASE: 'ftp://paid.example.com/SECRET_KEY',
    });
    expect(error.variable).toBe('RPC_URL_BASE');
    expect(error.message).not.toContain('paid.example.com');
  });

  it('prepends the override and exposes the measured cap', () => {
    const config = loadChainConfig({
      env: { RPC_URL_BASE: fakeRpc },
      rpcCaps: { [fakeRpc]: 12_345 },
    });
    const base = config.facts.find(
      (chain) => chain.id === 'base' && chain.network === 'mainnet',
    );
    expect(base?.rpcEndpoints[0]).toEqual({
      url: fakeRpc,
      host: 'paid.example.com',
      maxLogRange: 12_345,
      source: 'override',
    });
    expect(base?.rpcUrls[0]).toBe(fakeRpc);
    expect(
      config.coreChains.find((chain) => chain.id === 'base')?.rpcUrls[0],
    ).toBe(fakeRpc);
  });

  it('applies the override only to the selected network', () => {
    const config = loadChainConfig({
      env: { RPC_URL_BASE: fakeRpc },
      network: 'mainnet',
    });
    const mainnet = config.chains.find(
      (chain) => chain.id === 'base' && chain.network === 'mainnet',
    );
    const testnet = config.chains.find(
      (chain) => chain.id === 'base' && chain.network === 'testnet',
    );
    expect(mainnet?.rpcUrls[0]).toBe(fakeRpc);
    expect(testnet?.rpcUrls[0]).not.toBe(fakeRpc);
  });

  it('probes the highest accepted eth_getLogs range', async () => {
    const call: RpcCaller = async <T>(
      _url: string,
      method: string,
      params: unknown[],
    ): Promise<T> => {
      if (method === 'eth_blockNumber') return '0x200000' as T;
      if (method === 'eth_getLogs') {
        const range = params[0] as { fromBlock: string; toBlock: string };
        const size = BigInt(range.toBlock) - BigInt(range.fromBlock) + 1n;
        if (size > 10_000n) throw new Error('range too large');
        return [] as unknown as T;
      }
      throw new Error(`unexpected method ${method}`);
    };
    await expect(
      probeRpcLogMaxRange('https://paid.example.com', call),
    ).resolves.toBe(10_000);
  });

  it('returns zero when the smallest probe is rejected', async () => {
    const call: RpcCaller = async <T>(
      _url: string,
      method: string,
    ): Promise<T> => {
      if (method === 'eth_blockNumber') return '0x200000' as T;
      throw new Error('logs unavailable');
    };
    await expect(
      probeRpcLogMaxRange('https://paid.example.com', call),
    ).resolves.toBe(0);
  });
});
