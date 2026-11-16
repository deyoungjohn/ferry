import { redactRpcSecrets, type RpcCaller } from './rpc-overrides.js';

export function makeJsonRpc(secrets: readonly string[]): RpcCaller {
  return async <T>(
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
}
