import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BchPairingDialog } from '../components/BchPairingDialog';
import { WalletSheet } from '../components/WalletSheet';
import { MockWalletProvider } from '../lib/wallet/mock';
import { useBchReconnectTimeout } from '../lib/wallet/reconnect-timeout';

describe('BCH pairing recovery and resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Restore timeout never closes a QR on screen', () => {
    it('keeps QR on screen without timeout when wizard transitions connecting -> disconnected -> connecting', () => {
      const disconnect = vi.fn();

      // Test the hook driving the restore timeout
      const { rerender } = renderHookWithProps(
        ({ state, enabled }: { state: string; enabled: boolean }) =>
          useBchReconnectTimeout(state, disconnect, 8000, enabled),
        { state: 'connecting', enabled: false }, // enabled is false because QR/pairing link is active
      );

      // Advance time while connecting: timeout must not fire
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(disconnect).not.toHaveBeenCalled();

      // Temporary relay reconnect (passes through disconnected)
      rerender({ state: 'disconnected', enabled: false });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(disconnect).not.toHaveBeenCalled();

      // Returns to connecting
      rerender({ state: 'connecting', enabled: false });
      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      // Still must never fire disconnect
      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  describe('Wallet pairing failure and recovery dialog', () => {
    it('shows plain sentence and two working buttons when pairing fails at once', () => {
      const handleClose = vi.fn();
      const handleShowQrAgain = vi.fn();
      const handleReconnect = vi.fn();

      render(
        <BchPairingDialog
          open={true}
          onClose={handleClose}
          uri={null}
          qrUri={null}
          state="idle"
          pairingFailed={true}
          failureReason="Failed to connect to relay server."
          onShowQrAgain={handleShowQrAgain}
          onReconnect={handleReconnect}
        />,
      );

      // Verify the dialog is OPEN with explanation
      expect(screen.getByText('Connect a BCH wallet')).toBeInTheDocument();
      expect(
        screen.getByText('Failed to connect to relay server.'),
      ).toBeInTheDocument();

      // Verify "Show the QR again" button is rendered and functional
      const showQrBtn = screen.getByRole('button', {
        name: /Show the QR again/i,
      });
      expect(showQrBtn).toBeInTheDocument();
      fireEvent.click(showQrBtn);
      expect(handleShowQrAgain).toHaveBeenCalledTimes(1);

      // Verify "Reconnect wallet" button is rendered and functional
      const reconnectBtn = screen.getByRole('button', {
        name: /Reconnect wallet/i,
      });
      expect(reconnectBtn).toBeInTheDocument();
      fireEvent.click(reconnectBtn);
      expect(handleReconnect).toHaveBeenCalledTimes(1);
    });

    it('shows plain sentence and two working buttons when wallet disconnects before connected', () => {
      const handleClose = vi.fn();
      const handleShowQrAgain = vi.fn();
      const handleReconnect = vi.fn();

      render(
        <BchPairingDialog
          open={true}
          onClose={handleClose}
          uri="wiz://test?p=1&s=2"
          qrUri="WIZ://TEST"
          state="disconnected"
          pairingFailed={true}
          failureReason="The pairing connection was dropped. The wallet or relay disconnected."
          onShowQrAgain={handleShowQrAgain}
          onReconnect={handleReconnect}
        />,
      );

      // No pairing ends with a closed dialog and no explanation
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText(
          'The pairing connection was dropped. The wallet or relay disconnected.',
        ),
      ).toBeInTheDocument();

      const showQrBtn = screen.getByRole('button', {
        name: /Show the QR again/i,
      });
      const reconnectBtn = screen.getByRole('button', {
        name: /Reconnect wallet/i,
      });
      expect(showQrBtn).toBeInTheDocument();
      expect(reconnectBtn).toBeInTheDocument();

      fireEvent.click(showQrBtn);
      expect(handleShowQrAgain).toHaveBeenCalledTimes(1);
      fireEvent.click(reconnectBtn);
      expect(handleReconnect).toHaveBeenCalledTimes(1);
    });

    it('shows QR code canvas when pairing is active and not failed', () => {
      const handleClose = vi.fn();
      const handleShowQrAgain = vi.fn();
      const handleReconnect = vi.fn();

      render(
        <BchPairingDialog
          open={true}
          onClose={handleClose}
          uri="wiz://test?p=1&s=2"
          qrUri="WIZ://TEST"
          state="connecting"
          pairingFailed={false}
          onShowQrAgain={handleShowQrAgain}
          onReconnect={handleReconnect}
        />,
      );

      expect(
        screen.getByText(
          'Scan with Selene, Paytaca or another WizardConnect wallet',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Copy pairing link/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Show the QR again/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('WalletSheet pairing recovery view', () => {
    it('displays plain sentence and recovery buttons when pairing is in dropped state', () => {
      const handleClose = vi.fn();

      render(
        <MockWalletProvider defaultBchPairingFailed={true}>
          <WalletSheet open={true} onClose={handleClose} />
        </MockWalletProvider>,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText(/The pairing connection was dropped/i),
      ).toBeInTheDocument();

      const showQrBtn = screen.getByRole('button', {
        name: /Show the QR again/i,
      });
      const reconnectBtn = screen.getByRole('button', {
        name: /Reconnect wallet/i,
      });

      expect(showQrBtn).toBeInTheDocument();
      expect(reconnectBtn).toBeInTheDocument();

      fireEvent.click(showQrBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});

// Helper for hook rendering with props in vitest environment
function renderHookWithProps<P, R>(hook: (props: P) => R, initialProps: P) {
  let currentProps = initialProps;
  const result: { current: R } = { current: undefined as unknown as R };

  function TestComponent({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }

  const { rerender } = render(<TestComponent props={currentProps} />);

  return {
    result,
    rerender: (nextProps: P) => {
      currentProps = nextProps;
      rerender(<TestComponent props={nextProps} />);
    },
  };
}
