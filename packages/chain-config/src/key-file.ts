import {
  decodeWif,
  deriveBchAddressesFromWif,
  deriveEvmAddress,
  isBchMainnetWif,
  isEvmPrivateKey,
  knownTestKeyReason,
  type BchKeyAddresses,
  type GeneratedKeyMaterial,
} from './key-material.js';
import { MINIMUM_TIER } from './floors.js';

export const KEY_ENV_NAMES = {
  deployerEvm: 'DEPLOYER_EVM_PRIVATE_KEY',
  solverEvm: 'SOLVER_EVM_PRIVATE_KEY',
  solverBch: 'SOLVER_BCH_WIF',
} as const;

export const KEY_ADDRESS_NAMES = {
  deployerEvm: 'DEPLOYER_EVM_ADDRESS',
  solverEvm: 'SOLVER_EVM_ADDRESS',
  solverBch: 'SOLVER_BCH_ADDRESS',
  solverBchPlain: 'SOLVER_BCH_PLAIN_ADDRESS',
} as const;

const ADDRESS_COMMENT_NAMES = new Set<string>(Object.values(KEY_ADDRESS_NAMES));

export interface KeyFileAddresses {
  deployerEvm: string;
  solverEvm: string;
  solverBch: BchKeyAddresses;
}

export interface KeyCheck {
  name: string;
  ok: boolean;
  detail: string | null;
}

export interface KeyFileCheckResult {
  ok: boolean;
  checks: KeyCheck[];
  addresses: Partial<KeyFileAddresses>;
  funding: string[];
}

export interface ParsedKeyFile {
  values: Map<string, string>;
  recorded: Map<string, string>;
  duplicates: string[];
}

function parseLineValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseKeyFile(content: string): ParsedKeyFile {
  const values = new Map<string, string>();
  const recorded = new Map<string, string>();
  const duplicates: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      const comment = line.slice(1).trim();
      const separator = comment.indexOf('=');
      if (separator <= 0) continue;
      const name = comment.slice(0, separator).trim();
      if (!ADDRESS_COMMENT_NAMES.has(name)) continue;
      recorded.set(name, parseLineValue(comment.slice(separator + 1)));
      continue;
    }

    const assignment = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;
    const separator = assignment.indexOf('=');
    if (separator <= 0) continue;
    const name = assignment.slice(0, separator).trim();
    const value = parseLineValue(assignment.slice(separator + 1));
    if (values.has(name)) duplicates.push(name);
    values.set(name, value);
  }

  return { values, recorded, duplicates };
}

export function buildKeyFile(
  material: GeneratedKeyMaterial,
  generatedAt: Date = new Date(),
): string {
  return [
    '# Ferry mainnet key file. Mode 0600. Never commit.',
    `# Generated ${generatedAt.toISOString()}.`,
    '# Public addresses are recorded here so keys:check can compare them.',
    `# ${KEY_ADDRESS_NAMES.deployerEvm}=${material.addresses.deployerEvm}`,
    `# ${KEY_ADDRESS_NAMES.solverEvm}=${material.addresses.solverEvm}`,
    `# ${KEY_ADDRESS_NAMES.solverBch}=${material.addresses.solverBch.tokenAware}`,
    `# ${KEY_ADDRESS_NAMES.solverBchPlain}=${material.addresses.solverBch.plain}`,
    `${KEY_ENV_NAMES.deployerEvm}=${material.deployerEvmPrivateKey}`,
    `${KEY_ENV_NAMES.solverEvm}=${material.solverEvmPrivateKey}`,
    `${KEY_ENV_NAMES.solverBch}=${material.solverBchWif}`,
    '',
  ].join('\n');
}

function check(
  name: string,
  ok: boolean,
  detail: string | null = null,
): KeyCheck {
  return { name, ok, detail };
}

function recordedAddress(
  parsed: ParsedKeyFile,
  name: string,
): string | undefined {
  return parsed.recorded.get(name);
}

