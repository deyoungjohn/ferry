import { describe, expect, it } from 'vitest';
import { formatBchAmount, insufficientBchMessage } from '../src/actions.js';

describe('insufficient BCH message', () => {
  it('says the amounts in BCH, not satoshis, and what to do', () => {
    expect(formatBchAmount(4633n)).toBe('0.00004633 BCH');
    expect(formatBchAmount(100_000_000n)).toBe('1 BCH');
    const text = insufficientBchMessage(
      'Insufficient BCH balance for fees and carry satoshis: required 4633, available 3500',
    );
    expect(text).toContain('0.00004633 BCH');
    expect(text).toContain('0.000035 BCH');
    expect(text).toContain('0.00001133 BCH');
    expect(text.length).toBeLessThan(190);
    expect(text).not.toMatch(/satoshi/i);
    expect(text).toContain('Nothing was locked');
  });
});
