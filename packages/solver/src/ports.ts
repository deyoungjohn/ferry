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
  return {
    async getTip() {
      const tip = await evmAdapter.getTip();
      return { height: tip.height, finalized: tip.ageSeconds <= 60 };
    },
    async getLock(lockId: string) {
      const lock = await evmAdapter.getLock(lockId);
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
    async isFinal(txid: string, lane: 'safe' | 'fast') {
      return evmAdapter.isFinal(
        { chain: evmAdapter.id, txId: txid as Hex32 },
        lane,
      );
    },
    async broadcast(txHex: string) {
      if (txHex.startsWith('0x') && txHex.length > 66) {
        const publicClient =
          evmClients.get('base') ??
          (evmAdapter as unknown as { client: PublicClient }).client;
        return publicClient.sendRawTransaction({
          serializedTransaction: txHex as `0x${string}`,
        });
      }
      return txHex;
    },
    async isOnChain(txid: string) {
      try {
        const publicClient =
          evmClients.get('base') ??
          (evmAdapter as unknown as { client: PublicClient }).client;
        const receipt = await publicClient.getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        return receipt !== null && receipt.status === 'success';
      } catch {
        return false;
      }
    },
    async extractSecretFromClaim(txid: string) {
      try {
        const publicClient =
          evmClients.get('base') ??
          (evmAdapter as unknown as { client: PublicClient }).client;
        const receipt = await publicClient.getTransactionReceipt({
          hash: txid as `0x${string}`,
        });
        if (!receipt) return null;
        for (const log of receipt.logs) {
          if (
            log.address.toLowerCase() !== evmAdapter.htlcAddress.toLowerCase()
          )
            continue;
          const event = decodeHtlcLog(log, evmAdapter.id, evmAdapter.assets);
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
    async claim(lockId: string, secret: `0x${string}`) {
      const ref = await evmAdapter.claim(lockId, secret);
      return { txid: ref.txId, txHex: ref.txId };
    },
  };
}
