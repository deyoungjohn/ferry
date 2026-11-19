import { WebSocket as NodeWebSocket } from 'ws';

export interface ElectrumUtxo {
  height: number;
  tx_hash: string;
  tx_pos: number;
  value: number;
  token_data?: {
    category: string;
    amount: string;
    nft?: {
      capability: string;
      commitment: string;
    };
  };
}

export interface ElectrumHistoryItem {
  tx_hash: string;
  height: number;
  fee?: number;
}

export interface ElectrumFirstUse {
  block_hash: string;
  block_height: number;
  tx_hash: string;
}

export interface ElectrumBalance {
  confirmed: number;
  unconfirmed: number;
}

export interface ElectrumHeader {
  height: number;
  hex: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: unknown) => void,
  ): void;
}

export interface FulcrumClientOptions {
  timeoutMs?: number;
  createWebSocket?: (url: string) => WebSocketLike;
}

const WS_OPEN = 1;

function defaultCreateWebSocket(url: string): WebSocketLike {
  if (typeof globalThis.WebSocket === 'function') {
    return new globalThis.WebSocket(url) as unknown as WebSocketLike;
  }
  return new NodeWebSocket(url) as unknown as WebSocketLike;
}

/**
 * Browser- and Node-compatible WebSocket JSON-RPC client for Fulcrum/ElectrumX.
 */
export class FulcrumClient {
  private ws: WebSocketLike | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (res: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private tipHeight = 0;
  private readonly timeoutMs: number;
  private readonly createWebSocket: (url: string) => WebSocketLike;

  constructor(
    private readonly url = 'wss://chipnet.imaginary.cash:50004',
    options: FulcrumClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.createWebSocket = options.createWebSocket ?? defaultCreateWebSocket;
  }

  lastKnownTipHeight(): number {
    return this.tipHeight;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.createWebSocket(this.url);
      this.ws = ws;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.close();
          reject(
            new Error(`Fulcrum connect timed out after ${this.timeoutMs} ms`),
          );
        }
      }, this.timeoutMs);

      ws.addEventListener('open', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });

      ws.addEventListener('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error('WebSocket error'));
        }
      });

      ws.addEventListener('close', () => {
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Fulcrum connection closed'));
          this.pendingRequests.delete(id);
        }
      });

      ws.addEventListener('message', (event) => {
        const raw =
          typeof event === 'object' && event !== null && 'data' in event
            ? (event as { data: unknown }).data
            : event;
        const text =
          typeof raw === 'string'
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString('utf8')
              : String(raw);
        try {
          const rawPayload = JSON.parse(text) as unknown;
          const messages = Array.isArray(rawPayload)
            ? (rawPayload as Array<{
                id?: number;
                result?: unknown;
                error?: unknown;
                method?: string;
                params?: Array<{ height?: number }>;
              }>)
            : [
                rawPayload as {
                  id?: number;
                  result?: unknown;
                  error?: unknown;
                  method?: string;
                  params?: Array<{ height?: number }>;
                },
              ];
          for (const msg of messages) {
            if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
              const pending = this.pendingRequests.get(msg.id)!;
              this.pendingRequests.delete(msg.id);
              clearTimeout(pending.timer);
              if (msg.error !== undefined && msg.error !== null) {
                const message =
                  typeof msg.error === 'string'
                    ? msg.error
                    : ((msg.error as { message?: string }).message ??
                      JSON.stringify(msg.error));
                pending.reject(new Error(message));
              } else {
                pending.resolve(msg.result);
              }
            }
            if (
              msg.method === 'blockchain.headers.subscribe' &&
              msg.params?.[0]?.height !== undefined
            ) {
              this.tipHeight = msg.params[0].height;
            }
          }
        } catch {
          // Ignore malformed push frames
        }
      });
    });
  }

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      throw new Error('FulcrumClient is not connected');
    }
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new Error(
              `Fulcrum request ${method} timed out after ${this.timeoutMs} ms`,
            ),
          );
        }
      }, this.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (res: unknown) => void,
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async serverVersion(
    clientName = 'ferry',
    protocolVersion: string | [string, string] = '1.4',
  ): Promise<[string, string]> {
    return this.request<[string, string]>('server.version', [
      clientName,
      protocolVersion,
    ]);
  }

  async getHistory(scriptHash: string): Promise<ElectrumHistoryItem[]> {
    return this.request<ElectrumHistoryItem[]>(
      'blockchain.scripthash.get_history',
      [scriptHash],
    );
  }

  async getFirstUse(scriptHash: string): Promise<ElectrumFirstUse | null> {
    return this.request<ElectrumFirstUse | null>(
      'blockchain.scripthash.get_first_use',
      [scriptHash],
    );
  }

  async getBalance(scriptHash: string): Promise<ElectrumBalance> {
    return this.request<ElectrumBalance>('blockchain.scripthash.get_balance', [
      scriptHash,
    ]);
  }

  async listUnspent(
    scriptHash: string,
    tokenFilter:
      'include_tokens' | 'tokens_only' | 'exclude_tokens' = 'include_tokens',
  ): Promise<ElectrumUtxo[]> {
    return this.request<ElectrumUtxo[]>('blockchain.scripthash.listunspent', [
      scriptHash,
      tokenFilter,
    ]);
  }

  async getTransaction(txid: string, verbose = false): Promise<unknown> {
    return this.request('blockchain.transaction.get', [txid, verbose]);
  }

  async subscribeHeaders(): Promise<ElectrumHeader> {
    const header = await this.request<ElectrumHeader>(
      'blockchain.headers.subscribe',
      [],
    );
    this.tipHeight = header.height;
    return header;
  }

  async getTipHeight(): Promise<number> {
    const header = await this.subscribeHeaders();
    return header.height;
  }

  async broadcast(txHex: string): Promise<string> {
    return this.request<string>('blockchain.transaction.broadcast', [txHex]);
  }

  close(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('FulcrumClient closed'));
      this.pendingRequests.delete(id);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
