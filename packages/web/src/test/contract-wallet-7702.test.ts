import { describe, expect, it } from 'vitest';
import {
  getOrDeriveRecoveryRoot,
  isContractWallet,
} from '../lib/recovery/recovery-key-service';

const address = '0x12dcbbc7f96b87220e90b46d9528db156b1da841' as const;
const clientWith = (code: string) => ({
  getCode: async () => code as `0x${string}`,
});

describe('contract wallet check', () => {
  it('treats an EIP-7702 account as an ordinary account, and real code as a contract', async () => {
    expect(
      await isContractWallet(
        clientWith('0xef0100e40ccb2d94975c51bff0c004efdfd9b3a5796fa4'),
        address,
      ),
    ).toBe(false);
    expect(await isContractWallet(clientWith('0x'), address)).toBe(false);
    expect(
      await isContractWallet(clientWith('0x6080604052348015600f57'), address),
    ).toBe(true);
  });

  it('rechecks a stored contract mark and clears it when the chain says otherwise', async () => {
    const stored = new Map<string, string>([
      [`ferry.recovery.contract.${address}`, 'true'],
    ]);
    const store = {
      get: async (key: string) => stored.get(key) ?? null,
      set: async (key: string, value: string) => {
        stored.set(key, value);
      },
    };
    const result = await getOrDeriveRecoveryRoot(
      {
        address,
        signTypedData: async () => ('0x' + '5a'.repeat(65)) as `0x${string}`,
      } as never,
      {
        store: store as never,
        chainClient: clientWith(
          '0xef0100e40ccb2d94975c51bff0c004efdfd9b3a5796fa4',
        ),
      },
    );
    expect(result.isContract).toBe(false);
    expect(result.root).not.toBeNull();
    expect(stored.get(`ferry.recovery.contract.${address}`)).toBe('false');
  });
});
