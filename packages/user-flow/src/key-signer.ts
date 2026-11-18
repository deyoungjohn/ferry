import {
  binToHex,
  ripemd160,
  secp256k1,
  sha256,
  type Transaction,
} from '@bitauth/libauth';
import {
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type Unlocker,
} from 'cashscript';
import type { WizardConnectSignRequest } from '@ferry/htlc-bch';
import type { BchSignerPort } from './ports.js';

export interface KeyBackedBchSigner extends BchSignerPort {
  /** The P2PKH locking bytecode this key controls. */
  readonly lockingBytecode: Uint8Array;
}

/** An input the key does not own is left unsigned; the local check then names it. */
const unsignedInput: Unlocker = {
  generateLockingBytecode: () => new Uint8Array(),
  generateUnlockingBytecode: () => new Uint8Array(),
} as unknown as Unlocker;

/**
 * A Bitcoin Cash signer backed by one disposable private key, for the headless
 * probe and for tests. It signs the P2PKH inputs that pay to its own key and
 * returns the signed transaction as hex; it does not broadcast. No Node
 * built-ins: it runs in a browser too, but a real wallet should never hand its
 * key to a page, so this is not for end users.
 */
export function createKeyBackedBchSigner(
  privateKey: Uint8Array,
): KeyBackedBchSigner {
  if (privateKey.length !== 32) {
    throw new Error('The Bitcoin Cash key must be a 32-byte private key.');
  }
  if (!secp256k1.validatePrivateKey(privateKey)) {
    throw new Error('The Bitcoin Cash key is not a valid secp256k1 key.');
  }
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') {
    throw new Error(`The Bitcoin Cash key could not be used: ${publicKey}`);
  }
  const pkh = ripemd160.hash(sha256.hash(publicKey));
  const lockingBytecode = new Uint8Array([
    0x76,
    0xa9,
    0x14,
    ...pkh,
    0x88,
    0xac,
  ]);
  const ownHex = binToHex(lockingBytecode);
  const template = new SignatureTemplate(privateKey);

  return {
    lockingBytecode,
    signTransaction: (request: WizardConnectSignRequest) => {
      try {
        const tx = request.transaction.transaction as Transaction;
        const sources = request.transaction.sourceOutputs;
        const builder = new TransactionBuilder({
          provider: new MockNetworkProvider(),
        });
        tx.inputs.forEach((input, index) => {
          const source = sources[index];
          if (source === undefined) {
            throw new Error(`No source output for input ${index}.`);
          }
          const owned = binToHex(source.lockingBytecode) === ownHex;
          builder.addInput(
            {
              // libauth keeps outpoint hashes in transaction-id order.
              txid: binToHex(input.outpointTransactionHash),
              vout: input.outpointIndex,
              satoshis: source.valueSatoshis,
              lockingBytecode: binToHex(source.lockingBytecode),
              ...(source.token
                ? {
                    token: {
                      category: binToHex(source.token.category),
                      amount: source.token.amount,
                    },
                  }
                : {}),
            },
            owned ? template.unlockP2PKH() : unsignedInput,
          );
        });
        tx.outputs.forEach((output) => {
          builder.addOutput({
            to: output.lockingBytecode,
            amount: output.valueSatoshis,
            ...(output.token
              ? {
                  token: {
                    category: binToHex(output.token.category),
                    amount: output.token.amount,
                  },
                }
              : {}),
          });
        });
        return Promise.resolve(builder.build());
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
  };
}
