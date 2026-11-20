// The solver's real engine and real HTTP API, wired to a local EVM chain (anvil) and
// the simulated Bitcoin Cash chain, with no placeholder ports: the EVM port reads the
// chain, and the Bitcoin Cash port's `isOnChain` asks the simulator.
import {
  encodePrivateKeyWif,
  secp256k1,
  sha256,
  ripemd160,
  binToHex,
} from '@bitauth/libauth';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { Address, Chain, Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EvmChainAdapter } from '@ferry/chain-evm';
import { loadChainConfig } from '@ferry/chain-config';
import {
  MockPriceSource,
  SolverDatabase,
  SolverEngine,
  buildServer,
  createBchPort,
  createEvmPort,
  loadConfigFromEnv,
} from '@ferry/solver';
import type { BchQuorumClient, EvmChainPort } from '@ferry/solver';
import { SolverClient } from '@ferry/solver-client';
import { FakeBchChain } from './fake-bch-chain.js';
import {
  ReferenceBchExecutor,
  ReferenceEvmExecutor,
  withCovenantLookup,
} from './reference-actions.js';
import type { FakeElectrumTransport } from './fake-bch-chain.js';
import { SOLVER_KEY, makeFundedInventory } from '../harness.js';

export interface BchIdentity {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly lockingBytecode: Uint8Array;
  readonly wif: string;
}

/** A Bitcoin Cash key with its pay-to-public-key-hash locking bytecode. */
export function makeBchIdentity(seed: number): BchIdentity {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = secp256k1.derivePublicKeyCompressed(
    privateKey,
  ) as Uint8Array;
  const lockingBytecode = Uint8Array.from([
    0x76,
    0xa9,
    0x14,
    ...ripemd160.hash(sha256.hash(publicKey)),
    0x88,
    0xac,
  ]);
  return {
    privateKey,
    publicKey,
    lockingBytecode,
    wif: encodePrivateKeyWif(privateKey, 'testnet'),
  };
}

/** Faults a test can switch on for the solver's Bitcoin Cash broadcasts. */
export interface BchFaults {
  /**
   * The next broadcast reaches the chain but its reply is lost (the connection
   * times out), the way a real broadcast can succeed without the caller knowing.
   */
  loseNextBroadcastReply: boolean;
}

export interface ExtraForkChain {
  readonly chainKey: 'ethereum' | 'arbitrum' | 'bnb' | 'robinhood';
  readonly chain: Chain;
  readonly htlcAddress: Address;
  readonly tokenAddress: Address;
  readonly tokenDecimals: number;
  readonly tokenPermit: boolean;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly deployBlock?: bigint;
}

