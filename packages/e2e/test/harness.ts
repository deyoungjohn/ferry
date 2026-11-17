import { spawn, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseSignature,
} from 'viem';
import type {
  Abi,
  Address,
  Chain,
  Hex,
  Hex as HexString,
  PublicClient,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { OrderTerms } from '@ferry/core';
import type { RelayLockRequest } from '@ferry/core/api';
import { EvmChainAdapter } from '@ferry/chain-evm';
import type { RelayLockPayload } from '@ferry/chain-evm';
import {
  SolverDatabase,
  SolverEngine,
  MockPriceSource,
  buildServer,
  loadConfigFromEnv,
  type BchChainPort,
  type BchQuorumClient,
  type BchQuorumStatus,
  type EvmChainPort,
} from '@ferry/solver';
import { SolverClient } from '@ferry/solver-client';

const execFileAsync = promisify(execFile);

export const DEPLOYER_KEY: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const SOLVER_KEY: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
export const USER_KEY: Hex =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
export const RECIPIENT_KEY: Hex =
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';

export const USER_BCH_LOCKING_BYTECODE: Hex =
  '0x76a914111111111111111111111111111111111111111188ac';

const HTLC_EVM_DIR = fileURLToPath(new URL('../../htlc-evm', import.meta.url));

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

export interface AnvilInstance {
  rpcUrl: string;
  port: number;
  chainId: number;
  chain: Chain;
  stop: () => Promise<void>;
  increaseTimeAndMine: (seconds: number) => Promise<void>;
  setNextBlockTimestamp: (unixSeconds: number) => Promise<void>;
  snapshot: () => Promise<string>;
  revert: (id: string) => Promise<void>;
}

export async function startAnvil(options?: {
  chainId?: number;
}): Promise<AnvilInstance> {
  const port = await getFreePort();
  const chainId = options?.chainId ?? 31337;
  const rpcUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(
    'anvil',
    ['--port', String(port), '--chain-id', String(chainId), '--silent'],
    {
      stdio: 'ignore',
    },
  );

  const deadline = Date.now() + 15_000;
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
      if (res.ok) break;
    } catch {
      // Wait for anvil startup
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const chain: Chain = {
    id: chainId,
    name: `anvil-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };

  const rpc = async <T = unknown>(
    method: string,
    params: unknown[],
  ): Promise<T> => {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
      throw new Error(`Anvil RPC ${method} failed with ${res.status}`);
    }
    const json = (await res.json()) as { result: T };
    return json.result;
  };

  return {
    rpcUrl,
    port,
    chainId,
    chain,
    increaseTimeAndMine: async (seconds: number) => {
      await rpc('evm_increaseTime', [seconds]);
      await rpc('evm_mine', []);
    },
    setNextBlockTimestamp: async (unixSeconds: number) => {
      await rpc('evm_setNextBlockTimestamp', [unixSeconds]);
    },
    snapshot: async () => rpc<string>('evm_snapshot', []),
    revert: async (id: string) => {
      await rpc('evm_revert', [id]);
    },
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

export async function deployFerryHtlcDeterministic(
  rpcUrl: string,
  deployerKey: Hex = DEPLOYER_KEY,
): Promise<Address> {
  const { stdout } = await execFileAsync(
    'forge',
    [
      'script',
      'script/Deploy.s.sol:Deploy',
      '--rpc-url',
      rpcUrl,
      '--broadcast',
    ],
    {
      cwd: HTLC_EVM_DIR,
      env: {
        ...process.env,
        DEPLOYER_EVM_PRIVATE_KEY: deployerKey,
      },
    },
  );
  const match = stdout.match(/FerryHTLC deployed:\s*(0x[0-9a-fA-F]{40})/);
  if (!match?.[1]) {
    throw new Error(`Could not parse deployed FerryHTLC address:\n${stdout}`);
  }
  return getAddress(match[1]);
}

export interface ForgeArtifact {
  abi: Abi;
  bytecode: Hex;
}

export function loadForgeArtifact(relativePath: string): ForgeArtifact {
  const fullPath = fileURLToPath(
    new URL(`../../htlc-evm/out/${relativePath}`, import.meta.url),
  );
  const json = JSON.parse(readFileSync(fullPath, 'utf8')) as {
    abi: Abi;
    bytecode: { object: string };
  };
  const raw = json.bytecode.object;
  const bytecode = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
  return { abi: json.abi, bytecode };
}

export async function deployArtifact(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account: ReturnType<typeof privateKeyToAccount>,
  chain: Chain,
  artifactPath: string,
  args: unknown[] = [],
): Promise<Address> {
  const artifact = loadForgeArtifact(artifactPath);
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`Deployment of ${artifactPath} produced no address`);
  }
  return getAddress(receipt.contractAddress);
}

export interface InProcessSolverHarness {
  baseUrl: string;
  client: SolverClient;
  evmAdapter: EvmChainAdapter;
  priceSource: MockPriceSource;
  db: SolverDatabase;
  stop: () => Promise<void>;
}

export async function startInProcessSolver(params: {
  rpcUrl: string;
  chain: Chain;
  htlcAddress: Address;
  tokenAddress: Address;
  solverKey?: Hex;
  nowSeconds?: number;
  rateLimitMax?: number;
}): Promise<InProcessSolverHarness> {
  const solverAccount = privateKeyToAccount(params.solverKey ?? SOLVER_KEY);
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: http(params.rpcUrl),
    cacheTime: 0,
  });
  const solverWalletClient = createWalletClient({
    account: solverAccount,
    chain: params.chain,
    transport: http(params.rpcUrl),
  });

  const evmAdapter = new EvmChainAdapter({
    config: {
      id: 'base',
      chainId: params.chain.id,
      htlcAddress: params.htlcAddress,
      rpcUrls: [params.rpcUrl],
      explorerUrl: 'https://basescan.org',
      nativeGas: 'ETH',
      finality: { fast: 1, safe: 1 },
      relayCostUsd: 0.01,
      assets: [
        {
          symbol: 'USDC',
          address: params.tokenAddress,
          decimals: 6,
          permit: true,
        },
      ],
    },
    client: publicClient,
    walletClient: solverWalletClient,
  });

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const priceSource = new MockPriceSource(
    new Map([
      ['usdc', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
      ['pusd', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
    ]),
  );

  const mockBchPort: BchChainPort = {
    isQuorumHealthy: () => true,
    isQuotingEnabled: () => true,
    getTip: async () => ({ height: 330_000, hash: '00'.repeat(32) }),
    broadcast: async () => 'bch-tx-' + Math.random().toString(36).slice(2, 8),
    isOnChain: async () => true,
    getScriptHashHistory: async () => [],
  };

  const bchClient = {
    ...mockBchPort,
    getQuorumStatus(): BchQuorumStatus {
      return {
        quorumTip: 330_000,
        tips: { 'wss://node1.bch': 330_000, 'wss://node2.bch': 330_000 },
        isQuorumHealthy: true,
        isLivenessHealthy: true,
        ageSeconds: 10,
        lastConfirmedAt: Math.floor(Date.now() / 1000) - 10,
        livenessAgeSeconds: 5,
        healthyServersCount: 2,
        quotingAllowed: true,
        quotingState: 'HEALTHY',
      };
    },
    waitForDoubleSpendProof: async () => ({ hasProof: false }),
    broadcastTransaction: async () =>
      'bch-tx-' + Math.random().toString(36).slice(2, 8),
    start: async () => {},
    stop: async () => {},
  } as unknown as BchQuorumClient;

  const mockEvmPort: EvmChainPort = {
    getTip: async () => ({ height: 1, finalized: true }),
    getLock: async () => ({ status: 'locked' as const }),
    isFinal: async () => true,
    broadcast: async (txHex: string) => txHex,
    isOnChain: async () => true,
  };

  const config = loadConfigFromEnv({
    ALLOW_DEV_KEYS: '1',
    OPERATOR_TOKEN: 'a'.repeat(32),
    SOLVER_EVM_PRIVATE_KEY: params.solverKey ?? SOLVER_KEY,
    BASE_CHAIN_ID: String(params.chain.id),
    BASE_RPC_URL: params.rpcUrl,
    BASE_FERRY_HTLC_ADDRESS: params.htlcAddress,
    BASE_USDC_ADDRESS: params.tokenAddress,
    RATE_LIMIT_MAX_PER_ADDRESS: String(params.rateLimitMax ?? 100),
    RATE_LIMIT_MAX_PER_IP: String(params.rateLimitMax ?? 100),
  });

  const db = new SolverDatabase(':memory:');
  const engine = new SolverEngine(db, mockBchPort, mockEvmPort, config);
  const app = buildServer({
    config,
    db,
    evmAdapter,
    bchClient,
    engine,
    priceSource,
    inventoryReader: makeFundedInventory(),
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addressInfo = app.server.address();
  if (!addressInfo || typeof addressInfo === 'string') {
    throw new Error('Failed to bind solver HTTP server');
  }
  const baseUrl = `http://127.0.0.1:${addressInfo.port}`;
  const client = new SolverClient({ baseUrl });

  return {
    baseUrl,
    client,
    evmAdapter,
    priceSource,
    db,
    stop: async () => {
      await app.close();
      db.close();
    },
  };
}

export async function signRelayLockPayload(params: {
  evmAdapter: EvmChainAdapter;
  terms: OrderTerms;
  userAccount: ReturnType<typeof privateKeyToAccount>;
}): Promise<RelayLockPayload> {
  const unsigned = await params.evmAdapter.buildUserLock(params.terms);
  const payload = unsigned.payload as {
    mode: 'permit-intent';
    lockIntentTypedData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: 'LockIntent';
      message: Record<string, unknown>;
    };
    permitTypedData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: 'Permit';
      message: Record<string, unknown>;
    };
  };

  if (payload.mode !== 'permit-intent') {
    throw new Error(`Expected permit-intent mode, got ${payload.mode}`);
  }

  const signTyped = params.userAccount.signTypedData as (args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;

  const intentSig = await signTyped({
    domain: payload.lockIntentTypedData.domain,
    types: payload.lockIntentTypedData.types,
    primaryType: 'LockIntent',
    message: payload.lockIntentTypedData.message,
  });

  const permitSigHex = await signTyped({
    domain: payload.permitTypedData.domain,
    types: payload.permitTypedData.types,
    primaryType: 'Permit',
    message: payload.permitTypedData.message,
  });

  const { r, s, v, yParity } = parseSignature(permitSigHex);
  const normalizedV = Number(v ?? (yParity === 0 ? 27n : 28n));

  return {
    owner: params.userAccount.address,
    token: getAddress(params.terms.evmToken),
    recipient: getAddress(params.terms.solverEvmAddress),
    amount: params.terms.evmAmount,
    hashLock: params.terms.hashLock,
    deadline: BigInt(params.terms.evmDeadline),
    intentDeadline: BigInt(
      payload.lockIntentTypedData.message['intentDeadline'] as bigint,
    ),
    intentSig: intentSig as HexString,
    permitDeadline: BigInt(
      payload.permitTypedData.message['deadline'] as bigint,
    ),
    v: normalizedV,
    r,
    s,
  };
}

export async function signRelayLockRequest(params: {
  evmAdapter: EvmChainAdapter;
  orderId: HexString;
  terms: OrderTerms;
  userAccount: ReturnType<typeof privateKeyToAccount>;
}): Promise<RelayLockRequest> {
  const payload = await signRelayLockPayload(params);
  return {
    permit: {
      value: payload.amount,
      deadline: Number(payload.permitDeadline),
      v: payload.v,
      r: payload.r,
      s: payload.s,
    },
    intent: {
      orderId: params.orderId,
      deadline: Number(payload.intentDeadline),
    },
    signature: payload.intentSig,
  };
}

/** The solver reads real wallet balances in production; tests have no real wallets, so they inject a funded reader. */
export function makeFundedInventory(): NonNullable<
  Parameters<typeof buildServer>[0]['inventoryReader']
> {
  return {
    getAssetInventory: async () => 10n ** 15n,
    getBchInventory: async () => ({
      pusd: 10n ** 12n,
      musd: 10n ** 12n,
      sats: 10n ** 9n,
      asOf: Math.floor(Date.now() / 1000),
    }),
    getEvmInventory: async (chain: string) => ({
      chain,
      nativeWei: 10n ** 20n,
      tokens: new Map<string, bigint>(),
      asOf: Math.floor(Date.now() / 1000),
    }),
    getSolverBchScriptHash: async () => '00'.repeat(32),
    setSolverBchScriptHash: () => undefined,
    clearCache: () => undefined,
  } as unknown as NonNullable<
    Parameters<typeof buildServer>[0]['inventoryReader']
  >;
}
