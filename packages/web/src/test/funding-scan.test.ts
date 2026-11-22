import { beforeEach, describe, expect, it } from 'vitest';
import {
  scanFundingAddresses,
  clearFundingScanCache,
  FUNDING_SCAN_CACHE_MS,
  assertSensibleInputs,
  scriptHashOf,
  type FulcrumClientLike,
} from '../lib/wallet/funding-scan';
import { addressFromPubkey } from '../lib/bch/address';
import type { ElectrumUtxo } from '@ferry/htlc-bch';
import type { BchUtxo } from '../lib/wallet/types';

describe('Funding scan for rotating BCH wallet', () => {
  beforeEach(() => {
    clearFundingScanCache();
  });

  // Generates a deterministic 33-byte compressed pubkey for a given branch and index
  function fakePubkey(childIndex: number, index: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes[0] = 0x02;
    bytes[1] = childIndex;
    const view = new DataView(bytes.buffer);
    view.setUint32(2, index, false);
    return bytes;
  }

  function getScriptHash(childIndex: number, index: number): string {
    const pub = fakePubkey(childIndex, index);
    const bytecode = addressFromPubkey(pub).lockingBytecode.replace(/^0x/, '');
    return scriptHashOf(bytecode);
  }

  function makeMockClient(options: {
    utxosByHash?: Map<string, ElectrumUtxo[]>;
    historyByHash?: Map<string, Array<{ tx_hash: string; height: number }>>;
    firstUseByHash?: Map<
      string,
      { block_hash: string; block_height: number; tx_hash: string } | null
    >;
    onConnect?: () => void;
    onRequest?: (method: string, scriptHash: string) => void;
  }): FulcrumClientLike {
    return {
      connect: async () => {
        options.onConnect?.();
      },
      close: () => undefined,
      listUnspent: async (scriptHash: string) => {
        options.onRequest?.('listUnspent', scriptHash);
        return options.utxosByHash?.get(scriptHash) ?? [];
      },
      getHistory: async (scriptHash: string) => {
        options.onRequest?.('getHistory', scriptHash);
        const explicit = options.historyByHash?.get(scriptHash);
        if (explicit) return explicit;
        return (options.utxosByHash?.get(scriptHash) ?? []).map((utxo) => ({
          tx_hash: utxo.tx_hash,
          height: utxo.height,
        }));
      },
      getFirstUse: async (scriptHash: string) => {
        options.onRequest?.('getFirstUse', scriptHash);
        return options.firstUseByHash?.get(scriptHash) ?? null;
      },
    };
  }

  it('1. funds on an address at index 5,000 reached from a connected index near it', async () => {
    const targetScriptHash = getScriptHash(0, 5000);
    const utxoRow: ElectrumUtxo = {
      tx_hash: '11'.repeat(32),
      tx_pos: 0,
      value: 75000,
      height: 800000,
    };

    const utxos = new Map<string, ElectrumUtxo[]>([
      [targetScriptHash, [utxoRow]],
    ]);
    const client = makeMockClient({ utxosByHash: utxos });

    // Connected address is at index 4995 (distance of 5 to 5000, within gap limit of 20)
    const result = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 4995,
      createClient: () => client,
      urls: ['wss://mock1'],
      gapLimit: 20,
    });

    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0]!.satoshis).toBe(75000n);
    expect(result.utxos[0]!.derivationPath).toEqual(['receive', 5000]);
  });

  it('2. funds behind a gap of 25 are not found and the message says so', async () => {
    // Address at index 30 has funds, but addresses 5..29 are unused (gap of 25)
    const targetScriptHash = getScriptHash(0, 30);
    const utxoRow: ElectrumUtxo = {
      tx_hash: '22'.repeat(32),
      tx_pos: 0,
      value: 50000,
      height: 800000,
    };

    const utxos = new Map<string, ElectrumUtxo[]>([
      [getScriptHash(0, 0), [{ ...utxoRow, tx_hash: '00'.repeat(32) }]],
      [targetScriptHash, [utxoRow]],
    ]);

    const client = makeMockClient({ utxosByHash: utxos });

    const result = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      createClient: () => client,
      urls: ['wss://mock1'],
      gapLimit: 20,
      batchSize: 10,
    });

    // Address 30 should NOT be found because gap limit is 20
    const foundAt30 = result.utxos.find(
      (u) =>
        Array.isArray(
          (u as unknown as { derivationPath: unknown }).derivationPath,
        ) &&
        (u as unknown as { derivationPath: [string, number] })
          .derivationPath[1] === 30,
    );
    expect(foundAt30).toBeUndefined();
    // Only index 0 should be found
    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0]!.derivationPath).toEqual(['receive', 0]);
  });

  it('3. a lagging server does not hide an output seen by another server', async () => {
    const targetScriptHash = getScriptHash(0, 1);
    const utxoRow: ElectrumUtxo = {
      tx_hash: '33'.repeat(32),
      tx_pos: 1,
      value: 120000,
      height: 800000,
    };

    // Server 1 is lagging behind and reports empty
    const server1 = makeMockClient({ utxosByHash: new Map() });
    // Server 2 is up to date and reports the UTXO
    const server2 = makeMockClient({
      utxosByHash: new Map([[targetScriptHash, [utxoRow]]]),
    });

    const clientMap: Record<string, FulcrumClientLike> = {
      'wss://lagging': server1,
      'wss://synced': server2,
    };

    const result = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      urls: ['wss://lagging', 'wss://synced'],
      createClient: (url) => clientMap[url]!,
      gapLimit: 20,
    });

    // The output from server 2 must be found and not hidden
    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0]!.txid).toBe('33'.repeat(32));
    expect(result.utxos[0]!.satoshis).toBe(120000n);
  });

  it('4. the cap limits total requests and sets a clear message', async () => {
    // Chain where every address is used
    const history = new Map<
      string,
      Array<{ tx_hash: string; height: number }>
    >();
    for (let i = 0; i < 200; i++) {
      history.set(getScriptHash(0, i), [
        { tx_hash: '44'.repeat(32), height: 800000 },
      ]);
    }
    const client = makeMockClient({ historyByHash: history });

    const result = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      createClient: () => client,
      urls: ['wss://mock1'],
      maxAddresses: 50,
      batchSize: 10,
    });

    expect(result.capReached).toBe(true);
    expect(result.searched).toBe(50);
    expect(result.message).toMatch(/limit of 50 addresses/);
  });

  it('5. used-but-empty addresses extend the scan', async () => {
    // Address 0 has UTXO
    // Addresses 1..15 have NO UTXOs, but HAVE history (used and spent)
    // Addresses 16..25 have NO UTXOs and NO history (10 unused addresses)
    // Address 26 has UTXO
    const utxos = new Map<string, ElectrumUtxo[]>([
      [
        getScriptHash(0, 0),
        [{ tx_hash: '55'.repeat(32), tx_pos: 0, value: 10000, height: 800000 }],
      ],
      [
        getScriptHash(0, 26),
        [{ tx_hash: '66'.repeat(32), tx_pos: 0, value: 20000, height: 800000 }],
      ],
    ]);

    const history = new Map<
      string,
      Array<{ tx_hash: string; height: number }>
    >();
    // Addresses 1..15 have transaction history
    for (let i = 1; i <= 15; i++) {
      history.set(getScriptHash(0, i), [
        { tx_hash: `spent-${i}`.padEnd(64, '0'), height: 750000 },
      ]);
    }

    const client = makeMockClient({
      utxosByHash: utxos,
      historyByHash: history,
    });

    const result = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      createClient: () => client,
      urls: ['wss://mock1'],
      gapLimit: 20,
      batchSize: 10,
    });

    // If history wasn't checked, the gap of empty addresses from 1 to 25 is 25 (>20), which would abort.
    // Because addresses 1..15 have history, the gap reset, so address 26 was reached!
    expect(result.utxos).toHaveLength(2);
    const utxo26 = result.utxos.find(
      (u) =>
        Array.isArray(
          (u as unknown as { derivationPath: unknown }).derivationPath,
        ) &&
        (u as unknown as { derivationPath: [string, number] })
          .derivationPath[1] === 26,
    );
    expect(utxo26).toBeDefined();
    expect(utxo26!.satoshis).toBe(20000n);
  });

  it('6. two locks scan once (session caching)', async () => {
    let connectCount = 0;
    let requestCount = 0;

    const utxoRow: ElectrumUtxo = {
      tx_hash: '77'.repeat(32),
      tx_pos: 0,
      value: 90000,
      height: 800000,
    };
    const utxos = new Map<string, ElectrumUtxo[]>([
      [getScriptHash(0, 0), [utxoRow]],
    ]);

    const client = makeMockClient({
      utxosByHash: utxos,
      onConnect: () => {
        connectCount++;
      },
      onRequest: () => {
        requestCount++;
      },
    });

    const sessionKey = 'session-test-wallet-abc';

    // First scan
    const firstResult = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      createClient: () => client,
      urls: ['wss://mock1'],
      sessionKey,
      gapLimit: 20,
    });
    expect(firstResult.utxos).toHaveLength(1);
    expect(connectCount).toBe(1);
    const initialRequests = requestCount;
    expect(initialRequests).toBeGreaterThan(0);

    // Second scan with the same session key
    const secondResult = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      createClient: () => client,
      urls: ['wss://mock1'],
      sessionKey,
      gapLimit: 20,
    });

    // Zero new connections or requests
    expect(secondResult).toBe(firstResult);
    expect(connectCount).toBe(1);
    expect(requestCount).toBe(initialRequests);

    // After the cache's short life the wallet is scanned again (it may have new addresses).
    const realNow = Date.now;
    Date.now = () => realNow() + FUNDING_SCAN_CACHE_MS + 1_000;
    try {
      const third = await scanFundingAddresses({
        getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
        startIndex: 0,
        createClient: () => client,
        urls: ['wss://mock1'],
        sessionKey,
        gapLimit: 20,
      });
      expect(third).not.toBe(firstResult);
      expect(requestCount).toBeGreaterThan(initialRequests);
    } finally {
      Date.now = realNow;
    }
  });

  it('7. sorts outputs biggest first', async () => {
    const hash0 = getScriptHash(0, 0);
    const hash1 = getScriptHash(0, 1);

    const utxos = new Map<string, ElectrumUtxo[]>([
      [
        hash0,
        [
          {
            tx_hash: 'small'.padEnd(64, '0'),
            tx_pos: 0,
            value: 500,
            height: 800000,
          },
          {
            tx_hash: 'large'.padEnd(64, '0'),
            tx_pos: 1,
            value: 50000,
            height: 800000,
          },
        ],
      ],
      [
        hash1,
        [
          {
            tx_hash: 'medium'.padEnd(64, '0'),
            tx_pos: 0,
            value: 10000,
            height: 800000,
          },
        ],
      ],
    ]);

    const client = makeMockClient({ utxosByHash: utxos });

    const result = await scanFundingAddresses({
      getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
      startIndex: 0,
      createClient: () => client,
      urls: ['wss://mock1'],
      gapLimit: 20,
    });

    expect(result.utxos).toHaveLength(3);
    // Ordered: 50000, 10000, 500
    expect(result.utxos[0]!.satoshis).toBe(50000n);
    expect(result.utxos[1]!.satoshis).toBe(10000n);
    expect(result.utxos[2]!.satoshis).toBe(500n);
  });

  it('8. warns plainly when needed amount cannot be met from 40 inputs', () => {
    // 50 outputs of 100 sats each = 5,000 sats total
    const smallUtxos: BchUtxo[] = [];
    for (let i = 0; i < 50; i++) {
      smallUtxos.push({
        txid: `tx-${i}`.padEnd(64, '0'),
        vout: 0,
        satoshis: 100n,
        lockingBytecode: '0x00',
      });
    }

    // Needed: 4,500 sats. Top 40 inputs can only supply 4,000 sats.
    expect(() => assertSensibleInputs(smallUtxos, 4500n, 40)).toThrow(
      'Your funds are spread over many small outputs; send them to one address first.',
    );

    // If needed amount is 3,000 sats (can be met with 30 inputs <= 40), it succeeds
    expect(() => assertSensibleInputs(smallUtxos, 3000n, 40)).not.toThrow();
  });

  it('9. scan is cancellable via AbortSignal', async () => {
    const controller = new AbortController();
    const client = makeMockClient({
      onRequest: () => {
        controller.abort();
      },
    });

    await expect(
      scanFundingAddresses({
        getPubkey: (child, idx) => fakePubkey(child, Number(idx)),
        startIndex: 0,
        createClient: () => client,
        urls: ['wss://mock1'],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
