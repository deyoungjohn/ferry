import { createHash } from 'node:crypto';
import {
  type ElectrumTransport,
  WebSocketElectrumTransport,
} from './transport.js';
import type {
  BchQuorumStatus,
  DSProofEvidence,
  DSProofWatcher,
  ElectrumHistoryEntry,
  ElectrumUtxo,
  QuotingState,
} from './types.js';

export const BCH_GENESIS_HASHES = {
  chipnet: '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b',
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
} as const;

export interface BchQuorumOptions {
  network?: 'chipnet' | 'mainnet' | 'testnet';
  tipMaxAgeBchSeconds?: number;
  transports?: ElectrumTransport[];
}

export class BchQuorumClient implements DSProofWatcher {
  private transports: ElectrumTransport[] = [];
  private activeTransports: ElectrumTransport[] = [];
  private droppedTransports: ElectrumTransport[] = [];
  public readonly network: 'chipnet' | 'mainnet' | 'testnet';
  public readonly tipMaxAgeBchSeconds: number;

  private scriptCallbacks = new Map<
    string,
    Set<(status: string | null) => void>
  >();
  private knownHistory = new Map<string, Set<string>>();
  private droppedReasons = new Map<string, string>();

  constructor(
    serverUrlsOrTransports: string[] | ElectrumTransport[],
    options: BchQuorumOptions | 'chipnet' | 'mainnet' | 'testnet' = 'testnet',
  ) {
    const opts: BchQuorumOptions =
      typeof options === 'string' ? { network: options } : options;
    this.network = opts.network ?? 'testnet';
    this.tipMaxAgeBchSeconds = opts.tipMaxAgeBchSeconds ?? 7200;

    if (serverUrlsOrTransports.length === 0) {
      throw new Error(
        'At least one Electrum server URL or transport must be provided',
      );
    }

    if (typeof serverUrlsOrTransports[0] === 'string') {
      this.transports = (serverUrlsOrTransports as string[]).map(
        (url) => new WebSocketElectrumTransport(url),
      );
    } else {
      this.transports = [...(serverUrlsOrTransports as ElectrumTransport[])];
    }

    this.activeTransports = [...this.transports];

    for (const transport of this.transports) {
      transport.onScriptHashNotification = (sh, status) => {
        const callbacks = this.scriptCallbacks.get(sh);
        if (callbacks) {
          for (const cb of callbacks) cb(status);
        }
      };

      transport.onConnect = async () => {
        for (const sh of this.scriptCallbacks.keys()) {
          await this.reconcileScriptHash(sh);
        }
      };
    }
  }

  getActiveTransports(): ElectrumTransport[] {
    return [...this.activeTransports];
  }

  getDroppedTransports(): ElectrumTransport[] {
    return [...this.droppedTransports];
  }

  async connect(): Promise<void> {
    await Promise.all(
      this.transports.map((t) => t.connect().catch(() => null)),
    );
    await this.verifyGenesis();
  }

  /**
   * Verifies each server against canonical genesis hash.
   * Servers returning the wrong genesis hash or failing features are dropped from active pool.
   */
  async verifyGenesis(): Promise<void> {
    const targetNetwork = this.network === 'mainnet' ? 'mainnet' : 'chipnet';
    const expectedHash = BCH_GENESIS_HASHES[targetNetwork].toLowerCase();

    const verified: ElectrumTransport[] = [];
    const dropped: ElectrumTransport[] = [];

    for (const transport of this.transports) {
      try {
        let hash = transport.getGenesisHash();
        if (!hash) {
          const features = await transport.fetchFeatures();
          hash = features.genesis_hash || null;
        }

        if (!hash) {
          this.droppedReasons.set(
            transport.url,
            'missing genesis hash in server.features',
          );
          dropped.push(transport);
          transport.close();
          continue;
        }

        if (hash.toLowerCase() !== expectedHash) {
          this.droppedReasons.set(
            transport.url,
            `genesis mismatch: expected ${expectedHash}, got ${hash.toLowerCase()}`,
          );
          dropped.push(transport);
          transport.close();
        } else {
          verified.push(transport);
        }
      } catch (err) {
        this.droppedReasons.set(
          transport.url,
          `connection error: ${err instanceof Error ? err.message : String(err)}`,
        );
        dropped.push(transport);
        transport.close();
      }
    }

    this.activeTransports = verified;
    this.droppedTransports = dropped;

    if (this.network === 'mainnet' && this.activeTransports.length < 2) {
      // In mainnet, having fewer than 2 valid servers on connect is a critical refusal
      const totalProvided = this.transports.length;
      const failedHosts = Array.from(this.droppedReasons.entries())
        .map(([url, reason]) => `${url} (${reason})`)
        .join(', ');
      throw new Error(
        `Genesis hash verification failed: ${this.activeTransports.length} valid server(s) remaining out of ${totalProvided}. Mainnet requires at least two independent healthy servers on the correct chain. Failed hosts: ${failedHosts}`,
      );
    }

    if (this.activeTransports.length === 0) {
      const failedHosts = Array.from(this.droppedReasons.entries())
        .map(([url, reason]) => `${url} (${reason})`)
        .join(', ');
      throw new Error(
        `All servers failed genesis verification for network ${this.network}. Expected genesis hash ${expectedHash}. Failed hosts: ${failedHosts}`,
      );
    }
  }

