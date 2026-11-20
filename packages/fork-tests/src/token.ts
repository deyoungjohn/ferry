import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
} from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { setStorageAt } from './fork.js';

const ERC20 = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
]);

const BALANCE_SLOTS = [
  9, 2, 51, 1, 0, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 50, 52,
];

function mappingSlot(account: Address, slot: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [getAddress(account), BigInt(slot)],
    ),
  );
}

export async function setErc20Balance(params: {
  rpcUrl: string;
  publicClient: PublicClient;
  token: Address;
  account: Address;
  amount: bigint;
}): Promise<number> {
  const read = () =>
    params.publicClient.readContract({
      address: params.token,
      abi: ERC20,
      functionName: 'balanceOf',
      args: [params.account],
    });

  if ((await read()) >= params.amount) return -1;
  const value = toHex(params.amount, { size: 32 });

  for (const slot of BALANCE_SLOTS) {
    const key = mappingSlot(params.account, slot);
    const original = await params.publicClient.getStorageAt({
      address: params.token,
      slot: key,
    });
    await setStorageAt(params.rpcUrl, params.token, key, value);
    if ((await read()) === params.amount) return slot;
    await setStorageAt(params.rpcUrl, params.token, key, original ?? '0x0');
  }
  throw new Error(`could not find the token balance slot for ${params.token}`);
}
