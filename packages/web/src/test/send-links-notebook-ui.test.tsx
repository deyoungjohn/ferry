import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SendLinksPage } from '../routes/SendLinksPage';
import { saveSendLink, listSendLinks } from '../lib/paylink/send-store';
import { exportNotebook, MIN_PBKDF2_ITERATIONS } from '../lib/notebook/crypto';
import type { SendLinkData } from '../lib/paylink/link';

describe('Send Links Encrypted Notebook UI (B3-15)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const testLink: SendLinkData = {
    id: '0x1111111111111111111111111111111111111111111111111111111111111111',
    orderId:
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    destinationChain: 'Base',
    destinationToken: 'USDC',
    recipientEvmAddress: '0x1111111111111111111111111111111111111111',
    amount: 15.0,
    windowSeconds: 86400,
    expiresAt: 1800000000,
    note: 'Test gift',
    status: 'open',
    lockStatus: 'locked',
    createdAt: 1700000000,
    secret:
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
    refundDate: 'Tomorrow (BCH block 900000)',
    txId: 'bch-tx-555',
  };

  it('renders "Export notebook" and "Import notebook" action buttons on the page', () => {
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    const exportButtons = screen.getAllByRole('button', {
      name: /^Export notebook$/i,
    });
    expect(exportButtons.length).toBeGreaterThanOrEqual(1);

    const importButtons = screen.getAllByRole('button', {
      name: /^Import notebook$/i,
    });
    expect(importButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('Export notebook modal: shows warning notice, validates passphrases, exports, and clears inputs', async () => {
    saveSendLink(testLink);

    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    // Open export modal
    const exportBtn = screen.getAllByRole('button', {
      name: /^Export notebook$/i,
    })[0]!;
    fireEvent.click(exportBtn);

    // 1. Verify title and security notice
    expect(screen.getByText(/Export Encrypted Notebook/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /A lost passphrase cannot be recovered and the file holds the claim secrets/i,
      ),
    ).toBeInTheDocument();

    const passInput = screen.getByLabelText(/^Passphrase$/i);
    const confirmInput = screen.getByLabelText(/^Confirm Passphrase$/i);
    const submitBtn = screen.getByRole('button', {
      name: /Export & Download/i,
    });

    // 2. Mismatched passphrases should display an error
    fireEvent.change(passInput, { target: { value: 'password-a' } });
    fireEvent.change(confirmInput, { target: { value: 'password-b' } });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText(/Passphrases do not match/i),
    ).toBeInTheDocument();

    // 3. Matching passphrases should export and clear inputs
    fireEvent.change(confirmInput, { target: { value: 'password-a' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Modal closes upon successful export
      expect(
        screen.queryByText(/Export Encrypted Notebook/i),
      ).not.toBeInTheDocument();
    });
  });

  it('Import notebook modal: handles wrong passphrase or damaged file in plain words and merges on success', async () => {
    const passphrase = 'notebook-secret-passphrase';
    const encryptedFile = await exportNotebook({
      links: [testLink],
      passphrase,
      iterations: MIN_PBKDF2_ITERATIONS,
    });
    const fileJson = JSON.stringify(encryptedFile);

    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    // Open import modal
    const importBtn = screen.getAllByRole('button', {
      name: /^Import notebook$/i,
    })[0]!;
    fireEvent.click(importBtn);

    expect(screen.getByText(/Import Encrypted Notebook/i)).toBeInTheDocument();

    // Upload file
    const fileInput = screen.getByLabelText(/Notebook JSON file/i);
    const file = new File([fileJson], 'ferry-send-links-backup.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Wait for file text to load into component state
    await screen.findByText(/Selected: ferry-send-links-backup.json/i);

    const passInput = screen.getByLabelText(/^Passphrase$/i);
    const submitBtn = screen.getByRole('button', {
      name: /Import Notebook/i,
    });

    // 1. Wrong passphrase fails with plain words without changing storage
    fireEvent.change(passInput, { target: { value: 'wrong-passphrase' } });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText(/Incorrect passphrase or damaged notebook file/i),
    ).toBeInTheDocument();
    expect(listSendLinks()).toHaveLength(0); // storage unchanged!

    // 2. Correct passphrase imports and merges links
    fireEvent.change(passInput, { target: { value: passphrase } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.queryByText(/Import Encrypted Notebook/i),
      ).not.toBeInTheDocument();
    });

    const stored = listSendLinks();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(testLink.id);
    expect(stored[0]?.secret).toBe(testLink.secret);
  });

  it('displays export reminder notice under created send link', () => {
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    saveSendLink(testLink);

    // Re-render or select link to activate created preview
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    // Click "View QR" to display preview card
    const viewQrBtn = screen.getByRole('button', { name: /View QR/i });
    fireEvent.click(viewQrBtn);

    // Verify reminder notice is displayed
    const reminder = screen.getByTestId('created-export-reminder');
    expect(reminder).toBeInTheDocument();
    expect(reminder).toHaveTextContent(/Save to encrypted notebook/i);
    expect(reminder).toHaveTextContent(
      /Export your notebook to keep and restore this link and its claim secret on any device/i,
    );

    // Clicking "Export now" opens the export modal
    const exportNowBtn = screen.getByRole('button', { name: /Export now/i });
    fireEvent.click(exportNowBtn);
    expect(screen.getByText(/Export Encrypted Notebook/i)).toBeInTheDocument();
  });
});
