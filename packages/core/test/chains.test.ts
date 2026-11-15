import { describe, expect, it } from 'vitest';
import {
  EvmChainConfigSchema,
  parseEvmChainConfig,
  validateEvmChainConfig,
} from '../src/index.js';

describe('EvmChainConfig validator', () => {
  const validBaseConfig = {
    id: 'base' as const,
    chainId: 8453,
    rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    explorerUrl: 'https://basescan.org',
    htlcAddress: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    nativeGas: 'ETH' as const,
    finality: { fast: 10, safe: 'safe' as const },
    assets: [
      {
        symbol: 'USDC' as const,
        decimals: 6,
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        permit: true,
      },
    ],
    relayCostUsd: 0.05,
  };

  it('accepts a valid EvmChainConfig and normalizes addresses', () => {
    const parsed = parseEvmChainConfig(validBaseConfig);
    expect(parsed.id).toBe('base');
    expect(parsed.htlcAddress).toBe(validBaseConfig.htlcAddress.toLowerCase());
    expect(parsed.assets[0]?.address).toBe(
      validBaseConfig.assets[0]!.address.toLowerCase(),
    );
    expect(validateEvmChainConfig(validBaseConfig).ok).toBe(true);
  });

  it('fails closed when token address or assets are missing or zero-address', () => {
    expect(() =>
      parseEvmChainConfig({ ...validBaseConfig, assets: [] }),
    ).toThrow();
    expect(() =>
      parseEvmChainConfig({
        ...validBaseConfig,
        assets: [{ symbol: 'USDC', decimals: 6, address: '', permit: true }],
      }),
    ).toThrow();
    expect(() =>
      parseEvmChainConfig({
        ...validBaseConfig,
        assets: [
          {
            symbol: 'USDC',
            decimals: 6,
            address: '0x0000000000000000000000000000000000000000',
            permit: true,
          },
        ],
      }),
    ).toThrow();
    const res = validateEvmChainConfig({
      ...validBaseConfig,
      htlcAddress: '0x0000000000000000000000000000000000000000',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects unknown extra fields (strict schema)', () => {
    expect(() =>
      EvmChainConfigSchema.parse({ ...validBaseConfig, unknown: true }),
    ).toThrow();
  });
});
