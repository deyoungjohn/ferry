import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

function gitRoot(cwd: string): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** The directory the user typed the command in (pnpm sets INIT_CWD), else the working directory. */
export function invocationDir(): string {
  return process.env['INIT_CWD'] ?? process.cwd();
}

export function defaultKeyPath(cwd = process.cwd()): string {
  return join(gitRoot(cwd) ?? cwd, '.env.mainnet.local');
}

export function assertNewKeyPath(file: string, cwd = process.cwd()): string {
  const target = resolve(cwd, file);
  if (existsSync(target)) {
    throw new Error('Refusing to overwrite an existing key file.');
  }
  const directory = dirname(target);
  if (!existsSync(directory)) {
    throw new Error('The key file directory does not exist.');
  }
  if (!statSync(directory).isDirectory()) {
    throw new Error('The key file parent is not a directory.');
  }

  const root = gitRoot(directory);
  if (root !== null) {
    const relativePath = relative(root, target);
    const insideRepository =
      relativePath !== '' &&
      !relativePath.startsWith('..') &&
      !isAbsolute(relativePath);
    if (insideRepository) {
      const ignored = spawnSync(
        'git',
        ['-C', root, 'check-ignore', '-q', '--', target],
        { stdio: 'ignore' },
      );
      if (ignored.status !== 0) {
        throw new Error(
          'Refusing to write inside a git-tracked directory unless the path is gitignored.',
        );
      }
    }
  }
  return target;
}

export function writeKeyFile(
  file: string,
  content: string,
  cwd = process.cwd(),
): string {
  const target = assertNewKeyPath(file, cwd);
  let created = false;
  try {
    const descriptor = openSync(target, 'wx', 0o600);
    created = true;
    try {
      writeFileSync(descriptor, content, 'utf8');
    } finally {
      closeSync(descriptor);
    }
    chmodSync(target, 0o600);
    return target;
  } catch (error) {
    if (created) {
      try {
        unlinkSync(target);
      } catch {
        // Keep the original write error.
      }
    }
    throw error;
  }
}

export function readKeyFile(
  file: string,
  cwd = process.cwd(),
): { path: string; content: string; mode: number } {
  const target = resolve(cwd, file);
  if (!existsSync(target)) throw new Error('The key file does not exist.');
  const info = lstatSync(target);
  if (!info.isFile()) throw new Error('The key path is not a regular file.');
  return {
    path: target,
    content: readFileSync(target, 'utf8'),
    mode: info.mode,
  };
}
