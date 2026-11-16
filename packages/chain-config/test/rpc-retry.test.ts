import { describe, expect, it } from 'vitest';
import { isRetryableRpcError, withRetry } from '../src/index.js';

describe('RPC retry', () => {
  it('retries a rate-limit error with backoff', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('rate limit exceeded');
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry a non-transient error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('execution reverted');
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('execution reverted');
    expect(calls).toBe(1);
  });

  it('stops after the configured attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('too many requests');
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('too many requests');
    expect(calls).toBe(3);
  });

  it('classifies rate limits and ignores ordinary reverts', () => {
    expect(isRetryableRpcError(new Error('rate-limited'))).toBe(true);
    expect(isRetryableRpcError(new Error('error code -32005'))).toBe(true);
    expect(isRetryableRpcError(new Error('execution reverted'))).toBe(false);
  });
});
