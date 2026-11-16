import { describe, expect, it } from 'vitest';
import {
  HARD_MAINNET_CAP_USD,
  MAINNET_CONFIRM_PHRASE,
  ProbeSafetyError,
  assertProbeSafety,
  loadProbeKeys,
  parseProbeCliArgs,
} from '../src/index.js';

describe('@ferry/probe safety rails', () => {
  it('defaults to testnet and dry-run with a $1 cap', () => {
    const opts = parseProbeCliArgs([]);
    expect(opts.network).toBe('testnet');
    expect(opts.execute).toBe(false);
    expect(opts.direction).toBe('EVM_TO_BCH');
    expect(opts.mode).toBe('swap');
    expect(opts.amountUsd).toBe(1);
    expect(opts.maxUsd).toBe(1);
    expect(() => assertProbeSafety(opts, {})).not.toThrow();
  });

  it('refuses --network mainnet without the exact PROBE_MAINNET_CONFIRM phrase', () => {
    const opts = parseProbeCliArgs(['--network', 'mainnet']);
    expect(() => assertProbeSafety(opts, {})).toThrowError(ProbeSafetyError);
    expect(() => assertProbeSafety(opts, {})).toThrowError(
      /PROBE_MAINNET_CONFIRM/,
    );
    expect(() =>
      assertProbeSafety(opts, { PROBE_MAINNET_CONFIRM: 'yes' }),
    ).toThrowError(ProbeSafetyError);
  });

  it('refuses --network mainnet when amountUsd exceeds maxUsd or hard cap', () => {
    const env = { PROBE_MAINNET_CONFIRM: MAINNET_CONFIRM_PHRASE };

    const overDefaultCap = parseProbeCliArgs([
      '--network',
      'mainnet',
      '--amount-usd',
      '2',
    ]);
    expect(() => assertProbeSafety(overDefaultCap, env)).toThrowError(
      ProbeSafetyError,
    );

    const overHardMax = parseProbeCliArgs([
      '--network',
      'mainnet',
      '--max-usd',
      String(HARD_MAINNET_CAP_USD + 1),
      '--amount-usd',
      '1',
    ]);
    expect(() => assertProbeSafety(overHardMax, env)).toThrowError(/hard cap/i);

    const validMainnet = parseProbeCliArgs([
      '--network',
      'mainnet',
      '--max-usd',
      '5',
      '--amount-usd',
      '5',
    ]);
    expect(() => assertProbeSafety(validMainnet, env)).not.toThrow();
  });

  it('rejects invalid CLI flags and non-positive amounts', () => {
    expect(() => parseProbeCliArgs(['--network', 'devnet'])).toThrowError(
      ProbeSafetyError,
    );
    expect(() => parseProbeCliArgs(['--direction', 'BCH_TO_BCH'])).toThrowError(
      ProbeSafetyError,
    );
    expect(() => parseProbeCliArgs(['--mode', 'cancel'])).toThrowError(
      ProbeSafetyError,
    );
    expect(() => parseProbeCliArgs(['--token', 'USDT'])).toThrowError(
      ProbeSafetyError,
    );
    expect(() => parseProbeCliArgs(['--amount-usd', '0'])).toThrowError(
      ProbeSafetyError,
    );
    expect(() => parseProbeCliArgs(['--unknown'])).toThrowError(
      ProbeSafetyError,
    );
  });

  it('loads env keys when executing and refuses missing keys', () => {
    expect(() =>
      loadProbeKeys({}, { network: 'testnet', requireEnvKeys: true }),
    ).toThrowError(ProbeSafetyError);

    const dryKeys = loadProbeKeys(
      {},
      { network: 'testnet', requireEnvKeys: false },
    );
    expect(dryKeys.source).toBe('dry-run-ephemeral');
    expect(dryKeys.evmAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(dryKeys.bchLockingBytecode).toMatch(/^0x76a914[0-9a-f]{40}88ac$/);

    const envKeys = loadProbeKeys(
      {
        PROBE_EVM_PRIVATE_KEY:
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        PROBE_BCH_PRIVATE_KEY:
          '2222222222222222222222222222222222222222222222222222222222222222',
      },
      { network: 'testnet', requireEnvKeys: true },
    );
    expect(envKeys.source).toBe('env');
    expect(envKeys.bchCashAddress).toMatch(/^bchtest:/);
  });
});
