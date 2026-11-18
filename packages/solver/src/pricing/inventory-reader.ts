import type { PublicClient } from 'viem';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { SolverConfig } from '../config.js';
import type { BchQuorumClient } from '../bch/quorum-client.js';
import type { BchQuorumStatus } from '../bch/types.js';
import { deriveBchKeyDetails } from '../bch/lock-builder.js';

export interface BchInventory {
  pusd: bigint; // atoms (2 decimals: 100 = $1.00)
  musd: bigint; // atoms (2 decimals: 100 = $1.00)
  sats: bigint; // satoshis
  asOf: number;
}

export interface EvmInventory {
  chain: string;
  nativeWei: bigint;
  tokens: Map<string, bigint>; // symbol or address (lowercase) -> bigint base units
  asOf: number;
}

export interface InventoryReaderOptions {
  config: SolverConfig;
  bchClient: BchQuorumClient;
  evmAdapter: EvmChainAdapter;
  evmAdapters?: Map<string, EvmChainAdapter> | undefined;
  evmClients?: Map<string, PublicClient> | undefined;
  solverEvmAddress: string;
  solverBchScriptHash?: string | undefined;
  cacheTtlSeconds?: number | undefined; // default 4 seconds
}

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const;

export function normalizeCategory(cat: string): string {
  return cat.startsWith('0x') ? cat.slice(2).toLowerCase() : cat.toLowerCase();
}

export function evaluateBchHealth(
  quorum: BchQuorumStatus,
  config: Pick<SolverConfig, 'network' | 'tipMaxAgeBchSeconds'>,
): { isHealthy: boolean; stale: boolean } {
  if (!quorum.isQuorumHealthy || !quorum.quorumTip || quorum.quorumTip <= 0) {
    return { isHealthy: false, stale: true };
  }

  const livenessHealthy =
    quorum.isLivenessHealthy !== undefined
      ? quorum.isLivenessHealthy
      : quorum.livenessAgeSeconds !== undefined
        ? quorum.livenessAgeSeconds <= 60
        : quorum.ageSeconds <= config.tipMaxAgeBchSeconds;

  if (!livenessHealthy) {
    return { isHealthy: false, stale: true };
  }

  const isMainnet = config.network === 'mainnet';
  if (isMainnet && quorum.ageSeconds > config.tipMaxAgeBchSeconds) {
    return { isHealthy: false, stale: true };
  }

  return { isHealthy: true, stale: false };
}

export class InventoryReader {
  private readonly config: SolverConfig;
  private readonly bchClient: BchQuorumClient;
  private readonly evmAdapter: EvmChainAdapter;
  private readonly evmAdapters?: Map<string, EvmChainAdapter> | undefined;
  private readonly solverEvmAddress: string;
  private solverBchScriptHash?: string | undefined;
  private readonly cacheTtlSeconds: number;

  private bchCache: BchInventory | null = null;
  private evmCache = new Map<string, EvmInventory>();

  constructor(options: InventoryReaderOptions) {
    this.config = options.config;
    this.bchClient = options.bchClient;
    this.evmAdapter = options.evmAdapter;
    this.evmAdapters = options.evmAdapters;
    this.solverEvmAddress = options.solverEvmAddress;
    this.solverBchScriptHash = options.solverBchScriptHash;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 4;
  }

  private getAdapter(chain?: string): EvmChainAdapter {
    if (chain && this.evmAdapters) {
      const adapter = this.evmAdapters.get(chain.toLowerCase());
      if (adapter) return adapter;
    }
    return this.evmAdapter;
  }

