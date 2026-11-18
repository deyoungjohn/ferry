import { describe, expect, it, vi } from 'vitest';
import { revokeAccountAccess } from '../lib/wallet/revoke';

describe('forgetting the account on disconnect', () => {
  it('asks the wallet to revoke its account permission', async () => {
    const request = vi.fn(async () => null);
    expect(await revokeAccountAccess({ request })).toBe(true);
    expect(request).toHaveBeenCalledWith({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
  });

  it('a wallet that does not support it, or no wallet at all, is not an error', async () => {
    const unsupported = vi.fn(async () => {
      throw new Error('Method not found');
    });
    expect(await revokeAccountAccess({ request: unsupported })).toBe(false);
    expect(await revokeAccountAccess(null)).toBe(false);
    expect(await revokeAccountAccess({})).toBe(false);
  });
});
