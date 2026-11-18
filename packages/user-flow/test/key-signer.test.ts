import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  hexToBin,
  type Transaction,
} from '@bitauth/libauth';
import {
  buildLockTransaction,
  buildWizardConnectSignRequest,
  inspectSignedTransaction,
} from '@ferry/htlc-bch';
import { createKeyBackedBchSigner } from '../src/index.js';
import {
  BCH_CATEGORY,
  USER_KEY,
  USER_LOCKING,
  USER_LOCKING_HEX,
  createWorld,
} from './support/world.js';
import { UserSwapSession } from '../src/index.js';
import { EVM_CHAIN_ID, EVM_TOKEN } from './support/world.js';

const reverse = {
  direction: 'BCH_TO_EVM',
  token: 'PUSD',
  chainId: EVM_CHAIN_ID,
  evmToken: EVM_TOKEN,
  amountIn: 1000n,
  evmTokenDecimals: 6,
  bchTokenDecimals: 2,
} as const;

async function unsignedLock() {
  const { world, deps } = createWorld();
  const session = new UserSwapSession(deps());
  const quote = await session.quote(reverse);
  const built = buildLockTransaction({
    params: quote.terms,
    utxos: [
      {
        txid: '77'.repeat(32),
        vout: 0,
        satoshis: 50_000n,
        token: { category: BCH_CATEGORY, amount: 1_000_000n },
      },
    ],
    changeAddress: (await import('./support/world.js')).USER_CASH_ADDRESS,
    network: 'mainnet',
  });
  return { world, built };
}

describe('createKeyBackedBchSigner', () => {
  it('exposes the P2PKH locking bytecode of its key', () => {
    const signer = createKeyBackedBchSigner(USER_KEY);
    expect(binToHex(signer.lockingBytecode)).toBe(USER_LOCKING_HEX);
    expect(binToHex(signer.lockingBytecode)).toBe(binToHex(USER_LOCKING));
  });

  it('signs a lock request so that the local check accepts it', async () => {
    const { built } = await unsignedLock();
    const signer = createKeyBackedBchSigner(USER_KEY);
    const signedHex = await signer.signTransaction(
      buildWizardConnectSignRequest({ lockTx: built }),
    );
    const report = inspectSignedTransaction(
      built.unsigned.txHex,
      signedHex,
      built.unsigned.sourceOutputs,
    );
    expect(report.ok).toBe(true);
    const tx = decodeTransaction(hexToBin(signedHex)) as Transaction;
    expect(tx.inputs.every((i) => i.unlockingBytecode.length > 0)).toBe(true);
  });

  it('leaves inputs it does not own unsigned, so the local check names them', async () => {
    const { built } = await unsignedLock();
    const other = createKeyBackedBchSigner(new Uint8Array(32).fill(0x42));
    const signedHex = await other.signTransaction(
      buildWizardConnectSignRequest({ lockTx: built }),
    );
    const report = inspectSignedTransaction(
      built.unsigned.txHex,
      signedHex,
      built.unsigned.sourceOutputs,
    );
    expect(report.ok).toBe(false);
    expect(report.failedInput).toBe(0);
  });

  it('refuses a key that is not 32 bytes or not a valid secp256k1 key', () => {
    expect(() => createKeyBackedBchSigner(new Uint8Array(31))).toThrow(
      /32-byte/,
    );
    expect(() => createKeyBackedBchSigner(new Uint8Array(32))).toThrow(/valid/);
  });
});
