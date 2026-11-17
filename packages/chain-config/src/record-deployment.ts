import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import { loadChainConfig } from './config.js';
import {
  CHAIN_IDS,
  parseChainConfigData,
  type ChainConfigData,
  type ChainId,
  type Network,
} from './schema.js';
import { predictHtlcAddress } from './htlc.js';

export interface ImmutableSlot {
  start: number;
  length: number;
}

export interface DeploymentArtifact {
  deployedBytecode: {
    object: Hex;
    /** Byte ranges that hold constructor-time immutable values in the runtime code. */
    immutableReferences?: readonly ImmutableSlot[];
  };
}

/** Zero the immutable slots so on-chain code and the build artifact can be compared. */
export function maskImmutableSlots(
  bytecode: Hex,
  slots: readonly ImmutableSlot[] = [],
): string {
  const chars = bytecode.toLowerCase().replace(/^0x/, '').split('');
  for (const slot of slots) {
    const end = (slot.start + slot.length) * 2;
    for (let i = slot.start * 2; i < end && i < chars.length; i += 1) {
      chars[i] = '0';
    }
  }
  return chars.join('');
}

export interface DeploymentClient {
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex>;
}

export interface RecordDeploymentOptions {
  chain: ChainId;
  address: string;
  block: number;
  network?: Network;
  client: DeploymentClient;
  artifact: DeploymentArtifact | null;
  data: ChainConfigData;
}

export interface RecordDeploymentResult {
  data: ChainConfigData;
  diff: string;
  codeHash: Hex;
  artifactHash: Hex;
}

export class DeploymentRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentRecordError';
  }
}

export function loadDeploymentArtifact(
  path = new URL(
    '../../htlc-evm/out/FerryHTLC.sol/FerryHTLC.json',
    import.meta.url,
  ),
): DeploymentArtifact | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      deployedBytecode?: {
        object?: unknown;
        immutableReferences?: Record<string, ImmutableSlot[]>;
      };
    };
    if (
      raw.deployedBytecode === undefined ||
      typeof raw.deployedBytecode.object !== 'string'
    ) {
      return null;
    }
    const immutableReferences = Object.values(
      raw.deployedBytecode.immutableReferences ?? {},
    ).flat();
    return {
      deployedBytecode: {
        object: raw.deployedBytecode.object as Hex,
        immutableReferences,
      },
    };
  } catch {
    return null;
  }
}

function isChainId(value: string): value is ChainId {
  return (CHAIN_IDS as readonly string[]).includes(value);
}

export async function recordDeployment(
  options: RecordDeploymentOptions,
): Promise<RecordDeploymentResult> {
  const network = options.network ?? 'mainnet';
  if (network !== 'mainnet') {
    throw new DeploymentRecordError('Deployment recording is mainnet only.');
  }
  if (!isChainId(options.chain)) {
    throw new DeploymentRecordError(`Unknown chain ${options.chain}.`);
  }
  if (!Number.isSafeInteger(options.block) || options.block <= 0) {
    throw new DeploymentRecordError('The block must be a positive integer.');
  }

  let address: Address;
  try {
    address = getAddress(options.address);
  } catch {
    throw new DeploymentRecordError('The address is not a valid EVM address.');
  }
  const predicted = predictHtlcAddress();
  if (address !== predicted) {
    throw new DeploymentRecordError(
      `Address ${address} does not match the CREATE2 prediction ${predicted}.`,
    );
  }

  if (options.artifact === null) {
    throw new DeploymentRecordError(
      'FerryHTLC build artifact is missing; cannot verify the runtime bytecode.',
    );
  }

  const atBlock = await options.client.getCode({
    address,
    blockNumber: BigInt(options.block),
  });
  if (atBlock === '0x') {
    throw new DeploymentRecordError(
      `No contract code at block ${options.block}.`,
    );
  }
  const previousBlock = options.block - 1;
  if (previousBlock > 0) {
    const before = await options.client.getCode({
      address,
      blockNumber: BigInt(previousBlock),
    });
    if (before !== '0x') {
      throw new DeploymentRecordError(
        `Code already existed at block ${previousBlock}; the block does not match the deployment.`,
      );
    }
  }

  const slots = options.artifact.deployedBytecode.immutableReferences ?? [];
  const codeHash = keccak256(atBlock);
  const maskedCode = maskImmutableSlots(atBlock, slots);
  const maskedArtifact = maskImmutableSlots(
    options.artifact.deployedBytecode.object,
    slots,
  );
  const artifactHash = keccak256(options.artifact.deployedBytecode.object);
  if (
    maskedCode.length !== maskedArtifact.length ||
    maskedCode !== maskedArtifact
  ) {
    throw new DeploymentRecordError(
      `Runtime bytecode hash ${codeHash} does not match the build artifact ${artifactHash}.`,
    );
  }

  const updated = structuredClone(options.data);
  const deployment = updated.chains[options.chain].mainnet.deployment;
  const oldAddress = deployment.htlcAddress;
  const oldBlock = deployment.deployBlock;
  if (oldAddress !== null && getAddress(oldAddress) !== address) {
    throw new DeploymentRecordError(
      `A different HTLC address is already recorded for ${options.chain}.`,
    );
  }
  if (oldBlock !== null && oldBlock !== options.block) {
    throw new DeploymentRecordError(
      `A different deploy block is already recorded for ${options.chain}.`,
    );
  }

  deployment.htlcAddress = address;
  deployment.deployBlock = options.block;
  const parsed = parseChainConfigData(updated);

  return {
    data: parsed,
    diff: [
      `htlcAddress: ${oldAddress ?? 'null'} -> ${address}`,
      `deployBlock: ${oldBlock ?? 'null'} -> ${options.block}`,
    ].join('\n'),
    codeHash,
    artifactHash,
  };
}

