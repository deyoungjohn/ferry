import { Link, useInRouterContext } from 'react-router';
import { MAINNET_CHAINS_FROM_FACTS } from '../lib/network';
import { NETWORK_LABEL, BANNER_CONFIG, getBannerWarnings } from '../lib/config';
import { PREDICTED_FERRY_HTLC_ADDRESS } from '@ferry/chain-config/browser';
import { AlertTriangleIcon, ExternalLinkIcon, CheckIcon, XIcon } from './icons';

export function NetworkBlockedPage() {
  const inRouter = useInRouterContext();
  const solverUrls = (
    import.meta.env?.VITE_SOLVER_URLS as string | undefined
  )?.trim();
  const isSolverConfigured = Boolean(solverUrls && solverUrls.length > 0);
  const bannerWarnings = getBannerWarnings(BANNER_CONFIG);
  const mainnetChains = MAINNET_CHAINS_FROM_FACTS;

  const statusLinkContent = (
    <>
      <span>View Route Status & Diagnostics</span>
      <ExternalLinkIcon className="size-3.5" />
    </>
  );

  const statusLinkClass =
    'inline-flex items-center gap-1.5 rounded-pill bg-olive px-4 py-2 text-xs font-semibold text-text hover:bg-olive/90 transition-colors shadow-elev-pill cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-lime';

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-12 sm:py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-warn/15 text-warn mb-5">
        <AlertTriangleIcon className="size-8" />
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
        {NETWORK_LABEL} Configuration Incomplete
      </h1>

      <p className="mt-2.5 max-w-lg text-sm text-text-muted leading-relaxed">
        The mainnet deployment profile is empty by default and gated until
        on-chain HTLC contracts are recorded, solver endpoints are configured,
        and required banner values are set.
      </p>

      {/* Diagnostics / Status CTA */}
      <div className="mt-5">
        {inRouter ? (
          <Link
            to="/status"
            data-testid="link-to-status"
            className={statusLinkClass}
          >
            {statusLinkContent}
          </Link>
        ) : (
          <a
            href="/status"
            data-testid="link-to-status"
            className={statusLinkClass}
          >
            {statusLinkContent}
          </a>
        )}
      </div>

      {/* Maintainer Checklist Section */}
      <div className="mt-8 w-full rounded-card border border-hairline bg-surface-1 p-4 sm:p-5 text-left shadow-lg">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim mb-3">
          Maintainer Environment Status
        </h2>

        {/* Global Configuration Status */}
        <div className="space-y-2.5 mb-5">
          <div className="flex items-start gap-2.5 text-xs">
            {isSolverConfigured ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-lime/20 text-lime shrink-0 mt-0.5">
                <CheckIcon className="size-3" />
              </span>
            ) : (
              <span className="flex size-4 items-center justify-center rounded-full bg-warn/20 text-warn shrink-0 mt-0.5">
                <XIcon className="size-3" />
              </span>
            )}
            <div>
              <span className="font-semibold text-text">Solver URL: </span>
              {isSolverConfigured ? (
                <span className="text-lime">{solverUrls}</span>
              ) : (
                <span className="text-warn font-mono">
                  Unset (VITE_SOLVER_URLS environment variable is missing)
                </span>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-xs">
            {bannerWarnings.length === 0 ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-lime/20 text-lime shrink-0 mt-0.5">
                <CheckIcon className="size-3" />
              </span>
            ) : (
              <span className="flex size-4 items-center justify-center rounded-full bg-warn/20 text-warn shrink-0 mt-0.5">
                <XIcon className="size-3" />
              </span>
            )}
            <div>
              <span className="font-semibold text-text">
                Banner Configuration:{' '}
              </span>
              {bannerWarnings.length === 0 ? (
                <span className="text-lime">
                  All required banner variables set
                </span>
              ) : (
                <span className="text-warn">
                  Missing values: {bannerWarnings.join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Per-Route Breakdown */}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-dim mb-2 pt-3 border-t border-hairline">
          Mainnet Routes Breakdown ({mainnetChains.length} routes discovered)
        </h3>

        <div className="space-y-2.5 mt-2">
          {mainnetChains.map((chain) => {
            const htlcMissing =
              !chain.enabled &&
              (!chain.disabledReason ||
                chain.disabledReason.toLowerCase().includes('htlc') ||
                chain.disabledReason.includes('not deployed'));

            return (
              <div
                key={chain.chainKey}
                data-testid={`mainnet-route-${chain.chainKey}`}
                className="rounded-lg border border-hairline bg-surface-2 p-3 text-xs"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-text">
                    {chain.name} ({chain.tokenSymbols.join(', ')})
                  </span>
                  <span
                    className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${
                      chain.enabled
                        ? 'bg-lime/20 text-lime'
                        : 'bg-warn/15 text-warn'
                    }`}
                  >
                    {chain.enabled ? 'Live' : 'HTLC Not Deployed'}
                  </span>
                </div>

                <div className="space-y-1 text-text-muted text-[11px]">
                  <div>
                    <span className="font-medium text-text-dim">
                      HTLC Deployment:{' '}
                    </span>
                    {chain.enabled ? (
                      <span className="text-lime">Verified deployed</span>
                    ) : (
                      <span>
                        Not deployed on-chain (predicted:{' '}
                        <code className="font-mono text-text-dim">
                          {PREDICTED_FERRY_HTLC_ADDRESS}
                        </code>
                        )
                      </span>
                    )}
                  </div>
                  {chain.disabledReason && !htlcMissing && (
                    <div>
                      <span className="font-medium text-text-dim">
                        Route Details:{' '}
                      </span>
                      <span className="text-warn">{chain.disabledReason}</span>
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-text-dim">
                      Solver Status:{' '}
                    </span>
                    {isSolverConfigured ? (
                      <span className="text-lime">
                        Solver endpoint available
                      </span>
                    ) : (
                      <span className="text-warn">
                        Requires VITE_SOLVER_URLS to route orders
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
