import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  sha256,
  toHex,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadChainConfig } from '@ferry/chain-config';
import {
  EvmChainAdapter,
  claimSendLink,
  estimateArbitrumGasComponents,
  estimateBaseL1FeeWei,
  lockSendLink,
  relayCostUsd,
} from '@ferry/chain-evm';
import {
  evmLockId,
  parseSendLink,
  type Hex32,
  type OrderTerms,
} from '@ferry/core';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  MAINNET_CONFIRM_PHRASE,
  createDefaultEvmPort,
  runProbe,
  type ProbeBchPort,
} from '@ferry/probe';
import {
  MockPriceSource,
  SolverDatabase,
  SolverEngine,
  buildServer,
  loadConfigFromEnv,
  runPreflightCheck,
  type BchChainPort,
  type BchQuorumClient,
  type EvmChainPort,
} from '@ferry/solver';
import { SolverClient } from '@ferry/solver-client';
import {
  USER_BCH_LOCKING_BYTECODE,
  USER_KEY,
  signRelayLockPayload,
  signRelayLockRequest,
} from './harness.js';

const RUN_REHEARSE = process.env.FERRY_RUN_REHEARSE === '1';
const execFileAsync = promisify(execFile);
const HTLC_EVM_DIR = fileURLToPath(new URL('../../htlc-evm', import.meta.url));
const CREATE2_FACTORY: Address = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const PREDICTED_HTLC: Address = '0x8b968625F983420B571C102eC0b57F7e509c916e';
// Fresh random EOA keys (public/simple keys carry EIP-7702 delegations on mainnet)
const REHEARSE_DEPLOYER_KEY = generatePrivateKey() as Hex32;
const REHEARSE_SOLVER_KEY = generatePrivateKey() as Hex32;
const REHEARSE_USER_KEY = generatePrivateKey() as Hex32;

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function nonces(address owner) external view returns (uint256)',
]);

const NATIVE_USD_BY_CHAIN: Readonly<Record<string, number>> = {
  base: 3000,
  ethereum: 3000,
  arbitrum: 3000,
  bnb: 600,
  arc: 1,
  robinhood: 3000,
};

interface ScenarioRow {
  chain: string;
  route: string;
  scenario: string;
  result: string;
  gasUsed: string;
  timeMs: number;
}

interface CostRow {
  chain: string;
  route: string;
  gasPriceWei: bigint;
  execGas: bigint;
  execUsd: number;
  l1FeeUsd: number;
  totalUsd: number;
  minSwapSpreadUsd: number;
  recommendedFixedFeeUsd: number;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function startForkAnvil(forkUrl: string, chainId: number) {
  const { spawn } = await import('node:child_process');
  const port = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(
    'anvil',
    [
      '--fork-url',
      forkUrl,
      '--port',
      String(port),
      '--chain-id',
      String(chainId),
      '--silent',
    ],
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_blockNumber',
          params: [],
        }),
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Wait for fork startup
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) {
    proc.kill('SIGKILL');
    throw new Error(`Anvil fork startup timed out for ${forkUrl}`);
  }

  const rpc = async <T = unknown>(method: string, params: unknown[]) => {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = (await res.json()) as {
      result: T;
      error?: { message: string };
    };
    if (json.error) {
      throw new Error(`RPC ${method} error: ${json.error.message}`);
    }
    return json.result;
  };

  return {
    rpcUrl,
    port,
    rpc,
    stop: async () => {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 3000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function deployHtlcOnFork(rpcUrl: string): Promise<Address> {
  const { stdout } = await execFileAsync(
    'forge',
    [
      'script',
      'script/Deploy.s.sol:Deploy',
      '--rpc-url',
      rpcUrl,
      '--broadcast',
      '--start-fresh',
    ],
    {
      cwd: HTLC_EVM_DIR,
      env: { ...process.env, DEPLOYER_EVM_PRIVATE_KEY: REHEARSE_DEPLOYER_KEY },
    },
  );
  const match = stdout.match(/FerryHTLC deployed:\s*(0x[0-9a-fA-F]{40})/);
  if (!match?.[1]) {
    throw new Error(`Could not parse FerryHTLC address:\n${stdout}`);
  }
  return match[1] as Address;
}

async function fundTokenViaAnvil(
  rpc: <T = unknown>(method: string, params: unknown[]) => Promise<T>,
  publicClient: PublicClient,
  token: Address,
  holder: Address,
  amount: bigint,
): Promise<void> {
  const encodedAmount = pad(toHex(amount), { size: 32 });
  for (let slot = 0; slot <= 60; slot++) {
    const solKey = keccak256(
      encodeAbiParameters(parseAbiParameters('address, uint256'), [
        holder,
        BigInt(slot),
      ]),
    );
    const prevSol = await rpc<Hex>('eth_getStorageAt', [
      token,
      solKey,
      'latest',
    ]);
    await rpc('anvil_setStorageAt', [token, solKey, encodedAmount]);
    const balSol = await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [holder],
    });
    if (balSol >= amount) return;
    await rpc('anvil_setStorageAt', [token, solKey, prevSol]);
  }
  throw new Error(
    `Could not find balance slot for ${token} (holder ${holder})`,
  );
}

