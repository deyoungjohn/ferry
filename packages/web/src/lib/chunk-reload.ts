/**
 * A tab opened before a deploy asks for the previous build's chunk files. If one is gone, reload
 * the page once to pick up the new build. A flag in the session stops a reload loop.
 */
const FLAG = 'ferry.chunk-reload-at';

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(
    text,
  );
}

/** Reloads once per minute at most; returns whether it reloaded. */
export function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(FLAG) ?? '0');
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    // Storage blocked: reload anyway, once in this page's life.
  }
  window.location.reload();
  return true;
}

/** Listens for Vite's failed-preload event and reloads once. */
export function installChunkReload(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForNewBuild()) event.preventDefault();
  });
}