function normalizedKeyHex(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^0x/, '');
  return normalized.length === 64 ? normalized : null;
}

export function checkKeyFile(
  content: string,
  mode: number,
): KeyFileCheckResult {
  const parsed = parseKeyFile(content);
  const checks: KeyCheck[] = [
    check(
      'file mode 0600',
      (mode & 0o777) === 0o600,
      (mode & 0o777) === 0o600 ? null : 'file permissions are not 0600',
    ),
    check(
      'required key names present',
      parsed.duplicates.length === 0 &&
        Object.values(KEY_ENV_NAMES).every((name) => parsed.values.has(name)),
      parsed.duplicates.length > 0
        ? 'duplicate key names in the file'
        : 'one or more required key names are missing',
    ),
  ];

  const deployerKey = parsed.values.get(KEY_ENV_NAMES.deployerEvm);
  const solverKey = parsed.values.get(KEY_ENV_NAMES.solverEvm);
  const solverWif = parsed.values.get(KEY_ENV_NAMES.solverBch);

  const deployerAddress =
    deployerKey !== undefined && isEvmPrivateKey(deployerKey)
      ? deriveEvmAddress(deployerKey)
      : null;
  const solverAddress =
    solverKey !== undefined && isEvmPrivateKey(solverKey)
      ? deriveEvmAddress(solverKey)
      : null;
  const solverBchAddresses =
    solverWif !== undefined && isBchMainnetWif(solverWif)
      ? deriveBchAddressesFromWif(solverWif)
      : null;

  checks.push(
    check(
      `${KEY_ENV_NAMES.deployerEvm} format`,
      deployerAddress !== null,
      deployerAddress === null
        ? 'expected a 0x-prefixed 32-byte private key'
        : null,
    ),
    check(
      `${KEY_ENV_NAMES.solverEvm} format`,
      solverAddress !== null,
      solverAddress === null
        ? 'expected a 0x-prefixed 32-byte private key'
        : null,
    ),
    check(
      `${KEY_ENV_NAMES.solverBch} format`,
      solverBchAddresses !== null,
      solverBchAddresses === null
        ? 'expected a mainnet compressed-key WIF'
        : null,
    ),
  );

  const expectedDeployer = recordedAddress(
    parsed,
    KEY_ADDRESS_NAMES.deployerEvm,
  );
  const expectedSolver = recordedAddress(parsed, KEY_ADDRESS_NAMES.solverEvm);
  const expectedBch = recordedAddress(parsed, KEY_ADDRESS_NAMES.solverBch);
  const expectedPlain = recordedAddress(
    parsed,
    KEY_ADDRESS_NAMES.solverBchPlain,
  );

  checks.push(
    check(
      `${KEY_ADDRESS_NAMES.deployerEvm} matches key`,
      deployerAddress !== null &&
        expectedDeployer !== undefined &&
        deployerAddress.toLowerCase() === expectedDeployer.toLowerCase(),
      deployerAddress === null
        ? 'key is invalid'
        : expectedDeployer === undefined
          ? 'recorded public address is missing'
          : 'derived address does not match the recorded public address',
    ),
    check(
      `${KEY_ADDRESS_NAMES.solverEvm} matches key`,
      solverAddress !== null &&
        expectedSolver !== undefined &&
        solverAddress.toLowerCase() === expectedSolver.toLowerCase(),
      solverAddress === null
        ? 'key is invalid'
        : expectedSolver === undefined
          ? 'recorded public address is missing'
          : 'derived address does not match the recorded public address',
    ),
    check(
      `${KEY_ADDRESS_NAMES.solverBch} matches key`,
      solverBchAddresses !== null &&
        expectedBch !== undefined &&
        solverBchAddresses.tokenAware === expectedBch,
      solverBchAddresses === null
        ? 'key is invalid'
        : expectedBch === undefined
          ? 'recorded public address is missing'
          : 'derived address does not match the recorded public address',
    ),
    check(
      `${KEY_ADDRESS_NAMES.solverBchPlain} matches key`,
      solverBchAddresses !== null &&
        expectedPlain !== undefined &&
        solverBchAddresses.plain === expectedPlain,
      solverBchAddresses === null
        ? 'key is invalid'
        : expectedPlain === undefined
          ? 'recorded public address is missing'
          : 'derived address does not match the recorded public address',
    ),
  );

  const deployerHex =
    deployerKey === undefined ? null : normalizedKeyHex(deployerKey);
  const solverHex =
    solverKey === undefined ? null : normalizedKeyHex(solverKey);
  const bchKey = solverWif === undefined ? null : decodeWif(solverWif);
  const bchHex =
    bchKey === null ? null : Buffer.from(bchKey.privateKey).toString('hex');
  const keysValid =
    deployerHex !== null && solverHex !== null && bchHex !== null;
  checks.push(
    check(
      'deployer and solver EVM keys differ',
      deployerHex !== null && solverHex !== null && deployerHex !== solverHex,
      keysValid ? 'the two EVM keys are identical' : 'keys are not all valid',
    ),
    check(
      'all three keys differ',
      keysValid &&
        deployerHex !== solverHex &&
        deployerHex !== bchHex &&
        solverHex !== bchHex,
      keysValid ? 'two or more keys are identical' : 'keys are not all valid',
    ),
  );

  const knownReasons: string[] = [];
  for (const [name, hex] of [
    [KEY_ENV_NAMES.deployerEvm, deployerHex],
    [KEY_ENV_NAMES.solverEvm, solverHex],
    [KEY_ENV_NAMES.solverBch, bchHex],
  ] as const) {
    if (hex === null) continue;
    const reason = knownTestKeyReason(hex);
    if (reason !== null) knownReasons.push(`${name}: ${reason}`);
  }
  checks.push(
    check(
      'no known test keys',
      knownReasons.length === 0,
      knownReasons.length === 0
        ? null
        : 'a key is a known development key or a simple pattern',
    ),
  );

  const addresses: Partial<KeyFileAddresses> = {};
  if (deployerAddress !== null) addresses.deployerEvm = deployerAddress;
  if (solverAddress !== null) addresses.solverEvm = solverAddress;
  if (solverBchAddresses !== null) addresses.solverBch = solverBchAddresses;

  return {
    ok: checks.every((item) => item.ok),
    checks,
    addresses,
    funding:
      addresses.deployerEvm !== undefined &&
      addresses.solverEvm !== undefined &&
      addresses.solverBch !== undefined
        ? fundingTargets(addresses as KeyFileAddresses)
        : [],
  };
}

export function fundingTargets(addresses: KeyFileAddresses): string[] {
  const bch = Number(MINIMUM_TIER.bchSats) / 100_000_000;
  return [
    `Deployer EVM ${addresses.deployerEvm}: native gas for the first deployment on each target chain.`,
    `Solver EVM ${addresses.solverEvm}: Base ${MINIMUM_TIER.baseUsdcUsd} USDC, other configured chains ${MINIMUM_TIER.otherStablecoinUsd} stablecoin, plus native gas on each chain.`,
    `Solver BCH ${addresses.solverBch.tokenAware}: ${MINIMUM_TIER.pusd} PUSD, ${MINIMUM_TIER.musd} MUSD (optional), ${bch} BCH for fees.`,
  ];
}

export function evidenceBlock(addresses: KeyFileAddresses): string {
  return [
    '## Mainnet public addresses',
    '',
    `- Deployer EVM: \`${addresses.deployerEvm}\``,
    `- Solver EVM: \`${addresses.solverEvm}\``,
    `- Solver BCH (token-aware): \`${addresses.solverBch.tokenAware}\``,
    `- Solver BCH (plain): \`${addresses.solverBch.plain}\``,
  ].join('\n');
}
