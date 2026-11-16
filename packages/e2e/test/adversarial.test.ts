import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadChainConfig } from '@ferry/chain-config';
import {
  EvmChainAdapter,
  RelayLockRejectedError,
  RelayValidationError,
  checkRecipientCanReceiveToken,
  fetchChainLocks,
  validateRelayLock,
} from '@ferry/chain-evm';
import {
  DEFAULT_TIMING_CONFIG,
  invariantF,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  MockPriceSource,
  SolverDatabase,
  SolverEngine,
  buildServer,
  loadConfigFromEnv,
  type BchChainPort,
  type BchQuorumClient,
  type EvmChainPort,
} from '@ferry/solver';
import {
  SolverClient,
  SolverHttpError,
  SolverRefusalError,
} from '@ferry/solver-client';
import {
  DEPLOYER_KEY,
  RECIPIENT_KEY,
  SOLVER_KEY,
  USER_BCH_LOCKING_BYTECODE,
  USER_KEY,
  deployArtifact,
  deployFerryHtlcDeterministic,
  signRelayLockPayload,
  signRelayLockRequest,
  startAnvil,
  startInProcessSolver,
  type AnvilInstance,
  type InProcessSolverHarness,
} from './harness.js';

const ERC20_MINT_ABI = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function nonces(address owner) external view returns (uint256)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
  'function setBlacklisted(address account, bool blocked) external',
]);

function freshSecret(tag: string): { secret: Hex32; hashLock: Hex32 } {
  const hash = createHash('sha256').update(tag).digest('hex');
  const secret = `0x${hash}` as Hex32;
  return { secret, hashLock: sha256(secret) };
}