export interface RealEngineSolver {
  baseUrl: string;
  client: SolverClient;
  evmAdapter: EvmChainAdapter;
  evmAdapters: ReadonlyMap<string, EvmChainAdapter>;
  evmPublic: PublicClient;
  priceSource: MockPriceSource;
  db: SolverDatabase;
  engine: SolverEngine;
  chain: FakeBchChain;
  bchClient: BchQuorumClient;
  transports: FakeElectrumTransport[];
  solverBch: BchIdentity;
  faults: BchFaults;
  /** Confirmations the EVM port requires before it calls a transaction final. */
  evmConfirmations: { value: number };
  /** Engine events, newest last; useful when a swap stalls. */
  events: string[];
  /** Orders whose state is reported when a wait times out. */
  watch: (orderId: string) => void;
  /** One reconciliation pass of the engine. */
  pump: () => Promise<void>;
  /** Pumps until `predicate` holds, or fails after `timeoutMs`. */
  waitFor: (
    description: string,
    predicate: () => boolean | Promise<boolean>,
    timeoutMs?: number,
  ) => Promise<void>;
  /** An anvil snapshot of the EVM chain. */
  snapshot: () => Promise<string>;
  /** Revert the EVM chain to a snapshot. */
  revert: (snapshot: string) => Promise<void>;
  /** A new engine and server over the same database, as after a restart. */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startRealEngineSolver(params: {
  rpcUrl: string;
  chain: Chain;
  htlcAddress: Address;
  tokenAddress: Address;
  bchChain: FakeBchChain;
  solverBch: BchIdentity;
  tokenDecimals?: number;
  tokenPermit?: boolean;
  solverEvmKey?: Hex;
  solverEnv?: Readonly<Record<string, string>>;
  /**
   * Use the reference on-chain actions from the test support code instead of the
   * solver's own executors. Defaults to the FERRY_E2E_REFERENCE_ACTIONS switch.
   */
  referenceActions?: boolean;
  deployBlock?: bigint;
  extraChains?: readonly ExtraForkChain[];
}): Promise<RealEngineSolver> {
  const solverAccount = privateKeyToAccount(params.solverEvmKey ?? SOLVER_KEY);
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: http(params.rpcUrl),
    cacheTime: 0,
    pollingInterval: 50,
  });
  const walletClient = createWalletClient({
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
          decimals: params.tokenDecimals ?? 6,
          permit: params.tokenPermit ?? true,
        },
      ],
    },
    client: publicClient,
    walletClient,
    deployBlock: params.deployBlock,
  });

  const evmAdapters = new Map<string, EvmChainAdapter>([
    ['base', evmAdapter],
    [String(params.chain.id), evmAdapter],
  ]);
  const evmClients = new Map<string, PublicClient>([
    ['base', publicClient],
    [String(params.chain.id), publicClient],
  ]);
  for (const extra of params.extraChains ?? []) {
    const extraPublic = createPublicClient({
      chain: extra.chain,
      transport: http(extra.rpcUrl),
      cacheTime: 0,
      pollingInterval: 50,
    });
    const extraWallet = createWalletClient({
      account: solverAccount,
      chain: extra.chain,
      transport: http(extra.rpcUrl),
    });
    const extraAdapter = new EvmChainAdapter({
      config: {
        id: extra.chainKey,
        chainId: extra.chain.id,
        htlcAddress: extra.htlcAddress,
        rpcUrls: [extra.rpcUrl],
        explorerUrl: extra.explorerUrl,
        nativeGas: 'ETH',
        finality: { fast: 1, safe: 1 },
        relayCostUsd: 0.01,
        assets: [
          {
            symbol: 'USDC',
            address: extra.tokenAddress,
            decimals: extra.tokenDecimals,
            permit: extra.tokenPermit,
          },
        ],
      },
      client: extraPublic,
      walletClient: extraWallet,
      deployBlock: extra.deployBlock,
    });
    evmAdapters.set(extra.chainKey, extraAdapter);
    evmAdapters.set(String(extra.chain.id), extraAdapter);
    evmClients.set(extra.chainKey, extraPublic);
    evmClients.set(String(extra.chain.id), extraPublic);
  }

  const forkFacts = loadChainConfig({ network: 'mainnet' }).facts.map(
    (fact) => {
      const extra = (params.extraChains ?? []).find(
        (item) => item.chainKey === fact.id,
      );
      const isBase = fact.id === 'base';
      if (!extra && !isBase) return fact;
      return {
        ...fact,
        chainId: isBase ? params.chain.id : extra!.chain.id,
        htlcAddress: isBase ? params.htlcAddress : extra!.htlcAddress,
        assets: fact.assets.map((asset) =>
          asset.symbol === 'USDC'
            ? {
                ...asset,
                address: isBase ? params.tokenAddress : extra!.tokenAddress,
              }
            : asset,
        ),
      };
    },
  );
  const forkRoutes = [
    {
      key: 'usdc:base',
      chain: 'base' as const,
      asset: 'USDC' as const,
      htlcAddress: params.htlcAddress,
      deployBlock: params.deployBlock ? Number(params.deployBlock) : null,
      logMaxRange: 100_000,
      finality: { fast: 1, safe: 'finalized' as const, status: 'verified' },
      eligible: true,
      enabled: true,
      reasons: [],
    },
    ...(params.extraChains ?? []).map((extra) => ({
      key: `usdc:${extra.chainKey}`,
      chain: extra.chainKey,
      asset: 'USDC' as const,
      htlcAddress: extra.htlcAddress,
      deployBlock: extra.deployBlock ? Number(extra.deployBlock) : null,
      logMaxRange: 100_000,
      finality: { fast: 1, safe: 'finalized' as const, status: 'verified' },
      eligible: true,
      enabled: true,
      reasons: [],
    })),
  ];
  const forkChainConfig = loadChainConfig({ network: 'mainnet' });
  const forkRoutesContext = {
    chainConfig: {
      ...forkChainConfig,
      facts: forkFacts,
      chains: forkFacts,
    },
    routes: forkRoutes,
    enabledRoutes: forkRoutes,
  };

  const now = Math.floor(Date.now() / 1000);
  const priceSource = new MockPriceSource(
    new Map([
      ['usdc', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
      ['pusd', { usdPrice: 1_000_000n, source: 'reference', asOf: now }],
    ]),
  );

  const config = loadConfigFromEnv({
    COST_MODEL_ENABLED: '0',
    ALLOW_DEV_KEYS: '1',
    OPERATOR_TOKEN: 'a'.repeat(32),
    SOLVER_EVM_PRIVATE_KEY: params.solverEvmKey ?? SOLVER_KEY,
    SOLVER_BCH_WIF: params.solverBch.wif,
    BASE_CHAIN_ID: String(params.chain.id),
    BASE_RPC_URL: params.rpcUrl,
    BASE_FERRY_HTLC_ADDRESS: params.htlcAddress,
    BASE_USDC_ADDRESS: params.tokenAddress,
    RATE_LIMIT_MAX_PER_ADDRESS: '1000',
    RATE_LIMIT_MAX_PER_IP: '1000',
    ...params.solverEnv,
  });

  const { client: bchClient, transports } =
    params.bchChain.createQuorumClient();
  await bchClient.connect();

  const faults: BchFaults = { loseNextBroadcastReply: false };
  // The solver's own port over the real quorum client (which runs on the simulated chain).
  const basePort = createBchPort(bchClient);
  const bchPort = {
    ...basePort,
    broadcast: async (txHex: string) => {
      const txid = await basePort.broadcast(txHex);
      if (faults.loseNextBroadcastReply) {
        faults.loseNextBroadcastReply = false;
        throw new Error(
          'Timed out waiting for the broadcast reply (ETIMEDOUT)',
        );
      }
      return txid;
    },
  };

  const evmConfirmations = { value: 1 };
  const evmClientFor = (chainId?: number): PublicClient =>
    (chainId !== undefined ? evmClients.get(String(chainId)) : undefined) ??
    publicClient;
  // The solver's own EVM port over the real adapter; only the finality rule is replaced, so a test
  // can choose how many confirmations count.
  const realEvmPort = createEvmPort({
    evmAdapter,
    evmAdapters,
    evmClients,
  });
  const evmPort: EvmChainPort = {
    ...realEvmPort,
    getTip: async () => ({
      height: Number(await publicClient.getBlockNumber()),
      finalized: true,
    }),
    isFinal: async (txid: string, _lane, chainId?: number) => {
      try {
        const client = evmClientFor(chainId);
        const receipt = await client.getTransactionReceipt({
          hash: txid as Hex,
        });
        if (receipt.status !== 'success') return false;
        const head = await client.getBlockNumber();
        return (
          head - receipt.blockNumber + 1n >= BigInt(evmConfirmations.value)
        );
      } catch {
        return false;
      }
    },
    getLockEvidence: async (txid: string, chainId?: number) => {
      try {
        const client = evmClientFor(chainId);
        const receipt = await client.getTransactionReceipt({
          hash: txid as Hex,
        });
        if (!receipt || receipt.status !== 'success') return null;
        const [head, block] = await Promise.all([
          client.getBlockNumber(),
          client.getBlock({ blockNumber: receipt.blockNumber }),
        ]);
        const confirmations = Number(
          head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n,
        );
        return {
          confirmations,
          ageSeconds: Math.max(
            0,
            Math.floor(Date.now() / 1000) - Number(block.timestamp),
          ),
          finalized: confirmations >= evmConfirmations.value,
        };
      } catch {
        return null;
      }
    },
  };

  const db = new SolverDatabase(':memory:');
  const events: string[] = [];
  const recordEngineEvent = (info: unknown, message: string) => {
    events.push(`${message}: ${JSON.stringify(info)}`);
  };
  const useReference =
    params.referenceActions ??
    process.env['FERRY_E2E_REFERENCE_ACTIONS'] === '1';
  const enginePort = useReference
    ? withCovenantLookup(bchPort, db, params.bchChain)
    : bchPort;
  const engineConfig = {
    ...config,
    onEngineEvent: recordEngineEvent,
    onOrderError: (orderId: string, status: string, error: unknown) => {
      events.push(
        `Order error ${orderId.slice(0, 10)} ${status}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  };
  const newEngine = () =>
    useReference
      ? new SolverEngine(
          db,
          enginePort,
          evmPort,
          engineConfig,
          new ReferenceBchExecutor(
            db,
            enginePort,
            params.bchChain,
            params.solverBch,
          ),
          new ReferenceEvmExecutor(db, evmPort, evmAdapter, evmAdapters),
        )
      : new SolverEngine(db, enginePort, evmPort, engineConfig);
  let engine = newEngine();
  let app = buildServer({
    config,
    db,
    evmAdapter,
    bchClient,
    engine,
    priceSource,
    inventoryReader: makeFundedInventory(),
    evmAdapters,
    evmClients,
    routesContext: forkRoutesContext,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addressOf = () => {
    const info = app.server.address();
    if (!info || typeof info === 'string') {
      throw new Error('Failed to bind the solver HTTP server');
    }
    return `http://127.0.0.1:${info.port}`;
  };

  const watched: string[] = [];
  const harness: RealEngineSolver = {
    baseUrl: addressOf(),
    client: new SolverClient({ baseUrl: addressOf() }),
    evmAdapter,
    evmAdapters,
    evmPublic: publicClient,
    priceSource,
    db,
    engine,
    chain: params.bchChain,
    bchClient,
    transports,
    solverBch: params.solverBch,
    faults,
    evmConfirmations,
    events,
    watch: (orderId) => {
      watched.push(orderId);
    },
    pump: async () => {
      await harness.engine.reconcileOrders();
    },
    waitFor: async (description, predicate, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try {
          await harness.pump();
        } catch {
          // A failing step is visible through the assertions that follow.
        }
        if (await predicate()) return;
        if (Date.now() > deadline) {
          const refused = params.bchChain.broadcasts
            .filter((b) => b.error !== null)
            .slice(-3)
            .map((b) => `${b.error} [${b.hex.slice(0, 40)}]`);
          const orders = watched.flatMap((id) => {
            const record = db.getOrder(id);
            return record
              ? [
                  `${id.slice(0, 10)}: ${record.status}${
                    record.rejectionReason ? ` (${record.rejectionReason})` : ''
                  }`,
                ]
              : [];
          });
          throw new Error(
            `Timed out waiting for: ${description}` +
              (orders.length > 0 ? `. Orders: ${orders.join('; ')}` : '') +
              (refused.length > 0
                ? `. The simulated chain refused: ${refused.join(' | ')}`
                : '. The simulated chain saw no refused broadcast.') +
              (events.length > 0
                ? `. Recent engine events: ${events.slice(-12).join(' | ')}`
                : ''),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    snapshot: async () => {
      const id = await publicClient.request({
        method: 'evm_snapshot',
      } as never);
      return String(id);
    },
    revert: async (snapshot) => {
      const ok = await publicClient.request({
        method: 'evm_revert',
        params: [snapshot],
      } as never);
      if (!ok) throw new Error('anvil refused the snapshot revert');
    },
    restart: async () => {
      harness.engine.stop();
      await app.close();
      engine = newEngine();
      app = buildServer({
        config,
        db,
        evmAdapter,
        bchClient,
        engine,
        priceSource,
        inventoryReader: makeFundedInventory(),
      });
      await app.listen({ port: 0, host: '127.0.0.1' });
      harness.engine = engine;
      harness.baseUrl = addressOf();
      harness.client = new SolverClient({ baseUrl: harness.baseUrl });
    },
    stop: async () => {
      harness.engine.stop();
      await app.close();
      db.close();
      bchClient.close();
    },
  };
  return harness;
}

export const hex = (bytes: Uint8Array): string => binToHex(bytes);
