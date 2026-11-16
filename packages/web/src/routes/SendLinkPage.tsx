import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { getModeCopy } from '../lib/copy';

export function SendLinkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const copy = getModeCopy('send-link');

  const [amount] = useState(50.0);
  const [token] = useState('USDC');
  const [chain] = useState('Base');
  const [recipientEvmAddress] = useState(
    '0x1111222233334444555566667777888899990000',
  );
  const [claiming, setClaiming] = useState(false);

  function handleClaim() {
    setClaiming(true);
    const orderId = `sendlink-${id ?? 'claim'}`;
    void navigate(`/swap/${orderId}`);
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link
          to="/send-links"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          ← All Send Links
        </Link>
      </div>

      <div className="card-ring relative rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
        <div className="mb-4 border-b border-hairline pb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-lime">
            Send Link
          </span>
          <h1 className="mt-1 text-xl font-bold text-text">
            Receive {amount.toFixed(2)} {token}
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            Sent from Bitcoin Cash through Ferry atomic swap.
          </p>
        </div>

        <div className="space-y-3 mb-5 text-xs">
          <div className="rounded-well border border-hairline bg-surface-2 p-3">
            <span className="text-text-dim block mb-1">
              {copy.receiveLabel}
            </span>
            <div className="text-xl font-semibold text-text">
              {amount.toFixed(2)} {token}
            </div>
            <span className="text-[11px] text-text-dim block mt-0.5">
              On {chain}
            </span>
          </div>

          <div className="rounded-well border border-hairline bg-surface-2 p-3">
            <span className="text-text-dim block mb-1">
              Enforced Recipient Address
            </span>
            <span className="font-mono text-text break-all text-[11px]">
              {recipientEvmAddress}
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={claiming}
          onClick={handleClaim}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold hover:bg-olive/90 transition-colors cursor-pointer shadow-elev-pill disabled:opacity-40"
        >
          <span>{claiming ? 'Processing claim…' : copy.actionLabel}</span>
        </button>

        <p className="mt-3 text-center text-[11px] text-text-dim">
          Direct atomic claim. If unclaimed within the time window, funds return
          safely to the sender.
        </p>
      </div>
    </div>
  );
}