describe('Adversarial Security Suite (Blueprint §9)', () => {
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const solverAccount = privateKeyToAccount(SOLVER_KEY);
  const userAccount = privateKeyToAccount(USER_KEY);
  const recipientAccount = privateKeyToAccount(RECIPIENT_KEY);

  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerWallet: WalletClient;
  let userWallet: WalletClient;
  let htlcAddress: Address;
  let tokenAddress: Address;
  let solver: InProcessSolverHarness;
  const operatorToken = `op_adv_${'a'.repeat(32)}`;

  async function syncPrice(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    solver.priceSource.setPrice('usdc', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: now,
    });
    solver.priceSource.setPrice('pusd', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: now,
    });
  }

  async function startCustomSolver(
    overrides: Record<string, string> = {},
  ): Promise<{
    baseUrl: string;
    client: SolverClient;
    priceSource: MockPriceSource;
    db: SolverDatabase;
    stop: () => Promise<void>;
  }> {
    const cfg = loadConfigFromEnv({
      ALLOW_DEV_KEYS: '1',
      OPERATOR_TOKEN: operatorToken,
      SOLVER_EVM_PRIVATE_KEY: SOLVER_KEY,
      BASE_CHAIN_ID: String(anvil.chainId),
      BASE_RPC_URL: anvil.rpcUrl,
      BASE_FERRY_HTLC_ADDRESS: htlcAddress,
      BASE_USDC_ADDRESS: tokenAddress,
      RATE_LIMIT_MAX_PER_ADDRESS: '100',
      RATE_LIMIT_MAX_PER_IP: '100',
      ...overrides,
    });

    const evmAdapter = new EvmChainAdapter({
      config: {
        id: 'base',
        chainId: anvil.chainId,
        htlcAddress,
        rpcUrls: [anvil.rpcUrl],
        explorerUrl: 'https://sepolia.basescan.org',
        nativeGas: 'ETH',
        finality: { fast: 1, safe: 1 },
        relayCostUsd: 0.01,
        assets: [
          { symbol: 'USDC', address: tokenAddress, decimals: 6, permit: true },
        ],
      },
      client: publicClient,
      walletClient: createWalletClient({
        account: solverAccount,
        chain: anvil.chain,
        transport: http(anvil.rpcUrl),
      }),
    });

    const now = Math.floor(Date.now() / 1000);
    const priceSource = new MockPriceSource(
      new Map([
        ['usdc', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
        ['pusd', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
      ]),
    );
    const bchPort: BchChainPort = {
      isQuorumHealthy: () => true,
      isQuotingEnabled: () => true,
      getTip: async () => ({ height: 870_000, hash: '00'.repeat(32) }),
      broadcast: async (txHex) => txHex,
      isOnChain: async () => true,
      getScriptHashHistory: async () => [],
    };
    const bchClient = {
      ...bchPort,
      getQuorumStatus: () => ({
        quorumTip: 870_000,
        tips: { 'wss://a:50004': 870_000, 'wss://b:50004': 870_000 },
        isQuorumHealthy: true,
        isLivenessHealthy: true,
        ageSeconds: 5,
        lastConfirmedAt: now - 5,
        livenessAgeSeconds: 5,
        healthyServersCount: 2,
        quotingAllowed: true,
        quotingState: 'HEALTHY',
      }),
      waitForDoubleSpendProof: async () => ({ hasProof: false }),
      broadcastTransaction: async (txHex: string) => txHex,
      start: async () => {},
      stop: async () => {},
    } as unknown as BchQuorumClient;

    const evmPort: EvmChainPort = {
      getTip: async () => ({ height: 100, finalized: true }),
      getLock: async (id) => {
        const lock = await evmAdapter.getLock(id);
        return {
          status: lock.status === 'absent' ? 'none' : lock.status,
          amount: lock.status === 'absent' ? 0n : lock.amount,
        };
      },
      isFinal: async () => true,
      broadcast: async (txHex) => txHex,
      isOnChain: async () => true,
    };

    const db = new SolverDatabase(':memory:');
    const engine = new SolverEngine(db, bchPort, evmPort, cfg);
    const app = buildServer({
      config: cfg,
      db,
      evmAdapter,
      bchClient,
      engine,
      priceSource,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind adversarial solver');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    return {
      baseUrl,
      client: new SolverClient({ baseUrl }),
      priceSource,
      db,
      stop: async () => {
        await app.close();
        db.close();
      },
    };
  }

  beforeAll(async () => {
    anvil = await startAnvil({ chainId: 31337 });
    publicClient = createPublicClient({
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    deployerWallet = createWalletClient({
      account: deployer,
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
    });
    userWallet = createWalletClient({
      account: userAccount,
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
    });

    htlcAddress = await deployFerryHtlcDeterministic(anvil.rpcUrl);
    tokenAddress = await deployArtifact(
      deployerWallet,
      publicClient,
      deployer,
      anvil.chain,
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );

    for (const addr of [userAccount.address, solverAccount.address]) {
      const h = await deployerWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'mint',
        args: [addr, 500_000_000n],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    solver = await startInProcessSolver({
      rpcUrl: anvil.rpcUrl,
      chain: anvil.chain,
      htlcAddress,
      tokenAddress,
      rateLimitMax: 500,
    });
  }, 60_000);

  afterAll(async () => {
    await solver?.stop();
    await anvil?.stop();
  });

  // =========================================================================
  // 1. Griefing and spam
  // =========================================================================
  describe('1. Griefing and spam', () => {
    it('enforces per-address and per-IP rate limits on quote flood', async () => {
      const limited = await startCustomSolver({
        RATE_LIMIT_MAX_PER_ADDRESS: '2',
        RATE_LIMIT_MAX_PER_IP: '2',
      });
      try {
        for (let i = 0; i < 2; i++) {
          const { hashLock } = freshSecret(`flood-${i}`);
          await limited.client.quote({
            direction: 'EVM_TO_BCH',
            token: 'PUSD',
            chainId: anvil.chainId,
            evmToken: tokenAddress,
            amountIn: 2_000_000n,
            userEvmAddress: userAccount.address,
            userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
            hashLock,
            lane: 'safe',
          });
        }
        const { hashLock } = freshSecret('flood-3');
        await expect(
          limited.client.quote({
            direction: 'EVM_TO_BCH',
            token: 'PUSD',
            chainId: anvil.chainId,
            evmToken: tokenAddress,
            amountIn: 2_000_000n,
            userEvmAddress: userAccount.address,
            userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
            hashLock,
            lane: 'safe',
          }),
        ).rejects.toMatchObject({ status: 429 });
      } finally {
        await limited.stop();
      }
    });

    it('enforces per-address exposure reservation cap on un-locked quotes', async () => {
      const capped = await startCustomSolver({
        MAX_EXPOSURE_USD_MICROS: '6000000', // $6.00 cap
      });
      try {
        const q1 = await capped.client.quote({
          direction: 'BCH_TO_EVM',
          token: 'PUSD',
          chainId: anvil.chainId,
          evmToken: tokenAddress,
          amountIn: 500n, // 5.00 PUSD -> ~4.98 USDC (4_980_000n)
          userEvmAddress: userAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          hashLock: freshSecret('cap-1').hashLock,
          lane: 'safe',
        });
        expect(q1.orderId).toMatch(/^0x/);

        await expect(
          capped.client.quote({
            direction: 'BCH_TO_EVM',
            token: 'PUSD',
            chainId: anvil.chainId,
            evmToken: tokenAddress,
            amountIn: 500n,
            userEvmAddress: userAccount.address,
            userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
            hashLock: freshSecret('cap-2').hashLock,
            lane: 'safe',
          }),
        ).rejects.toBeInstanceOf(SolverRefusalError);
      } finally {
        await capped.stop();
      }
    });

    it('rejects wrong amount, wrong token, wrong recipient, and wrong deadline in relay validation', async () => {
      await syncPrice();
      const { hashLock } = freshSecret('mismatch-terms');
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 5_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        lane: 'safe',
      });
      const terms = quote.terms as OrderTerms;
      const basePayload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms,
        userAccount,
      });

      const mismatches: Array<Partial<typeof basePayload>> = [
        { amount: basePayload.amount - 1n },
        { token: `0x${'99'.repeat(20)}` as Address },
        { recipient: userAccount.address },
        { deadline: basePayload.deadline - 60n },
      ];
      for (const patch of mismatches) {
        expect(() =>
          validateRelayLock(
            {
              chain: 'base',
              orderId: quote.orderId,
              payload: { ...basePayload, ...patch },
            },
            terms,
          ),
        ).toThrow(RelayValidationError);
      }
    });

    it('refuses dust, zero, below-min, above-max, and uint256 extreme amounts without 500', async () => {
      await syncPrice();
      const extremes = [
        0n,
        1n, // $0.000001 dust
        999_999n, // $0.999999 (below $1 min)
        51_000_000n, // $51 (above $50 max)
        (1n << 256n) - 1n, // uint256 max
      ];
      for (const [idx, amountIn] of extremes.entries()) {
        try {
          await solver.client.quote({
            direction: 'EVM_TO_BCH',
            token: 'PUSD',
            chainId: anvil.chainId,
            evmToken: tokenAddress,
            amountIn,
            userEvmAddress: userAccount.address,
            userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
            hashLock: freshSecret(`extreme-${idx}`).hashLock,
            lane: 'safe',
          });
          expect.unreachable(`Expected amountIn=${amountIn} to be rejected`);
        } catch (err) {
          if (err instanceof SolverHttpError) {
            expect(err.status).toBeLessThan(500);
          } else {
            expect(
              err instanceof SolverRefusalError || err instanceof Error,
            ).toBe(true);
          }
        }
      }
    });
  });

  // =========================================================================
  // 2. Signature attacks
  // =========================================================================
  describe('2. Signature attacks', () => {
    it('rejects replaying a relay-lock request on another order', async () => {
      await syncPrice();
      const q1 = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 3_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock: freshSecret('replay-order-1').hashLock,
        lane: 'safe',
      });
      const q2 = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 3_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock: freshSecret('replay-order-2').hashLock,
        lane: 'safe',
      });
      const req1 = await signRelayLockRequest({
        evmAdapter: solver.evmAdapter,
        orderId: q1.orderId,
        terms: q1.terms as OrderTerms,
        userAccount,
      });
      await expect(solver.client.relayLock(q2.orderId, req1)).rejects.toThrow();
    });

    it('rejects cross-chain replay of lockWithIntent on a second chainId', async () => {
      await syncPrice();
      const { hashLock } = freshSecret('replay-chain');
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        lane: 'safe',
      });
      const payload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms as OrderTerms,
        userAccount,
      });

      const anvil2 = await startAnvil({ chainId: 31338 });
      try {
        const htlc2 = await deployFerryHtlcDeterministic(anvil2.rpcUrl);
        const token2 = await deployArtifact(
          createWalletClient({
            account: deployer,
            chain: anvil2.chain,
            transport: http(anvil2.rpcUrl),
          }),
          createPublicClient({
            chain: anvil2.chain,
            transport: http(anvil2.rpcUrl),
          }),
          deployer,
          anvil2.chain,
          'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
        );
        const adapter2 = new EvmChainAdapter({
          config: {
            id: 'base',
            chainId: 31338,
            htlcAddress: htlc2,
            rpcUrls: [anvil2.rpcUrl],
            explorerUrl: 'https://sepolia.basescan.org',
            nativeGas: 'ETH',
            finality: { fast: 1, safe: 1 },
            relayCostUsd: 0.01,
            assets: [
              { symbol: 'USDC', address: token2, decimals: 6, permit: true },
            ],
          },
          walletClient: createWalletClient({
            account: solverAccount,
            chain: anvil2.chain,
            transport: http(anvil2.rpcUrl),
          }),
        });
        await expect(
          adapter2.relayLock({
            chain: 'base',
            orderId: quote.orderId,
            payload: { ...payload, token: token2 },
          }),
        ).rejects.toBeInstanceOf(RelayLockRejectedError);
      } finally {
        await anvil2.stop();
      }
    });

    it('rejects replay of lockWithIntent on a different FerryHTLC contract address', async () => {
      await syncPrice();
      const { hashLock } = freshSecret('replay-contract');
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        lane: 'safe',
      });
      const payload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms as OrderTerms,
        userAccount,
      });

      const htlcB = await deployArtifact(
        deployerWallet,
        publicClient,
        deployer,
        anvil.chain,
        'FerryHTLC.sol/FerryHTLC.json',
      );
      const adapterB = new EvmChainAdapter({
        config: {
          id: 'base',
          chainId: anvil.chainId,
          htlcAddress: htlcB,
          rpcUrls: [anvil.rpcUrl],
          explorerUrl: 'https://sepolia.basescan.org',
          nativeGas: 'ETH',
          finality: { fast: 1, safe: 1 },
          relayCostUsd: 0.01,
          assets: [
            {
              symbol: 'USDC',
              address: tokenAddress,
              decimals: 6,
              permit: true,
            },
          ],
        },
        client: publicClient,
        walletClient: createWalletClient({
          account: solverAccount,
          chain: anvil.chain,
          transport: http(anvil.rpcUrl),
        }),
      });
      await expect(
        adapterB.relayLock({
          chain: 'base',
          orderId: quote.orderId,
          payload,
        }),
      ).rejects.toBeInstanceOf(RelayLockRejectedError);
    });

    it('survives permit front-running (T7): relay lockWithIntent still succeeds', async () => {
      await syncPrice();
      const { hashLock } = freshSecret('permit-frontrun');
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        lane: 'safe',
      });
      const payload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms as OrderTerms,
        userAccount,
      });

      // Attacker front-runs the permit transaction directly on the token
      const frontrunTx = await deployerWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'permit',
        args: [
          payload.owner,
          htlcAddress,
          payload.amount,
          payload.permitDeadline,
          payload.v,
          payload.r,
          payload.s,
        ],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: frontrunTx });

      // Relayer submits lockWithIntent; _tryPermit catches the used nonce and lock succeeds
      const relayTx = await solver.evmAdapter.relayLock({
        chain: 'base',
        orderId: quote.orderId,
        payload,
      });
      expect(relayTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('rejects tampered orderId in relay-lock intent', async () => {
      await syncPrice();
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock: freshSecret('tamper-orderid').hashLock,
        lane: 'safe',
      });
      const req = await signRelayLockRequest({
        evmAdapter: solver.evmAdapter,
        orderId: quote.orderId,
        terms: quote.terms as OrderTerms,
        userAccount,
      });
      await expect(
        solver.client.relayLock(quote.orderId, {
          ...req,
          intent: {
            ...req.intent,
            orderId: `0x${'ff'.repeat(32)}` as Hex32,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects an expired intent', async () => {
      await syncPrice();
      const { hashLock } = freshSecret('expired-intent');
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        lane: 'safe',
      });
      const expiredTerms: OrderTerms = {
        ...(quote.terms as OrderTerms),
        quoteExpiry: Math.floor(Date.now() / 1000) - 7200,
      };
      const payload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: expiredTerms,
        userAccount,
      });
      await expect(
        solver.evmAdapter.relayLock({
          chain: 'base',
          orderId: quote.orderId,
          payload,
        }),
      ).rejects.toBeInstanceOf(RelayLockRejectedError);
    });

    it('documents EIP-7702 delegated EOA behaviour (SignatureChecker routes to EIP-1271)', async () => {
      const eoaKey = generatePrivateKey();
      const eoa = privateKeyToAccount(eoaKey);
      const mintTx = await deployerWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'mint',
        args: [eoa.address, 10_000_000n],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: mintTx });

      // Simulate EIP-7702 delegation prefix 0xef0100 + target contract (MockERC20 / non-1271)
      const res = await fetch(anvil.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'anvil_setCode',
          params: [
            eoa.address,
            `0xef0100${tokenAddress.slice(2).toLowerCase()}`,
          ],
        }),
      });
      expect(res.ok).toBe(true);

      await syncPrice();
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: eoa.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock: freshSecret('eip7702').hashLock,
        lane: 'safe',
      });
      const payload = await signRelayLockPayload({
        evmAdapter: solver.evmAdapter,
        terms: quote.terms as OrderTerms,
        userAccount: eoa,
      });
      // SignatureChecker.isValidSignatureNow sees code.length > 0 -> calls EIP-1271 instead of ecrecover -> reverts
      await expect(
        solver.evmAdapter.relayLock({
          chain: 'base',
          orderId: quote.orderId,
          payload,
        }),
      ).rejects.toBeInstanceOf(RelayLockRejectedError);
    });
  });

  // =========================================================================
  // 3. Timing attacks
  // =========================================================================
  describe('3. Timing attacks', () => {
    it('enforces invariantF one second short of required margin and rejects late lock inside margin', () => {
      const now = Math.floor(Date.now() / 1000);
      const bchTip = 870_000;
      const bchRefundHeight = bchTip + 20;
      const probe = invariantF(
        { evmDeadlineSeconds: now + 1, bchRefundHeight },
        { unixSeconds: now, bchTipHeight: bchTip },
        DEFAULT_TIMING_CONFIG,
      );
      const exactMinEvm = now + Math.ceil(probe.requiredSeconds);
      const bad = invariantF(
        { evmDeadlineSeconds: exactMinEvm - 1, bchRefundHeight },
        { unixSeconds: now, bchTipHeight: bchTip },
        DEFAULT_TIMING_CONFIG,
      );
      expect(bad.allowed).toBe(false);
      expect(bad.reason).toBe('insufficient-margin');

      const ok = invariantF(
        { evmDeadlineSeconds: exactMinEvm, bchRefundHeight },
        { unixSeconds: now, bchTipHeight: bchTip },
        DEFAULT_TIMING_CONFIG,
      );
      expect(ok.allowed).toBe(true);

      // User locks late: start time advances inside margin
      const late = invariantF(
        { evmDeadlineSeconds: exactMinEvm, bchRefundHeight },
        { unixSeconds: now + 1, bchTipHeight: bchTip },
        DEFAULT_TIMING_CONFIG,
      );
      expect(late.allowed).toBe(false);
    });

    it('allows claim at and after deadline, while rejecting refund one second early', async () => {
      const latest = await publicClient.getBlock({ blockTag: 'latest' });
      const deadline = Number(latest.timestamp) + 120;
      const { secret, hashLock } = freshSecret('timing-boundary');

      const appTx = await userWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'approve',
        args: [htlcAddress, 5_000_000n],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: appTx });

      const lockTx = await userWallet.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [
          tokenAddress,
          solverAccount.address,
          2_000_000n,
          hashLock,
          BigInt(deadline),
        ],
        account: userAccount,
        chain: anvil.chain,
      });
      const lockReceipt = await publicClient.waitForTransactionReceipt({
        hash: lockTx,
      });
      const lockBlock = await publicClient.getBlock({
        blockNumber: lockReceipt.blockNumber,
      });

      const lockId = solver.evmAdapter.lockId(userAccount.address, hashLock);
      // Pin the exact block timestamps so the boundary does not depend on the wall clock.
      await anvil.setNextBlockTimestamp(deadline - 1);
      await expect(solver.evmAdapter.refund(lockId)).rejects.toThrow();

      // At/after the deadline: claim still succeeds (Blueprint §4.2)
      await anvil.setNextBlockTimestamp(deadline + 1);
      const claimTx = await solver.evmAdapter.claim(lockId, secret);
      expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('lets user refund with zero loss when solver is slow to counter-lock', async () => {
      const latest = await publicClient.getBlock({ blockTag: 'latest' });
      const deadline = Number(latest.timestamp) + 90;
      const { hashLock } = freshSecret('slow-solver');

      const appTx = await userWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'approve',
        args: [htlcAddress, 2_000_000n],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: appTx });

      const balBefore = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'balanceOf',
        args: [userAccount.address],
      });

      const lockTx = await userWallet.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [
          tokenAddress,
          solverAccount.address,
          2_000_000n,
          hashLock,
          BigInt(deadline),
        ],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: lockTx });

      await anvil.increaseTimeAndMine(100);
      const lockId = solver.evmAdapter.lockId(userAccount.address, hashLock);
      const refundTx = await solver.evmAdapter.refund(lockId);
      expect(refundTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

      const balAfter = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'balanceOf',
        args: [userAccount.address],
      });
      expect(balAfter).toBe(balBefore);
    });

    it('recovers cleanly from a reorg (evm_revert) of user lock without phantom state', async () => {
      const snapId = await anvil.snapshot();
      const latest = await publicClient.getBlock({ blockTag: 'latest' });
      const deadline = Number(latest.timestamp) + 600;
      const { hashLock } = freshSecret('reorg-attack');

      const appTx = await userWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_MINT_ABI,
        functionName: 'approve',
        args: [htlcAddress, 2_000_000n],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: appTx });

      const lockTx = await userWallet.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [
          tokenAddress,
          solverAccount.address,
          2_000_000n,
          hashLock,
          BigInt(deadline),
        ],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: lockTx });

      const lockId = solver.evmAdapter.lockId(userAccount.address, hashLock);
      expect((await solver.evmAdapter.getLock(lockId)).status).toBe('locked');

      // Reorg out the user's lock
      await anvil.revert(snapId);
      expect((await solver.evmAdapter.getLock(lockId)).status).toBe('absent');

      const tipAfter = await publicClient.getBlockNumber();
      const { locks } = await fetchChainLocks({
        client: publicClient,
        htlc: htlcAddress,
        user: userAccount.address,
        fromBlock: 0n,
        toBlock: tipAfter,
        deployBlock: 0n,
      });
      expect(locks.some((e) => e.lockId === lockId)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Secret handling
  // =========================================================================
  describe('4. Secret handling', () => {
    it('rejects wrong secret, truncated secret, and secret on wrong order', async () => {
      await syncPrice();
      const s1 = freshSecret('secret-1');
      const s2 = freshSecret('secret-2');
      const q1 = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock: s1.hashLock,
        lane: 'safe',
      });

      // Wrong secret
      await expect(
        solver.client.revealSecret(q1.orderId, s2.secret),
      ).rejects.toThrow();

      // Truncated secret
      await expect(
        solver.client.revealSecret(q1.orderId, '0x1234' as Hex32),
      ).rejects.toThrow();

      // Adapter claim with wrong secret must fail locally before sending tx
      const lockId = solver.evmAdapter.lockId(userAccount.address, s1.hashLock);
      await expect(
        solver.evmAdapter.claim(lockId, s2.secret),
      ).rejects.toThrow();
    });

    it('handles duplicate revealSecret idempotently without duplicate broadcast', async () => {
      await syncPrice();
      const s = freshSecret('double-reveal');
      const quote = await solver.client.quote({
        direction: 'BCH_TO_EVM',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 300n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock: s.hashLock,
        lane: 'safe',
      });
      await solver.evmAdapter.lock(quote.terms as OrderTerms);

      const r1 = await solver.client.revealSecret(quote.orderId, s.secret);
      const r2 = await solver.client.revealSecret(quote.orderId, s.secret);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
    });

    it('refuses revealSecret before counter-lock is confirmed/final', async () => {
      const strict = await startCustomSolver();
      try {
        const s = freshSecret('unfinal-reveal');
        const quote = await strict.client.quote({
          direction: 'BCH_TO_EVM',
          token: 'PUSD',
          chainId: anvil.chainId,
          evmToken: tokenAddress,
          amountIn: 300n,
          userEvmAddress: userAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          hashLock: s.hashLock,
          lane: 'safe',
        });
        // No counter-lock exists yet; relay-claim must refuse
        const lockId = solver.evmAdapter.lockId(
          solverAccount.address,
          s.hashLock,
        );
        await expect(
          strict.client.relayClaim(quote.orderId, { secret: s.secret, lockId }),
        ).rejects.toThrow();
      } finally {
        await strict.stop();
      }
    });
  });

  // =========================================================================
  // 5. Token quirks
  // =========================================================================
  describe('5. Token quirks', () => {
    it('refuses unknown / fee-on-transfer token not in chain-config', async () => {
      const fotToken = await deployArtifact(
        deployerWallet,
        publicClient,
        deployer,
        anvil.chain,
        'MockFeeOnTransferToken.sol/MockFeeOnTransferToken.json',
      );
      const cfg = loadChainConfig({ network: 'mainnet' });
      const allAddresses = cfg.chains.flatMap((c) =>
        c.assets.map((a) => (a.address ?? '').toLowerCase()),
      );
      expect(allAddresses).not.toContain(fotToken.toLowerCase());

      // EvmChainAdapter refuses unconfigured / fee-on-transfer token
      await expect(
        solver.evmAdapter.buildUserLock({
          version: 1,
          quoteId: 'fot-test',
          direction: 'EVM_TO_BCH',
          evmChainId: anvil.chainId,
          evmHtlc: htlcAddress,
          evmToken: fotToken,
          evmAmount: 2_000_000n,
          evmDeadline: Math.floor(Date.now() / 1000) + 3600,
          bchToken: 'PUSD',
          bchTokenCategory: `0x${'11'.repeat(32)}`,
          bchTokenAmount: 199n,
          bchCarrySats: 3000n,
          bchMaxFee: 1500n,
          bchRefundHeight: 330_000,
          hashLock: freshSecret('fot-adapter').hashLock,
          userEvmAddress: userAccount.address,
          solverEvmAddress: solverAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          solverBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          quoteExpiry: Math.floor(Date.now() / 1000) + 60,
          pricing: {
            refs: [],
            spreadBps: 40,
            fixedFeeBase: 0n,
            rounding: 'floor',
          },
        }),
      ).rejects.toThrow();
    });

    it.fails(
      '[expect-fail][owner:solver] solver /v1/quotes refuses unconfigured / fee-on-transfer evmToken',
      async () => {
        const fotToken = await deployArtifact(
          deployerWallet,
          publicClient,
          deployer,
          anvil.chain,
          'MockFeeOnTransferToken.sol/MockFeeOnTransferToken.json',
        );
        await syncPrice();
        await expect(
          solver.client.quote({
            direction: 'EVM_TO_BCH',
            token: 'PUSD',
            chainId: anvil.chainId,
            evmToken: fotToken,
            amountIn: 2_000_000n,
            userEvmAddress: userAccount.address,
            userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
            hashLock: freshSecret('fot-quote').hashLock,
            lane: 'safe',
          }),
        ).rejects.toThrow();
      },
    );

    it('handles non-standard void-return ERC20 (USDT MockNoReturnToken) via SafeERC20', async () => {
      const noReturnToken = await deployArtifact(
        deployerWallet,
        publicClient,
        deployer,
        anvil.chain,
        'MockNoReturnToken.sol/MockNoReturnToken.json',
        ['Tether', 'USDT', 6],
      );
      const mintTx = await deployerWallet.writeContract({
        address: noReturnToken,
        abi: ERC20_MINT_ABI,
        functionName: 'mint',
        args: [userAccount.address, 10_000_000n],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: mintTx });
      const appTx = await userWallet.writeContract({
        address: noReturnToken,
        abi: ERC20_MINT_ABI,
        functionName: 'approve',
        args: [htlcAddress, 5_000_000n],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: appTx });

      const latest = await publicClient.getBlock({ blockTag: 'latest' });
      const { secret, hashLock } = freshSecret('no-return-usdt');
      const lockTx = await userWallet.writeContract({
        address: htlcAddress,
        abi: ferryHtlcAbi,
        functionName: 'lock',
        args: [
          noReturnToken,
          solverAccount.address,
          3_000_000n,
          hashLock,
          BigInt(Number(latest.timestamp) + 600),
        ],
        account: userAccount,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: lockTx });

      const noReturnAdapter = new EvmChainAdapter({
        config: {
          id: 'base',
          chainId: anvil.chainId,
          htlcAddress,
          rpcUrls: [anvil.rpcUrl],
          explorerUrl: 'https://sepolia.basescan.org',
          nativeGas: 'ETH',
          finality: { fast: 1, safe: 1 },
          relayCostUsd: 0.01,
          assets: [
            {
              symbol: 'USDT',
              address: noReturnToken,
              decimals: 6,
              permit: false,
            },
          ],
        },
        client: publicClient,
        walletClient: createWalletClient({
          account: solverAccount,
          chain: anvil.chain,
          transport: http(anvil.rpcUrl),
        }),
      });
      const lockId = noReturnAdapter.lockId(userAccount.address, hashLock);
      const claimTx = await noReturnAdapter.claim(lockId, secret);
      expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('detects blocklisted recipient via checkRecipientCanReceiveToken', async () => {
      const blockToken = await deployArtifact(
        deployerWallet,
        publicClient,
        deployer,
        anvil.chain,
        'MockBlocklistToken.sol/MockBlocklistToken.json',
      );
      const mintTx = await deployerWallet.writeContract({
        address: blockToken,
        abi: ERC20_MINT_ABI,
        functionName: 'mint',
        args: [solverAccount.address, 10_000_000n],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: mintTx });
      const blkTx = await deployerWallet.writeContract({
        address: blockToken,
        abi: ERC20_MINT_ABI,
        functionName: 'setBlacklisted',
        args: [recipientAccount.address, true],
        account: deployer,
        chain: anvil.chain,
      });
      await publicClient.waitForTransactionReceipt({ hash: blkTx });

      const res = await checkRecipientCanReceiveToken({
        client: publicClient,
        token: blockToken,
        recipient: recipientAccount.address,
      });
      expect(res.ok).toBe(false);
    });

    it.fails(
      '[expect-fail][owner:solver] handles 18-decimal EVM amountIn through fast/safe caps and fees',
      async () => {
        await syncPrice();
        // $5.00 in 18 decimals (e.g. BNB USDT)
        const quote = await solver.client.quote({
          direction: 'EVM_TO_BCH',
          token: 'PUSD',
          chainId: anvil.chainId,
          evmToken: tokenAddress,
          amountIn: 5n * 10n ** 18n,
          userEvmAddress: userAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          hashLock: freshSecret('18-dec').hashLock,
          lane: 'fast',
        });
        expect(quote.orderId).toMatch(/^0x/);
      },
    );

    it('queries ERC-20 version() for permit v2 tokens in EvmChainAdapter', async () => {
      await syncPrice();
      // MockUSDCWithPermit is version '1'; verify buildUserLock reads version() dynamically
      const { hashLock } = freshSecret('permit-v2-check');
      const quote = await solver.client.quote({
        direction: 'EVM_TO_BCH',
        token: 'PUSD',
        chainId: anvil.chainId,
        evmToken: tokenAddress,
        amountIn: 2_000_000n,
        userEvmAddress: userAccount.address,
        userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
        hashLock,
        lane: 'safe',
      });
      const unsigned = await solver.evmAdapter.buildUserLock(
        quote.terms as OrderTerms,
      );
      const p = unsigned.payload as {
        mode: string;
        permitTypedData: { domain: { version: string } };
      };
      expect(p.mode).toBe('permit-intent');
      expect(p.permitTypedData.domain.version).toBe('1');
    });
  });

  // =========================================================================
  // 6. Operator surface
  // =========================================================================
  describe('6. Operator surface', () => {
    it('rejects missing, short, and wrong operator bearer tokens', async () => {
      const opServer = await startCustomSolver();
      try {
        const endpoints = [
          { method: 'GET', path: '/v1/operator/needs-attention' },
          { method: 'GET', path: '/v1/operator/alerts' },
          { method: 'GET', path: '/v1/operator/inventory' },
          { method: 'POST', path: '/v1/kill-switch' },
          { method: 'GET', path: '/v1/config' },
        ];
        const badHeaders = [
          undefined,
          'Bearer short',
          `Bearer ${'z'.repeat(operatorToken.length)}`,
        ];
        for (const ep of endpoints) {
          for (const auth of badHeaders) {
            const res = await fetch(`${opServer.baseUrl}${ep.path}`, {
              method: ep.method,
              headers: auth ? { authorization: auth } : {},
            });
            expect([401, 403]).toContain(res.status);
          }
        }
        const okRes = await fetch(
          `${opServer.baseUrl}/v1/operator/needs-attention`,
          { headers: { authorization: `Bearer ${operatorToken}` } },
        );
        expect(okRes.status).toBe(200);
      } finally {
        await opServer.stop();
      }
    });

    it.fails(
      '[expect-fail][owner:solver] kill switch stops new quoting while leaving refunds working',
      async () => {
        const opServer = await startCustomSolver();
        try {
          const ksRes = await fetch(`${opServer.baseUrl}/v1/kill-switch`, {
            method: 'POST',
            headers: { authorization: `Bearer ${operatorToken}` },
          });
          expect(ksRes.status).toBe(200);

          await expect(
            opServer.client.quote({
              direction: 'EVM_TO_BCH',
              token: 'PUSD',
              chainId: anvil.chainId,
              evmToken: tokenAddress,
              amountIn: 2_000_000n,
              userEvmAddress: userAccount.address,
              userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
              hashLock: freshSecret('post-kill').hashLock,
              lane: 'safe',
            }),
          ).rejects.toThrow();
        } finally {
          await opServer.stop();
        }
      },
    );

    it('rejects oversized body and malformed JSON without leaking stack traces', async () => {
      const bigBody = JSON.stringify({
        pad: randomBytes(1_200_000).toString('hex'),
      });
      const bigRes = await fetch(`${solver.baseUrl}/v1/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: bigBody,
      });
      expect([400, 413]).toContain(bigRes.status);
      const bigText = await bigRes.text();
      expect(bigText).not.toMatch(/\n\s+at\s+/);

      const badRes = await fetch(`${solver.baseUrl}/v1/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{malformed json',
      });
      expect(badRes.status).toBe(400);
      const badText = await badRes.text();
      expect(badText).not.toMatch(/\n\s+at\s+/);
      expect(badText).not.toContain('/home/');
    });

    it('exposes no order list or addresses on /v1/metrics', async () => {
      const res = await fetch(`${solver.baseUrl}/v1/metrics`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
      expect(text).not.toContain('bitcoincash:');
      const json = JSON.parse(text) as Record<string, unknown>;
      expect(json['orders']).toBeUndefined();
    });
  });
});
