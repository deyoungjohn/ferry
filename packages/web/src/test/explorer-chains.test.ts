import { describe, expect, it } from 'vitest';
import { chainLabel, evmExplorerName, evmTxUrl } from '../lib/explorer';

describe('explorer links for every chain', () => {
  const hash = `0x${'ab'.repeat(32)}`;
  it('links a transaction on each mainnet chain to its own explorer', () => {
    expect(evmTxUrl(8453, hash)).toContain('basescan.org/tx/');
    expect(evmTxUrl(42161, hash)).toContain('arbiscan.io/tx/');
    expect(evmTxUrl(1, hash)).toContain('etherscan.io/tx/');
    expect(evmTxUrl(56, hash)).toContain('bscscan.com/tx/');
    expect(evmTxUrl(5042, hash)).not.toBeNull();
    expect(evmTxUrl(4663, hash)).not.toBeNull();
  });
  it('names the chain and the explorer', () => {
    expect(chainLabel('Chain 42161')).toBe('Arbitrum One');
    expect(evmExplorerName(42161)).toBe('Arbiscan');
  });
});
