import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SwapCard } from '../components/SwapCard';
import { PayLinksPage } from '../routes/PayLinksPage';
import { SendLinksPage } from '../routes/SendLinksPage';
import { RecoverPage } from '../routes/RecoverPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('Accessibility & Keyboard Navigation (Task B3-05 §19)', () => {
  it('SwapCard has accessible form inputs, radiogroups, and action buttons', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <SwapCard />
        </SolverProvider>
      </MemoryRouter>,
    );

    // Radiogroup for lane selection
    const radiogroup = screen.getByRole('radiogroup', {
      name: /Execution lane/i,
    });
    expect(radiogroup).toBeInTheDocument();

    const fastRadio = screen.getByRole('radio', { name: /Fast/i });
    const safeRadio = screen.getByRole('radio', { name: /Safe/i });
    expect(fastRadio).toHaveAttribute('aria-checked');
    expect(safeRadio).toHaveAttribute('aria-checked');

    // Send amount input with accessible label
    const sendInput = screen.getByLabelText(/You send/i);
    expect(sendInput).toBeInTheDocument();
    expect(sendInput).toHaveAttribute('inputmode', 'decimal');

    // Direction flip toggle button
    const flipButton = screen.getByRole('button', {
      name: /Toggle swap direction/i,
    });
    expect(flipButton).toBeInTheDocument();

    // Primary action button
    const submitBtn = screen.getByTestId('swap-submit-button');
    expect(submitBtn).toBeInTheDocument();
  });

  it('PayLinksPage and SendLinksPage have keyboard-accessible form controls', () => {
    const { unmount } = render(
      <MemoryRouter>
        <PayLinksPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/Note for Payer/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Generate Pay Link/i }),
    ).toBeInTheDocument();

    unmount();

    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/Recipient EVM Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Destination Chain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Generate Send Link/i }),
    ).toBeInTheDocument();
  });

  it('RecoverPage provides accessible controls for paste, upload, and recovery execution', () => {
    render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByLabelText(/Or paste recovery file JSON:/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Load File/i }),
    ).toBeInTheDocument();
  });
});
