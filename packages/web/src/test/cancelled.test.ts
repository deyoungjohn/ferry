import { afterEach, describe, expect, it } from 'vitest';
import { isCancelled, markCancelled } from '../lib/live/cancelled';

describe('cancelled swaps', () => {
  afterEach(() => window.localStorage.clear());

  it('remembers a cancelled swap by its order id, whatever the case', () => {
    const id = `0x${'AB'.repeat(32)}`;
    expect(isCancelled(id)).toBe(false);
    markCancelled(id);
    expect(isCancelled(id.toLowerCase())).toBe(true);
  });
});
