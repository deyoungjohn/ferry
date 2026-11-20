import { snapPercent } from '../../lib/wallet/send-balance';

/**
 * Picks a share of the connected wallet's balance, snapping to 25, 50, 75 and 100 percent. Not
 * drawn when there is no balance to take a share of (no wallet connected yet, or an empty one).
 */
export function AmountSlider({
  percent,
  onPercent,
  balanceText,
  symbol,
}: {
  percent: number;
  onPercent: (percent: number) => void;
  /** The balance as shown ("38.04"). */
  balanceText: string;
  symbol: string;
}) {
  return (
    <div className="px-1 pt-1" data-testid="amount-slider">
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>
          Balance:{' '}
          <span className="font-semibold text-text">
            {balanceText} {symbol}
          </span>
        </span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label={`Share of your ${symbol} balance to swap`}
        onChange={(e) => onPercent(snapPercent(Number(e.target.value)))}
        className="mt-1 h-1.5 w-full cursor-pointer accent-[#c6f219]"
      />
      <div className="mt-1 flex justify-between text-[10px] text-text-dim">
        {[0, 25, 50, 75, 100].map((mark) => (
          <button
            key={mark}
            type="button"
            onClick={() => onPercent(mark)}
            className="rounded px-1 hover:text-text"
          >
            {mark === 0 ? '0' : `${mark}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
