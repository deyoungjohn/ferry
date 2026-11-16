import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopyDiagnosticsButton } from '../components/CopyDiagnosticsButton';
import { sanitizeDiagnostics } from '../lib/diagnostics';

describe('CopyDiagnosticsButton & sanitizeDiagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts solver URLs down to hostname only and never leaks URL fragments or secrets', () => {
    const raw = {
      route: '/swap/swap-12345',
      solverUrls: [
        'https://solver-alpha.ferry.cash/v1/quote?secret_token=supersecret#fragment',
        'https://beta.solver.io:8080/path/subpath',
      ],
      errorCode: 'ORDER_NOT_FOUND',
      errorMessage: 'Order does not exist',
      orderId: 'swap-12345',
      extra: {
        attempt: 3,
      },
    };

    const sanitized = sanitizeDiagnostics(raw);
    const parsed = JSON.parse(sanitized);

    expect(parsed.route).toBe('/swap/swap-12345');
    expect(parsed.solverHosts).toEqual([
      'solver-alpha.ferry.cash',
      'beta.solver.io:8080',
    ]);
    expect(parsed.errorCode).toBe('ORDER_NOT_FOUND');
    expect(parsed.errorMessage).toBe('Order does not exist');
    expect(parsed.orderId).toBe('swap-12345');
    expect(parsed.details.attempt).toBe(3);
    expect(parsed.timestamp).toBeDefined();

    // Verify secret and fragment are absent
    expect(sanitized).not.toContain('supersecret');
    expect(sanitized).not.toContain('secret_token');
    expect(sanitized).not.toContain('#fragment');
  });

  it('renders button and copies redacted JSON to navigator.clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    render(
      <CopyDiagnosticsButton
        data={{
          route: '/status',
          errorCode: 'TEST_ERR',
          solverUrls: ['https://mainnet-solver.cash'],
        }}
      />,
    );

    const button = screen.getByTestId('copy-diagnostics-button');
    expect(button).toHaveTextContent('Copy Diagnostics');

    fireEvent.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });

    const callArgs = writeText.mock.calls[0] as [string];
    const writtenJson = JSON.parse(callArgs[0]);
    expect(writtenJson.route).toBe('/status');
    expect(writtenJson.errorCode).toBe('TEST_ERR');
    expect(writtenJson.solverHosts).toEqual(['mainnet-solver.cash']);
  });
});
