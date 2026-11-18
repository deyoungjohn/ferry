import { loadChainConfig } from '@ferry/chain-config/browser';
import { evmLockId, type Hex, type Hex32 } from '@ferry/core';
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

  // 1. Try solver relay first
  if (deps.solver.relayClaim) {
    try {
      const relayRes = await deps.solver.relayClaim(orderId, {
        secret,
        ...(lockId ? { lockId } : {}),
      });
      if (relayRes.ok) {
        return {
          ok: true,
          method: 'relay',
          txHash: relayRes.txHash,
        };
      }
    } catch {
      // Relay not offered or failed; fall back to connected wallet
    }
  }

  // 2. Fall back to receiver's own connected wallet
  if (!deps.evmSigner) {
    throw new Error(
      'The solver relay is not available for this send link. Connect an EVM wallet to claim your funds.',
    );
  }

  const chainId = deps.chainId ?? (await deps.evmSigner.getChainId());
  let htlcAddress = deps.htlcAddress;
  if (!htlcAddress) {
    const config = loadChainConfig({
      env: { FERRY_NETWORK: 'mainnet' },
      network: 'mainnet',
    }).coreChains.find((c) => c.chainId === chainId);
    htlcAddress = config?.htlcAddress;
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