  async getSolverBchScriptHash(): Promise<string> {
    if (this.solverBchScriptHash) {
      return this.solverBchScriptHash;
    }
    if (this.config.solverBchWif) {
      const details = await deriveBchKeyDetails(
        this.config.solverBchWif,
        this.config.network === 'mainnet' ? 'bitcoincash' : 'bchtest',
      );
      this.solverBchScriptHash = details.scriptHash;
      return this.solverBchScriptHash;
    }
    // Fallback scriptHash for zeroed p2pkh if no WIF configured
    this.solverBchScriptHash =
      'cbb6361a7a0b38038feecb2816f1947b6a48f4791334005b4b2cb5d2c55b6c38';
    return this.solverBchScriptHash;
  }

  setSolverBchScriptHash(scriptHash: string): void {
    this.solverBchScriptHash = scriptHash;
  }

  async getBchInventory(forceRefresh = false): Promise<BchInventory> {
    const now = Math.floor(Date.now() / 1000);
    const quorum = this.bchClient.getQuorumStatus();
    const health = evaluateBchHealth(quorum, this.config);

    if (!health.isHealthy) {
      throw new Error(
        `BCH node tip is stale or unhealthy (quotingState: ${quorum.quotingState}, age: ${quorum.ageSeconds}s)`,
      );
    }

    if (
      quorum.ageSeconds !== Infinity &&
      quorum.ageSeconds > this.config.tipMaxAgeBchSeconds
    ) {
      throw new Error(
        `BCH node tip age (${quorum.ageSeconds}s) exceeds maximum allowed age (${this.config.tipMaxAgeBchSeconds}s)`,
      );
    }

    if (
      !forceRefresh &&
      this.bchCache &&
      now - this.bchCache.asOf < this.cacheTtlSeconds
    ) {
      return this.bchCache;
    }

    const scriptHash = await this.getSolverBchScriptHash();
    const utxos = await this.bchClient.listUnspent(
      scriptHash,
      'include_tokens',
    );

    const normPusd = normalizeCategory(this.config.tpusdCategory);
    const normMusd = normalizeCategory(this.config.tmusdCategory);

    let sats = 0n;
    let pusd = 0n;
    let musd = 0n;

    for (const utxo of utxos) {
      sats += BigInt(utxo.value ?? 0);
      if (utxo.token_data?.amount) {
        const cat = normalizeCategory(utxo.token_data.category);
        const amount = BigInt(utxo.token_data.amount);
        if (cat === normPusd) {
          pusd += amount;
        } else if (cat === normMusd) {
          musd += amount;
        }
      }
    }

    this.bchCache = {
      pusd,
      musd,
      sats,
      asOf: now,
    };

    return this.bchCache;
  }

  async getEvmInventory(
    chain: string = 'base',
    tokenAddress?: string,
    forceRefresh = false,
  ): Promise<EvmInventory> {
    const now = Math.floor(Date.now() / 1000);
    const chainKey = chain.toLowerCase();
    const adapter = this.getAdapter(chainKey);

    const tip = await adapter.getTip();
    const ageSeconds = Math.max(0, tip.ageSeconds);
    const isStale =
      (tip as { stale?: boolean }).stale ||
      ageSeconds > this.config.tipMaxAgeBaseSeconds ||
      tip.height <= 0;
    if (isStale) {
      throw new Error(
        `EVM node tip for chain ${chainKey} is stale or unhealthy (height: ${tip.height}, age: ${ageSeconds}s, max: ${this.config.tipMaxAgeBaseSeconds}s)`,
      );
    }

    const cached = this.evmCache.get(chainKey);
    const tokenKey = tokenAddress?.toLowerCase();
    if (
      !forceRefresh &&
      cached &&
      now - cached.asOf < this.cacheTtlSeconds &&
      (!tokenKey || cached.tokens.has(tokenKey))
    ) {
      return cached;
    }

    // Read native balance
    let nativeWei = 0n;
    const custom = adapter as unknown as {
      getNativeBalance?: (addr: string) => Promise<bigint> | bigint;
      nativeBalance?: bigint | string | number;
      client?: {
        getBalance?: (args: { address: `0x${string}` }) => Promise<bigint>;
      };
    };

    if (typeof custom.getNativeBalance === 'function') {
      nativeWei = BigInt(await custom.getNativeBalance(this.solverEvmAddress));
    } else if (custom.nativeBalance !== undefined) {
      nativeWei = BigInt(custom.nativeBalance);
    } else if (
      custom.client &&
      typeof custom.client.getBalance === 'function'
    ) {
      nativeWei = await custom.client.getBalance({
        address: this.solverEvmAddress as `0x${string}`,
      });
    }

    // Read token balances
    const tokens = cached?.tokens
      ? new Map(cached.tokens)
      : new Map<string, bigint>();
    const tokensToRead = new Set<string>();
    if (tokenKey) {
      tokensToRead.add(tokenKey);
    }
    // Also include configured default tokens on adapter
    if (chainKey === 'base' && this.config.baseUsdcAddress) {
      tokensToRead.add(this.config.baseUsdcAddress.toLowerCase());
    }
    for (const asset of adapter.assets) {
      if (asset.address) {
        tokensToRead.add(asset.address.toLowerCase());
      }
    }

    for (const tokAddr of tokensToRead) {
      const bal = await this.readEvmTokenBalance(adapter, tokAddr);
      tokens.set(tokAddr, bal);
    }

    const inventory: EvmInventory = {
      chain: chainKey,
      nativeWei,
      tokens,
      asOf: now,
    };

    this.evmCache.set(chainKey, inventory);
    return inventory;
  }

