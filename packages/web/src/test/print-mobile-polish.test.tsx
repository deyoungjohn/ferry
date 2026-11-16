import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import { PayLinkPage } from '../routes/PayLinkPage';
import { PayLinksPage } from '../routes/PayLinksPage';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '../..');

describe('Print and Mobile Polish (Task B3-09)', () => {
  it('renders pay link page with clean print and share elements (title, QR code, and chunked address)', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/p/pl-test-01']}>
        <SolverProvider client={new MockSolverClient()}>
          <Routes>
            <Route path="/p/:id" element={<PayLinkPage />} />
          </Routes>
        </SolverProvider>
      </MemoryRouter>,
    );

    // Title
    expect(
      screen.getByRole('heading', { level: 1, name: /Pay 25\.00 PUSD/i }),
    ).toBeInTheDocument();

    // QR Code
    const qrCode = screen.getByLabelText(/Payment QR code/i);
    expect(qrCode).toBeInTheDocument();
    expect(qrCode.tagName.toLowerCase()).toBe('svg');

    // Chunked Address
    const chunkedAddr = screen.getByTestId('chunked-address');
    expect(chunkedAddr).toBeInTheDocument();
    // Chunked address contains spaces grouping the address characters
    expect(chunkedAddr.textContent).toContain(' ');

    // Share and Print buttons
    const shareBtn = screen.getByRole('button', { name: /Share Link/i });
    const printBtn = screen.getByRole('button', { name: /Print/i });
    expect(shareBtn).toBeInTheDocument();
    expect(printBtn).toBeInTheDocument();

    // Trigger Print
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('configures mobile keyboard types on PayLinksPage amount and address inputs', () => {
    render(
      <MemoryRouter>
        <PayLinksPage />
      </MemoryRouter>,
    );

    const addrInput = screen.getByLabelText(/Receiving Bitcoin Cash Address/i);
    expect(addrInput).toHaveAttribute('inputMode', 'text');
    expect(addrInput).toHaveAttribute('autoCapitalize', 'none');
    expect(addrInput).toHaveAttribute('autoCorrect', 'off');
    expect(addrInput).toHaveAttribute('spellcheck', 'false');
    expect(addrInput).toHaveAttribute('autocomplete', 'off');

    const fixedAmountInput = screen.getByPlaceholderText('0.00');
    expect(fixedAmountInput).toHaveAttribute('inputMode', 'decimal');
    expect(fixedAmountInput).toHaveAttribute('autocomplete', 'off');
  });

  it('configures mobile keyboard types on SendLinksPage amount and address inputs', () => {
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    const addrInput = screen.getByLabelText(/Recipient EVM Address/i);
    expect(addrInput).toHaveAttribute('inputMode', 'text');
    expect(addrInput).toHaveAttribute('autoCapitalize', 'none');
    expect(addrInput).toHaveAttribute('autoCorrect', 'off');
    expect(addrInput).toHaveAttribute('spellcheck', 'false');
    expect(addrInput).toHaveAttribute('autocomplete', 'off');

    const amountInput = screen.getByLabelText(/Amount to Send/i);
    expect(amountInput).toHaveAttribute('inputMode', 'decimal');
    expect(amountInput).toHaveAttribute('autocomplete', 'off');
  });

  it('configures viewport-fit=cover in index.html for iOS safe-area insets', () => {
    const indexPath = path.resolve(webRoot, 'index.html');
    const content = fs.readFileSync(indexPath, 'utf8');
    expect(content).toContain('viewport-fit=cover');
  });

  it('handles prefers-color-scheme in CSS tokens and declares safe-area insets', () => {
    const tokensPath = path.resolve(webRoot, 'src/styles/tokens.css');
    const indexCssPath = path.resolve(webRoot, 'src/styles/index.css');

    const tokens = fs.readFileSync(tokensPath, 'utf8');
    expect(tokens).toContain('@media (prefers-color-scheme: light)');

    const indexCss = fs.readFileSync(indexCssPath, 'utf8');
    expect(indexCss).toContain('env(safe-area-inset-top');
    expect(indexCss).toContain('env(safe-area-inset-bottom');
    expect(indexCss).toContain('@media print');
  });
});
