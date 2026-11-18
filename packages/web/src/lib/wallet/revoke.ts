/**
 * Disconnecting in the page only forgets the account here: a browser wallet such as OKX keeps its
 * permission for the site and hands back the last account on the next connect, with no chance to
 * pick another. Asking the wallet to revoke the permission (EIP-2255) makes the next connect show
 * the account choice, as Rabby does. Wallets that do not support the call ignore it.
 */
export async function revokeAccountAccess(provider: unknown): Promise<boolean> {
  const request = (provider as { request?: unknown } | null)?.request;
  if (typeof request !== 'function') return false;
  try {
    await (
      provider as {
        request: (args: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>;
      }
    ).request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
    return true;
  } catch {
    return false;
  }
}
