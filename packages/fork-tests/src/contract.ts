import { getAddress } from 'viem';
import type { Address, Chain, Hex, PublicClient, WalletClient } from 'viem';
import { loadForgeArtifact } from '../../e2e/test/harness.js';
import { mine } from './fork.js';

export async function deployHtlc(
  wallet: WalletClient,
  publicClient: PublicClient,
  account: Parameters<typeof wallet.deployContract>[0]['account'],
  chain: Chain,
  rpcUrl: string,
): Promise<Address> {
  const artifact = loadForgeArtifact('FerryHTLC.sol/FerryHTLC.json');
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    args: [],
    account,
    chain,
  });
  await mine(rpcUrl).catch(() => undefined);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 180_000,
    pollingInterval: 500,
  });
  if (!receipt.contractAddress) {
    throw new Error('FerryHTLC deployment produced no address');
  }
  return getAddress(receipt.contractAddress);
}
