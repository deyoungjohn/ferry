export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface UrlCheckOptions {
  fetch?: FetchLike;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Provide an absolute http(s) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provide an http(s) URL.');
  }
  return url;
}

export async function runUrlCheck(
  rawUrl: string,
  options: UrlCheckOptions = {},
): Promise<number> {
  const out = options.stdout ?? ((line: string) => console.log(line));
  const err = options.stderr ?? ((line: string) => console.error(line));
  const fetchFn = options.fetch ?? fetch;

  let endpoint: URL;
  try {
    endpoint = new URL('/v1/health', parseBaseUrl(rawUrl));
  } catch (error) {
    err(
      `preflight --url: ${error instanceof Error ? error.message : 'invalid URL'}`,
    );
    return 1;
  }

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    err(`FAIL ${endpoint.toString()} did not respond`);
    return 1;
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    err('this URL is not a Ferry solver (it returned HTML)');
    return 1;
  }

  if (!response.ok) {
    err(`FAIL ${endpoint.toString()} returned HTTP ${response.status}`);
    return 1;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    err(
      'this URL is not a Ferry solver (it returned JSON but not a health object)',
    );
    return 1;
  }

  out(`PASS ${endpoint.toString()} returned JSON (HTTP ${response.status})`);
  return 0;
}
