import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  concat,
  createPublicClient,
  createWalletClient,
  getAddress,
  getCreate2Address,
  http,
  keccak256,
  stringToHex,
} from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadChainConfig } from '@ferry/chain-config';
import { execFileSync } from 'node:child_process';
import { envFileCandidates, findSetting } from './env-file.js';
import type { ChainId, Network } from '@ferry/chain-config';

export const FERRY_HTLC_SALT = keccak256(stringToHex('ferry-htlc.v1'));
export const CANONICAL_CREATE2_FACTORY: Address =
  '0x4e59b44847b379578588920cA78FbF26c0B4956C';

export interface ImmutableReference {
  start: number;
  length: number;
}

export interface FerryHtlcArtifact {
  initCode: Hex;
  initCodeHash: Hex;
  deployedBytecode: Hex;
  immutableReferences: ImmutableReference[];
}

export interface DeployFerryHtlcOptions {
  rpcUrl: string;
  factory?: Address | undefined;
  broadcast?: boolean | undefined;
  privateKey?: Hex | undefined;
}

export interface DeployFerryHtlcResult {
  status: 'dry-run' | 'already-deployed' | 'deployed';
  chainId: number;
  address: Address;
  factory: Address;
  salt: Hex;
  initCodeHash: Hex;
  deployBlock?: bigint | undefined;
  txHash?: Hex | undefined;
}

interface ForgeArtifactJson {
  bytecode: {
    object: Hex;
  };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, ImmutableReference[]> | undefined;
  };
}

export function loadFerryHtlcArtifact(): FerryHtlcArtifact {
  const artifactPath = resolve(
    fileURLToPath(new URL('..', import.meta.url)),
    'out/FerryHTLC.sol/FerryHTLC.json',
  );
  const raw = JSON.parse(
    readFileSync(artifactPath, 'utf8'),
  ) as ForgeArtifactJson;
  const initCode = raw.bytecode.object;
  const deployedBytecode = raw.deployedBytecode.object;
  const refsMap = raw.deployedBytecode.immutableReferences ?? {};
  const immutableReferences = Object.values(refsMap).flat();
  return {
    initCode,
    initCodeHash: keccak256(initCode),
    deployedBytecode,
    immutableReferences,
  };
}

export function predictFerryHtlcAddress(
  factory: Address = CANONICAL_CREATE2_FACTORY,
  artifact: FerryHtlcArtifact = loadFerryHtlcArtifact(),
): Address {
  return getCreate2Address({
    from: getAddress(factory),
    salt: FERRY_HTLC_SALT,
    bytecodeHash: artifact.initCodeHash,
  });
}

function maskImmutables(
  bytecode: Hex,
  immutableReferences: readonly ImmutableReference[],
): string {
  const clean = bytecode.toLowerCase().replace(/^0x/, '');
  const chars = clean.split('');
  for (const ref of immutableReferences) {
    const startChar = ref.start * 2;
    const endChar = (ref.start + ref.length) * 2;
    for (let i = startChar; i < endChar && i < chars.length; i++) {
      chars[i] = '0';
    }
  }
  return chars.join('');
}

export function isSameFerryHtlcBytecode(
  onChainCode: Hex | undefined,
  artifact: FerryHtlcArtifact = loadFerryHtlcArtifact(),
): boolean {
  if (!onChainCode || onChainCode === '0x') return false;
  if (onChainCode.length !== artifact.deployedBytecode.length) return false;
  return (
    maskImmutables(onChainCode, artifact.immutableReferences) ===
    maskImmutables(artifact.deployedBytecode, artifact.immutableReferences)
  );
}

/**
 * The first block in which `address` has code, by binary search over historical
 * state. Returns undefined when the endpoint cannot serve old state (many public
 * endpoints prune it), so the caller reports no block rather than a wrong one.
 */
export async function findDeployBlock(
  client: PublicClient,
  address: Address,
): Promise<bigint | undefined> {
  try {
    const hasCodeAt = async (blockNumber: bigint) => {
      const code = await client.getCode({ address, blockNumber });
      return code !== undefined && code !== '0x';
    };
    let high = await client.getBlockNumber();
    if (!(await hasCodeAt(high))) return undefined;
    let low = 0n;
    while (low < high) {
      const middle = (low + high) / 2n;
      if (await hasCodeAt(middle)) high = middle;
      else low = middle + 1n;
    }
    return low;
  } catch {
    return undefined;
  }
}

