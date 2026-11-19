import { chainIconUrl, tokenIconUrl } from '../lib/icons';
import type { SwapEnd } from '../lib/paylink/order-steps';

/** A token's artwork with its chain's artwork as a small superscript badge. */
function TokenWithChain({ end }: { end: SwapEnd }) {
  const token = tokenIconUrl(end.token);
  const chain = end.chain === 'bch' ? null : chainIconUrl(end.chain);
  return (
    <span className="relative inline-flex size-9 shrink-0">
      {token ? (
        <img src={token} alt="" className="size-9 rounded-full" />
      ) : (
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text">
          {end.token.slice(0, 2)}
        </span>
      )}
      <span className="absolute -right-1 -top-1 inline-flex size-4 items-center justify-center overflow-hidden rounded-full border-2 border-bg bg-lime text-[8px] font-bold text-black">
        {end.chain === 'bch' ? (
          '₿'
        ) : chain ? (
          <img src={chain} alt="" className="size-full object-cover" />
        ) : null}
      </span>
    </span>
  );
}

function End({ end, align }: { end: SwapEnd; align: 'left' | 'right' }) {
  return (
    <span
      className={`flex items-center gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      <TokenWithChain end={end} />
      <span className="text-xl font-bold text-text">
        {end.amount} {end.token}
      </span>
    </span>
  );
}

/** From on the left, To on the right, each with its amount, token and chain; no arrow. */
export function SwapEnds({ from, to }: { from: SwapEnd; to: SwapEnd }) {
  return (
    <div
      className="mt-5 flex items-start justify-between gap-4"
      data-testid="order-amount"
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs text-text-dim">From</span>
        <End end={from} align="left" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="text-xs text-text-dim">To</span>
        <End end={to} align="right" />
      </div>
    </div>
  );
}
