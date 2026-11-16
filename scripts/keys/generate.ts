import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  generateKeyMaterial,
  type RandomSource,
} from '../../packages/chain-config/src/key-material.js';
import {
  buildKeyFile,
  evidenceBlock,
} from '../../packages/chain-config/src/key-file.js';
import { assertNewKeyPath, defaultKeyPath, writeKeyFile } from './paths.js';

export interface GenerateOptions {
  file?: string;
  cwd?: string;
  random?: RandomSource;
  now?: Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export function parseGenerateArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): { file: string } {
  let file: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--env-file') {
      const next = argv[index + 1];
      if (next === undefined) throw new Error('--env-file needs a path');
      if (file !== undefined) throw new Error('provide the key file once');
      file = next;
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      if (file !== undefined) throw new Error('provide the key file once');
      file = arg;
    }
  }
  return { file: resolve(cwd, file ?? defaultKeyPath(cwd)) };
}

export function runGenerate(options: GenerateOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((line: string) => console.log(line));
  const err = options.stderr ?? ((line: string) => console.error(line));
  try {
    const file = options.file ?? defaultKeyPath(cwd);
    const target = assertNewKeyPath(file, cwd);
    const material = generateKeyMaterial(options.random);
    const content = buildKeyFile(material, options.now);
    writeKeyFile(target, content, cwd);
    out(`Key file: ${target} (mode 0600)`);
    out('');
    out('Public addresses (secrets are never printed):');
    out(`- Deployer EVM: ${material.addresses.deployerEvm}`);
    out(`- Solver EVM: ${material.addresses.solverEvm}`);
    out(
      `- Solver BCH (token-aware): ${material.addresses.solverBch.tokenAware}`,
    );
    out(`- Solver BCH (plain): ${material.addresses.solverBch.plain}`);
    out('');
    out('Ready-to-commit block for preparation/evidence/README.md:');
    out(evidenceBlock(material.addresses));
    return 0;
  } catch (error) {
    err(
      `keys:generate: ${error instanceof Error ? error.message : 'failed without a message'}`,
    );
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseGenerateArgs(process.argv.slice(2));
    process.exitCode = runGenerate({ file: args.file });
  } catch (error) {
    console.error(
      `keys:generate: ${error instanceof Error ? error.message : 'failed without a message'}`,
    );
    process.exitCode = 1;
  }
}
