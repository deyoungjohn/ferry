import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import { orderId as computeOrderId, type OrderTerms } from '@ferry/core';
import { RecoverPage } from '../routes/RecoverPage';

describe('RecoverPage (/recover) - Swap Recovery Port', () => {
  const sampleTerms: OrderTerms = {
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory:
      '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    bchTokenAmount: 10000n,
    evmAmount: 100500000n,
    evmToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    evmChainId: 8453,
    evmHtlc: '0x5a0c062f4b7b8ff2263530e12bc15de9c836a641',
    userEvmAddress: '0x87ea46fe296c1810ef234a8e8d782a2122defadd',
    userBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    solverEvmAddress: '0xc9ec91859bdb598dc2eee715934d8231478f7a70',
    solverBchLockingBytecode:
      '0x76a914222222222222222222222222222222222222222288ac',
    hashLock:
      '0x72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
    evmDeadline: 1794850000,
    bchRefundHeight: 974380,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'q-golden-001',
    quoteExpiry: 1794764200,
  };

  const canonicalId = computeOrderId(sampleTerms);

  const jsonTerms = {
    ...sampleTerms,
    bchTokenAmount: '10000',
    evmAmount: '100500000',
    bchCarrySats: '3000',
    bchMaxFee: '1500',
  };

  const validRecoveryFile = {
    version: 1,
    orderId: canonicalId,
    terms: jsonTerms,
    secret:
      '0xmocksecret01010101010101010101010101010101010101010101010101010101',
    solverKind: 'mock',
    contracts: {
      bchHtlcAddress: 'bchtest:pr3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy',
      evmContractAddress: '0x1234567890123456789012345678901234567890',
    },
  };

  it('renders Recover a Swap header and upload inputs', () => {
    render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /Recover a Swap/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Choose recovery JSON file/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Or paste recovery file JSON:/i),
    ).toBeInTheDocument();
  });

  it('rejects invalid JSON with an error message', async () => {
    render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );

    const textarea = screen.getByLabelText(/Or paste recovery file JSON:/i);
    const loadBtn = screen.getByRole('button', { name: /Load File/i });

    fireEvent.change(textarea, { target: { value: '{ invalid-json' } });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Invalid JSON format/i)).toBeInTheDocument();
    });
  });

  it('rejects recovery file with mismatched orderId', async () => {
    render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );

    const textarea = screen.getByLabelText(/Or paste recovery file JSON:/i);
    const loadBtn = screen.getByRole('button', { name: /Load File/i });

    const tampered = { ...validRecoveryFile, orderId: '0xinvalidorderid' };
    fireEvent.change(textarea, { target: { value: JSON.stringify(tampered) } });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Order ID does not match the terms in this recovery file/i,
        ),
      ).toBeInTheDocument();
    });
  });

  it('loads valid recovery file, shows mock solver notice and reveals secret', async () => {
    render(
      <MemoryRouter>
        <RecoverPage />
      </MemoryRouter>,
    );

    const textarea = screen.getByLabelText(/Or paste recovery file JSON:/i);
    const loadBtn = screen.getByRole('button', { name: /Load File/i });

    fireEvent.change(textarea, {
      target: { value: JSON.stringify(validRecoveryFile) },
    });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(
        screen.getByText(
          /This file was issued by the mock solver and cannot be claimed on chain/i,
        ),
      ).toBeInTheDocument();
    });

    // Verify swap parameters are displayed
    expect(screen.getByText(canonicalId)).toBeInTheDocument();
    expect(
      screen.getByText(/EVM Stablecoin → Bitcoin Cash/i),
    ).toBeInTheDocument();

    // Verify secret is masked initially
    expect(
      screen.getByText(/••••••••••••••••••••••••••••••••/i),
    ).toBeInTheDocument();

    // Reveal secret
    const revealBtn = screen.getByRole('button', { name: /Reveal/i });
    fireEvent.click(revealBtn);
    expect(screen.getByText(validRecoveryFile.secret)).toBeInTheDocument();

    // Claim button exists
    const claimBtn = screen.getByRole('button', {
      name: /Claim Funds with Secret/i,
    });
    expect(claimBtn).toBeInTheDocument();
  });
});
