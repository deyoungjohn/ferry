import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RecoverPage } from '../routes/RecoverPage';
import { WalletProvider } from '../lib/wallet/WalletProvider';

describe('IPFS-Ready Build & Offline Recovery', () => {
  it('vite config uses relative base path for IPFS gateway compatibility', async () => {
    // Read vite.config.ts directly
    const configPath = path.resolve(__dirname, '../../vite.config.ts');
    const configContent = fs.readFileSync(configPath, 'utf-8');

    // Base must be './' so all asset links are relative
    expect(configContent).toContain("'hash' ? './' : '/'");
  });

  it('a built index.html uses one consistent kind of asset path', () => {
    const distIndexPath = path.resolve(__dirname, '../../dist/index.html');
    if (fs.existsSync(distIndexPath)) {
      const html = fs.readFileSync(distIndexPath, 'utf-8');
      const relative = /(src|href)="\.\/assets\//.test(html);
      const absolute = /(src|href)="\/assets\//.test(html);
      // Server builds use absolute paths; the IPFS (hash router) build uses relative ones.
      expect(relative !== absolute).toBe(true);
    }
  });

  it('renders recovery page offline with zero solver connection required', () => {
    // Render without any SolverProvider (pure offline execution)
    render(
      <MemoryRouter>
        <WalletProvider>
          <RecoverPage />
        </WalletProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Recover a Swap/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Claim or refund an atomic swap directly from your recovery file, independent of any server/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Load Recovery File/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose recovery JSON file/i)).toBeInTheDocument();
  });
});
