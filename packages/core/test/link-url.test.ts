import { describe, expect, it } from 'vitest';
import {
  buildPayLinkPath,
  buildPayLinkUrl,
  buildSendLinkPath,
  buildSendLinkUrl,
  parsePayLinkUrl,
  parseSendLinkUrl,
  redactLinkForLog,
  toServerRequestPath,
} from '../src/index.js';

describe('link URL helpers and fragment-only secret isolation', () => {
  const payId = '4vJ9JU1bJJE96FWSJKvHsm';
  const sendId = `0x${'ab'.repeat(32)}` as const;
  const secretHex = `0x${'cd'.repeat(32)}` as const;
  const secretBare = 'cd'.repeat(32);

  it('builds and parses /p/<id> pay links', () => {
    expect(buildPayLinkPath(payId)).toBe(`/p/${payId}`);
    const fullUrl = buildPayLinkUrl('https://ferry.example/', payId);
    expect(fullUrl).toBe(`https://ferry.example/p/${payId}`);
    expect(parsePayLinkUrl(fullUrl)).toEqual({ kind: 'pay', id: payId });
    expect(parsePayLinkUrl(`/p/${payId}`)).toEqual({ kind: 'pay', id: payId });

    expect(() => parsePayLinkUrl(`/p/${payId}?foo=bar`)).toThrow();
    expect(() => parsePayLinkUrl(`/p/${payId}#frag`)).toThrow();
    expect(() => parsePayLinkUrl('/p/0OIl')).toThrow();
  });

  it('builds and parses /s/<id>#<secret> send links and keeps the secret strictly in the fragment', () => {
    const path = buildSendLinkPath(sendId, secretHex);
    expect(path).toBe(`/s/${sendId}#${secretHex}`);

    const fullUrl = buildSendLinkUrl(
      'https://ferry.example/app/',
      sendId,
      secretHex,
    );
    expect(fullUrl).toBe(`https://ferry.example/app/s/${sendId}#${secretHex}`);
    expect(parseSendLinkUrl(fullUrl)).toEqual({
      kind: 'send',
      id: sendId,
      secret: secretHex,
    });
    expect(parseSendLinkUrl(path)).toEqual({
      kind: 'send',
      id: sendId,
      secret: secretHex,
    });

    // SL-03: Server request paths and log-redacted URLs must never contain the secret
    const serverPath = toServerRequestPath(fullUrl);
    expect(serverPath).toBe(`/app/s/${sendId}`);
    expect(serverPath).not.toContain(secretBare);
    expect(serverPath).not.toContain('#');

    const logSafe = redactLinkForLog(fullUrl);
    expect(logSafe).toBe(`https://ferry.example/app/s/${sendId}`);
    expect(logSafe).not.toContain(secretBare);
    expect(logSafe).not.toContain('#');

    expect(() => parseSendLinkUrl(`/s/${sendId}`)).toThrow(
      /missing the secret/i,
    );
    expect(() =>
      parseSendLinkUrl(`/s/${sendId}?secret=${secretHex}#${secretHex}`),
    ).toThrow();
    expect(() => parseSendLinkUrl(`/s/${sendId}#0x1234`)).toThrow();
    expect(() => parseSendLinkUrl('/s/not-hex#0x' + 'cd'.repeat(32))).toThrow();
    expect(() => parseSendLinkUrl('/wrong/path')).toThrow();
    expect(() => parsePayLinkUrl('/wrong/path')).toThrow();
    expect(redactLinkForLog(`/p/${payId}`)).toBe(`/p/${payId}`);
  });
});
