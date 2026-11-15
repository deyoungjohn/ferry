import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEV_EVM_PRIVATE_KEY,
  KNOWN_DEV_EVM_KEYS,
  loadConfigFromEnv,
  redactConfigForDisplay,
} from '../src/config.js';

describe('SolverConfig and Config Loader', () => {
  const validTestnetEnv: Record<string, string> = {
    NETWORK: 'testnet',
    BCH_ELECTRUM_URLS:
      'wss://chipnet.imaginary.cash:50004,wss://blackie.c3-soft.com:64004',
    SOLVER_EVM_PRIVATE_KEY: DEFAULT_DEV_EVM_PRIVATE_KEY,
    ALLOW_DEV_KEYS: 'true',
    OPERATOR_TOKEN: 'a'.repeat(32),
  };

  const validMainnetEnv: Record<string, string> = {
    NETWORK: 'mainnet',
    BCH_ELECTRUM_URLS:
      'wss://blackie.c3-soft.com:50004,wss://bch.imaginary.cash:50004',
    SOLVER_EVM_PRIVATE_KEY:
      '0x112233445566778899001122334455667788990011223344556677889900aabb',
    OPERATOR_TOKEN: 'secure_mainnet_operator_token_with_32_chars!',
  };

  it('loads valid configuration on testnet with dev keys', () => {
    const config = loadConfigFromEnv(validTestnetEnv);
    expect(config.network).toBe('testnet');
    expect(config.bchElectrumUrls).toContain('chipnet');
  });

  it('refuses mainnet startup when fewer than two distinct Electrum hosts are configured', () => {
    const env = {
      ...validMainnetEnv,
      BCH_ELECTRUM_URLS: 'wss://blackie.c3-soft.com:50004',
    };
    expect(() => loadConfigFromEnv(env)).toThrow(
      /At least two distinct Electrum hosts are required on mainnet/i,
    );
  });

  it('refuses mainnet startup when two URLs point to the same host', () => {
    const env = {
      ...validMainnetEnv,
      BCH_ELECTRUM_URLS:
        'wss://blackie.c3-soft.com:50004,wss://blackie.c3-soft.com:50004',
    };
    expect(() => loadConfigFromEnv(env)).toThrow(
      /At least two distinct Electrum hosts are required on mainnet/i,
    );
  });

  it('refuses mainnet startup when operator token is missing or shorter than 32 characters', () => {
    const envMissing = {
      ...validMainnetEnv,
      OPERATOR_TOKEN: '',
    };
    expect(() => loadConfigFromEnv(envMissing)).toThrow(
      /operator token.*32 characters/i,
    );

    const envShort = {
      ...validMainnetEnv,
      OPERATOR_TOKEN: 'short_token_only_24_char',
    };
    expect(() => loadConfigFromEnv(envShort)).toThrow(
      /operator token.*32 characters/i,
    );
  });

  it('refuses mainnet startup when a default dev key or placeholder is used', () => {
    for (const devKey of KNOWN_DEV_EVM_KEYS) {
      const env = {
        ...validMainnetEnv,
        SOLVER_EVM_PRIVATE_KEY: devKey,
      };
      expect(() => loadConfigFromEnv(env)).toThrow(
        /default.*key.*refusing to start/i,
      );
    }
  });

  it('refuses mainnet startup when ALLOW_DEV_KEYS is set', () => {
    const env = {
      ...validMainnetEnv,
      ALLOW_DEV_KEYS: 'true',
    };
    expect(() => loadConfigFromEnv(env)).toThrow(
      /ALLOW_DEV_KEYS is not permitted on mainnet/i,
    );
  });

  it('refuses mainnet startup when testnet BCH WIF is provided', () => {
    const env = {
      ...validMainnetEnv,
      SOLVER_BCH_WIF: 'cPJEAQPn5NYgtNy9HXR1q2q6vw4EghTgjscBFFseT4UT9gbpoDY9',
    };
    expect(() => loadConfigFromEnv(env)).toThrow(
      /testnet BCH WIF cannot be used on mainnet/i,
    );
  });

  it('redacts keys and secrets when formatting config for display', () => {
    const config = loadConfigFromEnv(validTestnetEnv);
    const displayed = redactConfigForDisplay(config);
    expect(displayed).not.toContain(DEFAULT_DEV_EVM_PRIVATE_KEY);
    expect(displayed).toContain('[REDACTED]');
    expect(displayed).toContain('testnet');
  });
});
