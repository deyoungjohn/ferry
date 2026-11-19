import { describe, expect, it } from 'vitest';
import { runMatrix } from '../src/matrix.js';

const RUN = process.env['FERRY_RUN_FORK'] === '1';

describe.skipIf(!RUN)('fork edge-case matrix', () => {
  it('runs each configured chain in sequence and prints the matrix', async () => {
    const rows = await runMatrix();
    console.log('\nchain | case | status | detail');
    for (const row of rows) {
      console.log(`${row.chain} | ${row.case} | ${row.status} | ${row.detail}`);
    }
    const failed = rows.filter((row) => row.status === 'fail');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 600_000);
});
