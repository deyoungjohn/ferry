import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { WalletProvider } from '../lib/wallet/WalletProvider';

let mounts = 0;

function Probe() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <p>page</p>;
}

describe('WalletProvider keeps the page mounted when the real wallet code loads', () => {
  it('does not remount the page on activation', async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    expect(screen.getByText('page')).toBeInTheDocument();
    expect(mounts).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event('ferry:activate-wallets'));
      // Let the lazily loaded wallet code arrive.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });

    expect(screen.getByText('page')).toBeInTheDocument();
    expect(mounts).toBe(1);
  });
});
