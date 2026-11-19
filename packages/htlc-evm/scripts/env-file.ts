import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** One setting from a plain `KEY=value` file: CRLF, `export `, spaces and quotes are tolerated. */
export function readEnvValue(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    let line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** Where the deploy script looks for a setting that is not in the environment, in order. */
export function envFileCandidates(
  repoRoot: string,
  explicit?: string,
): string[] {
  return [
    ...(explicit ? [resolve(explicit)] : []),
    ...(process.env['ENV_FILE'] ? [resolve(process.env['ENV_FILE'])] : []),
    join(repoRoot, '.env.mainnet.local'),
    join(repoRoot, '.env.local'),
    join(homedir(), 'ferry-solver.env'),
  ];
}

/** The setting from the environment, else from the first file that has it. Never prints it. */
export function findSetting(
  name: string,
  files: readonly string[],
): { value: string; source: string } | undefined {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0)
    return { value: fromEnv, source: 'the environment' };
  for (const file of files) {
    const value = readEnvValue(file, name);
    if (value) return { value, source: file };
  }
  return undefined;
}
