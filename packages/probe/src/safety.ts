import {
  binToHex,
  decodePrivateKeyWif,
  encodeCashAddress,
  hash160,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import type { Direction, Hex, Hex32 } from '@ferry/core';
import { privateKeyToAccount } from 'viem/accounts';

export const MAINNET_CONFIRM_PHRASE = 'I approve this mainnet probe';
export const DEFAULT_MAINNET_MAX_USD = 1;
export const HARD_MAINNET_CAP_USD = 5;

export type ProbeNetwork = 'testnet' | 'mainnet';
export type ProbeMode = 'swap' | 'refund';

export type ProbeSafetyErrorCode =
  | 'MAINNET_CONFIRM_REQUIRED'
  | 'MAINNET_CAP_EXCEEDED'
  | 'INVALID_NETWORK'
  | 'INVALID_DIRECTION'
  | 'INVALID_MODE'
  | 'INVALID_TOKEN'
  | 'INVALID_AMOUNT'
  | 'MISSING_ENV_KEY';

export class ProbeSafetyError extends Error {
  readonly code: ProbeSafetyErrorCode;

  constructor(code: ProbeSafetyErrorCode, message: string) {
    super(message);
    this.name = 'ProbeSafetyError';
    this.code = code;
  }
}

export interface ProbeOptions {
  readonly network: ProbeNetwork;
  readonly execute: boolean;
  readonly direction: Direction;
  readonly mode: ProbeMode;
  readonly token: 'PUSD' | 'MUSD';
  readonly chainId: number;
  readonly amountUsd: number;
  readonly maxUsd: number;
  readonly solverUrl: string;
  readonly recoveryDir: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly bchFeeRateSatPerByte: number;
}

export interface ProbeKeys {
  readonly evmPrivateKey: Hex32;
  readonly evmAddress: Hex;
  readonly bchPrivateKey: Uint8Array;
  readonly bchLockingBytecode: Hex;
  readonly bchCashAddress: string;
  readonly source: 'env' | 'dry-run-ephemeral';
}

// Deterministic non-funded placeholder keys used ONLY in dry-run mode when env keys are absent.
const DRY_RUN_EVM_KEY: Hex32 =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DRY_RUN_BCH_KEY = hexToBin(
  '1111111111111111111111111111111111111111111111111111111111111111',
);

function parseNumberFlag(
  raw: string,
  flagName: string,
  code: ProbeSafetyErrorCode,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ProbeSafetyError(
      code,
      `${flagName} must be a positive finite number`,
    );
  }
  return value;
}

