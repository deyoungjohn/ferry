import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  checkKeyFile,
  type KeyCheck,
} from '../../packages/chain-config/src/key-file.js';
import { loadChainConfig } from '../../packages/chain-config/src/config.js';
import { checkOnlineCodes, type CodeReader } from './online.js';
import { readKeyFile } from './paths.js';

export interface CheckOptions {
  file: string;
  online?: boolean;
  cwd?: string;
  readCode?: CodeReader;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export function parseCheckArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): { file: string; online: boolean } {
  let file: string | undefined;
  let online = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--online') {
      online = true;
    } else if (arg === '--env-file') {
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
  if (file === undefined) throw new Error('provide the key file path');
  return { file: resolve(cwd, file), online };
}

function printCheck(out: (line: string) => void, check: KeyCheck): void {
  out(
    `${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail === null ? '' : `: ${check.detail}`}`,
  );
}

export async function runCheck(options: CheckOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((line: string) => console.log(line));
  const err = options.stderr ?? ((line: string) => console.error(line));

  let file: ReturnType<typeof readKeyFile>;
  try {
    file = readKeyFile(options.file, cwd);
  } catch (error) {
    err(
      `keys:check: ${error instanceof Error ? error.message : 'failed without a message'}`,
    );
    return 1;
  }

  const result = checkKeyFile(file.content, file.mode);
  out(`Key file: ${file.path}`);
  for (const check of result.checks) printCheck(out, check);
  if (Object.keys(result.addresses).length > 0) {
    out('');
    out('Public addresses:');
    if (result.addresses.deployerEvm !== undefined) {
      out(`- Deployer EVM: ${result.addresses.deployerEvm}`);
    }
    if (result.addresses.solverEvm !== undefined) {
      out(`- Solver EVM: ${result.addresses.solverEvm}`);
    }
    if (result.addresses.solverBch !== undefined) {
      out(
        `- Solver BCH (token-aware): ${result.addresses.solverBch.tokenAware}`,
      );
      out(`- Solver BCH (plain): ${result.addresses.solverBch.plain}`);
    }
  }
  if (result.funding.length > 0) {
    out('');
    out('Funding targets (Minimum tier, addresses only):');
    for (const line of result.funding) out(`- ${line}`);
  }

  let ok = result.ok;
  if (options.online === true) {
    out('');
    if (
      !result.ok ||
      result.addresses.deployerEvm === undefined ||
      result.addresses.solverEvm === undefined
    ) {
      out('SKIP online account checks: fix the offline checks first');
      ok = false;
    } else {
      try {
        const config = loadChainConfig({
          env: { ...process.env, FERRY_NETWORK: 'mainnet' },
        });
        const online = await checkOnlineCodes(
          config,
          {
            deployerEvm: result.addresses.deployerEvm,
            solverEvm: result.addresses.solverEvm,
          },
          options.readCode,
        );
        for (const check of online) printCheck(out, check);
        if (online.some((check) => !check.ok)) ok = false;
      } catch (error) {
        err(
          `keys:check: online account check failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        ok = false;
      }
    }
  }

  out('');
  out(
    ok
      ? 'PASS: key file is ready for mainnet'
      : 'FAIL: key file is not ready for mainnet',
  );
  return ok ? 0 : 1;
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseCheckArgs(process.argv.slice(2));
    process.exitCode = await runCheck({
      file: args.file,
      online: args.online,
    });
  } catch (error) {
    console.error(
      `keys:check: ${error instanceof Error ? error.message : 'failed without a message'}`,
    );
    process.exitCode = 1;
  }
}
