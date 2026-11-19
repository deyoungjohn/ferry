import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PayLinksPage } from '../routes/PayLinksPage';
import { PayLinkPage } from '../routes/PayLinkPage';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SendLinkPage } from '../routes/SendLinkPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';
import { saveSendLink } from '../lib/paylink/send-store';
import { savePayLink } from '../lib/paylink/pay-store';

describe('Pay Links & Send Links Pages (Task B3-03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
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

    // No invented sample link: the table starts empty.
    expect(screen.queryByText(/Dinner split/i)).toBeNull();
    expect(
      screen.getByText(/Pay links you create appear here/i),
    ).toBeInTheDocument();

    // Fill form and create link
    fireEvent.change(screen.getByLabelText(/Receiving Bitcoin Cash Address/i), {
      target: {
        value: 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
      },
    });
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

    // An Open button sits next to Copy, and the table lists the link with a link to its page.
    expect(screen.getByTestId('open-pay-link')).toBeInTheDocument();
    const rows = await screen.findAllByTestId('links-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toMatch(
      /^\/pay\/pl-/,
    );
    expect(rows[0]!.textContent).toContain('Open');
    expect(rows[0]!.textContent).toContain('–');
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

    expect(screen.getByText('Pay link')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Pay 25\.00 PUSD/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('They receive')).toBeInTheDocument();
    expect(screen.getByText('You pay')).toBeInTheDocument();

    // Recipient address is chunked
    expect(screen.getByText(/bchtest: zqg3/i)).toBeInTheDocument();
  });

  it('shows the link the creator made (amount and note), not the sample', () => {
    savePayLink({
      id: 'pl-mine',
      recipientCashaddr: 'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
      token: 'PUSD',
      amountOut: 2,
      note: 'Lunch money',
      verified: true,
      status: 'open',
      createdAt: Math.floor(Date.now() / 1000),
    });
    render(
      <MemoryRouter initialEntries={['/p/pl-mine']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/p/:id" element={<PayLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Pay 2\.00 PUSD/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('pay-link-note')).toHaveTextContent(
      'Lunch money',
    );
    expect(screen.queryByText(/Dinner split/i)).toBeNull();
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

  const sampleLink = {
    id: 'sl-sample-01',
    destinationChain: 'Base',
    destinationToken: 'USDC',
    recipientEvmAddress: '0x1111222233334444555566667777888899990000',
    amount: 50,
    windowSeconds: 86_400,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    note: 'Thanks for dinner, see you Friday',
    status: 'open' as const,
    createdAt: Math.floor(Date.now() / 1000) - 60,
  };

  function renderSendLink(id: string) {
    return render(
      <MemoryRouter initialEntries={[`/s/${id}`]}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/s/:id" element={<SendLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );
  }

  it('renders SendLinkPage with enforced recipient, the claim deadline and the sender note', async () => {
    window.localStorage.clear();
    saveSendLink(sampleLink);
    renderSendLink('sl-sample-01');

    expect(
      await screen.findByRole('heading', { name: /Receive 50\.00 USDC/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Send Link')).toBeInTheDocument();
    expect(screen.getByText('They receive')).toBeInTheDocument();
    expect(screen.getByText('Enforced Recipient Address')).toBeInTheDocument();
    expect(screen.getByText('Claim before')).toBeInTheDocument();
    expect(screen.getByTestId('send-link-note')).toHaveTextContent(
      'Thanks for dinner, see you Friday',
    );
  });

  it('shows a note that contains markup as plain text and never runs it', async () => {
    window.localStorage.clear();
    saveSendLink({
      ...sampleLink,
      id: 'sl-markup',
      note: '<img src=x onerror=alert(1)><b>bold</b>',
    });
    const { container } = renderSendLink('sl-markup');
    const note = await screen.findByTestId('send-link-note');
    expect(note).toHaveTextContent('<img src=x onerror=alert(1)><b>bold</b>');
    expect(container.querySelector('img')).toBeNull();
    expect(note.querySelector('b')).toBeNull();
  });

  it('a link without a note shows no note block, and an unknown link says so', async () => {
    window.localStorage.clear();
    saveSendLink({ ...sampleLink, id: 'sl-plain', note: undefined });
    renderSendLink('sl-plain');
    await screen.findByRole('heading', { name: /Receive 50\.00 USDC/i });
    expect(screen.queryByTestId('send-link-note')).toBeNull();

    renderSendLink('sl-nothing');
    expect(await screen.findByTestId('send-link-missing')).toBeInTheDocument();
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
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/s/:id" element={<SendLinkPage />} />
          </Routes>
        </SolverProvider>
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
