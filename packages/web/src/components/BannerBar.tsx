import { useState } from 'react';
import { BANNER_CONFIG, getBannerWarnings } from '../lib/config';
import { AlertTriangleIcon, CheckIcon, CopyIcon } from './icons';

export function BannerBar() {
  const [copied, setCopied] = useState(false);
  const warnings = getBannerWarnings(BANNER_CONFIG);

  const hasPriorLinks = Boolean(
    BANNER_CONFIG.priorRepoUrl || BANNER_CONFIG.priorDemoUrl,
  );

  async function handleCopy() {
    if (!BANNER_CONFIG.emberAddress) return;
    try {
      await navigator.clipboard.writeText(BANNER_CONFIG.emberAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures in non-secure contexts
    }
  }

  return (
    <aside aria-label="Project banner" className="w-full">
      {warnings.length > 0 && (
        <div
          role="alert"
          aria-label="Build warning"
          className="flex items-center justify-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs font-medium text-warn"
        >
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          <span>
            Build warning: Banner configuration incomplete (
            {warnings.join(', ')})
          </span>
        </div>
      )}

      <div className="border-b border-hairline bg-surface-1/60 text-[11px] text-text-muted">
        <div className="mx-auto flex h-9 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex truncate items-center gap-1.5">
            <span>Built on prior work</span>
            {hasPriorLinks ? (
              <span className="hidden sm:inline-flex items-center gap-1.5">
                :
                {BANNER_CONFIG.priorRepoUrl && (
                  <a
                    href={BANNER_CONFIG.priorRepoUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-text underline-offset-2 hover:underline hover:text-lime"
                  >
                    prior repo
                  </a>
                )}
                {BANNER_CONFIG.priorDemoUrl ? (
                  <>
                    <span>·</span>
                    <a
                      href={BANNER_CONFIG.priorDemoUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-text underline-offset-2 hover:underline hover:text-lime"
                    >
                      prior demo
                    </a>
                  </>
                ) : (
                  BANNER_CONFIG.priorRepoUrl && (
                    <span>
                      (the pre-event version ran locally; recording on request)
                    </span>
                  )
                )}
              </span>
            ) : (
              <span className="hidden text-text-dim sm:inline">
                : unconfigured
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {BANNER_CONFIG.deckUrl && (
              <a
                href={BANNER_CONFIG.deckUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-text"
              >
                Deck
              </a>
            )}
            {BANNER_CONFIG.repoUrl && (
              <a
                href={BANNER_CONFIG.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-text"
              >
                Repo
              </a>
            )}
            {(BANNER_CONFIG.deckUrl || BANNER_CONFIG.repoUrl) && (
              <span
                className="hidden h-3 w-px bg-hairline sm:block"
                aria-hidden="true"
              />
            )}
            <div className="inline-flex items-center gap-1.5">
              <span className="font-medium text-text-muted">EMBER2026:</span>
              {BANNER_CONFIG.emberAddress ? (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 font-mono text-text transition-colors hover:text-lime"
                  title="Copy EMBER2026 address"
                  aria-label="Copy EMBER2026 address"
                >
                  <span>
                    {BANNER_CONFIG.emberAddress.slice(0, 10)}…
                    {BANNER_CONFIG.emberAddress.slice(-6)}
                  </span>
                  {copied ? (
                    <CheckIcon className="size-3 text-ok" />
                  ) : (
                    <CopyIcon className="size-3 text-text-muted" />
                  )}
                </button>
              ) : (
                <span className="font-mono text-warn">not set</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
