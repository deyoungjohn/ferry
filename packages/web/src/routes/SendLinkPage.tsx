import { useEffect, useState } from 'react';
import { ROUTES } from '../lib/routes';
import { useParams, useNavigate, Link } from 'react-router';
import { getModeCopy } from '../lib/copy';
import { useSolver } from '../lib/solver/useSolver';
import type { SendLinkView } from '../lib/solver/types';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'ready'; readonly link: SendLinkView };

function formatDeadline(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

export function SendLinkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const solver = useSolver();
  const copy = getModeCopy('send-link');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    let active = true;
    setLoad({ state: 'loading' });
    const read = solver.getSendLink?.(id ?? '') ?? Promise.resolve(null);
    read.then(
      (link) => {
        if (active)
          setLoad(link ? { state: 'ready', link } : { state: 'missing' });
      },
      () => {
        if (active) setLoad({ state: 'missing' });
      },
    );
    return () => {
      active = false;
    };
  }, [id, solver]);

  function handleClaim() {
    setClaiming(true);
    const orderId = `sendlink-${id ?? 'claim'}`;
    void navigate(ROUTES.swapOrder(orderId));
  }

  const link = load.state === 'ready' ? load.link : null;
  const claimable =
    link !== null && (link.status === 'open' || link.status === 'locked');

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link
          to={ROUTES.sendLink}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          ← All Send Links
        </Link>
      </div>

      <div className="card-ring relative rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
        {load.state === 'loading' && (
          <p className="text-xs text-text-muted" role="status">
            Loading this link…
          </p>
        )}

        {load.state === 'missing' && (
          <div data-testid="send-link-missing" className="text-xs">
            <h1 className="text-base font-semibold text-text">
              This link was not found
            </h1>
            <p className="mt-2 text-text-muted">
              It may have been mistyped, or it was made on another device. Ask
              the sender for the link again.
            </p>
          </div>
        )}

        {link && (
          <>
            <div className="mb-4 border-b border-hairline pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-lime">
                Send Link
              </span>
              <h1 className="mt-1 text-xl font-bold text-text">
                {link.amount !== null
                  ? `Receive ${link.amount.toFixed(2)} ${link.token}`
                  : `Receive ${link.token}`}
              </h1>
              <p className="mt-1 text-xs text-text-muted">
                Sent from Bitcoin Cash through Ferry atomic swap.
              </p>
            </div>

            {link.note && (
              <figure
                data-testid="send-link-note"
                className="mb-4 rounded-well border border-lime/30 bg-lime/5 p-3"
              >
                <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-lime">
                  Note from the sender
                </figcaption>
                {/* Plain text: React escapes it, so markup in a note is shown, never run. */}
                <blockquote className="mt-1 text-sm text-text break-words">
                  {link.note}
                </blockquote>
              </figure>
            )}

            <div className="space-y-3 mb-5 text-xs">
              <div className="rounded-well border border-hairline bg-surface-2 p-3">
                <span className="text-text-dim block mb-1">
                  {copy.receiveLabel}
                </span>
                <div className="text-xl font-semibold text-text">
                  {link.amount !== null ? link.amount.toFixed(2) : '—'}{' '}
                  {link.token}
                </div>
                <span className="text-[11px] text-text-dim block mt-0.5">
                  On {link.chain}
                </span>
              </div>

              <div className="rounded-well border border-hairline bg-surface-2 p-3">
                <span className="text-text-dim block mb-1">
                  Enforced Recipient Address
                </span>
                <span className="font-mono text-text break-all text-[11px]">
                  {link.recipientEvmAddress}
                </span>
              </div>

              {link.expiresAt !== null && (
                <div className="rounded-well border border-hairline bg-surface-2 p-3">
                  <span className="text-text-dim block mb-1">Claim before</span>
                  <span className="text-text">
                    {formatDeadline(link.expiresAt)}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={claiming || !claimable}
              onClick={handleClaim}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold hover:bg-olive/90 transition-colors cursor-pointer shadow-elev-pill disabled:opacity-40"
            >
              <span>
                {claiming
                  ? 'Processing claim…'
                  : claimable
                    ? copy.actionLabel
                    : link.status === 'claimed'
                      ? 'Already claimed'
                      : 'This link is no longer open'}
              </span>
            </button>

            <p className="mt-3 text-center text-[11px] text-text-dim">
              Direct atomic claim. If unclaimed within the time window, funds
              return safely to the sender.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
