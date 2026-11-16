import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WalletSheet } from '../components/WalletSheet';
import { MockWalletProvider } from '../lib/wallet/mock';

describe('WalletSheet component', () => {
  it('renders wallet sheet with EVM and BCH connection options in mock mode', () => {
    const handleClose = vi.fn();

    render(
      <MockWalletProvider>
        <WalletSheet open={true} onClose={handleClose} />
      </MockWalletProvider>,
    );

    expect(screen.getByText('Connect Wallets')).toBeInTheDocument();
    expect(screen.getByText(/Mock wallet mode active/i)).toBeInTheDocument();
    expect(screen.getByText(/^EVM Wallet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Bitcoin Cash \(Bitcoin Cash Chipnet\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Connect EVM Wallet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Connect BCH Wallet/i }),
    ).toBeInTheDocument();
  });

  it('displays connected status when wallets are connected', () => {
    const handleClose = vi.fn();

    render(
      <MockWalletProvider defaultEvmConnected defaultBchConnected>
        <WalletSheet open={true} onClose={handleClose} />
      </MockWalletProvider>,
    );

    const connectedBadges = screen.getAllByText('Connected');
    expect(connectedBadges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Paytaca (Mock)')).toBeInTheDocument();
  });
});
