import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  TESTNET_PROFILE,
  MAINNET_PROFILE,
  readNetworkSetting,
  networkConfigErrors,
  isMainnetProfileConfigured,
  loadFarChainsFromFacts,
} from '../lib/network';
import { NetworkBlockedPage } from '../components/NetworkBlockedPage';

describe('Network Profile', () => {
  it('defaults to testnet when VITE_NETWORK is unset', () => {
    const setting = readNetworkSetting(undefined);
    expect(setting.kind).toBe('testnet');
    expect(setting.error).toBeUndefined();
  });

  it('selects mainnet and returns configuration requirement when set to mainnet', () => {
    const setting = readNetworkSetting('mainnet', false);
    expect(setting.kind).toBe('mainnet');
    expect(setting.error).toBeDefined();
  });

  it('verifies testnet profile has EVM chains from facts with disabled reasons and BCH chipnet configured', () => {
    expect(TESTNET_PROFILE.farChains).toHaveLength(6);
    expect(TESTNET_PROFILE.bch.network).toBe('chipnet');
    expect(TESTNET_PROFILE.isConfigured).toBe(true);

    const bnbChain = TESTNET_PROFILE.farChains.find(
      (c) => c.chainKey === 'bnb',
    );
    expect(bnbChain?.enabled).toBe(false);
    expect(bnbChain?.disabledReason).toContain('token address is reported');
  });

  it('verifies mainnet profile is empty-by-default and unconfigured', () => {
    expect(MAINNET_PROFILE.isConfigured).toBe(false);
    expect(MAINNET_PROFILE.farChains).toHaveLength(0);
    const errors = networkConfigErrors(MAINNET_PROFILE);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Mainnet deployment contracts');
  });

  it('allows mainnet profile to be configured when facts, solver URLs, and banner values are provided', () => {
    const enabledMainnetChains = loadFarChainsFromFacts('mainnet').map((c) =>
      c.chainKey === 'base' ? { ...c, enabled: true, disabledReason: null } : c,
    );
    const configured = isMainnetProfileConfigured(
      enabledMainnetChains,
      'https://solver.mainnet.ferry.cash',
      {
        deckUrl: 'https://deck.ferry.cash',
        repoUrl: 'https://github.com/deyoungjohn/ferry',
        emberAddress: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
        priorRepoUrl: 'https://github.com/prior/repo',
        priorDemoUrl: 'https://demo.prior.cash',
      },
    );
    expect(configured).toBe(true);
    const setting = readNetworkSetting('mainnet', configured);
    expect(setting.error).toBeUndefined();
  });

  it('does not switch routes off when only the banner values are missing', () => {
    const chains = loadFarChainsFromFacts('mainnet').map((c) =>
      c.chainKey === 'base' ? { ...c, enabled: true, disabledReason: null } : c,
    );
    expect(
      isMainnetProfileConfigured(chains, 'https://solver.example.org', {
        deckUrl: '',
        repoUrl: 'https://github.com/deyoungjohn/ferry',
        emberAddress: '',
        priorRepoUrl: '',
        priorDemoUrl: '',
      }),
    ).toBe(true);
  });

  it('renders NetworkBlockedPage with a clear explanation', () => {
    render(<NetworkBlockedPage />);
    expect(screen.getByText(/Configuration Incomplete/i)).toBeInTheDocument();
    expect(
      screen.getByText(/mainnet deployment profile is empty by default/i),
    ).toBeInTheDocument();
  });
});
