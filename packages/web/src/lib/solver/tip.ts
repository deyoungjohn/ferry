let cached: { height: number; at: number } | null = null;

/** Forgets the remembered height (tests share this module's state between files). */
export function clearBchTipCache(): void {
  cached = null;
}

/**
 * Current Bitcoin Cash height, used to check a quote's timing. The solver
 * reports it on /v1/health; if it does not, ask a public block explorer.
 */
export async function readBchTipHeight(
  solverUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  if (cached && Date.now() - cached.at < 60_000) return cached.height;
  if (solverUrl) {
    try {
      const res = await fetchFn(`${solverUrl.replace(/\/+$/, '')}/v1/health`);
      if (res.ok) {
        const data = (await res.json()) as { tips?: { bchHeight?: number } };
        const height = data.tips?.bchHeight;
        if (typeof height === 'number' && height > 0) {
          cached = { height, at: Date.now() };
          return height;
        }
      }
    } catch {
      // fall through to the public source
    }
  }
  const res = await fetchFn('https://api.blockchair.com/bitcoin-cash/stats');
  if (!res.ok) throw new Error('Could not read the Bitcoin Cash height');
  const data = (await res.json()) as { data?: { blocks?: number } };
  const height = data.data?.blocks;
  if (typeof height !== 'number' || height <= 0) {
    throw new Error('Could not read the Bitcoin Cash height');
  }
  cached = { height, at: Date.now() };
  return height;
}
