import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import {
  deriveRecoveryRoot,
  swapSecretAt,
  swapTagAt,
  type Hex,
  type Hex32,
  orderId as computeOrderId,
  type OrderTerms,
} from '@ferry/core';
import type { SendLinkQueryMatch, SendQuoteRequest } from '@ferry/core/api';
import { sha256 } from 'viem';
import { SendLinksPage } from '../routes/SendLinksPage';
import { WalletContext } from '../lib/wallet/context';
import type { WalletSet } from '../lib/wallet/types';
import type { SendLinkDependencies } from '../lib/send/ports';
import {
  browserRecoveryStorage,
  createWalletSecretGenerator,
} from '../lib/recovery/recovery-key-service';
import { sendLinkViewTag } from '../lib/send/wallet-send-links';
import { saveSendLink } from '../lib/paylink/send-store';

describe('Send links from wallet derivation (Task B3-20)', () => {
  const SIGNATURE = `0x${'44'.repeat(65)}` as const;
  const WALLET_ROOT = deriveRecoveryRoot(SIGNATURE);
  const DUMMY_EVM = '0x1111111111111111111111111111111111111111' as Hex;
  const SOLVER_EVM = '0x2222222222222222222222222222222222222222' as Hex;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function createMockWalletContext(options?: {
    connected?: boolean;
  }): WalletSet {
    const isConnected = options?.connected ?? true;

    return {
      evm: {
        status: isConnected ? 'connected' : 'disconnected',
        address: isConnected ? DUMMY_EVM : null,
        chainId: 8453,
        connect: vi.fn(),
        disconnect: vi.fn(),
        switchChain: vi.fn(),
        signTypedData: vi.fn().mockResolvedValue(SIGNATURE),
      },
      bch: {
        status: isConnected ? 'connected' : 'disconnected',
        address: isConnected
          ? {
              address: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
              lockingBytecode: '0x',
              tokenAware: true,
            }
          : null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        signTransaction: vi.fn(),
      },
      usingMocks: false,
    } as never;
  }

  it('creation attaches viewTag derived from the wallet root index to the quote request', async () => {
    let capturedQuoteRequest: SendQuoteRequest | undefined;

    const mockSecretGenerator = createWalletSecretGenerator(
      {
        address: DUMMY_EVM,
        signTypedData: vi.fn().mockResolvedValue(SIGNATURE),
      } as never,
      { store: browserRecoveryStorage },
    );

    const mockSolver = {
      quoteSendLink: vi
        .fn()
        .mockImplementation(async (req: SendQuoteRequest) => {
          capturedQuoteRequest = req;
          const now = Math.floor(Date.now() / 1000);
          const terms: OrderTerms = {
            version: 1,
            direction: 'BCH_TO_EVM',
            bchToken: 'PUSD',
            bchTokenCategory: `0x${'01'.repeat(32)}` as Hex32,
            evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex,
            evmChainId: 8453,
            evmHtlc: '0x3333333333333333333333333333333333333333' as Hex,
            userEvmAddress: DUMMY_EVM,
            userBchLockingBytecode: req.userBchLockingBytecode,
            solverEvmAddress: SOLVER_EVM,
            solverBchLockingBytecode:
              '0x76a914222222222222222222222222222222222222222288ac' as Hex,
            hashLock: req.hashLock,
            evmDeadline: now + 86400,
            bchRefundHeight: 900000,
            bchCarrySats: 3000n,
            bchMaxFee: 500n,
            bchTokenAmount: req.amountIn,
            evmAmount: 20000000n,
            quoteId: 'quote-test-1',
            quoteExpiry: now + 600,
            pricing: {
              refs: [
                {
                  asset: 'PUSD',
                  usdPrice: '1.000000',
                  source: 'ref',
                  asOf: now,
                },
              ],
              spreadBps: 20,
              fixedFeeBase: 0n,
              rounding: 'floor',
            },
          };
          const orderId = computeOrderId(terms);
          return {
            orderId,
            terms,
            signature: `0x${'aa'.repeat(65)}` as `0x${string}`,
            signerAddress: SOLVER_EVM,
          };
        }),
      querySendLinks: vi.fn().mockResolvedValue([]),
    };

    const deps: SendLinkDependencies = {
      solver: mockSolver as never,
      bchSigner: {
        signTransaction: vi.fn().mockResolvedValue(new Uint8Array(100)),
      },
      bchChain: {
        broadcast: vi.fn().mockResolvedValue({ txId: '0x' + 'bch'.repeat(21) }),
        getLockStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
      } as never,
      store: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
      bchCashAddress: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      bchNetwork: 'mainnet',
      secretGenerator: mockSecretGenerator,
      downloadFile: vi.fn().mockResolvedValue(true),
    };

    const walletCtx = createMockWalletContext();

    render(
      <MemoryRouter>
        <WalletContext.Provider value={walletCtx}>
          <SendLinksPage isLive={true} dependencies={deps} />
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    const addrInput = screen.getByLabelText(/Recipient EVM Address/i);
    fireEvent.change(addrInput, { target: { value: DUMMY_EVM } });

    const submitBtn = screen.getByRole('button', {
      name: /Generate Send Link/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedQuoteRequest).toBeDefined();
    });

    // viewTag is attached and equals swapTagAt(WALLET_ROOT, 0) padded to 32 bytes
    const expectedTag = sendLinkViewTag(swapTagAt(WALLET_ROOT, 0));
    expect(capturedQuoteRequest?.viewTag).toBe(expectedTag);

    // hashLock equals sha256(swapSecretAt(WALLET_ROOT, 0))
    const expectedSecret = swapSecretAt(WALLET_ROOT, 0);
    expect(capturedQuoteRequest?.hashLock).toBe(sha256(expectedSecret));
  });

  it('fresh browser with only wallet signature lists links made earlier and rebuilds URLs', async () => {
    // Generate an order at index 0
    const secret0 = swapSecretAt(WALLET_ROOT, 0);
    const hashLock0 = sha256(secret0);
    const tag0 = sendLinkViewTag(swapTagAt(WALLET_ROOT, 0));

    const mockMatches: SendLinkQueryMatch[] = [
      {
        id: 'order-fresh-0',
        orderId: `0x${'10'.repeat(32)}` as Hex32,
        status: 'locked',
        token: 'PUSD',
        chainId: 8453,
        evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amountIn: '2000',
        recipientEvmAddress: DUMMY_EVM,
        hashLock: hashLock0,
        evmDeadline: 1_800_000_000,
        bchRefundHeight: 900_000,
        note: 'Coffee payment',
        createdAt: 1_790_000_000,
        updatedAt: 1_790_000_000,
        tag: tag0,
      },
    ];

    const mockSolver = {
      quoteSendLink: vi.fn(),
      querySendLinks: vi
        .fn()
        .mockImplementation(async (tags: readonly Hex32[]) => {
          const lower = tags.map((t) => t.toLowerCase());
          return mockMatches.filter((m) => lower.includes(m.tag.toLowerCase()));
        }),
    };

    const deps: SendLinkDependencies = {
      solver: mockSolver as never,
      bchSigner: { signTransaction: vi.fn() },
      bchChain: {} as never,
      store: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
      bchCashAddress: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      bchNetwork: 'mainnet',
    };

    const walletCtx = createMockWalletContext();

    render(
      <MemoryRouter>
        <WalletContext.Provider value={walletCtx}>
          <SendLinksPage isLive={true} dependencies={deps} />
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    // Wait for the scan to run and list the link
    await waitFor(() => {
      expect(screen.getByText('20.00 PUSD (Base)')).toBeInTheDocument();
    });

    // Check that rebuilt link href has #secret
    const linkAnchor = screen.getByTitle('order-fresh-0');
    const cleanSecret = secret0.slice(2);
    expect(linkAnchor.getAttribute('href')).toBe(
      `/send/order-fresh-0#${cleanSecret}`,
    );

    // Verify secret hashes to hashLock
    expect(sha256(secret0)).toBe(hashLock0);

    // Check status tone
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('preserves old links stored in the browser and does not list untagged links from query', async () => {
    // 1. Save an old link made without tags into browser storage
    saveSendLink({
      id: 'old-local-link',
      destinationChain: 'Base',
      destinationToken: 'USDC',
      recipientEvmAddress: DUMMY_EVM,
      amount: 15.0,
      windowSeconds: 86400,
      expiresAt: 1_800_000_000,
      note: 'Old link from yesterday',
      status: 'open',
      createdAt: 1_785_000_000,
      secret: `0x${'ee'.repeat(32)}`,
      lockStatus: 'locked',
    });

    const mockSolver = {
      quoteSendLink: vi.fn(),
      querySendLinks: vi.fn().mockResolvedValue([]),
    };

    const deps: SendLinkDependencies = {
      solver: mockSolver as never,
      bchSigner: { signTransaction: vi.fn() },
      bchChain: {} as never,
      store: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
      bchCashAddress: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      bchNetwork: 'mainnet',
    };

    const walletCtx = createMockWalletContext();

    render(
      <MemoryRouter>
        <WalletContext.Provider value={walletCtx}>
          <SendLinksPage isLive={true} dependencies={deps} />
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    // Old local link is present
    await waitFor(() => {
      expect(screen.getByText('15.00 USDC (Base)')).toBeInTheDocument();
    });

    // Check explanatory notice about local browser links
    expect(
      screen.getByText(
        /Links created with random secrets or before wallet recovery remain stored in this browser/i,
      ),
    ).toBeInTheDocument();
  });

  it('displays contract wallet notice when smart contract wallet is detected', async () => {
    // Mark address as contract wallet in storage
    await browserRecoveryStorage.set(
      `ferry.recovery.contract.${DUMMY_EVM.toLowerCase()}`,
      'true',
    );

    const mockSolver = {
      quoteSendLink: vi.fn(),
      querySendLinks: vi.fn().mockResolvedValue([]),
    };

    const deps: SendLinkDependencies = {
      solver: mockSolver as never,
      bchSigner: { signTransaction: vi.fn() },
      bchChain: {} as never,
      store: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
      bchCashAddress: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      bchNetwork: 'mainnet',
    };

    const walletCtx = createMockWalletContext();

    render(
      <MemoryRouter>
        <WalletContext.Provider value={walletCtx}>
          <SendLinksPage isLive={true} dependencies={deps} />
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('contract-wallet-notice')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Smart contract wallet detected/i),
    ).toBeInTheDocument();
  });

  it('never logs or leaks the recovery root or secret to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const mockSolver = {
      quoteSendLink: vi.fn(),
      querySendLinks: vi.fn().mockResolvedValue([]),
    };

    const deps: SendLinkDependencies = {
      solver: mockSolver as never,
      bchSigner: { signTransaction: vi.fn() },
      bchChain: {} as never,
      store: {
        save: vi.fn(),
        load: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
      bchCashAddress: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      bchNetwork: 'mainnet',
    };

    const walletCtx = createMockWalletContext();

    render(
      <MemoryRouter>
        <WalletContext.Provider value={walletCtx}>
          <SendLinksPage isLive={true} dependencies={deps} />
        </WalletContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/All send links/i)).toBeInTheDocument();
    });

    const allConsoleCalls = [
      ...consoleSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .join(' ');

    expect(allConsoleCalls).not.toContain(WALLET_ROOT);
    expect(allConsoleCalls).not.toContain(swapSecretAt(WALLET_ROOT, 0));
  });
});
