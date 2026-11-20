import type { Hex32 } from '@ferry/core';
import {
  PREDICTED_FERRY_HTLC_ADDRESS,
  PREVIOUS_FERRY_HTLC_ADDRESS,
} from '@ferry/chain-config';
import { scanEvmRoot } from './wallet-scan.js';

export interface WalletScanArgs {
  root: Hex32;
  owner: `0x${string}`;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  gap?: number;
}

export function parseWalletScanArgs(argv: readonly string[]): WalletScanArgs {
  let root: string | undefined;
  let owner: string | undefined;
  let chainId = 8453;
  let chainName = 'Base';
  let rpcUrl: string | undefined;
  let gap: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--root' || arg === '--rescue-key') root = argv[++i];
    else if (arg === '--owner') owner = argv[++i];
    else if (arg === '--chain-id') chainId = Number(argv[++i]);
    else if (arg === '--chain-name') chainName = argv[++i] ?? chainName;
    else if (arg === '--rpc') rpcUrl = argv[++i];
    else if (arg === '--gap') gap = Number(argv[++i]);
  }
  if (!root || !/^0x[0-9a-fA-F]{64}$/.test(root)) {
    throw new Error('--root (or --rescue-key) needs a 32-byte 0x-hex value');
  }
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    throw new Error('--owner needs an EVM address');
  }
  if (!rpcUrl) throw new Error('--rpc needs an http(s) endpoint');
  return {
    root: root.toLowerCase() as Hex32,
    owner: owner as `0x${string}`,
    chainId,
    chainName,
    rpcUrl,
    ...(gap !== undefined ? { gap } : {}),
  };
}

export async function runWalletScanCli(
  argv: readonly string[],
  io: { log: (line: string) => void } = console,
): Promise<void> {
  const args = parseWalletScanArgs(argv);
  const result = await scanEvmRoot({
    root: args.root,
    owner: args.owner,
    gap: args.gap ?? 20,
    chains: [
      {
        chainId: args.chainId,
        name: args.chainName,
        rpcUrls: [args.rpcUrl],
        htlcAddresses: [
          PREDICTED_FERRY_HTLC_ADDRESS,
          PREVIOUS_FERRY_HTLC_ADDRESS,
        ],
      },
    ],
  });
  io.log(
    JSON.stringify(
      result.swaps.map((swap) => ({
        index: swap.index,
        chainId: swap.chainId,
        chain: swap.chainName,
        lockId: swap.lockId,
        hashLock: swap.hashLock,
        status: swap.status,
        htlcAddress: swap.htlcAddress,
        evmDeadline:
          swap.evmDeadline === null ? null : swap.evmDeadline.toString(),
      })),
      null,
      2,
    ),
  );
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('wallet-cli.ts');

if (isMain) {
  runWalletScanCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
