import { describe, expect, it, vi } from 'vitest';
import type { ElectrumTransport } from '../src/bch/transport.js';
import { BchQuorumClient } from '../src/bch/quorum-client.js';

describe('BchQuorumClient Electrum methods and failover', () => {
  it('calls listUnspent with include_tokens and handles CashTokens payload', async () => {
    const mockRequest = vi.fn().mockResolvedValue([
      {
        tx_hash: '11'.repeat(32),
        tx_pos: 0,
        value: 5000,
        token_data: {
          category: 'aa'.repeat(32),
          amount: '25000',
        },
      },
    ]);

    const transport: ElectrumTransport = {
      url: 'wss://node1',
      connect: async () => {},
      close: () => {},
      isConnected: () => true,
      request: mockRequest,
      getGenesisHash: () => 'chipnet_hash',
      fetchFeatures: async () => ({ genesis_hash: 'chipnet_hash' }),
      getTip: () => ({ height: 330000, timestamp: Date.now() }),
      getLastConfirmedAt: () => Date.now(),
      ping: async () => true,
    };

    const client = new BchQuorumClient([transport], 'chipnet');
    const utxos = await client.listUnspent('mockScriptHash', 'include_tokens');

    expect(mockRequest).toHaveBeenCalledWith(
      'blockchain.scripthash.listunspent',
      ['mockScriptHash', 'include_tokens'],
    );
    expect(utxos.length).toBe(1);
    expect(utxos[0]?.token_data?.category).toBe('aa'.repeat(32));
    expect(utxos[0]?.token_data?.amount).toBe('25000');
  });

  it('fails over to secondary server when primary server fails', async () => {
    const t1: ElectrumTransport = {
      url: 'wss://failing',
      connect: async () => {},
      close: () => {},
      isConnected: () => true,
      request: vi.fn().mockRejectedValue(new Error('Connection dropped')),
      getGenesisHash: () => 'chipnet_hash',
      fetchFeatures: async () => ({ genesis_hash: 'chipnet_hash' }),
      getTip: () => ({ height: 330000, timestamp: Date.now() }),
      getLastConfirmedAt: () => Date.now(),
      ping: async () => false,
    };

    const t2: ElectrumTransport = {
      url: 'wss://backup',
      connect: async () => {},
      close: () => {},
      isConnected: () => true,
      request: vi.fn().mockResolvedValue('0xrawtxhex'),
      getGenesisHash: () => 'chipnet_hash',
      fetchFeatures: async () => ({ genesis_hash: 'chipnet_hash' }),
      getTip: () => ({ height: 330000, timestamp: Date.now() }),
      getLastConfirmedAt: () => Date.now(),
      ping: async () => true,
    };

    const client = new BchQuorumClient([t1, t2], 'chipnet');
    const result = await client.getTransaction('txid123');

    expect(t1.request).toHaveBeenCalled();
    expect(t2.request).toHaveBeenCalledWith('blockchain.transaction.get', [
      'txid123',
      true,
    ]);
    expect(result).toBe('0xrawtxhex');
  });

  it('waitForDoubleSpendProof returns hasProof=true when proof appears within window', async () => {
    let callCount = 0;
    const transport: ElectrumTransport = {
      url: 'wss://dsproof-node',
      connect: async () => {},
      close: () => {},
      isConnected: () => true,
      request: vi.fn().mockImplementation(async (method) => {
        if (method === 'blockchain.transaction.dsproof.get') {
          callCount++;
          if (callCount >= 2) {
            return { dsproof_id: 'dsproof123' };
          }
          throw new Error('Not found');
        }
        return null;
      }),
      getGenesisHash: () => 'chipnet_hash',
      fetchFeatures: async () => ({ genesis_hash: 'chipnet_hash' }),
      getTip: () => ({ height: 330000, timestamp: Date.now() }),
      getLastConfirmedAt: () => Date.now(),
      ping: async () => true,
    };

    const client = new BchQuorumClient([transport], 'chipnet');
    const result = await client.waitForDoubleSpendProof('txid123', 15_000);

    expect(result.hasProof).toBe(true);
    expect(result.proofData).toEqual({ dsproof_id: 'dsproof123' });
  });

  it('waitForDoubleSpendProof returns hasProof=false when window expires with no proof', async () => {
    const transport: ElectrumTransport = {
      url: 'wss://dsproof-node',
      connect: async () => {},
      close: () => {},
      isConnected: () => true,
      request: vi.fn().mockRejectedValue(new Error('dsproof not found')),
      getGenesisHash: () => 'chipnet_hash',
      fetchFeatures: async () => ({ genesis_hash: 'chipnet_hash' }),
      getTip: () => ({ height: 330000, timestamp: Date.now() }),
      getLastConfirmedAt: () => Date.now(),
      ping: async () => true,
    };

    const client = new BchQuorumClient([transport], 'chipnet');
    const result = await client.waitForDoubleSpendProof('txid123', 500);

    expect(result.hasProof).toBe(false);
  });
});
