import { describe, expect, it } from 'vitest';
import { runPreflightCheck, PreflightError } from '../src/ops/self-check.js';
import { loadConfigFromEnv } from '../src/config.js';

describe('Preflight Self-Check (blueprint §5.1, §11.3)', () => {
  it('passes on default testnet config', () => {
    const config = loadConfigFromEnv({ ALLOW_DEV_KEYS: '1' });
    expect(() => runPreflightCheck(config)).not.toThrow();
  });

  it('refuses mainnet if fewer than 2 distinct Electrum hosts provided', () => {
    const config = loadConfigFromEnv({ ALLOW_DEV_KEYS: '1' });
    config.network = 'mainnet';
    config.operatorToken = 'a'.repeat(32);
    config.solverEvmPrivateKey = '0x' + '22'.repeat(32);
    config.solverBchWif = 'L1testWifKey111111111111111111111111111111111111';
    config.allowMockPaylinkSignatures = false;
    config.baseHtlcAddress = '0x1234567890123456789012345678901234567890';

    // Single host
    config.bchElectrumUrls = 'wss://electrum1.bch.org';
    expect(() => runPreflightCheck(config)).toThrow(PreflightError);
    expect(() => runPreflightCheck(config)).toThrow(/at least 2 distinct/);

    // Duplicate hosts
    config.bchElectrumUrls = 'wss://electrum1.bch.org,wss://electrum1.bch.org';
    expect(() => runPreflightCheck(config)).toThrow(PreflightError);
    expect(() => runPreflightCheck(config)).toThrow(/at least 2 distinct/);

    // Distinct hosts pass
    config.bchElectrumUrls = 'wss://electrum1.bch.org,wss://electrum2.bch.org';
    expect(() => runPreflightCheck(config)).not.toThrow();
  });

  it('refuses mainnet if OPERATOR_TOKEN is shorter than 32 characters', () => {
    const config = loadConfigFromEnv({ ALLOW_DEV_KEYS: '1' });
    config.network = 'mainnet';
    config.bchElectrumUrls = 'wss://electrum1.bch.org,wss://electrum2.bch.org';
    config.solverEvmPrivateKey = '0x' + '22'.repeat(32);
    config.solverBchWif = 'L1testWifKey111111111111111111111111111111111111';
    config.allowMockPaylinkSignatures = false;
    config.baseHtlcAddress = '0x1234567890123456789012345678901234567890';

    config.operatorToken = 'short-token-123';
    expect(() => runPreflightCheck(config)).toThrow(PreflightError);
    expect(() => runPreflightCheck(config)).toThrow(/at least 32 characters/);

    config.operatorToken = 'a'.repeat(32);
    expect(() => runPreflightCheck(config)).not.toThrow();
  });

  it('refuses mainnet if known placeholder/development keys are used', () => {
    const config = loadConfigFromEnv({ ALLOW_DEV_KEYS: '1' });
    config.network = 'mainnet';
    config.bchElectrumUrls = 'wss://electrum1.bch.org,wss://electrum2.bch.org';
    config.operatorToken = 'a'.repeat(32);
    config.solverBchWif = 'L1testWifKey111111111111111111111111111111111111';
    config.allowMockPaylinkSignatures = false;
    config.baseHtlcAddress = '0x1234567890123456789012345678901234567890';

    // Anvil key 0
    config.solverEvmPrivateKey =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    expect(() => runPreflightCheck(config)).toThrow(PreflightError);
    expect(() => runPreflightCheck(config)).toThrow(/placeholder/);
  });

  it('refuses mainnet if ALLOW_MOCK_PAYLINK_SIGNATURES is enabled', () => {
    const config = loadConfigFromEnv({ ALLOW_DEV_KEYS: '1' });
    config.network = 'mainnet';
    config.bchElectrumUrls = 'wss://electrum1.bch.org,wss://electrum2.bch.org';
    config.operatorToken = 'a'.repeat(32);
    config.solverEvmPrivateKey = '0x' + '22'.repeat(32);
    config.solverBchWif = 'L1testWifKey111111111111111111111111111111111111';
    config.baseHtlcAddress = '0x1234567890123456789012345678901234567890';

    config.allowMockPaylinkSignatures = true;
    expect(() => runPreflightCheck(config)).toThrow(PreflightError);
    expect(() => runPreflightCheck(config)).toThrow(
      /ALLOW_MOCK_PAYLINK_SIGNATURES/,
    );
  });
});
