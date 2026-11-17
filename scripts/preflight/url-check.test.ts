import { describe, expect, it } from 'vitest';
import { runUrlCheck } from './url-check.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    text: () => [...out, ...err].join('\n'),
  };
}

describe('preflight --url', () => {
  it('passes a JSON health response', async () => {
    const output = capture();
    const code = await runUrlCheck('https://example.org', {
      stdout: output.stdout,
      stderr: output.stderr,
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(code).toBe(0);
    expect(output.text()).toContain('PASS https://example.org/v1/health');
  });

  it('rejects an HTML landing page with the exact message', async () => {
    const output = capture();
    const code = await runUrlCheck('https://example.org', {
      stdout: output.stdout,
      stderr: output.stderr,
      fetch: async () =>
        new Response('<!doctype html><title>Ferry</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });
    expect(code).toBe(1);
    expect(output.text()).toContain(
      'this URL is not a Ferry solver (it returned HTML)',
    );
  });

  it('fails an HTTP error and rejects a non-http scheme', async () => {
    const output = capture();
    expect(
      await runUrlCheck('https://example.org', {
        stdout: output.stdout,
        stderr: output.stderr,
        fetch: async () =>
          new Response(JSON.stringify({ error: 'missing' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).toBe(1);
    expect(output.text()).toContain('HTTP 404');

    const invalid = capture();
    expect(
      await runUrlCheck('ftp://example.org', {
        stdout: invalid.stdout,
        stderr: invalid.stderr,
      }),
    ).toBe(1);
    expect(invalid.text()).toContain('http(s) URL');
  });
});
