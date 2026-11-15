import { describe, it, expect } from 'vitest';
import { MODE_COPY, getModeCopy, containsForbiddenWord } from '../lib/copy';

describe('Copy wording module', () => {
  it('covers the three modes: swap, pay-link, send-link', () => {
    expect(MODE_COPY.swap).toBeDefined();
    expect(MODE_COPY['pay-link']).toBeDefined();
    expect(MODE_COPY['send-link']).toBeDefined();
  });

  it('provides exact required phrasing for swap', () => {
    const swap = getModeCopy('swap');
    expect(swap.sendLabel).toBe('You send');
    expect(swap.receiveLabel).toBe('You receive');
  });

  it('provides exact required phrasing for pay-link', () => {
    const payLink = getModeCopy('pay-link');
    expect(payLink.sendLabel).toBe('You pay');
    expect(payLink.receiveLabel).toBe('They receive');
  });

  it('provides exact required phrasing for send-link', () => {
    const sendLink = getModeCopy('send-link');
    expect(sendLink.sendLabel).toBe('You send');
    expect(sendLink.receiveLabel).toBe('They receive');
  });

  it('never contains forbidden terms: invoice, bill, tip', () => {
    for (const [mode, copy] of Object.entries(MODE_COPY)) {
      const allText = Object.values(copy).join(' ').toLowerCase();
      expect(
        containsForbiddenWord(allText),
        `mode ${mode} contains forbidden word`,
      ).toBe(false);
      expect(allText).not.toContain('invoice');
      expect(allText).not.toContain('bill');
      expect(allText).not.toContain('tip');
    }
  });

  it('throws on unknown mode', () => {
    // @ts-expect-error Testing invalid runtime mode
    expect(() => getModeCopy('unknown')).toThrow();
  });
});