  async reconcileScriptHash(scriptHash: string): Promise<void> {
    try {
      const history = await this.getHistory(scriptHash);
      let seen = this.knownHistory.get(scriptHash);
      if (!seen) {
        seen = new Set<string>();
        this.knownHistory.set(scriptHash, seen);
      }
      for (const entry of history) {
        if (!seen.has(entry.tx_hash)) {
          seen.add(entry.tx_hash);
          const callbacks = this.scriptCallbacks.get(scriptHash);
          if (callbacks) {
            for (const cb of callbacks) cb('reconciled');
          }
        }
      }
    } catch {
      // Will retry on next reconnect or poll
    }
  }

  getQuorumStatus(): BchQuorumStatus {
    const tips: Record<string, number> = {};
    let minTip = Infinity;
    let maxTip = 0;
    let newestTimestamp = 0;
    let newestConfirmedAt = 0;
    let connectedCount = 0;

    for (const transport of this.activeTransports) {
      if (transport.isConnected()) {
        const tip = transport.getTip();
        const lastConfirmed = transport.getLastConfirmedAt();
        if (tip && tip.height > 0) {
          tips[transport.url] = tip.height;
          if (tip.height < minTip) minTip = tip.height;
          if (tip.height > maxTip) maxTip = tip.height;
          if (tip.timestamp > newestTimestamp) newestTimestamp = tip.timestamp;
          if (lastConfirmed && lastConfirmed > newestConfirmedAt)
            newestConfirmedAt = lastConfirmed;
          connectedCount++;
        }
      }
    }

    const now = Date.now();
    const ageSeconds =
      newestTimestamp > 0
        ? Math.floor((now - newestTimestamp) / 1000)
        : Infinity;
    const livenessAgeSeconds =
      newestConfirmedAt > 0
        ? Math.floor((now - newestConfirmedAt) / 1000)
        : Infinity;

    const isLivenessHealthy = connectedCount > 0 && livenessAgeSeconds <= 60;
    const tipSpreadOk = connectedCount <= 1 || maxTip - minTip <= 1;

    let quotingState: QuotingState = 'HEALTHY';
    let isQuorumHealthy = true;
    let quotingAllowed = true;

    if (connectedCount === 0) {
      quotingState = 'INSUFFICIENT_SERVERS';
      isQuorumHealthy = false;
      quotingAllowed = false;
    } else if (this.network === 'mainnet' && connectedCount < 2) {
      quotingState = 'INSUFFICIENT_SERVERS';
      isQuorumHealthy = false;
      quotingAllowed = false;
    } else if (!tipSpreadOk) {
      quotingState = 'SPLIT_TIP';
      isQuorumHealthy = false;
      quotingAllowed = false;
    } else if (!isLivenessHealthy) {
      quotingState = 'STALE_LIVENESS';
      quotingAllowed = false;
    } else if (
      this.network === 'mainnet' &&
      ageSeconds > this.tipMaxAgeBchSeconds
    ) {
      // Block-age threshold enforced only on mainnet
      quotingState = 'STALE_BLOCK_AGE';
      quotingAllowed = false;
    }

    const failedHosts: Record<string, string> = {};
    for (const transport of this.transports) {
      if (!this.activeTransports.includes(transport)) {
        failedHosts[transport.url] =
          this.droppedReasons.get(transport.url) ?? 'dropped';
      } else if (!transport.isConnected()) {
        const lastErr =
          'getLastError' in transport &&
          typeof transport.getLastError === 'function'
            ? transport.getLastError()
            : null;
        failedHosts[transport.url] = lastErr ? lastErr.message : 'disconnected';
      } else {
        const lastErr =
          'getLastError' in transport &&
          typeof transport.getLastError === 'function'
            ? transport.getLastError()
            : null;
        const tip = transport.getTip();
        if (lastErr) {
          failedHosts[transport.url] = lastErr.message;
        } else if (!tip || tip.height <= 0) {
          failedHosts[transport.url] = 'no valid tip received';
        }
      }
    }

    let quorumFailureMessage: string | undefined;
    if (!isQuorumHealthy) {
      const failedEntries = Object.entries(failedHosts).map(
        ([h, r]) => `${h} (${r})`,
      );
      quorumFailureMessage =
        failedEntries.length > 0
          ? `BCH quorum unhealthy: ${connectedCount}/${this.transports.length} servers live. Failed hosts: ${failedEntries.join('; ')}`
          : `BCH quorum unhealthy (${quotingState})`;
    }

    return {
      quorumTip: minTip === Infinity ? 0 : minTip,
      tips,
      isQuorumHealthy,
      ageSeconds,
      lastConfirmedAt: newestConfirmedAt,
      livenessAgeSeconds,
      isLivenessHealthy,
      healthyServersCount: connectedCount,
      quotingAllowed,
      quotingState,
      failedHosts,
      quorumFailureMessage,
    };
  }

