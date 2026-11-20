import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmountSlider } from '../components/swap-block/AmountSlider';
import {
  readEvmTokenBalance,
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
    // The thumb is a slider: keys move it, the marks below jump to a share.
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(onPercent).toHaveBeenCalledWith(1);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(onPercent).toHaveBeenCalledWith(100);
    fireEvent.click(screen.getByRole('button', { name: '75%' }));
    expect(onPercent).toHaveBeenCalledWith(75);
  });
});

describe('the EVM balance read', () => {
  const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const owner = '0x12DC0000000000000000000000000000001Da841';

  it('uses the solver first and reads no public endpoint when it answers', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ balance: '38040000' }),
    ) as unknown as typeof fetch;
    const balance = await readEvmTokenBalance(8453, token, owner, {
      solverUrl: 'https://solver.test',
      fetchFn,
    });
    expect(balance).toBe(38_040_000n);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats a solver refusal as the answer and does not fall back', async () => {
    const fetchFn = vi.fn(
      async () => new Response('{}', { status: 422 }),
    ) as unknown as typeof fetch;
    await expect(
      readEvmTokenBalance(8453, token, owner, {
        solverUrl: 'https://solver.test',
        fetchFn,
      }),
    ).rejects.toThrow(/refused/);
  });
});
