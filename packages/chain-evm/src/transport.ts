import { fallback, http, type Transport } from 'viem';

/**
 * One transport over a chain's endpoints, in order. A failing or rate-limited endpoint (HTTP 429)
 * hands the request to the next one at once: no retries inside an endpoint, because viem's
 * default of three retries turned one rate-limited request into four.
 */
export function rpcTransport(urls: readonly string[]): Transport {
  if (urls.length === 0) throw new Error('No RPC endpoint is configured');
  if (urls.length === 1) return http(urls[0], { retryCount: 1 });
  return fallback(
    urls.map((url) => http(url, { retryCount: 0 })),
    { retryCount: 1 },
  );
}
