import { redactRpcSecrets, type RpcCaller } from './rpc-overrides.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export function isRetryableRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.trim() === '') return true;
  return /rate limit|rate-limited|too many|limit exceeded|timeout|aborted|fetch failed|unexpected end of json|invalid json|socket hang up|econnreset|temporarily|try again|429|-\s?32005|-\s?32011|-\s?32029/i.test(
    message,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableRpcError(error)) throw error;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function makeJsonRpc(
  secrets: readonly string[],
  retry: RetryOptions = {},
): RpcCaller {
  const raw = async <T>(
    url: string,
    method: string,
    params: unknown[],
  ): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        result?: T;
        error?: { message?: string };
      };
      if (payload.error) {
        throw new Error(
          redactRpcSecrets(
            payload.error.message ?? 'RPC returned an error',
            secrets,
          ),
        );
      }
      if (payload.result === undefined) {
        throw new Error('RPC returned no result');
      }
      return payload.result;
    } catch (error) {
      throw new Error(
        redactRpcSecrets(
          error instanceof Error ? error.message : String(error),
          secrets,
        ),
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return async <T>(
    url: string,
    method: string,
    params: unknown[],
  ): Promise<T> => withRetry(() => raw<T>(url, method, params), retry);
}
