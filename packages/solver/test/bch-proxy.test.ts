import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { SolverConfigSchema } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import { BchQuorumClient } from '../src/bch/quorum-client.js';
import type { ElectrumTransport } from '../src/bch/transport.js';
import { MockPriceSource } from '../src/pricing/price-source.js';
import { QuoteRateLimiter } from '../src/api/rate-limiter.js';
import type { EvmChainAdapter } from '@ferry/chain-evm';

describe('BCH Proxy Endpoints and Quorum Broadcast (B4-18)', () => {
  let app: FastifyInstance;
  let db: SolverDatabase;
  let fakeBchClient: BchQuorumClient;
  let fakeEvmAdapter: EvmChainAdapter;
  let engine: SolverEngine;
  let priceSource: MockPriceSource;
  let rateLimiter: QuoteRateLimiter;

  const validScriptHash = 'aa'.repeat(32);
  const validTxid = 'bb'.repeat(32);
  const validTxHex =
    '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100000000000000000000000000';

  let listUnspentSpy: ReturnType<typeof vi.fn>;
  let getHistorySpy: ReturnType<typeof vi.fn>;
  let getTransactionSpy: ReturnType<typeof vi.fn>;
  let broadcastAllSpy: ReturnType<typeof vi.fn>;
  let getTipHeaderSpy: ReturnType<typeof vi.fn>;
  let quorumHealthy = true;

  beforeAll(async () => {
    db = new SolverDatabase(':memory:');

    listUnspentSpy = vi.fn().mockResolvedValue([
      {
        height: 800000,
        tx_hash: validTxid,
        tx_pos: 0,
        value: 50000,
      },
    ]);

    getHistorySpy = vi.fn().mockResolvedValue([
      { tx_hash: '11'.repeat(32), height: 800100 },
      { tx_hash: '22'.repeat(32), height: 800050 },
      { tx_hash: '33'.repeat(32), height: 0 },
    ]);

    getTransactionSpy = vi.fn().mockImplementation(async (txid: string) => {
      if (txid === validTxid) {
        return {
          hex: validTxHex,
          confirmations: 6,
        };
      }
      if (txid === 'cc'.repeat(32)) {
        return {
          hex: validTxHex,
          confirmations: 0,
        };
      }
      throw new Error('No such mempool or blockchain transaction');
    });

    broadcastAllSpy = vi.fn().mockResolvedValue(validTxid);

    getTipHeaderSpy = vi.fn().mockResolvedValue({
      height: 800200,
      hash: '00000000000000000123456789abcdef0123456789abcdef0123456789abcdef',
      timestamp: 1700000000,
    });

    fakeBchClient = {
      getQuorumStatus: () => ({
        quorumTip: 800200,
        tips: {
          'wss://mock1': 800200,
          'wss://mock2': 800200,
          'wss://mock3': 800200,
        },
        isQuorumHealthy: quorumHealthy,
        isLivenessHealthy: quorumHealthy,
        ageSeconds: 10,
        lastConfirmedAt: Math.floor(Date.now() / 1000) - 10,
        quotingState: quorumHealthy ? 'healthy' : 'degraded',
      }),
      listUnspent: listUnspentSpy,
      getHistory: getHistorySpy,
      getTransaction: getTransactionSpy,
      broadcastAll: broadcastAllSpy,
      getTipHeader: getTipHeaderSpy,
      close: () => {},
    } as unknown as BchQuorumClient;

    const solverEvmKey =
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
    const solverAccount = privateKeyToAccount(solverEvmKey);

    fakeEvmAdapter = {
      id: 'base',
      address: solverAccount.address,
      getTokenBalance: async () => 100_000_000_000n,
      getNativeBalance: async () => 10_000_000_000_000_000_000n,
      getTip: async () => ({
        height: 1234567,
        timestamp: Math.floor(Date.now() / 1000) - 5,
        ageSeconds: 5,
        stale: false,
      }),
      getLock: async () => ({ status: 'absent' as const }),
      isFinal: async () => true,
      relayLock: async () => '0x' as `0x${string}`,
      claim: async () => '0x' as `0x${string}`,
      refund: async () => '0x' as `0x${string}`,
      watchLocks: () => () => {},
      waitForFinality: async () => {},
    } as unknown as EvmChainAdapter;

    const config = SolverConfigSchema.parse({
      solverEvmPrivateKey: solverEvmKey,
      bchElectrumUrls: 'wss://mock1,wss://mock2,wss://mock3',
      operatorToken: 'test-operator-token-32-chars-long-secret!',
      minProfitMarginBps: 10,
    });

    const now = Math.floor(Date.now() / 1000);
    priceSource = new MockPriceSource();
    priceSource.setPrice('USDC', {
      usdPrice: 1_000_000n,
      source: 'cauldron',
      asOf: now,
    });
    priceSource.setPrice('BCH', {
      usdPrice: 400_000_000n,
      source: 'cauldron',
      asOf: now,
    });

    engine = {
      isQuotingEnabled: () => true,
      start: async () => {},
      stop: () => {},
    } as unknown as SolverEngine;

    rateLimiter = new QuoteRateLimiter({
      windowMs: 60_000,
      maxPerAddress: 100,
      maxPerIp: 100,
    });

    app = await buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      engine,
      priceSource,
      rateLimiter,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/health', () => {
    it('lists bchRoutes and their quorum backing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.bchRoutes).toBeDefined();
      expect(body.bchRoutes).toContain('GET /v1/bch/utxos/:scriptHash');
      expect(body.bchRoutes).toContain('GET /v1/bch/history/:scriptHash');
      expect(body.bchRoutes).toContain('GET /v1/bch/first-use/:scriptHash');
      expect(body.bchRoutes).toContain('GET /v1/bch/tx/:txid');
      expect(body.bchRoutes).toContain('POST /v1/bch/broadcast');
      expect(body.bchRoutes).toContain('GET /v1/bch/tip');
    });
  });

  describe('GET /v1/bch/utxos/:scriptHash', () => {
    it('returns utxos and asOf timestamp for valid scriptHash', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/utxos/${validScriptHash}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.utxos).toHaveLength(1);
      expect(body.utxos[0].value).toBe(50000);
      expect(typeof body.asOf).toBe('number');
    });

    it('returns 400 if scriptHash is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/bch/utxos/invalidScriptHash',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain('64 hex');
    });

    it('returns 503 when quorum is unhealthy', async () => {
      quorumHealthy = false;
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/utxos/${validScriptHash}`,
      });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.payload).error).toContain('quorum unhealthy');
      quorumHealthy = true;
    });
  });

  describe('GET /v1/bch/history/:scriptHash', () => {
    it('returns history entries and caches for 5s', async () => {
      getHistorySpy.mockClear();
      const res1 = await app.inject({
        method: 'GET',
        url: `/v1/bch/history/${validScriptHash}`,
      });
      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.payload);
      expect(body1.history).toHaveLength(3);
      expect(getHistorySpy).toHaveBeenCalledTimes(1);

      // Cached call within 5s
      const res2 = await app.inject({
        method: 'GET',
        url: `/v1/bch/history/${validScriptHash}`,
      });
      expect(res2.statusCode).toBe(200);
      expect(getHistorySpy).toHaveBeenCalledTimes(1);
    });

    it('caps history entries at 1000', async () => {
      const largeHistory = Array.from({ length: 1200 }, (_, i) => ({
        tx_hash: i.toString(16).padStart(2, '0').repeat(32),
        height: 1000 + i,
      }));
      getHistorySpy.mockResolvedValueOnce(largeHistory);
      const newScriptHash = '12'.repeat(32);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/history/${newScriptHash}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.history).toHaveLength(1000);
    });

    it('returns 400 on invalid scriptHash', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/bch/history/bad',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/bch/first-use/:scriptHash', () => {
    it('returns earliest confirmed history entry (lowest block height > 0)', async () => {
      const hash = '34'.repeat(32);
      getHistorySpy.mockResolvedValueOnce([
        { tx_hash: '11'.repeat(32), height: 800100 },
        { tx_hash: '22'.repeat(32), height: 800050 }, // lowest confirmed
        { tx_hash: '33'.repeat(32), height: 0 },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/first-use/${hash}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.txHash).toBe('22'.repeat(32));
      expect(body.height).toBe(800050);
    });

    it('returns first unconfirmed when none confirmed', async () => {
      const hash = '56'.repeat(32);
      getHistorySpy.mockResolvedValueOnce([
        { tx_hash: 'aa'.repeat(32), height: 0 },
        { tx_hash: 'bb'.repeat(32), height: -1 },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/first-use/${hash}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.txHash).toBe('aa'.repeat(32));
      expect(body.height).toBe(0);
    });

    it('returns nulls when history is empty', async () => {
      const hash = '78'.repeat(32);
      getHistorySpy.mockResolvedValueOnce([]);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/first-use/${hash}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.txHash).toBeNull();
      expect(body.height).toBeNull();
    });
  });

  describe('GET /v1/bch/tx/:txid', () => {
    it('returns transaction hex and caches confirmed tx forever', async () => {
      getTransactionSpy.mockClear();
      const res1 = await app.inject({
        method: 'GET',
        url: `/v1/bch/tx/${validTxid}`,
      });
      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.payload);
      expect(body1.hex).toBe(validTxHex);
      expect(getTransactionSpy).toHaveBeenCalledTimes(1);

      // Confirmed tx is cached forever -> no second call to client
      const res2 = await app.inject({
        method: 'GET',
        url: `/v1/bch/tx/${validTxid}`,
      });
      expect(res2.statusCode).toBe(200);
      expect(getTransactionSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT cache unconfirmed tx', async () => {
      getTransactionSpy.mockClear();
      const unconfirmedTxid = 'cc'.repeat(32);
      const res1 = await app.inject({
        method: 'GET',
        url: `/v1/bch/tx/${unconfirmedTxid}`,
      });
      expect(res1.statusCode).toBe(200);
      expect(getTransactionSpy).toHaveBeenCalledTimes(1);

      // Second call still invokes client because unconfirmed
      const res2 = await app.inject({
        method: 'GET',
        url: `/v1/bch/tx/${unconfirmedTxid}`,
      });
      expect(res2.statusCode).toBe(200);
      expect(getTransactionSpy).toHaveBeenCalledTimes(2);
    });

    it('returns 404 for missing transaction', async () => {
      const missingTxid = 'dd'.repeat(32);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/bch/tx/${missingTxid}`,
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.payload).error).toBe('Transaction not found');
    });

    it('returns 400 for invalid txid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/bch/tx/invalid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /v1/bch/broadcast', () => {
    it('broadcasts hex and returns txid', async () => {
      broadcastAllSpy.mockResolvedValueOnce(validTxid);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/bch/broadcast',
        payload: { hex: validTxHex },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).txid).toBe(validTxid);
    });

    it('returns 400 for invalid hex format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/bch/broadcast',
        payload: { hex: 'not-hex' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 with server rejection reason if rejected by all', async () => {
      broadcastAllSpy.mockRejectedValueOnce(
        new Error(
          'All servers rejected broadcast: 64: non-mandatory-script-verify-flag',
        ),
      );
      const res = await app.inject({
        method: 'POST',
        url: '/v1/bch/broadcast',
        payload: { hex: validTxHex },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain(
        'non-mandatory-script-verify-flag',
      );
    });
  });

  describe('GET /v1/bch/tip', () => {
    it('returns tip header information and caches for 2s', async () => {
      getTipHeaderSpy.mockClear();
      const res1 = await app.inject({
        method: 'GET',
        url: '/v1/bch/tip',
      });
      expect(res1.statusCode).toBe(200);
      const body = JSON.parse(res1.payload);
      expect(body.height).toBe(800200);
      expect(body.hash).toBeDefined();
      expect(body.timestamp).toBe(1700000000);
      expect(getTipHeaderSpy).toHaveBeenCalledTimes(1);

      // Cached call
      const res2 = await app.inject({
        method: 'GET',
        url: '/v1/bch/tip',
      });
      expect(res2.statusCode).toBe(200);
      expect(getTipHeaderSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rate limiting on BCH proxy routes', () => {
    it('returns 429 when rate limit exceeded', async () => {
      const strictLimiter = new QuoteRateLimiter({
        windowMs: 60_000,
        maxPerAddress: 2,
        maxPerIp: 2,
      });

      const rateLimitedApp = await buildServer({
        config: SolverConfigSchema.parse({
          solverEvmPrivateKey:
            '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
          bchElectrumUrls: 'wss://mock1,wss://mock2',
          operatorToken: 'test-operator-token-32-chars-long-secret!',
          minProfitMarginBps: 10,
        }),
        db,
        evmAdapter: fakeEvmAdapter,
        bchClient: fakeBchClient,
        engine,
        priceSource,
        rateLimiter,
        bchProxyLimiter: strictLimiter,
      });

      const res1 = await rateLimitedApp.inject({
        method: 'GET',
        url: '/v1/bch/tip',
        remoteAddress: '198.51.100.1',
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await rateLimitedApp.inject({
        method: 'GET',
        url: '/v1/bch/tip',
        remoteAddress: '198.51.100.1',
      });
      expect(res2.statusCode).toBe(200);

      // Third request should be rate limited
      const res3 = await rateLimitedApp.inject({
        method: 'GET',
        url: '/v1/bch/tip',
        remoteAddress: '198.51.100.1',
      });
      expect(res3.statusCode).toBe(429);
      await rateLimitedApp.close();
    });
  });

  describe('Quorum broadcast safety in BchQuorumClient', () => {
    const realTxid =
      '7686b26faa147357b6cec35785c44e5924cf36cd2f3ea239d5a5f29853ffff88';

    it('broadcasts to all active servers in parallel and succeeds if one accepts', async () => {
      const mockReq1 = vi.fn().mockRejectedValue(new Error('Connection error'));
      const mockReq2 = vi.fn().mockResolvedValue(realTxid);
      const mockReq3 = vi.fn().mockResolvedValue(realTxid);

      const makeTransport = (
        url: string,
        req: ElectrumTransport['request'],
      ): ElectrumTransport => ({
        url,
        connect: async () => {},
        close: () => {},
        isConnected: () => true,
        request: req,
        getGenesisHash: () =>
          '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        fetchFeatures: async () => ({
          genesis_hash:
            '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        }),
        getTip: () => ({ height: 800000, timestamp: Date.now() }),
        getLastConfirmedAt: () => Date.now(),
        ping: async () => true,
      });

      const client = new BchQuorumClient(
        [
          makeTransport('wss://s1', mockReq1),
          makeTransport('wss://s2', mockReq2),
          makeTransport('wss://s3', mockReq3),
        ],
        'mainnet',
      );

      const result = await client.broadcastAll(validTxHex);
      expect(result).toBe(realTxid);
      expect(mockReq2).toHaveBeenCalled();
      expect(mockReq3).toHaveBeenCalled();
    });

    it('rejects response from a lying server that returns mismatched txid', async () => {
      const mockLyingReq = vi.fn().mockResolvedValue('00'.repeat(32));
      const mockHonestReq = vi.fn().mockResolvedValue(realTxid);

      const makeTransport = (
        url: string,
        req: ElectrumTransport['request'],
      ): ElectrumTransport => ({
        url,
        connect: async () => {},
        close: () => {},
        isConnected: () => true,
        request: req,
        getGenesisHash: () =>
          '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        fetchFeatures: async () => ({
          genesis_hash:
            '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        }),
        getTip: () => ({ height: 800000, timestamp: Date.now() }),
        getLastConfirmedAt: () => Date.now(),
        ping: async () => true,
      });

      const client = new BchQuorumClient(
        [
          makeTransport('wss://lying', mockLyingReq),
          makeTransport('wss://honest1', mockHonestReq),
          makeTransport('wss://honest2', mockHonestReq),
        ],
        'mainnet',
      );

      const result = await client.broadcastAll(validTxHex);
      expect(result).toBe(realTxid);
    });

    it('throws rejection reason if all servers reject broadcast (e.g. mempool conflict)', async () => {
      const mockReq = vi
        .fn()
        .mockRejectedValue(new Error('258: txn-mempool-conflict'));

      const makeTransport = (url: string): ElectrumTransport => ({
        url,
        connect: async () => {},
        close: () => {},
        isConnected: () => true,
        request: mockReq,
        getGenesisHash: () =>
          '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        fetchFeatures: async () => ({
          genesis_hash:
            '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        }),
        getTip: () => ({ height: 800000, timestamp: Date.now() }),
        getLastConfirmedAt: () => Date.now(),
        ping: async () => true,
      });

      const client = new BchQuorumClient(
        [makeTransport('wss://s1'), makeTransport('wss://s2')],
        'mainnet',
      );

      await expect(client.broadcastAll(validTxHex)).rejects.toThrow(
        /txn-mempool-conflict/,
      );
    });
  });
});
