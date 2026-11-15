import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { keccak256 } from 'viem';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const abiPath = join(packageRoot, 'abi.ts');
const artifactPath = join(
  packageRoot,
  'out',
  'FerryHTLC.sol',
  'FerryHTLC.json',
);

export async function generateAbiSource() {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const deployedBytecode = artifact.deployedBytecode.object;
  const initCode = artifact.bytecode.object;
  const deployedBytecodeHash = keccak256(deployedBytecode);
  const initCodeHash = keccak256(initCode);

  const raw = [
    `export const ferryHtlcAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;`,
    `export type FerryHtlcAbi = typeof ferryHtlcAbi;`,
    `export const FERRY_HTLC_DEPLOYED_BYTECODE_HASH = '${deployedBytecodeHash}' as const;`,
    `export const FERRY_HTLC_INIT_CODE_HASH = '${initCodeHash}' as const;`,
    '',
  ].join('\n');

  const options = (await prettier.resolveConfig(abiPath)) ?? {};
  return prettier.format(raw, { ...options, parser: 'typescript' });
}
