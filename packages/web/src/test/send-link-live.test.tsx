import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  secp256k1,
  ripemd160,
  sha256 as libauthSha256,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import {
  type Hex,
  type Hex32,
  orderId as computeOrderId,
  type OrderTerms,
} from '@ferry/core';
import type { QuoteResponse, SendQuoteRequest } from '@ferry/core/api';
import { prepareRecoveryDownload } from '@ferry/solver-client';
import {
  createKeyBackedBchSigner,
  type BchChainPort,
  type BchSignerPort,
  type RecoveryStorePort,
} from '@ferry/user-flow';
import { SendLinksPage } from '../routes/SendLinksPage';
import { SendLinkPage } from '../routes/SendLinkPage';
import { extractSecretFromHash, hashSecret } from '../lib/send/secret';
import type { SendLinkDependencies } from '../lib/send/ports';
import { listSendLinks, saveSendLink } from '../lib/paylink/send-store';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { RealSolverClient } from '../lib/solver/real';
import { WalletContext } from '../lib/wallet/context';
import { decodeFunctionData, parseAbi } from 'viem';
import type { SendLinkView, SolverClient } from '../lib/solver/types';

describe('Send Links Live Execution and Receiver Claim (Task B3-14)', () => {
  // Derive valid test BCH key and address
  const testBchKey = new Uint8Array(32).fill(0x21);
  const testPubKey = secp256k1.derivePublicKeyCompressed(
    testBchKey,
  ) as Uint8Array;
  const testPkh = ripemd160.hash(libauthSha256.hash(testPubKey));
  const testLockingBytecode = new Uint8Array([
    0x76,
    0xa9,
    0x14,
    ...testPkh,
    0x88,
    0xac,
  ]);
  const testCashAddress = (
    lockingBytecodeToCashAddress({
      bytecode: testLockingBytecode,
      prefix: 'bitcoincash',
      tokenSupport: false,
    }) as { address: string }
  ).address;

  const dummyRecipient = '0x1111111111111111111111111111111111111111' as Hex;
  const dummySolverEvm = '0x2222222222222222222222222222222222222222' as Hex;
  const testCategory = '00'.repeat(31) + '01';

  function makeValidTerms(hashLock: Hex32, windowSeconds = 86400): OrderTerms {
    const now = Math.floor(Date.now() / 1000);
    return {
      version: 1,
      direction: 'BCH_TO_EVM',
      bchToken: 'PUSD',
      bchTokenCategory: `0x${testCategory}` as Hex32,
      evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex, // Base USDC
      evmChainId: 8453,
      evmHtlc: '0x3333333333333333333333333333333333333333' as Hex,
      userEvmAddress: dummyRecipient,
      userBchLockingBytecode:
        `0x${Array.from(testLockingBytecode, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex,
      solverEvmAddress: dummySolverEvm,
      solverBchLockingBytecode:
        '0x76a914222222222222222222222222222222222222222288ac' as Hex,
      hashLock,
      evmDeadline: now + windowSeconds,
      bchRefundHeight: 900000,
      bchCarrySats: 3000n,
      bchMaxFee: 500n,
      bchTokenAmount: 2000n,
      evmAmount: 20000000n,
      quoteId: 'sq-test-01',
      quoteExpiry: now + 600,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.000000',
            source: 'reference',
            asOf: now,
          },
        ],
        spreadBps: 20,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe('1. Live Send Link Creation (SendLinksPage)', () => {
    it('creates a send link: request carries note, window, and hashLock, NEVER the secret; fragment holds the secret', async () => {
      let recordedRequest: SendQuoteRequest | null = null;
      const events: string[] = [];

      const mockStore: Record<string, string> = {};
      const recoveryStore: RecoveryStorePort = {
        save: vi.fn(async (id, json) => {
          events.push(`saveRecovery:${id}`);
          mockStore[id] = json;
        }),
        load: vi.fn(async (id) => mockStore[id] ?? null),
        list: vi.fn(async () => Object.keys(mockStore) as Hex32[]),
      };

      const realKeySigner = createKeyBackedBchSigner(testBchKey);
      const bchSigner: BchSignerPort = {
        signTransaction: vi.fn(async (req) => {
          events.push('signTransaction');
          return realKeySigner.signTransaction(req);
        }),
      };

      const bchChain: BchChainPort = {
        getTipHeight: vi.fn(async () => 880000),
        getUtxos: vi.fn(async () => [
          {
            txid: 'a'.repeat(64),
            vout: 0,
            satoshis: 100000n,
            token: {
              category: testCategory,
              amount: 5000n,
            },
          },
        ]),
        broadcast: vi.fn(async () => {
          events.push('broadcastBch');
          return 'bch-tx-12345';
        }),
      };

      const fakeSolver = {
        quoteSendLink: vi.fn(
          async (req: SendQuoteRequest): Promise<QuoteResponse> => {
            recordedRequest = req;
            events.push('quoteSendLink');
            const terms = makeValidTerms(req.hashLock, req.windowSeconds);
            const computedId = computeOrderId(terms);
            return {
              orderId: computedId,
              terms,
              signature: ('0x' + '12'.repeat(65)) as Hex,
              signerAddress: dummySolverEvm,
            };
          },
        ),
      };

      const deps: SendLinkDependencies = {
        solver: fakeSolver,
        bchSigner,
        bchChain,
        store: recoveryStore,
        bchCashAddress: testCashAddress,
        bchNetwork: 'mainnet',
        downloadFile: vi.fn((filename) => {
          events.push(`downloadFile:${filename}`);
          return true;
        }),
      };

      render(
        <MemoryRouter>
          <SendLinksPage isLive={true} dependencies={deps} />
        </MemoryRouter>,
      );

      // Fill in creator inputs
      const addressInput = screen.getByLabelText(/Recipient EVM Address/i);
      fireEvent.change(addressInput, { target: { value: dummyRecipient } });

      const amountInput = screen.getByLabelText(/Amount to Send/i);
      fireEvent.change(amountInput, { target: { value: '20.00' } });

      const noteInput = screen.getByLabelText(/Note for the receiver/i);
      fireEvent.change(noteInput, { target: { value: 'Secret gift for Bob' } });

      const submitBtn = screen.getByRole('button', {
        name: /Generate Send Link/i,
      });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const alert = screen.queryByRole('alert');
        if (alert) {
          throw new Error(`Creation failed with alert: ${alert.textContent}`);
        }
        expect(
          screen.getByText(/Your Send Link is Ready/i),
        ).toBeInTheDocument();
      });

      // 1. Verify request carried note, window, and hashLock
      expect(recordedRequest).not.toBeNull();
      const req = recordedRequest!;
      expect(req.note).toBe('Secret gift for Bob');
      expect(req.windowSeconds).toBe(86400); // 24h default
      expect(req.hashLock).toMatch(/^0x[0-9a-fA-F]{64}$/);

      // 2. Verify request NEVER contained the secret
      expect(req).not.toHaveProperty('secret');
      expect((req as Record<string, unknown>).secret).toBeUndefined();

      // 3. Verify execution order: recovery file saved and downloaded BEFORE BCH lock broadcast
      expect(events).toContain('quoteSendLink');
      const downloadIdx = events.findIndex((e) =>
        e.startsWith('downloadFile:'),
      );
      const broadcastIdx = events.findIndex((e) => e === 'broadcastBch');
      expect(downloadIdx).toBeGreaterThanOrEqual(0);
      expect(broadcastIdx).toBeGreaterThanOrEqual(0);
      expect(downloadIdx).toBeLessThan(broadcastIdx);

      // 4. Verify the link fragment holds the secret
      const shareableLinkSpan = screen.getByText(/\/send\/0x/);
      const urlText = shareableLinkSpan.textContent!;
      expect(urlText).toContain('#');
      const secretInFragment = extractSecretFromHash(urlText);
      expect(secretInFragment).not.toBeNull();
      expect(secretInFragment).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(hashSecret(secretInFragment!)).toBe(req.hashLock);

      // 5. Verify security statement on screen
      expect(
        screen.getByText(
          /Only the wallet you entered can receive these funds/i,
        ),
      ).toBeInTheDocument();

      // 6. Verify refund date on screen
      expect(screen.getByTestId('created-refund-date')).toHaveTextContent(
        /BCH block 900000/i,
      );
    });

    it('adds a Resume button for links whose lock was not finished, using the saved recovery file', async () => {
      const unfinishedSecret = ('0x' + '44'.repeat(32)) as Hex32;
      const unfinishedHashLock = hashSecret(unfinishedSecret);
      const terms = makeValidTerms(unfinishedHashLock);
      const unfinishedOrderId = computeOrderId(terms);

      const recoveryPayload = prepareRecoveryDownload({
        quote: {
          orderId: unfinishedOrderId,
          terms,
          signature: ('0x' + '12'.repeat(65)) as Hex,
        },
        contracts: {
          evm: {
            chainId: 8453,
            htlcAddress: '0x3333333333333333333333333333333333333333' as Hex,
            tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex,
          },
          bch: {
            network: 'mainnet',
            htlcAddress: testCashAddress,
            tokenAddress: testCashAddress,
            redeemScript: '0x51' as Hex,
            lockingBytecode:
              '0x76a914000000000000000000000000000000000000000088ac' as Hex,
          },
        },
        secret: unfinishedSecret,
        createdAt: Math.floor(Date.now() / 1000),
      });

      // Save an unfinished link with pending_lock and recoveryJson in browser store
      saveSendLink({
        id: unfinishedOrderId,
        orderId: unfinishedOrderId,
        destinationChain: 'Base',
        destinationToken: 'USDC',
        recipientEvmAddress: dummyRecipient,
        amount: 20,
        windowSeconds: 86400,
        expiresAt: terms.evmDeadline,
        note: 'Pending lock link',
        status: 'open',
        createdAt: Math.floor(Date.now() / 1000),
        secret: unfinishedSecret,
        recoveryJson: recoveryPayload.json,
        lockStatus: 'pending_lock',
      });

      const realKeySigner = createKeyBackedBchSigner(testBchKey);
      const bchSigner: BchSignerPort = {
        signTransaction: vi.fn(async (req) =>
          realKeySigner.signTransaction(req),
        ),
      };
      const bchChain: BchChainPort = {
        getTipHeight: vi.fn(async () => 880000),
        getUtxos: vi.fn(async () => [
          {
            txid: 'b'.repeat(64),
            vout: 0,
            satoshis: 100000n,
            token: {
              category: testCategory,
              amount: 5000n,
            },
          },
        ]),
        broadcast: vi.fn(async () => 'bch-resume-txid-999'),
      };

      const deps: SendLinkDependencies = {
        solver: { quoteSendLink: vi.fn() },
        bchSigner,
        bchChain,
        store: {
          save: vi.fn(),
          load: vi.fn(async () => recoveryPayload.json),
          list: vi.fn(async () => [unfinishedOrderId]),
        },
        bchCashAddress: testCashAddress,
        bchNetwork: 'mainnet',
      };

      render(
        <MemoryRouter>
          <SendLinksPage isLive={true} dependencies={deps} />
        </MemoryRouter>,
      );

      // Verify "Resume" button is displayed in the recent links list
      const resumeBtn = screen.getByRole('button', { name: /^Resume$/i });
      expect(resumeBtn).toBeInTheDocument();

      fireEvent.click(resumeBtn);

      await waitFor(() => {
        expect(bchChain.broadcast).toHaveBeenCalled();
      });

      // After resuming, the link is now locked
      const updated = listSendLinks().find((l) => l.id === unfinishedOrderId);
      expect(updated?.lockStatus).toBe('locked');
      expect(updated?.txId).toBe('bch-resume-txid-999');
    });
  });

  describe('2. Receiver Page (SendLinkPage)', () => {
    function makeMockSolver(
      view: SendLinkView | null,
      onRelay?: () => void,
    ): SolverClient {
      return {
        isLive: () => true,
        getLabel: () => 'Mock Solver',
        getQuote: vi.fn(),
        getLiquidity: vi.fn(),
        getStats: vi.fn(),
        getRecentSwaps: vi.fn(),
        getPegPrices: vi.fn(),
        getOrder: vi.fn(),
        getSendLink: vi.fn(async () => view),
        relayClaim: vi.fn(async (orderId) => {
          onRelay?.();
          return {
            ok: true,
            orderId,
            txHash: ('0x' + '77'.repeat(32)) as Hex32,
          };
        }),
      } as unknown as SolverClient;
    }

    it('renders receiver view: plain text note escaping markup, and plain words wait state "ready to claim"', async () => {
      const mockSecret = ('0x' + '55'.repeat(32)) as Hex32;
      const sendLinkView: SendLinkView = {
        id: 'sl-markup-01',
        status: 'locked',
        amount: 25,
        token: 'USDC',
        chain: 'Base',
        recipientEvmAddress: dummyRecipient,
        expiresAt: Math.floor(Date.now() / 1000) + 7200,
        note: '<script>alert("xss")</script><b>Bold Note</b>',
      };

      const solver = makeMockSolver(sendLinkView);

      const { container } = render(
        <SolverProvider client={solver}>
          <MemoryRouter
            initialEntries={[`/s/sl-markup-01#${mockSecret.slice(2)}`]}
          >
            <Routes>
              <Route path="/s/:id" element={<SendLinkPage />} />
            </Routes>
          </MemoryRouter>
        </SolverProvider>,
      );

      const noteBlock = await screen.findByTestId('send-link-note');
      expect(noteBlock).toBeInTheDocument();
      // Markup is displayed as plain text, never executable tags
      expect(noteBlock).toHaveTextContent(
        '<script>alert("xss")</script><b>Bold Note</b>',
      );
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('b')).toBeNull();

      // Verify plain words wait state: "ready to claim"
      expect(screen.getByTestId('send-link-status')).toHaveTextContent(
        'ready to claim',
      );
    });

    it('renders plain words wait state "the sender\'s funds are being locked" when status is pending_lock', async () => {
      const sendLinkView: SendLinkView = {
        id: 'sl-pending-01',
        status: 'pending_lock',
        amount: 15,
        token: 'USDC',
        chain: 'Base',
        recipientEvmAddress: dummyRecipient,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const solver = makeMockSolver(sendLinkView);

      render(
        <SolverProvider client={solver}>
          <MemoryRouter initialEntries={['/s/sl-pending-01']}>
            <Routes>
              <Route path="/s/:id" element={<SendLinkPage />} />
            </Routes>
          </MemoryRouter>
        </SolverProvider>,
      );

      const statusEl = await screen.findByTestId('send-link-status');
      expect(statusEl).toHaveTextContent("the sender's funds are being locked");

      // Claim button should reflect wait state and be disabled
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent("the sender's funds are being locked");
    });

    it('renders plain words wait state "claimed" when status is claimed', async () => {
      const sendLinkView: SendLinkView = {
        id: 'sl-claimed-01',
        status: 'claimed',
        amount: 50,
        token: 'USDC',
        chain: 'Base',
        recipientEvmAddress: dummyRecipient,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const solver = makeMockSolver(sendLinkView);

      render(
        <SolverProvider client={solver}>
          <MemoryRouter initialEntries={['/s/sl-claimed-01']}>
            <Routes>
              <Route path="/s/:id" element={<SendLinkPage />} />
            </Routes>
          </MemoryRouter>
        </SolverProvider>,
      );

      const statusEl = await screen.findByTestId('send-link-status');
      expect(statusEl).toHaveTextContent('claimed');

      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent(/Claimed/i);
    });

    it('renders plain words wait state "expired: the sender gets their funds back" when link is expired', async () => {
      const sendLinkView: SendLinkView = {
        id: 'sl-expired-01',
        status: 'expired',
        amount: 30,
        token: 'USDC',
        chain: 'Base',
        recipientEvmAddress: dummyRecipient,
        expiresAt: Math.floor(Date.now() / 1000) - 100, // in the past
      };

      const solver = makeMockSolver(sendLinkView);

      render(
        <SolverProvider client={solver}>
          <MemoryRouter initialEntries={['/s/sl-expired-01']}>
            <Routes>
              <Route path="/s/:id" element={<SendLinkPage />} />
            </Routes>
          </MemoryRouter>
        </SolverProvider>,
      );

      const statusEl = await screen.findByTestId('send-link-status');
      expect(statusEl).toHaveTextContent(
        'expired: the sender gets their funds back',
      );

      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent(
        'expired: the sender gets their funds back',
      );
    });

    // The page as production builds it: the link details come from the general solver client over
    // HTTP, and the claim goes through the library client over HTTP. Only the network is faked.
    const LOCK_ID = ('0x' + '9a'.repeat(32)) as Hex32;
    const SECRET = ('0x' + '66'.repeat(32)) as Hex32;
    const ORDER = ('0x' + 'ab'.repeat(32)) as Hex32;

    function wireProductionPage(relayStatus: number) {
      const requests: { url: string; method: string; body: unknown }[] = [];
      const fakeFetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? 'GET';
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          requests.push({ url, method, body });
          if (url.endsWith(`/v1/send-links/${ORDER}`)) {
            return new Response(
              JSON.stringify({
                id: ORDER,
                status: 'locked',
                token: 'PUSD',
                chainId: 8453,
                evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                amountOut: '40000000',
                recipientEvmAddress: dummyRecipient.toLowerCase(),
                hashLock: hashSecret(SECRET),
                evmDeadline: Math.floor(Date.now() / 1000) + 7200,
                bchRefundHeight: 900000,
                lockId: LOCK_ID,
                createdAt: 1,
                updatedAt: 1,
              }),
            );
          }
          if (url.includes('/relay-claim')) {
            return relayStatus === 200
              ? new Response(
                  JSON.stringify({
                    ok: true,
                    orderId: ORDER,
                    txHash: '0x' + '77'.repeat(32),
                  }),
                )
              : new Response(
                  JSON.stringify({ code: 'INTERNAL_ERROR', message: 'down' }),
                  {
                    status: relayStatus,
                  },
                );
          }
          return new Response('{}', { status: 404 });
        },
      );
      vi.stubGlobal('fetch', fakeFetch);
      vi.stubEnv('VITE_SOLVER_URLS', 'https://solver.test');
      return { requests };
    }

    it('claims through the solver relay with the secret from the link and the real client', async () => {
      const { requests } = wireProductionPage(200);
      render(
        <SolverProvider
          client={
            new RealSolverClient({
              baseUrl: 'https://solver.test',
              fetch: fetch,
            })
          }
        >
          <MemoryRouter initialEntries={[`/s/${ORDER}#${SECRET.slice(2)}`]}>
            <Routes>
              <Route
                path="/s/:id"
                element={<SendLinkPage isLive={true} initialSecret={SECRET} />}
              />
            </Routes>
          </MemoryRouter>
        </SolverProvider>,
      );
      fireEvent.click(
        await screen.findByRole('button', { name: /Send link ›/i }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('send-link-status')).toHaveTextContent(
          'claimed',
        ),
      );
      const relay = requests.find((r) => r.url.includes('/relay-claim'));
      expect(relay?.method).toBe('POST');
      expect(relay?.url).toContain(`/v1/orders/${ORDER}/relay-claim`);
      expect(relay?.body).toEqual({ secret: SECRET, lockId: LOCK_ID });
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('when the relay is down the receiver claims from their own wallet, on the lock the link names', async () => {
      wireProductionPage(500);
      const sent: { to: string; data: string }[] = [];
      const wallets = {
        evm: {
          status: 'connected',
          address: dummyRecipient,
          chainId: 8453,
          signTypedData: async () => `0x${'22'.repeat(65)}`,
          sendTransaction: async (tx: { to: string; data: string }) => {
            sent.push(tx);
            return ('0x' + '88'.repeat(32)) as Hex32;
          },
        },
        bch: { status: 'disconnected', address: null },
      };
      render(
        <WalletContext.Provider value={wallets as never}>
          <SolverProvider
            client={
              new RealSolverClient({
                baseUrl: 'https://solver.test',
                fetch: fetch,
              })
            }
          >
            <MemoryRouter initialEntries={[`/s/${ORDER}#${SECRET.slice(2)}`]}>
              <Routes>
                <Route
                  path="/s/:id"
                  element={
                    <SendLinkPage isLive={true} initialSecret={SECRET} />
                  }
                />
              </Routes>
            </MemoryRouter>
          </SolverProvider>
        </WalletContext.Provider>,
      );
      fireEvent.click(
        await screen.findByRole('button', { name: /Send link ›/i }),
      );
      await waitFor(() => expect(sent).toHaveLength(1));
      const decoded = decodeFunctionData({
        abi: parseAbi([
          'function claim(bytes32 lockId, bytes32 secret) external',
        ]),
        data: sent[0]!.data as `0x${string}`,
      });
      expect(decoded.args).toEqual([LOCK_ID, SECRET]);
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
  });
});