export function parseProbeCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProbeOptions {
  let network: ProbeNetwork = 'testnet';
  let execute = false;
  let direction: Direction = 'EVM_TO_BCH';
  let mode: ProbeMode = 'swap';
  let token: 'PUSD' | 'MUSD' = 'PUSD';
  let chainId: number | undefined;
  let amountUsd = DEFAULT_MAINNET_MAX_USD;
  let maxUsd = DEFAULT_MAINNET_MAX_USD;
  let solverUrl = env.PROBE_SOLVER_URL ?? 'http://127.0.0.1:8787';
  let recoveryDir = env.PROBE_RECOVERY_DIR ?? '.probe-recovery';
  let pollIntervalMs = 2000;
  let timeoutMs = 120_000;
  let bchFeeRateSatPerByte = 1.2;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ProbeSafetyError(
          'INVALID_AMOUNT',
          `Missing value for ${arg}`,
        );
      }
      i += 1;
      return value;
    };

    if (arg === '--execute') {
      execute = true;
    } else if (arg === '--dry-run') {
      execute = false;
    } else if (arg === '--network') {
      const val = next();
      if (val !== 'testnet' && val !== 'mainnet') {
        throw new ProbeSafetyError(
          'INVALID_NETWORK',
          `Unsupported network "${val}" (expected testnet or mainnet)`,
        );
      }
      network = val;
    } else if (arg === '--direction') {
      const val = next();
      if (val !== 'EVM_TO_BCH' && val !== 'BCH_TO_EVM') {
        throw new ProbeSafetyError(
          'INVALID_DIRECTION',
          `Unsupported direction "${val}" (expected EVM_TO_BCH or BCH_TO_EVM)`,
        );
      }
      direction = val;
    } else if (arg === '--mode') {
      const val = next();
      if (val !== 'swap' && val !== 'refund') {
        throw new ProbeSafetyError(
          'INVALID_MODE',
          `Unsupported mode "${val}" (expected swap or refund)`,
        );
      }
      mode = val;
    } else if (arg === '--token') {
      const val = next().toUpperCase();
      if (val !== 'PUSD' && val !== 'MUSD') {
        throw new ProbeSafetyError(
          'INVALID_TOKEN',
          `Unsupported token "${val}" (expected PUSD or MUSD)`,
        );
      }
      token = val;
    } else if (arg === '--chain-id') {
      chainId = parseNumberFlag(next(), '--chain-id', 'INVALID_NETWORK');
    } else if (arg === '--amount-usd') {
      amountUsd = parseNumberFlag(next(), '--amount-usd', 'INVALID_AMOUNT');
    } else if (arg === '--max-usd') {
      maxUsd = parseNumberFlag(next(), '--max-usd', 'MAINNET_CAP_EXCEEDED');
    } else if (arg === '--solver-url') {
      solverUrl = next();
    } else if (arg === '--recovery-dir') {
      recoveryDir = next();
    } else if (arg === '--poll-ms') {
      pollIntervalMs = parseNumberFlag(next(), '--poll-ms', 'INVALID_AMOUNT');
    } else if (arg === '--timeout-ms') {
      timeoutMs = parseNumberFlag(next(), '--timeout-ms', 'INVALID_AMOUNT');
    } else if (arg === '--bch-fee-rate') {
      bchFeeRateSatPerByte = parseNumberFlag(
        next(),
        '--bch-fee-rate',
        'INVALID_AMOUNT',
      );
    } else {
      throw new ProbeSafetyError('INVALID_MODE', `Unknown option "${arg}"`);
    }
  }

  return {
    network,
    execute,
    direction,
    mode,
    token,
    chainId: chainId ?? (network === 'mainnet' ? 8453 : 84532),
    amountUsd,
    maxUsd,
    solverUrl,
    recoveryDir,
    pollIntervalMs,
    timeoutMs,
    bchFeeRateSatPerByte,
  };
}

export function assertProbeSafety(
  options: ProbeOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!Number.isFinite(options.amountUsd) || options.amountUsd <= 0) {
    throw new ProbeSafetyError(
      'INVALID_AMOUNT',
      'amountUsd must be a positive finite number',
    );
  }
  if (!Number.isFinite(options.maxUsd) || options.maxUsd <= 0) {
    throw new ProbeSafetyError(
      'MAINNET_CAP_EXCEEDED',
      'maxUsd must be a positive finite number',
    );
  }

  if (options.network === 'mainnet') {
    if (env.PROBE_MAINNET_CONFIRM !== MAINNET_CONFIRM_PHRASE) {
      throw new ProbeSafetyError(
        'MAINNET_CONFIRM_REQUIRED',
        `Mainnet probe refused: set PROBE_MAINNET_CONFIRM="${MAINNET_CONFIRM_PHRASE}"`,
      );
    }
    if (options.maxUsd > HARD_MAINNET_CAP_USD) {
      throw new ProbeSafetyError(
        'MAINNET_CAP_EXCEEDED',
        `Mainnet probe refused: maxUsd (${options.maxUsd}) exceeds hard cap of $${HARD_MAINNET_CAP_USD}`,
      );
    }
    if (options.amountUsd > options.maxUsd) {
      throw new ProbeSafetyError(
        'MAINNET_CAP_EXCEEDED',
        `Mainnet probe refused: amountUsd (${options.amountUsd}) exceeds cap of $${options.maxUsd}`,
      );
    }
    if (options.amountUsd > HARD_MAINNET_CAP_USD) {
      throw new ProbeSafetyError(
        'MAINNET_CAP_EXCEEDED',
        `Mainnet probe refused: amountUsd (${options.amountUsd}) exceeds hard cap of $${HARD_MAINNET_CAP_USD}`,
      );
    }
  }
}