  private async readEvmTokenBalance(
    adapter: EvmChainAdapter,
    tokenAddress: string,
  ): Promise<bigint> {
    const custom = adapter as unknown as {
      getTokenBalance?: (
        token: string,
        addr: string,
      ) => Promise<bigint> | bigint;
      tokenBalances?: Record<string, bigint | string | number>;
      client?: {
        readContract?: (args: unknown) => Promise<unknown>;
      };
    };

    if (typeof custom.getTokenBalance === 'function') {
      return BigInt(
        await custom.getTokenBalance(tokenAddress, this.solverEvmAddress),
      );
    }
    if (custom.tokenBalances) {
      const key = tokenAddress.toLowerCase();
      if (custom.tokenBalances[key] !== undefined) {
        return BigInt(custom.tokenBalances[key]);
      }
    }
    if (custom.client && typeof custom.client.readContract === 'function') {
      const res = await custom.client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20BalanceOfAbi,
        functionName: 'balanceOf',
        args: [this.solverEvmAddress as `0x${string}`],
      });
      return BigInt(res as string | number | bigint);
    }
    return 0n;
  }

  /**
   * Retrieves available inventory for a specific asset and chain.
   * Throws an error if node tips are stale or balance reading fails.
   */
  async getAssetInventory(params: {
    asset: string;
    chain?: string | undefined;
    tokenAddress?: string | undefined;
    forceRefresh?: boolean | undefined;
  }): Promise<bigint> {
    const normAsset = params.asset.toUpperCase();
    if (normAsset === 'PUSD') {
      const bch = await this.getBchInventory(params.forceRefresh);
      return bch.pusd;
    }
    if (normAsset === 'MUSD') {
      const bch = await this.getBchInventory(params.forceRefresh);
      return bch.musd;
    }
    if (normAsset === 'BCH') {
      const bch = await this.getBchInventory(params.forceRefresh);
      return bch.sats;
    }

    // EVM token
    const evm = await this.getEvmInventory(
      params.chain ?? 'base',
      params.tokenAddress,
      params.forceRefresh,
    );
    if (normAsset === 'ETH' || normAsset === 'BNB') {
      return evm.nativeWei;
    }

    const tokenKey = (
      params.tokenAddress ??
      (params.chain === 'base' || !params.chain
        ? this.config.baseUsdcAddress
        : '')
    ).toLowerCase();

    return evm.tokens.get(tokenKey) ?? 0n;
  }

  clearCache(): void {
    this.bchCache = null;
    this.evmCache.clear();
  }
}
