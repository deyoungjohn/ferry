import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSetting, readEnvValue } from '../scripts/env-file.js';

const NAME = 'FERRY_TEST_SETTING';

describe('env-file', () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  it('reads plain, quoted, exported and CRLF lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'envf-'));
    const file = join(dir, 'a.env');
    writeFileSync(file, `# c\r\nOTHER=1\r\nexport ${NAME}="abc 123"\r\n`);
    expect(readEnvValue(file, NAME)).toBe('abc 123');
    writeFileSync(file, `${NAME}='x'\n`);
    expect(readEnvValue(file, NAME)).toBe('x');
    expect(readEnvValue(join(dir, 'missing.env'), NAME)).toBeUndefined();
  });

  it('prefers the environment, then the first file that has it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'envf-'));
    const a = join(dir, 'a.env');
    const b = join(dir, 'b.env');
    writeFileSync(a, 'OTHER=1\n');
    writeFileSync(b, `${NAME}=from-b\n`);
    expect(findSetting(NAME, [a, b])).toEqual({ value: 'from-b', source: b });
    process.env[NAME] = 'from-env';
    expect(findSetting(NAME, [a, b])?.source).toBe('the environment');
  });
});
