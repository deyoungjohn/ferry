import { describe, expect, it } from 'vitest';
import { latestWallet } from '../lib/live/latest-wallets';
import type { BchWallet } from '../lib/wallet/types';

describe('latestWallet', () => {
  it('answers from the newest wallet object, so a wallet that connected later is the one that signs', async () => {
    let current = {
      status: 'offline',
      signWizardRequest: async () => {
        throw new Error('Connect a WizardConnect wallet first');
      },
    } as unknown as BchWallet;
    const wallet = latestWallet<BchWallet>(() => current);
    expect(wallet.status).toBe('offline');
    await expect(wallet.signWizardRequest!({} as never)).rejects.toHaveProperty(
      'message',
      'Connect a WizardConnect wallet first',
    );

    current = {
      status: 'connected',
      signWizardRequest: async () => '0xsigned',
    } as unknown as BchWallet;
    expect(wallet.status).toBe('connected');
    expect(await wallet.signWizardRequest!({} as never)).toBe('0xsigned');
  });
});