function parseArgs(argv: string[]): {
  chain: ChainId;
  address: string;
  block: number;
  network: Network;
} {
  let chain: string | undefined;
  let address: string | undefined;
  let block: string | undefined;
  let network: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--chain' && next) {
      chain = next;
      index += 1;
    } else if (arg === '--address' && next) {
      address = next;
      index += 1;
    } else if (arg === '--block' && next) {
      block = next;
      index += 1;
    } else if (arg === '--network' && next) {
      network = next;
      index += 1;
    } else {
      throw new DeploymentRecordError(`Unknown or incomplete argument ${arg}.`);
    }
  }

  if (!chain || !isChainId(chain)) {
    throw new DeploymentRecordError(
      `Provide --chain one of ${CHAIN_IDS.join(', ')}.`,
    );
  }
  if (!address) throw new DeploymentRecordError('Provide --address 0x…');
  if (!block || !/^\d+$/.test(block)) {
    throw new DeploymentRecordError('Provide --block as a positive integer.');
  }
  const selectedNetwork = (network ?? process.env.FERRY_NETWORK ?? 'mainnet')
    .trim()
    .toLowerCase();
  if (selectedNetwork !== 'mainnet' && selectedNetwork !== 'testnet') {
    throw new DeploymentRecordError(
      'Provide --network mainnet or testnet; deployment recording is mainnet only.',
    );
  }
  return {
    chain,
    address,
    block: Number(block),
    network: selectedNetwork,
  };
}

export async function runRecordDeployment(
  argv = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv);
  const dataUrl = new URL('./data/chains.json', import.meta.url);
  const data = parseChainConfigData(
    JSON.parse(readFileSync(dataUrl, 'utf8')) as unknown,
  );
  const config = loadChainConfig({
    env: { ...process.env, FERRY_NETWORK: args.network },
  });
  const chain = config.facts.find((item) => item.id === args.chain);
  const endpoint = chain?.rpcEndpoints[0];
  if (!endpoint) {
    throw new DeploymentRecordError(
      `No RPC endpoint configured for ${args.chain}.`,
    );
  }
  const viemClient = createPublicClient({ transport: http(endpoint.url) });
  const client: DeploymentClient = {
    async getCode({ address, blockNumber }): Promise<Hex> {
      return (await viemClient.getCode({ address, blockNumber })) ?? '0x';
    },
  };

  let result: RecordDeploymentResult;
  try {
    result = await recordDeployment({
      ...args,
      client,
      artifact: loadDeploymentArtifact(),
      data,
    });
  } catch (error) {
    if (error instanceof DeploymentRecordError) throw error;
    throw new DeploymentRecordError(
      `RPC read failed for ${args.chain}; no file was written.`,
    );
  }

  writeFileSync(dataUrl, `${JSON.stringify(result.data, null, 2)}\n`);
  console.log(`Recorded ${args.chain} mainnet deployment`);
  console.log(result.diff);
  console.log(`Runtime code hash: ${result.codeHash}`);
  console.log('Wrote htlcAddress and deployBlock only.');
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runRecordDeployment().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
