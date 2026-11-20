import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmountSlider } from '../components/swap-block/AmountSlider';
import {
  readBchTokenBalance,
  shareOfBalance,
  snapPercent,
} from '../lib/wallet/send-balance';

describe('share of the balance', () => {
  it('snaps to 25, 50, 75 and 100 percent near them, and leaves other values alone', () => {
    expect(snapPercent(24)).toBe(25);
    expect(snapPercent(51)).toBe(50);
    expect(snapPercent(74)).toBe(75);
    expect(snapPercent(98)).toBe(100);
    expect(snapPercent(10)).toBe(10);
    expect(snapPercent(1)).toBe(0);
  });

  it('takes a share of the balance rounded down, for 6 and 18 decimals', () => {
    expect(shareOfBalance(38_040_000n, 50)).toBe(19_020_000n);
    expect(shareOfBalance(1_999n, 25)).toBe(499n);
    expect(shareOfBalance(5n * 10n ** 18n, 100)).toBe(5n * 10n ** 18n);
  });

  it('adds up the PUSD outputs of the wallet, ignoring other tokens', async () => {
    const pusd =
      '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
    const balance = await readBchTokenBalance(
      'PUSD',
      ['aa', 'bb'],
      async (b) =>
        b === 'aa'
          ? [{ token: { category: pusd, amount: 944n } }, {}]
          : [
              { token: { category: pusd, amount: 100n } },
              { token: { category: 'ff'.repeat(32), amount: 5000n } },
            ],
    );
    expect(balance).toBe(1044n);
  });
});

describe('AmountSlider', () => {
  it('shows the balance and reports the chosen share', () => {
    const onPercent = vi.fn();
    render(
      <AmountSlider
        percent={0}
        onPercent={onPercent}
        balanceText="38.04"
        symbol="USDC"
      />,
    );
    expect(screen.getByTestId('amount-slider')).toHaveTextContent('38.04 USDC');
    fireEvent.change(screen.getByRole('slider'), { target: { value: '49' } });
    expect(onPercent).toHaveBeenCalledWith(50);
    fireEvent.click(screen.getByRole('button', { name: '75%' }));
    expect(onPercent).toHaveBeenCalledWith(75);
  });
});
