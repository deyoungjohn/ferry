import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SwapCard } from '../components/SwapCard';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('Swap Flow Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles execution lanes between fast and safe', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    const fastLaneBtn = screen.getByRole('radio', { name: /Fast/i });
    const safeLaneBtn = screen.getByRole('radio', { name: /Safe/i });

    expect(fastLaneBtn).toHaveAttribute('aria-checked', 'true');
    expect(safeLaneBtn).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(safeLaneBtn);
    expect(safeLaneBtn).toHaveAttribute('aria-checked', 'true');
    expect(fastLaneBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('flips direction when flip button is clicked', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard initialReverse />
        </SolverProvider>
      </MemoryRouter>,
    );

    const flipBtn = screen.getByRole('button', {
      name: /Toggle swap direction/i,
    });
    expect(flipBtn).toBeInTheDocument();

    // Initial (Judge path): send tPUSD, receive USDC
    await waitFor(() => {
      expect(screen.getByText(/1 tPUSD ≈/i)).toBeInTheDocument();
    });

    fireEvent.click(flipBtn);
    // After flip: send USDC, receive tPUSD
    await waitFor(() => {
      expect(screen.getByText(/1 USDC ≈/i)).toBeInTheDocument();
    });
  });

  it('disables submit button when refusal is present', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard
            initialReverse
            initialRecipient="0x1111222233334444555566667777888899990000"
          />
        </SolverProvider>
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/You send/i);
    fireEvent.change(input, { target: { value: '99999' } });

    await waitFor(() => {
      expect(screen.getByTestId('quote-refusal')).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId('swap-submit-button');
    expect(submitBtn).toBeDisabled();
  });

  it('creates order and navigates to swap status on submit', async () => {
    const assignMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { assign: assignMock },
      writable: true,
      configurable: true,
    });

    const client = new MockSolverClient();
    const createOrderSpy = vi.spyOn(client, 'createOrder');

    render(
      <MemoryRouter>
        <SolverProvider client={client}>
          <SwapCard
            initialReverse
            initialRecipient="0x1111222233334444555566667777888899990000"
          />
        </SolverProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('swap-submit-button')).not.toBeDisabled();
    });

    const submitBtn = screen.getByTestId('swap-submit-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createOrderSpy).toHaveBeenCalled();
      expect(assignMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/swap\/.+/),
      );
    });
  });
});

describe('swap card defaults', () => {
  it('starts as USDC to PUSD with 5.00 to send', async () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/You send/i)).toHaveValue('5.00');
    await waitFor(() => {
      expect(screen.getByText(/1 USDC ≈/i)).toBeInTheDocument();
    });
  });
});
