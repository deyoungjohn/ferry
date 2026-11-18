import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The build script is plain JavaScript.
import { buildHtml } from '../scripts/build.mjs';

describe('recover.html', () => {
  it('matches a fresh build, so the committed page is the code in this repository', async () => {
    const committed = readFileSync(
      fileURLToPath(new URL('../../../recover.html', import.meta.url)),
      'utf8',
    );
    const fresh = (await buildHtml()) as string;
    expect(committed === fresh).toBe(true);
  }, 60_000);

  it('loads nothing from the network and runs only its own inline script', async () => {
    const html = (await buildHtml()) as string;
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain("default-src 'none'");
  }, 60_000);
});
