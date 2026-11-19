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
}): UserSwapDependencies {
  const { wallets, solverUrl, chainId } = options;
  const address = wallets.bch.address?.address;
  if (!address) throw new Error('Connect a Bitcoin Cash wallet first.');
  return {
    solver: new SolverClient({ baseUrl: solverUrl }),
    evmSigner: evmSignerFromWallet(wallets.evm),
    evmChain: createBrowserEvmChain(chainId),
    bchSigner: bchSignerFromWallet(wallets.bch),
    bchChain: createBrowserBchChain({ solverUrl }),
    store: createLocalRecoveryStore(),
    bchNetwork: 'mainnet',
    bchCashAddress: address,
  };
}
