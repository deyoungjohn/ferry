import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  validateBchAddressPrefix,
  isWrongEvmChain,
  wrongEvmChainMessage,
} from '../lib/wallet/chain';
import {
  MockWalletProvider,
  MOCK_BCH_CHIPNET_ADDRESS,
  MOCK_BCH_MAINNET_ADDRESS,
} from '../lib/wallet/mock';
import { useWallets } from '../lib/wallet/context';
import type { ReactNode } from 'react';

describe('BCH address prefix validation & network mismatch prevention', () => {
  it('accepts valid bchtest address when expecting chipnet', () => {
    const result = validateBchAddressPrefix(
      MOCK_BCH_CHIPNET_ADDRESS,
      'bchtest',
    );
    expect(result.ok).toBe(true);
    expect(result.prefix).toBe('bchtest');
    expect(result.error).toBeUndefined();
  });

  it('refuses bitcoincash address with clear message when expecting chipnet', () => {
    const result = validateBchAddressPrefix(
      MOCK_BCH_MAINNET_ADDRESS,
      'bchtest',
    );
    expect(result.ok).toBe(false);
    expect(result.prefix).toBe('bitcoincash');
    expect(result.error).toContain('Wallet network mismatch');
    expect(result.error).toContain('Bitcoin Cash Mainnet (bitcoincash:)');
    expect(result.error).toContain('Bitcoin Cash Chipnet (bchtest:)');
    expect(result.error).toContain(
      'Please switch the active network in your wallet.',
    );
  });

  it('refuses bchtest address with clear message when expecting mainnet', () => {
    const result = validateBchAddressPrefix(
      MOCK_BCH_CHIPNET_ADDRESS,
      'bitcoincash',
    );
    expect(result.ok).toBe(false);
    expect(result.prefix).toBe('bchtest');
    expect(result.error).toContain('Wallet network mismatch');
    expect(result.error).toContain('Chipnet (bchtest:)');
    expect(result.error).toContain('Bitcoin Cash (bitcoincash:)');
  });

  it('refuses invalid address strings cleanly', () => {
    const result = validateBchAddressPrefix('not-a-valid-cashaddr', 'bchtest');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid Bitcoin Cash address');
  });

  it('MockWallet refuses connection when simulated prefix mismatch occurs', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MockWalletProvider>{children}</MockWalletProvider>
    );

    const { result } = renderHook(() => useWallets(), { wrapper });

    expect(result.current.bch.status).toBe('disconnected');
    expect(result.current.bch.error).toBeNull();

    // Attempt connect with simulated prefix mismatch (e.g. user wallet is on mainnet while app is on chipnet)
    act(() => {
      result.current.bch.connect({ simulatePrefixMismatch: true });
    });

    expect(result.current.bch.status).toBe('disconnected');
    expect(result.current.bch.address).toBeNull();
    expect(result.current.bch.error).not.toBeNull();
    expect(result.current.bch.error).toContain('Wallet network mismatch');
  });

  it('verifies EVM chain mismatch guard and message', () => {
    expect(isWrongEvmChain(84532, 84532)).toBe(false);
    expect(isWrongEvmChain(1, 84532)).toBe(true);
    expect(isWrongEvmChain(undefined, 84532)).toBe(false);

    expect(wrongEvmChainMessage(84532, 'Base Sepolia')).toBe(
      'Switch your wallet to Base Sepolia (chain 84532).',
    );
  });
});
