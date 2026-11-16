import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  TESTNET_PROFILE,
  MAINNET_PROFILE,
  readNetworkSetting,
  networkConfigErrors,
} from '../lib/network';
import { NetworkBlockedPage } from '../components/NetworkBlockedPage';

describe('Network Profile', () => {
  it('defaults to testnet when VITE_NETWORK is unset', () => {
    const setting = readNetworkSetting(undefined);
    expect(setting.kind).toBe('testnet');
    expect(setting.error).toBeUndefined();
  });

  it('selects mainnet and returns configuration requirement when set to mainnet', () => {
    const setting = readNetworkSetting('mainnet');
    expect(setting.kind).toBe('mainnet');
    expect(setting.error).toBeDefined();
  });

  it('verifies testnet profile has 4 EVM chains and BCH chipnet configured', () => {
    expect(TESTNET_PROFILE.farChains).toHaveLength(4);
    expect(TESTNET_PROFILE.bch.network).toBe('chipnet');
    expect(TESTNET_PROFILE.isConfigured).toBe(true);
  });

  it('verifies mainnet profile is empty-by-default and unconfigured', () => {
    expect(MAINNET_PROFILE.isConfigured).toBe(false);
    expect(MAINNET_PROFILE.farChains).toHaveLength(0);
    const errors = networkConfigErrors(MAINNET_PROFILE);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Mainnet deployment contracts');
  });

  it('renders NetworkBlockedPage with a clear explanation', () => {
    render(<NetworkBlockedPage />);
    expect(screen.getByText(/Configuration Incomplete/i)).toBeInTheDocument();
    expect(
      screen.getByText(/mainnet deployment profile is empty by default/i),
    ).toBeInTheDocument();
  });
});
