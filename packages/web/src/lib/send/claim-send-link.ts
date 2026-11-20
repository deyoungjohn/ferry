import {
  listDeployedContracts,
  PREDICTED_FERRY_HTLC_ADDRESS,
} from '@ferry/chain-config/browser';
import chainsData from '../../../../chain-config/src/data/chains.json';
import { evmLockId, type Hex, type Hex32 } from '@ferry/core';
import { claimRequestTypedData } from '@ferry/core/api';
import type { EvmSignerPort } from '@ferry/user-flow';
import { encodeFunctionData, parseAbi } from 'viem';
import type { SendLinkSolverPort } from './ports';
import type { ClaimSendLinkLiveInput, ClaimSendLinkLiveResult } from './types';

const claimAbi = parseAbi([
  'function claim(bytes32 lockId, bytes32 secret) external',
]);

export interface ClaimSendLinkDependencies {
  readonly solver: SendLinkSolverPort;
  readonly evmSigner?: EvmSignerPort | undefined;
  readonly chainId?: number | undefined;
  readonly htlcAddress?: string | undefined;
  readonly solverEvmAddress?: string | undefined;
  readonly hashLock?: Hex32 | undefined;
}

/**
 * The chain the claim is made on: the link's own chain. A wallet on another network is asked to
 * switch first; when it refuses or cannot, the person is told which network to choose.
 */
async function ensureLinkChain(
  signer: EvmSignerPort,
  wanted: number | undefined,
): Promise<number> {
  if (wanted === undefined) return signer.getChainId();
  const current = await signer.getChainId().catch(() => undefined);
  if (current === wanted) return wanted;
  if (!signer.switchChain) {
    throw new Error(
      'Your wallet is on a different network than this link. Switch network in your wallet and try again.',
    );
  }
  try {
    await signer.switchChain(wanted);
  } catch (cause) {
    throw new Error(
      'Your wallet is on a different network than this link and did not switch. Switch network in your wallet and try again.',
      { cause },
    );
  }
  return wanted;
}

/**
 * Executes a claim for a send link on the receiver's side.
 *
 * Requirements:
 * 1. Tries the solver's relay claim first if offered.
 * 2. Otherwise falls back to the receiver's own connected EVM wallet sending `claim(lockId, secret)`.
 *    (The HTLC contract transfers the tokens to the enforced recipient regardless of who sends the transaction).
 */
export async function claimSendLinkLive(
  input: ClaimSendLinkLiveInput,
  deps: ClaimSendLinkDependencies,
): Promise<ClaimSendLinkLiveResult> {
  const orderId = (input.orderId ?? input.id) as Hex32;
  const secret = input.secret;

  // Derive lockId if not passed directly
  let lockId = input.lockId;
  if (!lockId && deps.solverEvmAddress && deps.hashLock) {
    lockId = evmLockId(deps.solverEvmAddress, deps.hashLock);
  }

  // Only the wallet the link was made for may ask for the claim: a different wallet is refused
  // here, and the relay checks the signature again on its side.
  let claimSig: Hex | undefined;
  if (deps.evmSigner && input.recipientEvmAddress) {
    const signer = (await deps.evmSigner.getAddress()).toLowerCase();
    if (signer !== input.recipientEvmAddress.toLowerCase()) {
      throw new Error('The connected wallet is not the intended recipient.');
    }
    if (lockId) {
      const chainForSig = await ensureLinkChain(
        deps.evmSigner,
        input.chainId ?? deps.chainId,
      );
      claimSig = await deps.evmSigner.signTypedData(
        claimRequestTypedData({ chainId: chainForSig, orderId, lockId }),
      );
    }
  }

  // 1. Try solver relay first
  if (deps.solver.relayClaim) {
    try {
      const relayRes = await deps.solver.relayClaim(orderId, {
        secret,
        ...(lockId ? { lockId } : {}),
        ...(claimSig ? { claimSig } : {}),
      });
      if (relayRes.ok) {
        return {
          ok: true,
          method: 'relay',
          txHash: relayRes.txHash,
        };
      }
    } catch (cause) {
      // A refusal of the signature is final; any other failure falls back to the wallet.
      if (
        cause instanceof Error &&
        /Only 0x[0-9a-fA-F]{40} can claim/.test(cause.message)
      ) {
        throw cause;
      }
    }
  }

  // 2. Fall back to receiver's own connected wallet
  if (!deps.evmSigner) {
    throw new Error(
      'The solver relay is not available for this send link. Connect an EVM wallet to claim your funds.',
    );
  }

  const chainId = await ensureLinkChain(
    deps.evmSigner,
    input.chainId ?? deps.chainId,
  );
  let htlcAddress = deps.htlcAddress;
  if (!htlcAddress) {
    // The recorded deployments are bundled with the page; reading the chain config from disk
    // does not work in a browser.
    htlcAddress =
      listDeployedContracts(chainsData).find((item) => item.chainId === chainId)
        ?.address ?? PREDICTED_FERRY_HTLC_ADDRESS;
  }

  if (!htlcAddress) {
    throw new Error(`HTLC contract address not found for chain ${chainId}`);
  }

  if (!lockId) {
    throw new Error('lockId is required for direct EVM wallet claim');
  }

  const data = encodeFunctionData({
    abi: claimAbi,
    functionName: 'claim',
    args: [lockId, secret],
  });

  const txHash = await deps.evmSigner.sendTransaction({
    to: htlcAddress as Hex,
    data: data as Hex,
    chainId,
  });

  return {
    ok: true,
    method: 'evm-wallet',
    txHash: txHash as string,
  };
}
