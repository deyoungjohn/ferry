import type { Hex } from '@ferry/core';
import { SolverClient } from '@ferry/solver-client';
import type {
  BchSignerPort,
  EvmSignerPort,
  UserSwapDependencies,
} from '@ferry/user-flow';
import type { BchWallet, EvmWallet } from '../wallet/types';
import { createBrowserBchChain } from './bch-chain';
import { createBrowserEvmChain } from './evm-chain';
import { createLocalRecoveryStore } from './recovery-store';
import {
  createRescueSecretGenerator,
  createWalletSecretGenerator,
  type SecretGenerator,
} from '../recovery/recovery-key-service';

export function evmSignerFromWallet(wallet: EvmWallet): EvmSignerPort {
  return {
    getAddress: () =>
      wallet.address
        ? Promise.resolve(wallet.address as Hex)
        : Promise.reject(new Error('Connect an EVM wallet first.')),
    getChainId: () =>
      wallet.chainId !== undefined
        ? Promise.resolve(wallet.chainId)
        : Promise.reject(new Error('The EVM wallet did not report a chain.')),
    ...(wallet.switchChain
      ? { switchChain: (chainId: number) => wallet.switchChain!(chainId) }
      : {}),
    signTypedData: (typedData) =>
      wallet.signTypedData(
        typedData as Parameters<EvmWallet['signTypedData']>[0],
      ),
    sendTransaction: (tx) => {
      if (!wallet.sendTransaction) {
        return Promise.reject(
          new Error('This wallet cannot send transactions from the page.'),
        );
      }
      return wallet.sendTransaction(tx) as ReturnType<
        EvmSignerPort['sendTransaction']
      >;
    },
  };
}

export function bchSignerFromWallet(wallet: BchWallet): BchSignerPort {
  return {
    listFundingAddresses: () =>
      wallet.listFundingAddresses
        ? wallet.listFundingAddresses()
        : Promise.resolve([]),
    signTransaction: (request) => {
      if (!wallet.signWizardRequest) {
        return Promise.reject(
          new Error(
            'This Bitcoin Cash wallet cannot sign a lock from the page.',
          ),
        );
      }
      return wallet.signWizardRequest(request);
    },
  };
}

export interface LiveSwapWallets {
  readonly evm: EvmWallet;
  readonly bch: BchWallet;
}

/** Everything the session needs, built from the connected wallets and the live solver. */
export function createLiveDependencies(options: {
  readonly wallets: LiveSwapWallets;
  readonly solverUrl: string;
  readonly chainId: number;
  /**
   * Where the PUSD or MUSD goes in a swap into Bitcoin Cash, when typed instead of taken from a
   * connected wallet (a swap into Bitcoin Cash needs no Bitcoin Cash signature).
   */
  readonly bchRecipientAddress?: string | undefined;
}): UserSwapDependencies {
  const { wallets, solverUrl, chainId } = options;
  const address =
    options.bchRecipientAddress?.trim() || wallets.bch.address?.address;
  if (!address)
    throw new Error('Enter the Bitcoin Cash address that receives the swap.');
  const evmChain = createBrowserEvmChain(chainId);

  let secretGenerator: SecretGenerator | undefined;
  if (wallets.evm.address) {
    secretGenerator = createWalletSecretGenerator(wallets.evm, {
      chains: [evmChain],
      chainClient: evmChain.client,
    });
  } else {
    secretGenerator = createRescueSecretGenerator();
  }

  return {
    solver: new SolverClient({ baseUrl: solverUrl }),
    evmSigner: evmSignerFromWallet(wallets.evm),
    evmChain,
    bchSigner: bchSignerFromWallet(wallets.bch),
    bchChain: createBrowserBchChain({ solverUrl }),
    store: createLocalRecoveryStore(),
    bchNetwork: 'mainnet',
    bchCashAddress: address,
    secretGenerator,
    // The tag of the secret just used, written into the Bitcoin Cash lock's terms output.
    recoveryTag: () => secretGenerator?.lastTag,
  };
}

/**
 * Dependencies for someone paying a pay link: only the EVM wallet signs. The Bitcoin Cash side
 * pays the link's recipient, and its claim needs no wallet and no signature, so the payer needs
 * no Bitcoin Cash wallet at all.
 */
export function createPayerDependencies(options: {
  readonly evm: EvmWallet;
  readonly solverUrl: string;
  readonly chainId: number;
  /** The link's recipient: where the Bitcoin Cash payment goes. */
  readonly recipientCashAddress: string;
}): UserSwapDependencies {
  const { evm, solverUrl, chainId, recipientCashAddress } = options;
  const evmChain = createBrowserEvmChain(chainId);
  const secretGenerator = evm.address
    ? createWalletSecretGenerator(evm, {
        chains: [evmChain],
        chainClient: evmChain.client,
      })
    : undefined;

  return {
    solver: new SolverClient({ baseUrl: solverUrl }),
    evmSigner: evmSignerFromWallet(evm),
    evmChain,
    bchSigner: {
      signTransaction: () =>
        Promise.reject(
          new Error('A payment to a pay link needs no Bitcoin Cash signature.'),
        ),
    },
    bchChain: createBrowserBchChain({ solverUrl }),
    store: createLocalRecoveryStore(),
    bchNetwork: 'mainnet',
    bchCashAddress: recipientCashAddress,
    ...(secretGenerator ? { secretGenerator } : {}),
  };
}