export async function deployFerryHtlc(
  options: DeployFerryHtlcOptions,
): Promise<DeployFerryHtlcResult> {
  const factory = getAddress(options.factory ?? CANONICAL_CREATE2_FACTORY);
  const artifact = loadFerryHtlcArtifact();
  const predicted = predictFerryHtlcAddress(factory, artifact);

  const publicClient = createPublicClient({
    transport: http(options.rpcUrl),
  });

  const chainId = await publicClient.getChainId();

  const factoryCode = await publicClient.getCode({ address: factory });
  if (!factoryCode || factoryCode === '0x') {
    throw new Error(
      `Canonical CREATE2 factory ${factory} has no code on chain ${chainId}`,
    );
  }

  const existingCode = await publicClient.getCode({ address: predicted });
  if (existingCode && existingCode !== '0x') {
    if (isSameFerryHtlcBytecode(existingCode, artifact)) {
      return {
        status: 'already-deployed',
        chainId,
        address: predicted,
        factory,
        salt: FERRY_HTLC_SALT,
        initCodeHash: artifact.initCodeHash,
        deployBlock: await findDeployBlock(publicClient, predicted),
      };
    }
    throw new Error(
      `Refusing deploy: predicted address ${predicted} already contains different bytecode`,
    );
  }

  const callData = concat([FERRY_HTLC_SALT, artifact.initCode]);

  if (!options.broadcast) {
    await publicClient.call({
      to: factory,
      data: callData,
    });
    return {
      status: 'dry-run',
      chainId,
      address: predicted,
      factory,
      salt: FERRY_HTLC_SALT,
      initCodeHash: artifact.initCodeHash,
    };
  }

  if (!options.privateKey) {
    throw new Error(
      'Broadcast requested but no privateKey provided (set DEPLOYER_EVM_PRIVATE_KEY)',
    );
  }

  const account = privateKeyToAccount(options.privateKey);
  const walletClient = createWalletClient({
    account,
    transport: http(options.rpcUrl),
  });

  const txHash = await walletClient.sendTransaction({
    account,
    chain: null,
    to: factory,
    data: callData,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== 'success') {
    throw new Error(`CREATE2 deployment transaction ${txHash} reverted`);
  }

  const deployedCode = await publicClient.getCode({ address: predicted });
  if (!isSameFerryHtlcBytecode(deployedCode, artifact)) {
    throw new Error(
      `Deployed code at ${predicted} does not match expected FerryHTLC bytecode`,
    );
  }

  return {
    status: 'deployed',
    chainId,
    address: predicted,
    factory,
    salt: FERRY_HTLC_SALT,
    initCodeHash: artifact.initCodeHash,
    deployBlock: receipt.blockNumber,
    txHash,
  };
}

function parseCliArgs(argv: string[]): {
  rpcUrl?: string | undefined;
  chain?: ChainId | undefined;
  network: Network;
  broadcast: boolean;
  envFile?: string | undefined;
} {
  let rpcUrl: string | undefined;
  let chain: ChainId | undefined;
  let network: Network = 'mainnet';
  let broadcast = false;
  let envFile: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rpc-url' && argv[i + 1]) {
      rpcUrl = argv[++i];
    } else if (arg === '--chain' && argv[i + 1]) {
      chain = argv[++i] as ChainId;
    } else if (arg === '--network' && argv[i + 1]) {
      network = argv[++i] as Network;
    } else if (arg === '--env-file' && argv[i + 1]) {
      envFile = argv[++i];
    } else if (arg === '--broadcast') {
      broadcast = true;
    }
  }

  return { rpcUrl, chain, network, broadcast, envFile };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  // The address and init code hash come from the compiled output, so compile first: a stale build
  // would print (or deploy) the previous contract.
  try {
    execFileSync('forge', ['build'], {
      cwd: resolve(fileURLToPath(import.meta.url), '../..'),
      stdio: 'ignore',
    });
  } catch {
    console.error(
      'forge build failed or forge is not installed; using the existing build in out/.',
    );
  }
  let rpcUrl = args.rpcUrl;
  let factory: Address = CANONICAL_CREATE2_FACTORY;

  if (!rpcUrl) {
    if (!args.chain) {
      throw new Error('Provide --rpc-url <url> or --chain <chainId>');
    }
    const config = loadChainConfig();
    const chainEntry = config.chains.find(
      (c) => c.id === args.chain && c.network === args.network,
    );
    if (!chainEntry || chainEntry.rpcUrls.length === 0) {
      throw new Error(
        `No RPC URL configured for ${args.chain} (${args.network})`,
      );
    }
    rpcUrl = chainEntry.rpcUrls[0]!;
    factory = getAddress(chainEntry.create2Factory.address);
  }

  // The key comes from the environment, else from an env file (--env-file, ENV_FILE, the
  // repository's .env.mainnet.local or .env.local, ~/ferry-solver.env). Only its source is printed.
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
  const found = findSetting(
    'DEPLOYER_EVM_PRIVATE_KEY',
    envFileCandidates(repoRoot, args.envFile),
  );
  const rawKey = found?.value;
  if (args.broadcast) {
    console.error(
      found
        ? `Deployer key read from ${found.source}.`
        : 'No DEPLOYER_EVM_PRIVATE_KEY in the environment or in any env file (looked in: ' +
            `${envFileCandidates(repoRoot, args.envFile).join(', ')}).`,
    );
  }
  const privateKey =
    rawKey && rawKey.length > 0
      ? ((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex)
      : undefined;

  const result = await deployFerryHtlc({
    rpcUrl,
    factory,
    broadcast: args.broadcast,
    privateKey,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        deployBlock:
          result.deployBlock !== undefined
            ? result.deployBlock.toString()
            : undefined,
      },
      null,
      2,
    ),
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  void main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
