import { BubbleSlider } from './range-slider-bubble';

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
    // mb-5: the flip button below overlaps its neighbours by 16px; the marks stay clear of it.
    <div className="mb-5 px-1 pt-1" data-testid="amount-slider">
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>
          Balance:{' '}
          <span className="font-semibold text-text">
            {balanceText} {symbol}
          </span>
        </span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <BubbleSlider
        min={0}
        max={100}
        step={1}
        value={percent}
        onValueChange={onPercent}
        snapPoints={[0, 25, 50, 75, 100]}
        format={(v) => `${Math.round(v)}%`}
        aria-label={`Share of your ${symbol} balance to swap`}
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
