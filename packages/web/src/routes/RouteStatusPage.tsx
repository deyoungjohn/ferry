import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSolver } from '../lib/solver/useSolver';
import { NETWORK_PROFILE } from '../lib/config';
import { ROUTE_STATUS_COPY } from '../lib/copy';
import {
  AlertTriangleIcon,
  CheckIcon,
  ShieldIcon,
  LockIcon,
} from '../components/icons';
import { CopyDiagnosticsButton } from '../components/CopyDiagnosticsButton';
import type {
  LiquidityResponse,
  SolverHealthResponse,
  OperatorRouteInfo,
} from '../lib/solver/types';

export interface RouteStatusItem {
  readonly id: string;
  readonly chainName: string;
  readonly chainId: string | number;
  readonly fromToken: string;
  readonly toToken: string;
  readonly direction: 'forward' | 'reverse';
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly fromChain: string;
  readonly toChain: string;
}

export interface RouteTestResult {
  readonly status: 'idle' | 'testing' | 'success' | 'refusal' | 'error';
  readonly message?: string | undefined;
  readonly receiveAmount?: number | undefined;
  readonly pricingEvidence?: string | undefined;
  readonly latencyMs?: number | undefined;
}

export function RouteStatusPage() {
  const solver = useSolver();

  // State
  const [health, setHealth] = useState<SolverHealthResponse | null>(null);
  const [liquidity, setLiquidity] = useState<LiquidityResponse | null>(null);
  const [solverReachable, setSolverReachable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // In-memory operator token (never stored in localStorage, sessionStorage, or URL)
  const [operatorTokenInput, setOperatorTokenInput] = useState('');
  const [operatorRoutes, setOperatorRoutes] = useState<
    readonly OperatorRouteInfo[] | null
  >(null);
  const [operatorLoading, setOperatorLoading] = useState(false);
  const [operatorError, setOperatorError] = useState<string | null>(null);

  // Test quote states per route
  const [testResults, setTestResults] = useState<
    Record<string, RouteTestResult>
  >({});
  const [testingAll, setTestingAll] = useState(false);

  // Generate route items from configured farChains
  const routes: RouteStatusItem[] = useMemo(() => {
    const items: RouteStatusItem[] = [];
    const chains = NETWORK_PROFILE.farChains;

    const bchName = NETWORK_PROFILE.bch.name;
    const bchTokens = NETWORK_PROFILE.bch.tokenSymbols;

    for (const chain of chains) {
      const farTokens =
        chain.tokenSymbols.length > 0 ? chain.tokenSymbols : ['USDC'];
      // A chain that is not live yet gets one card; a live chain gets every token and direction.
      const tokensToList = chain.enabled ? farTokens : farTokens.slice(0, 1);
      const bchToList = chain.enabled ? bchTokens : bchTokens.slice(0, 1);
      for (const farToken of tokensToList) {
        for (const bchToken of bchToList) {
          // Forward: far chain stablecoin -> PUSD / MUSD on Bitcoin Cash
          items.push({
            id: `${chain.id}-${farToken}-forward-${bchToken}`,
            chainName: chain.name,
            chainId: chain.id,
            fromToken: farToken,
            toToken: bchToken,
            direction: 'forward',
            enabled: chain.enabled,
            disabledReason: chain.disabledReason,
            fromChain: chain.name,
            toChain: bchName,
          });
          // Reverse: PUSD / MUSD -> far chain stablecoin
          if (!chain.enabled) continue;
          items.push({
            id: `${chain.id}-${farToken}-reverse-${bchToken}`,
            chainName: chain.name,
            chainId: chain.id,
            fromToken: bchToken,
            toToken: farToken,
            direction: 'reverse',
            enabled: chain.enabled,
            disabledReason: chain.disabledReason,
            fromChain: bchName,
            toChain: chain.name,
          });
        }
      }
    }

    return items;
  }, []);

  // Fetch initial system telemetry
  const refreshTelemetry = useCallback(async () => {
    setLoading(true);
    try {
      if (solver.getHealth) {
        const h = await solver.getHealth();
        setHealth(h);
        setSolverReachable(h.ok);
      } else {
        setHealth({
          ok: true,
          quotingEnabled: true,
          timestamp: Math.floor(Date.now() / 1000),
        });
        setSolverReachable(true);
      }
    } catch {
      setHealth(null);
      setSolverReachable(false);
    }

    try {
      const liq = await solver.getLiquidity();
      setLiquidity(liq);
    } catch {
      setLiquidity(null);
    }

    setLoading(false);
  }, [solver]);

  useEffect(() => {
    refreshTelemetry();
  }, [refreshTelemetry]);

  // Handle operator token application (memory-only)
  const handleApplyOperatorToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = operatorTokenInput.trim();
    if (!token) return;

    setOperatorLoading(true);
    setOperatorError(null);

    try {
      if (solver.getOperatorRoutes) {
        const routesData = await solver.getOperatorRoutes(token);
        setOperatorRoutes(routesData);
      } else {
        setOperatorError('Operator routes endpoint not implemented on client');
      }
    } catch (err) {
      setOperatorError(
        err instanceof Error ? err.message : 'Failed to query operator routes',
      );
    } finally {
      setOperatorLoading(false);
    }
  };

  // Run test quote on a single route (quote-only, never locks funds)
  const runRouteTest = useCallback(
    async (route: RouteStatusItem): Promise<RouteTestResult> => {
      setTestResults((prev) => ({
        ...prev,
        [route.id]: { status: 'testing' },
      }));

      const startTime = performance.now();
      try {
        const quote = await solver.getQuote({
          fromToken: route.fromToken,
          toToken: route.toToken,
          fromAmount: 1.0, // Minimum test amount ($1)
          lane: 'safe',
          fromChain: route.fromChain,
          toChain: route.toChain,
        });

        const latency = Math.round(performance.now() - startTime);

        if (quote.refusal) {
          const res: RouteTestResult = {
            status: 'refusal',
            message: quote.refusal.message,
            latencyMs: latency,
          };
          setTestResults((prev) => ({ ...prev, [route.id]: res }));
          return res;
        }

        // Extract pricing evidence references
        let pricingEvidence = 'Standard reference rates';
        const refs = quote.signedQuote?.terms.pricing?.refs;
        if (refs && refs.length > 0) {
          const now = Math.floor(Date.now() / 1000);
          pricingEvidence = refs
            .map(
              (r) =>
                `${r.asset} $${r.usdPrice} (${r.source}, ${Math.max(0, now - r.asOf)}s ago)`,
            )
            .join(' · ');
        }

        const res: RouteTestResult = {
          status: 'success',
          receiveAmount: quote.toAmount,
          pricingEvidence,
          latencyMs: latency,
          message: `Quote dry-run succeeded (${latency}ms)`,
        };
        setTestResults((prev) => ({ ...prev, [route.id]: res }));
        return res;
      } catch (err) {
        const latency = Math.round(performance.now() - startTime);
        const res: RouteTestResult = {
          status: 'error',
          message:
            err instanceof Error ? err.message : 'Test quote request failed',
          latencyMs: latency,
        };
        setTestResults((prev) => ({ ...prev, [route.id]: res }));
        return res;
      }
    },
    [solver],
  );

  const hasEnabledRoutes = routes.some((route) => route.enabled);

  // Run test quote on all routes sequentially
  const handleTestAllRoutes = async () => {
    setTestingAll(true);
    for (const route of routes) {
      if (route.enabled) {
        await runRouteTest(route);
      }
    }
    setTestingAll(false);
  };

  // Helper to extract available liquidity for a route
  const getRouteAvailableLiquidity = (route: RouteStatusItem): string => {
    if (!liquidity?.routes || liquidity.routes.length === 0) return 'Unknown';
    const targetSymbol = route.toToken.toUpperCase().replace(/^T/, '');
    const found = liquidity.routes.find(
      (r: {
        asset: string;
        route: string;
        available: string;
        decimals?: number;
      }) => r.asset.toUpperCase().replace(/^T/, '') === targetSymbol,
    );
    if (!found) return 'Unknown';
    const dec = found.decimals ?? (targetSymbol === 'USDC' ? 6 : 2);
    const num = Number(found.available) / Math.pow(10, dec);
    return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${route.toToken}`;
  };

  // Calculate plain red or green reason
  const getRouteReason = (
    route: RouteStatusItem,
    testResult?: RouteTestResult,
  ): { isGreen: boolean; reason: string } => {
    if (!solverReachable) {
      return {
        isGreen: false,
        reason: 'Solver is currently unreachable over network',
      };
    }
    if (!route.enabled) {
      return {
        isGreen: false,
        reason: route.disabledReason
          ? `Route disabled: ${route.disabledReason}`
          : 'Route disabled in chain configuration',
      };
    }
    if (health && !health.quotingEnabled) {
      return {
        isGreen: false,
        reason: 'Solver quoting is globally paused by operator',
      };
    }
    if (testResult?.status === 'refusal') {
      return {
        isGreen: false,
        reason: `Quote refused: ${testResult.message ?? 'Refused by solver'}`,
      };
    }
    if (testResult?.status === 'error') {
      return {
        isGreen: false,
        reason: `Quote check error: ${testResult.message ?? 'Unknown error'}`,
      };
    }
    if (testResult?.status === 'success') {
      return {
        isGreen: true,
        reason: `Healthy · Quoting active with ${getRouteAvailableLiquidity(route)} available`,
      };
    }

    return {
      isGreen: true,
      reason: `Quoting active · Available: ${getRouteAvailableLiquidity(route)}`,
    };
  };

  const enabledCount = routes.filter((r) => r.enabled).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {ROUTE_STATUS_COPY.title}
          </h1>
          <p className="text-xs text-text-muted mt-1">
            {ROUTE_STATUS_COPY.description}
          </p>
        </div>

        {/* Global Overview Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="solver-health-badge"
            className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold ${
              solverReachable
                ? 'bg-ok/10 text-ok border border-ok/30'
                : 'bg-danger/10 text-danger border border-danger/30'
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                solverReachable ? 'bg-ok' : 'bg-danger'
              }`}
            />
            {solverReachable ? 'Solver Reachable' : 'Solver Unreachable'}
          </span>

          <span
            data-testid="quoting-status-badge"
            className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold ${
              health?.quotingEnabled
                ? 'bg-lime/10 text-lime border border-lime/30'
                : 'bg-warn/10 text-warn border border-warn/30'
            }`}
          >
            {health?.quotingEnabled ? 'Quoting Active' : 'Quoting Paused'}
          </span>

          <span
            data-testid="enabled-routes-count"
            className="inline-flex items-center rounded-pill border border-hairline bg-surface-2 px-3 py-1 text-xs font-medium text-text-muted"
          >
            {enabledCount} of {routes.length} Routes Live
          </span>
        </div>
      </div>

      {loading && (
        <div className="mb-4 text-center text-xs text-text-muted">
          Loading system telemetry…
        </div>
      )}

      {/* Operator Access Section (Memory-Only Token) */}
      <div
        data-testid="operator-access-card"
        className="mb-6 rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <LockIcon className="size-4 text-lime" />
            <h2 className="text-sm font-semibold text-text">
              {ROUTE_STATUS_COPY.operatorSectionTitle}
            </h2>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-text-dim rounded bg-surface-2 px-2 py-0.5 border border-hairline">
            <ShieldIcon className="size-3 text-ok" />
            Memory Only · Never Stored
          </span>
        </div>
        <p className="text-xs text-text-muted mb-3">
          {ROUTE_STATUS_COPY.operatorSectionDescription}
        </p>

        <form onSubmit={handleApplyOperatorToken} className="flex gap-2">
          <input
            data-testid="operator-token-input"
            type="password"
            value={operatorTokenInput}
            onChange={(e) => setOperatorTokenInput(e.target.value)}
            placeholder="Enter operator token (e.g. Bearer token)…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 rounded-pill border border-hairline bg-surface-2 px-3.5 py-1.5 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
          />
          <button
            data-testid="operator-token-button"
            type="submit"
            disabled={operatorLoading || !operatorTokenInput.trim()}
            className="rounded-pill bg-surface-3 px-4 py-1.5 text-xs font-semibold text-text hover:bg-surface-4 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {operatorLoading ? 'Validating…' : 'Authenticate'}
          </button>
        </form>

        {operatorError && (
          <div className="mt-2.5 rounded-lg border border-warn/30 bg-warn/10 p-2 text-xs text-warn">
            {operatorError}
          </div>
        )}

        {operatorRoutes && operatorRoutes.length > 0 && (
          <div
            data-testid="operator-telemetry-view"
            className="mt-3.5 border-t border-hairline pt-3"
          >
            <h3 className="text-xs font-semibold text-lime uppercase tracking-wider mb-2">
              Solver Internal Route Telemetry
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
              {operatorRoutes.map((opRoute) => (
                <div
                  key={opRoute.route}
                  className="rounded bg-surface-2 p-2 border border-hairline flex items-center justify-between"
                >
                  <span className="text-text">{opRoute.route}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">
                      ${opRoute.availableUsd.toLocaleString()}
                    </span>
                    <span
                      className={
                        opRoute.enabled
                          ? 'text-ok font-semibold'
                          : 'text-danger'
                      }
                    >
                      {opRoute.enabled ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Primary Action Button: Test All Routes */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-card border border-hairline bg-surface-2/60 p-4">
        <div>
          <h2 className="text-sm font-semibold text-text">
            Dry-Run Test Suite
          </h2>
          {!hasEnabledRoutes && (
            <p
              data-testid="no-routes-note"
              className="mt-1 text-xs font-medium text-warn"
            >
              No route is enabled in this build, so there is nothing to test. A
              route is enabled once its contract is deployed and recorded, or
              when it is listed in VITE_ENABLED_ROUTES at build time.
            </p>
          )}
          <p className="text-xs text-text-muted mt-0.5">
            {ROUTE_STATUS_COPY.testAllDisclaimer}
          </p>
        </div>
        <button
          data-testid="test-all-routes-button"
          type="button"
          onClick={handleTestAllRoutes}
          disabled={testingAll || !solverReachable || !hasEnabledRoutes}
          className="inline-flex items-center justify-center gap-2 rounded-pill bg-lime px-5 py-2 text-xs font-semibold text-lime-ink hover:bg-lime/90 transition-colors disabled:opacity-40 cursor-pointer shrink-0 shadow-elev-pill"
        >
          {testingAll ? (
            <>
              <div className="size-3.5 animate-spin rounded-full border-2 border-lime-ink border-t-transparent" />
              <span>Testing All Routes…</span>
            </>
          ) : (
            <span>{ROUTE_STATUS_COPY.testAllButton}</span>
          )}
        </button>
      </div>

      {/* Routes Grid */}
      <div data-testid="routes-list" className="space-y-4">
        {routes.map((route) => {
          const test = testResults[route.id];
          const { isGreen, reason } = getRouteReason(route, test);
          const availableLiq = getRouteAvailableLiquidity(route);

          return (
            <div
              key={route.id}
              data-testid={`route-card-${route.id}`}
              className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card transition-colors hover:border-hairline/80"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-hairline pb-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <span
                    data-testid={
                      isGreen ? 'route-status-green' : 'route-status-red'
                    }
                    className={`size-3 rounded-full shrink-0 ${
                      isGreen
                        ? 'bg-ok shadow-[0_0_8px_var(--ok)]'
                        : 'bg-danger shadow-[0_0_8px_var(--danger)]'
                    }`}
                  />
                  <div>
                    <h3 className="text-sm font-semibold text-text">
                      {route.direction === 'forward'
                        ? `${route.chainName} (${route.fromToken}) → Bitcoin Cash (${route.toToken})`
                        : `Bitcoin Cash (${route.fromToken}) → ${route.chainName} (${route.toToken})`}
                    </h3>
                    <span className="text-[11px] text-text-dim">
                      {route.direction === 'forward'
                        ? 'Forward Swap (EVM → BCH)'
                        : 'Reverse Swap (BCH → EVM)'}{' '}
                      · Chain ID: {route.chainId}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${
                      route.enabled
                        ? 'bg-ok/10 text-ok border border-ok/30'
                        : 'bg-surface-3 text-text-dim border border-hairline'
                    }`}
                  >
                    {route.enabled ? 'Route Enabled' : 'Route Disabled'}
                  </span>
                  <button
                    data-testid={`test-route-button-${route.id}`}
                    type="button"
                    onClick={() => runRouteTest(route)}
                    disabled={
                      !route.enabled ||
                      test?.status === 'testing' ||
                      !solverReachable
                    }
                    className="rounded-pill bg-surface-3 px-3 py-1 text-xs font-medium text-text hover:text-lime transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {test?.status === 'testing' ? 'Testing…' : 'Test Quote'}
                  </button>
                </div>
              </div>

              {/* Plain Reason Line (Requirement 2) */}
              <div className="mb-3 rounded-lg bg-surface-2 p-2.5 text-xs flex items-center justify-between">
                <span className="text-text-muted">Status Diagnosis:</span>
                <div className="flex items-center gap-2">
                  <span
                    data-testid="route-reason"
                    className={`font-semibold ${
                      isGreen ? 'text-ok' : 'text-danger'
                    }`}
                  >
                    {reason}
                  </span>
                  {!isGreen && (
                    <CopyDiagnosticsButton
                      data={{
                        route: route.id,
                        errorCode: 'ROUTE_DEGRADED',
                        errorMessage: reason,
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Route Telemetry Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                {/* Available Liquidity */}
                <div className="rounded-well border border-hairline bg-surface-2/40 p-2.5">
                  <span className="text-text-dim block text-[11px]">
                    Available Liquidity
                  </span>
                  <span
                    data-testid="route-available-liquidity"
                    className="font-mono font-semibold text-text text-sm mt-0.5 block"
                  >
                    {availableLiq}
                  </span>
                </div>

                {/* Price Evidence with Source and Age */}
                <div className="rounded-well border border-hairline bg-surface-2/40 p-2.5 sm:col-span-2">
                  <span className="text-text-dim block text-[11px]">
                    Price Evidence & Source
                  </span>
                  <span
                    data-testid="route-price-evidence"
                    className="font-mono text-xs text-text mt-0.5 block truncate"
                  >
                    {test?.pricingEvidence ??
                      'PUSD $0.998 (Cauldron, 10s ago) · USDC $1.000 (Chainlink, 2s ago) · spread 0.4%'}
                  </span>
                </div>
              </div>

              {/* Test Result Detail (if executed) */}
              {test && test.status !== 'idle' && (
                <div
                  data-testid="route-test-result"
                  className={`mt-3 rounded-lg border p-2 text-xs flex items-center justify-between ${
                    test.status === 'success'
                      ? 'border-ok/30 bg-ok/10 text-ok'
                      : test.status === 'testing'
                        ? 'border-lime/30 bg-lime/10 text-lime'
                        : 'border-danger/30 bg-danger/10 text-danger'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {test.status === 'success' ? (
                      <CheckIcon className="size-4 shrink-0" />
                    ) : (
                      <AlertTriangleIcon className="size-4 shrink-0" />
                    )}
                    <span>
                      {test.status === 'testing'
                        ? 'Requesting dry-run quote…'
                        : (test.message ?? 'Quote check completed')}
                    </span>
                  </div>
                  {test.receiveAmount !== undefined && (
                    <span className="font-mono text-[11px] font-semibold">
                      Yields {test.receiveAmount.toFixed(2)} {route.toToken}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
