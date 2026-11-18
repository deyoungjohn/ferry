import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { WalletContext } from '../lib/wallet/context';

const EVM = '0x12DCBbc7f96B87220e90B46d9528Db156B1Da841';
const BCH = 'bitcoincash:qq2azmyyv6dtgczexyalqar70q036yund5ys8ygnru';

function wallets(connected: { evm: boolean; bch: boolean }) {
  return {
    evm: {
      status: connected.evm ? 'connected' : 'disconnected',
      address: connected.evm ? EVM : null,
    },
    bch: {
      status: connected.bch ? 'connected' : 'disconnected',
      address: connected.bch
        ? { address: BCH, lockingBytecode: '0x76a914', tokenAware: true }
        : null,
    },
    usingMocks: false,
  } as never;
}

function renderCard(connected: { evm: boolean; bch: boolean }) {
  return render(
    <WalletContext.Provider value={wallets(connected)}>
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>
    </WalletContext.Provider>,
  );
}

describe('the destination follows the connected wallet', () => {
  it('with both wallets connected, nobody types an address: it is the wallet for the direction', () => {
    renderCard({ evm: true, bch: true });
    // Send PUSD, receive USDC: the destination is the EVM wallet.
    expect(screen.getByTestId('recipient-from-wallet')).toHaveTextContent(EVM);
    expect(screen.queryByTestId('recipient-address-input')).toBeNull();

    // Flip: send USDC, receive PUSD: the destination becomes the Bitcoin Cash wallet.
    fireEvent.click(
      screen.getByRole('button', { name: /Toggle swap direction/i }),
    );
    expect(screen.getByTestId('recipient-from-wallet')).toHaveTextContent(BCH);
  });

  it('the person can type another address, and flipping drops it (it belonged to the other chain)', () => {
    renderCard({ evm: true, bch: true });
    fireEvent.click(screen.getByTestId('recipient-use-other'));
    const input = screen.getByTestId('recipient-address-input');
    fireEvent.change(input, {
      target: { value: '0x1111111111111111111111111111111111111111' },
    });
    expect(
      (screen.getByTestId('recipient-address-input') as HTMLInputElement).value,
    ).toBe('0x1111111111111111111111111111111111111111');

    fireEvent.click(
      screen.getByRole('button', { name: /Toggle swap direction/i }),
    );
    // Back on the wallet, never the old EVM address in the Bitcoin Cash box.
    expect(screen.getByTestId('recipient-from-wallet')).toHaveTextContent(BCH);
    expect(screen.queryByText(/Invalid Bitcoin Cash address/)).toBeNull();
  });

  it('with the needed wallet not connected the box is empty, and a connected one can be used again', () => {
    renderCard({ evm: true, bch: false });
    fireEvent.click(
      screen.getByRole('button', { name: /Toggle swap direction/i }),
    );
    // Receiving Bitcoin Cash with no Bitcoin Cash wallet: an empty box to fill in.
    const input = screen.getByTestId(
      'recipient-address-input',
    ) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.queryByTestId('recipient-use-wallet')).toBeNull();
  });
});
