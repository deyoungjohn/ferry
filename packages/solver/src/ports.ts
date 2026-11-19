import type { PublicClient } from 'viem';
import { decodeHtlcLog, type EvmChainAdapter } from '@ferry/chain-evm';
import type { Hex32, OrderTerms } from '@ferry/core';
import type { BchQuorumClient } from './bch/quorum-client.js';
import { extractSecretFromSpendTx } from './bch/lock-builder.js';
import type { BchChainPort, EvmChainPort } from './engine/types.js';

/**
 * The chain ports the engine runs on, used by the daemon and by the end-to-end tests alike, so the
 * tests exercise the real ones.
 */

export function createBchPort(bchClient: BchQuorumClient): BchChainPort {
  return {
    async getTip() {
      const q = bchClient.getQuorumStatus();
      return { height: q.quorumTip, hash: '' };
    },
    isQuorumHealthy() {
      return bchClient.getQuorumStatus().isQuorumHealthy;
    },
    isQuotingEnabled() {
      return bchClient.getQuorumStatus().isQuorumHealthy;
    },
    async broadcast(txHex: string) {
      return bchClient.broadcast(txHex);
    },
    async isOnChain(txid: string) {
      try {
        const tx = await bchClient.getTransaction(txid, false);
        return tx !== null && tx !== undefined;
      } catch {
        return false;
      }
    },
    async getScriptHashHistory(hash: string) {
      const entries = await bchClient.getHistory(hash);
      return entries.map((e) => ({ tx_hash: e.tx_hash, height: e.height }));
    },
    waitForDoubleSpendProof(txid: string, windowMs?: number) {
      return bchClient.waitForDoubleSpendProof(txid, windowMs);
    },
    async listUnspent(
      scriptHash: string,
      filter?: 'include_tokens' | 'tokens_only' | 'exclude_tokens',
    ) {
      return bchClient.listUnspent(scriptHash, filter ?? 'include_tokens');
    },
    async extractSecretFromSpend(txid: string, hashLock?: string) {
      try {
        const raw = (await bchClient.getTransaction(txid, false)) as string;
        if (!raw || typeof raw !== 'string') return null;
        return extractSecretFromSpendTx(raw, hashLock);
      } catch {
        return null;
      }
    },
  };
}

export interface EvmPortOptions {
  readonly evmAdapter: EvmChainAdapter;
  /** Adapters by chain key and chain id, for locks on a chain other than the default. */
  readonly evmAdapters?: ReadonlyMap<string, EvmChainAdapter>;
  /** Public clients by chain key. */
  readonly evmClients?: ReadonlyMap<string, PublicClient>;
}

export function createEvmPort(options: EvmPortOptions): EvmChainPort {
  const { evmAdapter } = options;
  const evmAdapters = options.evmAdapters ?? new Map<string, EvmChainAdapter>();
  const evmClients = options.evmClients ?? new Map<string, PublicClient>();
  /** The adapter of the order's chain; Base (the default adapter) only when no chain is given. */
  const adapterFor = (chainId?: number): EvmChainAdapter => {
    if (chainId === undefined) return evmAdapter;
    const found = evmAdapters.get(String(chainId));
    if (!found) {
      throw new Error(`No EVM adapter is configured for chain ${chainId}`);
    }
    return found;
  };
  const clientFor = (chainId?: number): PublicClient => {
    const adapter = adapterFor(chainId);
    return (
      (adapter as unknown as { client?: PublicClient }).client ??
      evmClients.get(adapter.id) ??
      (evmAdapter as unknown as { client: PublicClient }).client
    );
  };
  return {
    async getTip() {
      const tip = await evmAdapter.getTip();
      return { height: tip.height, finalized: tip.ageSeconds <= 60 };
    },
    async getLock(lockId: string, chainId?: number) {
      const lock = await adapterFor(chainId).getLock(lockId);
      return {
        status: lock.status === 'absent' ? 'none' : lock.status,
        txid:
          lock.status === 'locked'
            ? lock.lockTx.txId
            : lock.status === 'claimed'
              ? lock.claimTx.txId
              : lock.status === 'refunded'
                ? lock.refundTx?.txId
                : undefined,
        secret:
          lock.status === 'claimed' && lock.secret ? lock.secret : undefined,
      };
    },
    async isFinal(txid: string, lane: 'safe' | 'fast', chainId?: number) {
      const adapter = adapterFor(chainId);
      return adapter.isFinal({ chain: adapter.id, txId: txid as Hex32 }, lane);
    },
    async broadcast(txHex: string) {
      if (txHex.startsWith('0x') && txHex.length > 66) {
        return clientFor().sendRawTransaction({
          serializedTransaction: txHex as `0x${string}`,
        });
      }
      return txHex;
    },
    async isOnChain(txid: string, chainId?: number) {
      try {
        const receipt = await clientFor(chainId).getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        return receipt !== null && receipt.status === 'success';
      } catch {
        return false;
      }
    },
    async getLockEvidence(txid: string, chainId?: number) {
      try {
        const adapter = adapterFor(chainId);
        const client = clientFor(chainId);
        const receipt = await client.getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        if (!receipt || receipt.status !== 'success') return null;
        const [tip, block, finalized] = await Promise.all([
          client.getBlockNumber(),
          client.getBlock({ blockNumber: receipt.blockNumber }),
          adapter.isFinal({ chain: adapter.id, txId: txid as Hex32 }, 'safe'),
        ]);
        return {
          confirmations: Number(
            tip >= receipt.blockNumber ? tip - receipt.blockNumber + 1n : 0n,
          ),
          ageSeconds: Math.max(
            0,
            Math.floor(Date.now() / 1000) - Number(block.timestamp),
          ),
          finalized,
        };
      } catch {
        return null;
      }
    },
    async extractSecretFromClaim(txid: string, chainId?: number) {
      try {
        const adapter = adapterFor(chainId);
        const receipt = await clientFor(chainId).getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        if (!receipt) return null;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== adapter.htlcAddress.toLowerCase())
            continue;
          const event = decodeHtlcLog(log, adapter.id, adapter.assets);
          if (event?.type === 'Claimed' && event.secret) {
            return event.secret;
          }
        }
        return null;
      } catch {
        return null;
      }
    },
    async lock(terms: OrderTerms) {
      const adapter = evmAdapters.get(String(terms.evmChainId)) ?? evmAdapter;
      const ref = await adapter.lock(terms);
      return { txid: ref.txId, txHex: ref.txId };
    },
    async claim(lockId: string, secret: `0x${string}`, chainId?: number) {
      const ref = await adapterFor(chainId).claim(lockId, secret);
      return { txid: ref.txId, txHex: ref.txId };
    },
  };
}