function deriveBchP2pkh(
  privateKey: Uint8Array,
  network: ProbeNetwork,
): { lockingBytecode: Hex; cashAddress: string } {
  const pubkey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pubkey === 'string') {
    throw new ProbeSafetyError(
      'MISSING_ENV_KEY',
      'Invalid BCH private key: failed to derive public key',
    );
  }
  const pubKeyHash = hash160(pubkey);
  const locking = new Uint8Array(25);
  locking[0] = 0x76;
  locking[1] = 0xa9;
  locking[2] = 0x14;
  locking.set(pubKeyHash, 3);
  locking[23] = 0x88;
  locking[24] = 0xac;

  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  const encoded = encodeCashAddress({
    prefix,
    type: 'p2pkh',
    payload: pubKeyHash,
  });
  if (typeof encoded === 'string') {
    throw new ProbeSafetyError(
      'MISSING_ENV_KEY',
      'Failed to encode BCH CashAddress',
    );
  }

  return {
    lockingBytecode: `0x${binToHex(locking)}` as Hex,
    cashAddress: encoded.address,
  };
}

function parseBchPrivateKeyFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): Uint8Array | undefined {
  const wif = env.PROBE_BCH_WIF?.trim();
  if (wif) {
    const decoded = decodePrivateKeyWif(wif);
    if (typeof decoded === 'string') {
      throw new ProbeSafetyError(
        'MISSING_ENV_KEY',
        'PROBE_BCH_WIF is not a valid WIF private key',
      );
    }
    return decoded.privateKey;
  }

  const hex = env.PROBE_BCH_PRIVATE_KEY?.trim();
  if (hex) {
    const clean = hex.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
      throw new ProbeSafetyError(
        'MISSING_ENV_KEY',
        'PROBE_BCH_PRIVATE_KEY must be a 32-byte hex string',
      );
    }
    return hexToBin(clean);
  }

  return undefined;
}

export function loadProbeKeys(
  env: Readonly<Record<string, string | undefined>>,
  options: {
    readonly network: ProbeNetwork;
    readonly requireEnvKeys: boolean;
  },
): ProbeKeys {
  const rawEvmKey = env.PROBE_EVM_PRIVATE_KEY?.trim();
  const parsedBchKey = parseBchPrivateKeyFromEnv(env);

  if (options.requireEnvKeys && (!rawEvmKey || !parsedBchKey)) {
    throw new ProbeSafetyError(
      'MISSING_ENV_KEY',
      'Live probe requires PROBE_EVM_PRIVATE_KEY and (PROBE_BCH_WIF or PROBE_BCH_PRIVATE_KEY)',
    );
  }

  const evmPrivateKey: Hex32 = rawEvmKey
    ? ((rawEvmKey.startsWith('0x') ? rawEvmKey : `0x${rawEvmKey}`) as Hex32)
    : DRY_RUN_EVM_KEY;

  if (!/^0x[0-9a-fA-F]{64}$/.test(evmPrivateKey)) {
    throw new ProbeSafetyError(
      'MISSING_ENV_KEY',
      'PROBE_EVM_PRIVATE_KEY must be a 32-byte hex string',
    );
  }

  const evmAccount = privateKeyToAccount(evmPrivateKey);
  const bchPrivateKey = parsedBchKey ?? DRY_RUN_BCH_KEY;
  const bch = deriveBchP2pkh(bchPrivateKey, options.network);

  return {
    evmPrivateKey,
    evmAddress: evmAccount.address.toLowerCase() as Hex,
    bchPrivateKey,
    bchLockingBytecode: bch.lockingBytecode,
    bchCashAddress: bch.cashAddress,
    source: rawEvmKey && parsedBchKey ? 'env' : 'dry-run-ephemeral',
  };
}
