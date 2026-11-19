import { useState } from 'react';
import { ROUTES } from '../lib/routes';
import { Link } from 'react-router';
import { HELP_COPY, type HelpGuideSection } from '../lib/copy';

export function HelpPage() {
  const [expandedSection, setExpandedSection] = useState<string | null>(
    HELP_COPY.sections[0]?.id ?? null,
  );

  const toggleSection = (id: string) => {
    setExpandedSection((curr) => (curr === id ? null : id));
  };

  return (
    <main
      className="mx-auto max-w-4xl px-4 py-8 sm:py-12"
      aria-labelledby="help-title"
    >
      {/* Header */}
      <div className="mb-8 text-center sm:mb-12">
        <h1
          id="help-title"
          className="font-accent text-3xl font-normal text-text sm:text-4xl"
        >
          {HELP_COPY.title}
        </h1>
        <p className="mt-2 text-sm text-text-muted sm:text-base max-w-xl mx-auto">
          {HELP_COPY.subtitle}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs">
          <Link
            to="/"
            className="rounded-pill bg-lime/10 px-3.5 py-1.5 font-medium text-lime hover:bg-lime/20 focus-visible:outline-lime transition-colors"
          >
            ← Back to Swap
          </Link>
          <Link
            to="/status"
            className="rounded-pill bg-surface-2 border border-hairline px-3.5 py-1.5 text-text-muted hover:text-text hover:border-text-muted/40 transition-colors"
          >
            Route Health & Status
          </Link>
          <Link
            to={ROUTES.recover}
            className="rounded-pill bg-surface-2 border border-hairline px-3.5 py-1.5 text-text-muted hover:text-text hover:border-text-muted/40 transition-colors"
          >
            Offline Recovery Tool
          </Link>
        </div>
      </div>

      {/* Guide Sections */}
      <div className="space-y-4" role="region" aria-label="User Guide Sections">
        {HELP_COPY.sections.map((section: HelpGuideSection) => {
          const isExpanded = expandedSection === section.id;
          return (
            <article
              key={section.id}
              className="rounded-card border border-hairline bg-surface-1/80 p-5 backdrop-blur-md transition-colors sm:p-6"
            >
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={isExpanded}
                aria-controls={`help-content-${section.id}`}
                className="flex w-full items-start justify-between gap-4 text-left focus-visible:outline-lime cursor-pointer"
              >
                <div>
                  <h2 className="text-lg font-semibold text-text sm:text-xl">
                    {section.title}
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    {section.summary}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className={`mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2 text-xs font-semibold text-text-muted transition-transform duration-200 ${
                    isExpanded ? 'rotate-180 text-lime' : ''
                  }`}
                >
                  ▼
                </span>
              </button>

              {isExpanded && (
                <div
                  id={`help-content-${section.id}`}
                  className="mt-5 border-t border-hairline/60 pt-4 text-sm text-text-muted space-y-4 animate-in fade-in-50 duration-150"
                >
                  {section.steps && section.steps.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">
                        Step-by-step flow
                      </h3>
                      <ol className="space-y-2 list-decimal list-inside text-text-muted/90 pl-1">
                        {section.steps.map((step, idx) => (
                          <li key={idx} className="leading-relaxed">
                            <span className="text-text font-normal">
                              {step}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-dim">
                      Key details & facts
                    </h3>
                    <ul className="space-y-1.5 list-disc list-inside text-text-muted/90 pl-1">
                      {section.details.map((detail, idx) => (
                        <li key={idx} className="leading-relaxed">
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Trust & Safety Footer Note */}
      <footer className="mt-12 rounded-well border border-hairline/60 bg-surface-2/40 p-5 text-center text-xs text-text-dim sm:p-6">
        <p>
          Ferry uses mathematical hash-time-locked contracts. Never send funds
          you cannot afford to risk. For command-line emergency recovery, refer
          to{' '}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 text-text font-mono text-[11px]">
            @ferry/recover-cli
          </code>{' '}
          in the project repository.
        </p>
      </footer>
    </main>
  );
}

export default HelpPage;