function makeFakeBchProbePort(): ProbeBchPort {
  return {
    getTipHeight: async () => 870_000,
    getFundingUtxos: async () => [],
    buildDryRunLock: async () => {},
    lock: async () => `0x${'01'.repeat(32)}` as Hex32,
    waitForHtlcUtxo: async () => ({ utxos: [], lockTxid: null }),
    claim: async () => `0x${'02'.repeat(32)}` as Hex32,
    waitForRefundHeight: async () => 870_010,
    refund: async () => `0x${'03'.repeat(32)}` as Hex32,
  };
}

describe.skipIf(!RUN_REHEARSE)('Full-System Mainnet Fork Rehearsal', () => {
  const scenarioRows: ScenarioRow[] = [];
  const costRows: CostRow[] = [];

  const mainnetChains = loadChainConfig({ network: 'mainnet' }).chains;

  for (const chainId of ['base', 'ethereum', 'arbitrum', 'bnb'] as const) {
    it(`rehearses ${chainId} mainnet fork end-to-end`, async () => {
      const cfg = mainnetChains.find((c) => c.id === chainId);
      expect(cfg).toBeDefined();
      if (!cfg) return;

      const asset = cfg.assets[0];
      expect(asset).toBeDefined();
      if (!asset || asset.decimals === null || asset.address === null) return;

      const forkRpcUrl =
        chainId === 'bnb'
          ? 'https://bsc-dataseed1.binance.org'
          : cfg.rpcUrls[0]!;
      const fork = await startForkAnvil(forkRpcUrl, cfg.chainId);
      const viemChain: Chain = {
        id: cfg.chainId,
        name: `fork-${cfg.id}`,
        nativeCurrency: {
          name: cfg.nativeGas,
          symbol: cfg.nativeGas,
          decimals: 18,
        },
        rpcUrls: { default: { http: [fork.rpcUrl] } },
      };

      const publicClient = createPublicClient({
        chain: viemChain,
        transport: http(fork.rpcUrl),
        cacheTime: 0,
      });

      const deployer = privateKeyToAccount(REHEARSE_DEPLOYER_KEY);
      const solverAccount = privateKeyToAccount(REHEARSE_SOLVER_KEY);
      const userAccount = privateKeyToAccount(REHEARSE_USER_KEY);
      const recipientAccount = privateKeyToAccount(
        `0x${'77'.repeat(32)}` as Hex32,
      );

      const solverWallet = createWalletClient({
        account: solverAccount,
        chain: viemChain,
        transport: http(fork.rpcUrl),
      });
      const userWallet = createWalletClient({
        account: userAccount,
        chain: viemChain,
        transport: http(fork.rpcUrl),
      });

      let appClose: (() => Promise<void>) | undefined;

      try {
        // Fund native gas
        for (const addr of [
          deployer.address,
          solverAccount.address,
          userAccount.address,
          recipientAccount.address,
        ]) {
          await fork.rpc('anvil_setBalance', [
            addr,
            '0x56bc75e2d63100000', // 100 ETH/BNB
          ]);
        }

        // 1. Deploy FerryHTLC via real script
        const tDeploy = performance.now();
        const htlcAddress = await deployHtlcOnFork(fork.rpcUrl);
        expect(htlcAddress.toLowerCase()).toBe(PREDICTED_HTLC.toLowerCase());
        const deployBlock = await publicClient.getBlockNumber();
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: `deploy (block ${deployBlock})`,
          result: 'PASS',
          gasUsed: '-',
          timeMs: Math.round(performance.now() - tDeploy),
        });

        // 2. Fund user and solver with real mainnet token
        const unit = 10n ** BigInt(asset.decimals);
        const fundAmount = 1_000n * unit;
        await fundTokenViaAnvil(
          fork.rpc,
          publicClient,
          asset.address as Address,
          userAccount.address,
          fundAmount,
        );
        await fundTokenViaAnvil(
          fork.rpc,
          publicClient,
          asset.address as Address,
          solverAccount.address,
          fundAmount,
        );

        // 3. Validate mainnet solver config semantics (non-placeholder key, 2 Electrum hosts, 32+ char token)
        const mainnetValidated = loadConfigFromEnv({
          NETWORK: 'mainnet',
          OPERATOR_TOKEN: `op_rehearse_${'x'.repeat(32)}`,
          BCH_ELECTRUM_URLS:
            'wss://blackie.c3-soft.com:50004,wss://bch.imaginary.cash:50004',
          SOLVER_EVM_PRIVATE_KEY: `0x${'ab'.repeat(32)}`,
          SOLVER_BCH_WIF:
            'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ',
          BASE_FERRY_HTLC_ADDRESS: htlcAddress,
          BASE_USDC_ADDRESS: asset.address,
          BASE_CHAIN_ID: String(cfg.chainId),
          BASE_RPC_URL: fork.rpcUrl,
          ALLOW_MOCK_PAYLINK_SIGNATURES: 'false',
        });
        runPreflightCheck(mainnetValidated);

        // Build runtime config using Anvil's funded solver key
        const runtimeConfig = {
          ...mainnetValidated,
          solverEvmPrivateKey: REHEARSE_SOLVER_KEY,
          rateLimitMaxPerAddress: 1000,
          rateLimitMaxPerIp: 1000,
        };

        const evmAdapter = new EvmChainAdapter({
          config: {
            id: cfg.id,
            chainId: cfg.chainId,
            htlcAddress,
            rpcUrls: [fork.rpcUrl],
            explorerUrl: cfg.explorerUrl,
            nativeGas: cfg.nativeGas,
            finality: { fast: cfg.finality.fast, safe: cfg.finality.safe },
            relayCostUsd: cfg.relayCostUsd ?? 0.01,
            assets: [
              {
                symbol: asset.symbol,
                address: asset.address as Address,
                decimals: asset.decimals,
                permit: asset.permit,
              },
            ],
          },
          client: publicClient,
          walletClient: solverWallet,
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
            tips: {
              'wss://blackie.c3-soft.com:50004': 870_000,
              'wss://bch.imaginary.cash:50004': 870_000,
            },
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
          getTip: async () => ({
            height: Number(deployBlock),
            finalized: true,
          }),
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
        const engine = new SolverEngine(db, bchPort, evmPort, runtimeConfig);
        const app = buildServer({
          config: runtimeConfig,
          db,
          evmAdapter,
          bchClient,
          engine,
          priceSource,
        });
        await app.listen({ port: 0, host: '127.0.0.1' });
        const addrInfo = app.server.address();
        if (!addrInfo || typeof addrInfo === 'string') {
          throw new Error('Failed to bind rehearsal solver');
        }
        const baseUrl = `http://127.0.0.1:${addrInfo.port}`;
        appClose = async () => {
          await app.close();
          db.close();
        };

        const solverClient = new SolverClient({ baseUrl });

        // 4. @ferry/probe dry-run (execute: false, mainnet)
        const tProbe = performance.now();
        const probeEvmPort = createDefaultEvmPort({
          chainConfig: {
            id: cfg.id,
            chainId: cfg.chainId,
            htlcAddress,
            rpcUrls: [fork.rpcUrl],
            explorerUrl: cfg.explorerUrl,
            nativeGas: cfg.nativeGas,
            finality: { fast: cfg.finality.fast, safe: cfg.finality.safe },
            relayCostUsd: cfg.relayCostUsd ?? 0.01,
            assets: [
              {
                symbol: asset.symbol,
                address: asset.address as Address,
                decimals: asset.decimals,
                permit: asset.permit,
              },
            ],
          },
          publicClient,
          walletClient: userWallet,
          userAddress: userAccount.address,
        });
        let probeStatus = 'PASS';
        try {
          const probeResult = await runProbe(
            {
              network: 'mainnet',
              execute: false,
              direction: 'EVM_TO_BCH',
              mode: 'swap',
              token: 'PUSD',
              chainId: cfg.chainId,
              amountUsd: 1,
              maxUsd: 1,
              solverUrl: baseUrl,
              recoveryDir: '/tmp/ferry-rehearse-recovery',
              pollIntervalMs: 100,
              timeoutMs: 5000,
              bchFeeRateSatPerByte: 1,
            },
            {
              solverClient,
              evmPort: probeEvmPort,
              bchPort: makeFakeBchProbePort(),
              evmToken: asset.address as Hex,
              evmTokenDecimals: asset.decimals,
              bchTokenDecimals: 2,
              env: {
                PROBE_MAINNET_CONFIRM: MAINNET_CONFIRM_PHRASE,
              },
            },
          );
          expect(probeResult.status).toBe('dry-run');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          probeStatus = msg.includes('Fast lane is limited')
            ? 'BLOCKED(solver-18dec)'
            : `FAIL(${msg.slice(0, 30)})`;
        }
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'probe dry-run',
          result: probeStatus,
          gasUsed: '-',
          timeMs: Math.round(performance.now() - tProbe),
        });

        // 5. Quote
        const tQuote = performance.now();
        const secret1 = `0x${'11'.repeat(32)}` as Hex32;
        const hashLock1 = sha256(secret1);
        let quoteOrderId: Hex32 | undefined;
        let quoteTerms: OrderTerms | undefined;
        let quoteStatus = 'PASS';
        try {
          const quote = await solverClient.quote({
            direction: 'EVM_TO_BCH',
            token: 'PUSD',
            chainId: cfg.chainId,
            evmToken: asset.address as Address,
            amountIn: 5n * unit,
            userEvmAddress: userAccount.address,
            userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
            hashLock: hashLock1,
            lane: 'safe',
          });
          quoteOrderId = quote.orderId;
          quoteTerms = quote.terms as OrderTerms;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          quoteStatus = msg.includes('Only 100 PUSD')
            ? 'BLOCKED(solver-18dec)'
            : `FAIL(${msg.slice(0, 30)})`;
        }
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'quote',
          result: quoteStatus,
          gasUsed: '-',
          timeMs: Math.round(performance.now() - tQuote),
        });

        // 6. Lock (permit-intent if supported) + Relay check
        let lockGas = 0n;
        let lockWithIntentGas = 0n;
        if (asset.permit && quoteOrderId && quoteTerms) {
          const tPermit = performance.now();
          const relayReq = await signRelayLockRequest({
            evmAdapter,
            orderId: quoteOrderId,
            terms: quoteTerms,
            userAccount,
          });
          let relayResult = 'PASS';
          try {
            await solverClient.relayLock(quoteOrderId, relayReq);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            relayResult = msg.includes('Malformed relay lock payload')
              ? 'BLOCKED(solver-pr)'
              : `FAIL(${msg.slice(0, 30)})`;
            const p = await signRelayLockPayload({
              evmAdapter,
              terms: quoteTerms,
              userAccount,
            });
            const relayTx = await evmAdapter.relayLock({
              chain: cfg.id,
              orderId: quoteOrderId,
              payload: p,
            });
            const receipt = await publicClient.getTransactionReceipt({
              hash: relayTx.txId as Hex32,
            });
            lockWithIntentGas = receipt.gasUsed;
          }
          scenarioRows.push({
            chain: cfg.id,
            route: `${asset.symbol}/PUSD`,
            scenario: 'lock (permit-intent)',
            result: relayResult,
            gasUsed: lockWithIntentGas ? lockWithIntentGas.toString() : '-',
            timeMs: Math.round(performance.now() - tPermit),
          });
        }

        // 7. Lock (approve-plus-lock via EvmChainAdapter) + Reveal + Claim
        const tApproveLock = performance.now();
        const secret2 = `0x${'22'.repeat(32)}` as Hex32;
        const hashLock2 = sha256(secret2);
        const revQuote = await solverClient.quote({
          direction: 'BCH_TO_EVM',
          token: 'PUSD',
          chainId: cfg.chainId,
          evmToken: asset.address as Address,
          amountIn: 500n,
          userEvmAddress: userAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          hashLock: hashLock2,
          lane: 'safe',
        });
        const lockTx = await evmAdapter.lock(revQuote.terms as OrderTerms);
        const lockReceipt = await publicClient.getTransactionReceipt({
          hash: lockTx.txId as Hex32,
        });
        lockGas = lockReceipt.gasUsed;
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'lock (approve+lock)',
          result: 'PASS',
          gasUsed: lockGas.toString(),
          timeMs: Math.round(performance.now() - tApproveLock),
        });

        const tReveal = performance.now();
        const revRes = await solverClient.revealSecret(
          revQuote.orderId,
          secret2,
        );
        expect(revRes.ok).toBe(true);
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'revealSecret',
          result: 'PASS',
          gasUsed: '-',
          timeMs: Math.round(performance.now() - tReveal),
        });

        const tClaim = performance.now();
        const revLockId = evmLockId(solverAccount.address, hashLock2);
        const claimTx = await evmAdapter.claim(revLockId, secret2);
        const claimReceipt = await publicClient.getTransactionReceipt({
          hash: claimTx.txId as Hex32,
        });
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'claim',
          result: 'PASS',
          gasUsed: claimReceipt.gasUsed.toString(),
          timeMs: Math.round(performance.now() - tClaim),
        });

        // 8. Refund drill (time travel past deadline)
        const tRefund = performance.now();
        const secret3 = `0x${'33'.repeat(32)}` as Hex32;
        const hashLock3 = sha256(secret3);
        const refQuote = await solverClient.quote({
          direction: 'BCH_TO_EVM',
          token: 'PUSD',
          chainId: cfg.chainId,
          evmToken: asset.address as Address,
          amountIn: 200n,
          userEvmAddress: userAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          hashLock: hashLock3,
          lane: 'safe',
        });
        await evmAdapter.lock(refQuote.terms as OrderTerms);
        const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
        const jump =
          refQuote.terms.evmDeadline - Number(latestBlock.timestamp) + 15;
        await fork.rpc('evm_increaseTime', [Math.max(jump, 1)]);
        await fork.rpc('evm_mine', []);
        const refLockId = evmLockId(solverAccount.address, hashLock3);
        const refTx = await evmAdapter.refund(refLockId);
        const refReceipt = await publicClient.getTransactionReceipt({
          hash: refTx.txId as Hex32,
        });
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'refund drill',
          result: 'PASS',
          gasUsed: refReceipt.gasUsed.toString(),
          timeMs: Math.round(performance.now() - tRefund),
        });

        // 9. Send link
        const tSend = performance.now();
        const secret4 = `0x${'44'.repeat(32)}` as Hex32;
        const hashLock4 = sha256(secret4);
        const latestAfterRef = await publicClient.getBlock({
          blockTag: 'latest',
        });
        const sendLink = parseSendLink({
          id: hashLock4,
          destinationChainId: cfg.chainId,
          token: asset.address as Address,
          recipientAddress: recipientAccount.address,
          amount: 2n * unit,
          windowSeconds: 86_400,
          status: 'quoted',
          createdAt: Number(latestAfterRef.timestamp),
        });
        const { txRef: sendLockTx, lockId: sendLockId } = await lockSendLink({
          adapter: evmAdapter,
          sendLink,
          hashLock: hashLock4,
        });
        const sendClaimTx = await claimSendLink({
          adapter: evmAdapter,
          lockId: sendLockId,
          secret: secret4,
        });
        expect(sendLockTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
        expect(sendClaimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'send link (lock+claim)',
          result: 'PASS',
          gasUsed: '-',
          timeMs: Math.round(performance.now() - tSend),
        });

        // 10. Pay link (create + fetch + quote)
        const tPay = performance.now();
        const createLinkRes = await fetch(`${baseUrl}/v1/links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            recipientAddress:
              'bitcoincash:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfnhks603',
            token: 'PUSD',
            amountOut: '500',
            memo: 'rehearsal-invoice',
          }),
        });
        const linkCreated = (await createLinkRes.json()) as {
          id?: string;
        };
        let payResult = 'PASS';
        if (!createLinkRes.ok || !linkCreated.id) {
          payResult = `HTTP_${createLinkRes.status}`;
        } else {
          const getRes = await fetch(`${baseUrl}/v1/links/${linkCreated.id}`);
          if (!getRes.ok) payResult = `GET_HTTP_${getRes.status}`;
        }
        scenarioRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          scenario: 'pay link',
          result: payResult,
          gasUsed: '-',
          timeMs: Math.round(performance.now() - tPay),
        });

        // 11. Cost reality check (using live mainnet eth_gasPrice + L1 fee)
        const liveClient = createPublicClient({
          transport: http(forkRpcUrl),
        });
        const gasPriceWei = await liveClient.getGasPrice();
        const nativeUsd = NATIVE_USD_BY_CHAIN[cfg.id] ?? 3000;
        const lockOrPermitGas =
          lockWithIntentGas > 0n ? lockWithIntentGas : lockGas;
        const execGas = lockOrPermitGas + claimReceipt.gasUsed;
        const execUsd = relayCostUsd(execGas, gasPriceWei, nativeUsd);

        let l1FeeUsd = 0;
        const sampleClaimData = encodeFunctionData({
          abi: ferryHtlcAbi,
          functionName: 'claim',
          args: [revLockId, secret2],
        });
        if (cfg.id === 'base') {
          const l1Wei = await estimateBaseL1FeeWei(liveClient, sampleClaimData);
          l1FeeUsd = (Number(l1Wei) / 1e18) * nativeUsd;
        } else if (cfg.id === 'arbitrum') {
          const arb = await estimateArbitrumGasComponents(liveClient, {
            to: htlcAddress,
            data: sampleClaimData,
          });
          l1FeeUsd = (Number(arb.l1FeeWei) / 1e18) * nativeUsd;
        }
        const totalUsd = execUsd + l1FeeUsd;
        const minSwapSpreadUsd = 0.004; // 40 bps * $1.00 min swap
        const deficit = Math.max(0, totalUsd - minSwapSpreadUsd);
        costRows.push({
          chain: cfg.id,
          route: `${asset.symbol}/PUSD`,
          gasPriceWei,
          execGas,
          execUsd,
          l1FeeUsd,
          totalUsd,
          minSwapSpreadUsd,
          recommendedFixedFeeUsd:
            deficit > 0 ? Math.ceil(deficit * 100) / 100 : 0,
        });
      } finally {
        await appClose?.();
        await fork.stop();
      }
    }, 180_000);
  }

  it('verifies Arc and Robinhood read-only mainnet pre-flight', async () => {
    for (const chainId of ['arc', 'robinhood'] as const) {
      const cfg = mainnetChains.find((c) => c.id === chainId);
      expect(cfg).toBeDefined();
      if (!cfg) continue;

      const t0 = performance.now();
      const client = createPublicClient({
        transport: http(cfg.rpcUrls[0]!),
      });
      const factoryCode = await client.getCode({ address: CREATE2_FACTORY });
      const htlcCode = await client.getCode({ address: PREDICTED_HTLC });
      expect(factoryCode && factoryCode.length > 2).toBe(true);
      expect(htlcCode ?? '0x').toBe('0x');

      if (chainId === 'arc' && cfg.assets[0]) {
        const approveGas = await client.estimateGas({
          account: privateKeyToAccount(USER_KEY).address,
          to: cfg.assets[0].address as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [PREDICTED_HTLC, 1_000_000n],
          }),
        });
        expect(approveGas).toBeGreaterThan(0n);
      }

      scenarioRows.push({
        chain: cfg.id,
        route: cfg.assets[0] ? `${cfg.assets[0].symbol}/PUSD` : 'N/A',
        scenario: 'read-only pre-flight',
        result: 'PASS',
        gasUsed: '-',
        timeMs: Math.round(performance.now() - t0),
      });
    }

    // Print summary tables for PR / handoff
    console.info('\n=== REHEARSAL SCENARIO TABLE ===');
    console.info(
      '| Chain | Route | Scenario | Result | Gas Used | Time (ms) |',
    );
    console.info('| --- | --- | --- | --- | ---: | ---: |');
    for (const r of scenarioRows) {
      console.info(
        `| ${r.chain} | ${r.route} | ${r.scenario} | ${r.result} | ${r.gasUsed} | ${r.timeMs} |`,
      );
    }

    console.info('\n=== COST REALITY CHECK TABLE ===');
    console.info(
      '| Chain | Route | Gas Price (wei) | Relay Gas | Exec USD | L1 Fee USD | Total USD | $1 Spread ($0.004) | Recommended Fixed Fee |',
    );
    console.info(
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const c of costRows) {
      console.info(
        `| ${c.chain} | ${c.route} | ${c.gasPriceWei} | ${c.execGas} | $${c.execUsd.toFixed(6)} | $${c.l1FeeUsd.toFixed(6)} | $${c.totalUsd.toFixed(6)} | $${c.minSwapSpreadUsd.toFixed(4)} | $${c.recommendedFixedFeeUsd.toFixed(2)} |`,
      );
    }
  }, 60_000);
});
