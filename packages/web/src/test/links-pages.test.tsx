import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PayLinksPage } from '../routes/PayLinksPage';
import { PayLinkPage } from '../routes/PayLinkPage';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SendLinkPage } from '../routes/SendLinkPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('Pay Links & Send Links Pages (Task B3-03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders PayLinksPage and creates a new pay link with QR code', async () => {
    render(
      <MemoryRouter>
        <PayLinksPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: /^Pay Links/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Get paid in PUSD or MUSD/i)).toBeInTheDocument();

    // Verify existing sample pay link
    expect(screen.getByText(/Dinner split/i)).toBeInTheDocument();

    // Fill form and create link
    const noteInput = screen.getByLabelText(/Note for Payer/i);
    fireEvent.change(noteInput, { target: { value: 'Design Bounty' } });

    const createBtn = screen.getByRole('button', {
      name: /Generate Pay Link/i,
    });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/Your Pay Link is Ready/i)).toBeInTheDocument();
    });

    // Chunked address check
    expect(
      screen.getByText(/Recipient \(Chunked CashAddr\)/i),
    ).toBeInTheDocument();
  });

  it('renders PayLinkPage with exact-output quote and correct labels', async () => {
    render(
      <MemoryRouter initialEntries={['/p/pl-test-01']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/p/:id" element={<PayLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Pay Link')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Pay 25\.00 PUSD/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('They receive')).toBeInTheDocument();
    expect(screen.getByText('You pay')).toBeInTheDocument();

    // Recipient address is chunked
    expect(screen.getByText(/bchtest: zqg3/i)).toBeInTheDocument();
  });

  it('renders SendLinksPage and creates a new send link', async () => {
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: /^Send Links/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Recipient EVM Address/i)).toBeInTheDocument();

    // Fill valid EVM address
    const evmInput = screen.getByLabelText(/Recipient EVM Address/i);
    fireEvent.change(evmInput, {
      target: { value: '0x71c95911e9a5d330f4d621842ec243ee1343292e' },
    });

    const createBtn = screen.getByRole('button', {
      name: /Generate Send Link/i,
    });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/Your Send Link/i)).toBeInTheDocument();
    });
  });

  it('renders SendLinkPage with enforced recipient and They receive copy', () => {
    render(
      <MemoryRouter initialEntries={['/s/sl-sample-01']}>
        <Routes>
          <Route path="/s/:id" element={<SendLinkPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Send Link')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Receive 50\.00 USDC/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('They receive')).toBeInTheDocument();
    expect(screen.getByText('Enforced Recipient Address')).toBeInTheDocument();
  });

  it('strictly adheres to wording rules: never uses invoice, bill, or tip', () => {
    const { container: payLinksContainer } = render(
      <MemoryRouter>
        <PayLinksPage />
      </MemoryRouter>,
    );
    const { container: payLinkContainer } = render(
      <MemoryRouter initialEntries={['/p/test']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/p/:id" element={<PayLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
    const { container: sendLinksContainer } = render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );
    const { container: sendLinkContainer } = render(
      <MemoryRouter initialEntries={['/s/test']}>
        <Routes>
          <Route path="/s/:id" element={<SendLinkPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const combinedText = (
      payLinksContainer.textContent! +
      payLinkContainer.textContent! +
      sendLinksContainer.textContent! +
      sendLinkContainer.textContent!
    ).toLowerCase();

    expect(combinedText).not.toMatch(/\binvoice\b/);
    expect(combinedText).not.toMatch(/\bbill\b/);
    expect(combinedText).not.toMatch(/\btip\b/);
  });
});
