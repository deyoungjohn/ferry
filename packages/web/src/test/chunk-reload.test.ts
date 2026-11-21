import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '../lib/chunk-reload';

describe('a chunk from an earlier build', () => {
  it('is recognised by the message browsers give', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://x/assets/SwapStatusPage-Y3dDs7h6.js',
        ),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError(new TypeError('Importing a module script failed.')),
    ).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of null'))).toBe(
      false,
    );
  });
});
