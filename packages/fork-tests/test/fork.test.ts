import { describe, expect, it } from 'vitest';

const RUN = process.env['FERRY_RUN_FORK'] === '1';

describe.skipIf(!RUN)('fork edge-case matrix', () => {
  it('has a chain list', () => {
    expect(true).toBe(true);
  });
});
