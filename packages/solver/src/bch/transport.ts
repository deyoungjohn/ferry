import WebSocket from 'ws';

export interface ServerFeatures {
  genesis_hash?: string;
  server_version?: string;
  protocol_min?: string;
  protocol_max?: string;
  [key: string]: unknown;
}

export interface ElectrumTransport {
  readonly url: string;
  connect(): Promise<void>;
  close(): void;
  isConnected(): boolean;
  request<T>(method: string, params?: unknown[]): Promise<T>;
  getGenesisHash(): string | null;
  fetchFeatures(): Promise<ServerFeatures>;
  getTip(): { height: number; timestamp: number };
  getLastConfirmedAt(): number;
  ping(timeoutMs?: number): Promise<boolean>;
  getLastError?(): Error | null;

  onTipUpdate?: (height: number) => void;
  onScriptHashNotification?: (scriptHash: string, status: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface PendingRequest {
  resolve: (res: unknown) => void;
  reject: (err: unknown) => void;
}

export class WebSocketElectrumTransport implements ElectrumTransport {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private tipHeight = 0;
  private tipTimestamp = 0;
  private lastConfirmedAt = 0;
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isPinging = false;
  private scriptSubscriptions = new Set<string>();
  private genesisHash: string | null = null;
  private lastError: Error | null = null;

  public onTipUpdate?: (height: number) => void;
  public onScriptHashNotification?: (
    scriptHash: string,
    status: string,
  ) => void;
  public onConnect?: () => void;
  public onDisconnect?: () => void;

  constructor(public readonly url: string) {}

  getLastConfirmedAt(): number {
    return this.lastConfirmedAt;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  setLastConfirmedAt(ts: number): void {
    this.lastConfirmedAt = ts;
  }

  getGenesisHash(): string | null {
    return this.genesisHash;
  }

  getTip(): { height: number; timestamp: number } {
    return { height: this.tipHeight, timestamp: this.tipTimestamp };
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async fetchFeatures(): Promise<ServerFeatures> {
    const features = await this.request<ServerFeatures>('server.features', []);
    if (features && typeof features.genesis_hash === 'string') {
      this.genesisHash = features.genesis_hash;
    }
    return features;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    return new Promise((resolve, reject) => {
      let resolved = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.on('open', async () => {
        this.connected = true;
        try {
          // Subscribe to headers
          const header = (await this.request<{ height: number; hex: string }>(
            'blockchain.headers.subscribe',
            [],
          )) as { height: number; hex: string };
          this.tipHeight = header.height;
          this.tipTimestamp = Date.now();
          this.lastConfirmedAt = Date.now();
          this.startPingTimer();
          if (this.onTipUpdate) this.onTipUpdate(header.height);

          // Fetch server features
          try {
            await this.fetchFeatures();
          } catch {
            // Checked strictly in genesis verification
          }

          // Resubscribe to scripts if reconnecting
          for (const sh of this.scriptSubscriptions) {
            await this.request('blockchain.scripthash.subscribe', [sh]);
          }

          if (this.onConnect) this.onConnect();
          if (!resolved) {
            resolved = true;
            resolve();
          }
        } catch (e) {
          if (!resolved) {
            resolved = true;
            reject(e);
          }
        }
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
            const { resolve: reqResolve, reject: reqReject } =
              this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              reqReject(
                new Error(
                  typeof msg.error === 'string'
                    ? msg.error
                    : msg.error.message || JSON.stringify(msg.error),
                ),
              );
            } else {
              reqResolve(msg.result);
            }
          }

          // Server notifications
          if (
            msg.method === 'blockchain.headers.subscribe' &&
            msg.params?.[0]
          ) {
            const newHeight = msg.params[0].height;
            if (newHeight !== this.tipHeight) {
              this.tipHeight = newHeight;
              this.tipTimestamp = Date.now();
              if (this.onTipUpdate) this.onTipUpdate(this.tipHeight);
            }
            this.lastConfirmedAt = Date.now();
          } else if (
            msg.method === 'blockchain.scripthash.subscribe' &&
            msg.params
          ) {
            const [sh, status] = msg.params;
            if (this.onScriptHashNotification) {
              this.onScriptHashNotification(sh, status);
            }
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', (err) => {
        this.lastError = err instanceof Error ? err : new Error(String(err));
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      ws.on('close', (code, reason) => {
        this.connected = false;
        this.stopPingTimer();
        const reasonStr = reason ? reason.toString() : '';
        this.lastError = new Error(
          `Connection closed (code: ${code}${reasonStr ? `, reason: ${reasonStr}` : ''})`,
        );
        if (this.onDisconnect) this.onDisconnect();
        this.failPendingRequests(new Error('Connection closed'));
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, 2000);
  }

  private failPendingRequests(err: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      req.reject(err);
      this.pendingRequests.delete(id);
    }
  }

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(`ElectrumTransport (${this.url}) is not connected`);
    }
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (res: unknown) => void,
        reject,
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async ping(timeoutMs = 10000): Promise<boolean> {
    if (!this.isConnected()) return false;
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Ping timeout')), timeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([this.request('server.ping'), timeoutPromise]);
      this.lastConfirmedAt = Date.now();
      return true;
    } catch {
      try {
        const header = (await Promise.race([
          this.request<{ height: number; hex: string }>(
            'blockchain.headers.subscribe',
            [],
          ),
          timeoutPromise,
        ])) as { height: number; hex: string };
        if (header && typeof header.height === 'number') {
          if (header.height !== this.tipHeight) {
            this.tipHeight = header.height;
            this.tipTimestamp = Date.now();
          }
        }
        this.lastConfirmedAt = Date.now();
        return true;
      } catch {
        return false;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  startPingTimer(intervalMs = 30000): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(async () => {
      if (this.isConnected() && !this.isPinging) {
        this.isPinging = true;
        try {
          await this.ping();
        } catch {
          // handled within ping
        } finally {
          this.isPinging = false;
        }
      }
    }, intervalMs);
    this.pingTimer.unref?.();
  }

  stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  close(): void {
    this.shouldReconnect = false;
    this.stopPingTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}