  getTip(): number {
    return this.getQuorumStatus().quorumTip;
  }

  async pingAll(): Promise<boolean[]> {
    return Promise.all(this.activeTransports.map((t) => t.ping()));
  }

  private async executeWithFailover<T>(
    operation: (transport: ElectrumTransport) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    const failures: string[] = [];
    for (const transport of this.activeTransports) {
      if (transport.isConnected()) {
        try {
          return await operation(transport);
        } catch (err) {
          lastError = err;
          failures.push(
            `${transport.url} (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      } else {
        const lastErr =
          'getLastError' in transport &&
          typeof transport.getLastError === 'function'
            ? transport.getLastError()
            : null;
        failures.push(
          `${transport.url} (${lastErr ? lastErr.message : 'disconnected'})`,
        );
      }
    }
    const failureMsg =
      failures.length > 0 ? `. Failed hosts: ${failures.join('; ')}` : '';
    throw new Error(
      `All active Electrum servers failed to execute request${failureMsg}`,
      { cause: lastError },
    );
  }

  async listUnspent(
    scriptHash: string,
    tokenFilter:
      'include_tokens' | 'tokens_only' | 'exclude_tokens' = 'include_tokens',
  ): Promise<ElectrumUtxo[]> {
    return this.executeWithFailover((transport) =>
      transport.request<ElectrumUtxo[]>('blockchain.scripthash.listunspent', [
        scriptHash,
        tokenFilter,
      ]),
    );
  }

  async getHistory(scriptHash: string): Promise<ElectrumHistoryEntry[]> {
    return this.executeWithFailover((transport) =>
      transport.request<ElectrumHistoryEntry[]>(
        'blockchain.scripthash.get_history',
        [scriptHash],
      ),
    );
  }

  async broadcast(txHex: string): Promise<string> {
    return this.executeWithFailover((transport) =>
      transport.request<string>('blockchain.transaction.broadcast', [txHex]),
    );
  }

  /**
   * Broadcasts a raw transaction to every connected server in the active quorum pool in parallel.
   * Returns the txid only after at least one server accepts it.
   * If all fail or reject, throws with the server's rejection reason.
   */
  async broadcastAll(txHex: string): Promise<string> {
    const quorum = this.getQuorumStatus();
    if (!quorum.isQuorumHealthy) {
      throw new Error(
        quorum.quorumFailureMessage ?? 'Bitcoin Cash quorum is unhealthy',
      );
    }

    const connectedTransports = this.activeTransports.filter((t) =>
      t.isConnected(),
    );
    if (connectedTransports.length === 0) {
      throw new Error('No Bitcoin Cash servers connected in quorum');
    }

    let expectedTxid = '';
    try {
      const raw = Buffer.from(txHex.replace(/^0x/, ''), 'hex');
      const first = createHash('sha256').update(raw).digest();
      const second = createHash('sha256').update(first).digest();
      expectedTxid = Buffer.from(second).reverse().toString('hex');
    } catch {
      // If compute fails, expectedTxid remains empty
    }

    const cleanHex = txHex.replace(/^0x/, '');
    const results = await Promise.allSettled(
      connectedTransports.map((transport) =>
        transport.request<string>('blockchain.transaction.broadcast', [
          cleanHex,
        ]),
      ),
    );

    let acceptedTxid: string | null = null;
    const rejections: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const res = result.value;
        if (typeof res === 'string') {
          const cleanRes = res.replace(/^0x/, '').toLowerCase();
          if (/^[0-9a-fA-F]{64}$/.test(cleanRes)) {
            if (!expectedTxid || cleanRes === expectedTxid.toLowerCase()) {
              acceptedTxid = cleanRes;
            }
          }
        }
      } else {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        rejections.push(reason);
      }
    }

    if (acceptedTxid) {
      return acceptedTxid;
    }

    const distinctReasons = Array.from(new Set(rejections));
    const reasonMsg =
      distinctReasons.length > 0
        ? `All servers rejected broadcast: ${distinctReasons.join('; ')}`
        : 'Transaction rejected by all Bitcoin Cash servers';
    throw new Error(reasonMsg);
  }

  /**
   * Retrieves the current tip height, block hash, and block timestamp from the quorum.
   */
  async getTipHeader(): Promise<{
    height: number;
    hash: string;
    timestamp: number;
  }> {
    const quorum = this.getQuorumStatus();
    if (!quorum.isQuorumHealthy) {
      throw new Error(
        quorum.quorumFailureMessage ?? 'Bitcoin Cash quorum is unhealthy',
      );
    }

    return this.executeWithFailover(async (transport) => {
      let height = quorum.quorumTip;
      let hex: string | undefined;

      try {
        const header = await transport.request<
          { height?: number; hex?: string } | string
        >('blockchain.headers.subscribe', []);
        if (typeof header === 'object' && header !== null) {
          if (typeof header.height === 'number') height = header.height;
          if (typeof header.hex === 'string') hex = header.hex;
        } else if (typeof header === 'string') {
          hex = header;
        }
      } catch {
        // Fall back to blockchain.block.header
      }

      if (!hex) {
        hex = await transport.request<string>('blockchain.block.header', [
          height,
        ]);
      }

      let hash: string;
      let timestamp: number;

      if (typeof hex === 'string' && hex.length === 160) {
        const raw = Buffer.from(hex, 'hex');
        const first = createHash('sha256').update(raw).digest();
        const second = createHash('sha256').update(first).digest();
        hash = Buffer.from(second).reverse().toString('hex');
        timestamp = raw.readUInt32LE(68);
      } else if (typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex)) {
        hash = hex.toLowerCase();
        timestamp = Math.floor(Date.now() / 1000);
      } else {
        hash = createHash('sha256').update(`tip:${height}`).digest('hex');
        timestamp = Math.floor(Date.now() / 1000);
      }

      return { height, hash, timestamp };
    });
  }

  async getRelayFee(): Promise<number> {
    try {
      const bchPerKb = await this.executeWithFailover((transport) =>
        transport.request<number>('blockchain.relayfee', []),
      );
      const satsPerByte = Math.max(1, Math.round(Number(bchPerKb) * 100_000));
      return satsPerByte;
    } catch {
      return 1;
    }
  }

  async estimateFee(blocks = 2): Promise<number> {
    try {
      const bchPerKb = await this.executeWithFailover((transport) =>
        transport.request<number>('blockchain.estimatefee', [blocks]),
      );
      if (typeof bchPerKb !== 'number' || bchPerKb <= 0) {
        return await this.getRelayFee();
      }
      const satsPerByte = Math.max(1, Math.round(Number(bchPerKb) * 100_000));
      return satsPerByte;
    } catch {
      return await this.getRelayFee();
    }
  }

  async getFeeRate(): Promise<{
    relayFeeSatsPerByte: number;
    estimateFeeSatsPerByte: number;
    effectiveSatsPerByte: number;
    asOf: number;
    source: string;
  }> {
    const relay = await this.getRelayFee();
    const estimate = await this.estimateFee();
    const effective = Math.max(relay, estimate, 1);
    return {
      relayFeeSatsPerByte: relay,
      estimateFeeSatsPerByte: estimate,
      effectiveSatsPerByte: effective,
      asOf: Math.floor(Date.now() / 1000),
      source: 'electrum-quorum-fee',
    };
  }

  async getTransaction(txid: string, verbose = true): Promise<unknown> {
    return this.executeWithFailover((transport) =>
      transport.request('blockchain.transaction.get', [txid, verbose]),
    );
  }

  async checkTxAcrossQuorum(
    txid: string,
    scriptHash?: string,
  ): Promise<{
    found: boolean;
    seenOnServers: string[];
    totalConnected: number;
  }> {
    const seenOnServers: string[] = [];
    let totalConnected = 0;

    for (const transport of this.activeTransports) {
      if (!transport.isConnected()) continue;
      totalConnected++;
      try {
        if (scriptHash) {
          const history = await transport.request<ElectrumHistoryEntry[]>(
            'blockchain.scripthash.get_history',
            [scriptHash],
          );
          if (history && history.some((h) => h.tx_hash === txid)) {
            seenOnServers.push(transport.url);
            continue;
          }
        }
        const tx = await transport.request('blockchain.transaction.get', [
          txid,
          false,
        ]);
        if (tx) {
          seenOnServers.push(transport.url);
        }
      } catch {
        // Not found on this server
      }
    }

    return {
      found: seenOnServers.length > 0,
      seenOnServers,
      totalConnected,
    };
  }

  /**
   * Double-spend proof lookup with configurable wait window (Blueprint §4.3).
   * Checks if a double-spend proof exists for txid within wait window.
   */
  async waitForDoubleSpendProof(
    txid: string,
    windowMs = 5000,
  ): Promise<DSProofEvidence> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime <= windowMs) {
      try {
        const proof = await this.executeWithFailover((transport) =>
          transport.request<unknown>('blockchain.transaction.dsproof.get', [
            txid,
          ]),
        );
        if (proof) {
          return { txid, hasProof: true, proofData: proof };
        }
      } catch {
        // No proof found yet
      }

      const elapsed = Date.now() - startTime;
      const remaining = windowMs - elapsed;
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(pollInterval, remaining)),
      );
    }

    return { txid, hasProof: false };
  }

  async subscribeScriptHash(
    scriptHash: string,
    callback: (status: string | null) => void,
  ): Promise<void> {
    let callbacks = this.scriptCallbacks.get(scriptHash);
    if (!callbacks) {
      callbacks = new Set();
      this.scriptCallbacks.set(scriptHash, callbacks);
      for (const transport of this.activeTransports) {
        if (transport.isConnected()) {
          await transport.request('blockchain.scripthash.subscribe', [
            scriptHash,
          ]);
        }
      }
    }
    callbacks.add(callback);
  }

  unsubscribeScriptHash(
    scriptHash: string,
    callback: (status: string | null) => void,
  ): void {
    const callbacks = this.scriptCallbacks.get(scriptHash);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.scriptCallbacks.delete(scriptHash);
        for (const transport of this.activeTransports) {
          if (transport.isConnected()) {
            transport
              .request('blockchain.scripthash.unsubscribe', [scriptHash])
              .catch(() => {});
          }
        }
      }
    }
  }

  subscribe(txid: string, callback: (evidence: DSProofEvidence) => void): void {
    this.waitForDoubleSpendProof(txid, 5000).then(callback);
  }

  unsubscribe(): void {}

  close(): void {
    for (const transport of this.transports) {
      transport.close();
    }
    this.scriptCallbacks.clear();
  }
}
