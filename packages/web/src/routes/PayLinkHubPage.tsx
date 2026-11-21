import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router';

const PayLinksPage = lazy(async () => {
  const m = await import('./PayLinksPage');
  return { default: m.PayLinksPage };
});
const SendLinksPage = lazy(async () => {
  const m = await import('./SendLinksPage');
  return { default: m.SendLinksPage };
});

export function PayLinkHubPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('type') === 'send' ? 'send' : 'pay';

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 pt-8">
        <div
          role="tablist"
          aria-label="Link type"
          className="mx-auto flex w-fit gap-1 rounded-pill border border-hairline bg-surface-2 p-1"
        >
          {(
            [
              ['pay', 'Pay link'],
              ['send', 'Send link'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setParams(key === 'send' ? { type: 'send' } : {})}
              className={`rounded-pill px-5 py-1.5 text-xs font-semibold transition-colors ${
                tab === key
                  ? 'bg-lime text-lime-ink'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={null}>
        {tab === 'send' ? <SendLinksPage /> : <PayLinksPage />}
      </Suspense>
    </>
  );
}
