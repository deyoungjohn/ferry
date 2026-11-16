export interface DiagnosticsData {
  readonly route?: string | undefined;
  readonly solverUrls?: readonly string[] | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly orderId?: string | undefined;
  readonly timestamp?: number | string | undefined;
  readonly extra?: Record<string, unknown> | undefined;
}

export function sanitizeDiagnostics(data: DiagnosticsData): string {
  // Strip hostnames only from solver URLs
  const hosts = data.solverUrls
    ? data.solverUrls.map((url) => {
        try {
          return new URL(url).host;
        } catch {
          return url.replace(/^https?:\/\//, '').split('/')[0];
        }
      })
    : [];

  // Redact any secrets or URL fragments
  let safeRoute = data.route;
  if (typeof window !== 'undefined' && !safeRoute) {
    safeRoute = window.location.pathname; // pathname only, NEVER window.location.hash or search fragments with secrets
  }

  const payload = {
    timestamp: data.timestamp ?? new Date().toISOString(),
    route: safeRoute,
    solverHosts: hosts,
    errorCode: data.errorCode,
    errorMessage: data.errorMessage,
    orderId: data.orderId,
    ...(data.extra ? { details: data.extra } : {}),
  };

  return JSON.stringify(payload, null, 2);
}
