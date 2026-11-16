import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';
import { loadChainConfig } from '@ferry/chain-config';
import type { Network } from '@ferry/chain-config';
import {
  CANONICAL_CREATE2_FACTORY,
  predictFerryHtlcAddress,
} from './deploy.js';

export interface VerifyCommandEntry {
  chain: string;
  chainId: number;
  network: Network;
  address: Address;
  explorerUrl: string;
  command: string;
}

export function formatVerifyCommands(options?: {
  network?: Network | undefined;
  address?: Address | undefined;
}): VerifyCommandEntry[] {
  const network = options?.network ?? 'mainnet';
  const config = loadChainConfig();

  return config.chains
    .filter((chain) => chain.network === network)
    .map((chain) => {
      const address =
        options?.address ??
        predictFerryHtlcAddress(
          (chain.create2Factory.address as Address) ??
            CANONICAL_CREATE2_FACTORY,
        );
      const command = [
        'forge verify-contract',
        address,
        'src/FerryHTLC.sol:FerryHTLC',
        `--chain-id ${chain.chainId}`,
        '--compiler-version 0.8.28',
        '--evm-version cancun',
        '--num-of-runs 200',
        '--via-ir',
        '--constructor-args 0x',
        '--watch',
      ].join(' ');

      return {
        chain: chain.id,
        chainId: chain.chainId,
        network,
        address,
        explorerUrl: chain.explorerUrl,
        command,
      };
    });
}

function main(): void {
  const networkArg = process.argv.includes('--testnet') ? 'testnet' : 'mainnet';
  const entries = formatVerifyCommands({ network: networkArg });
  for (const entry of entries) {
    console.log(
      `# ${entry.chain} (${entry.network}, chainId=${entry.chainId}, explorer=${entry.explorerUrl})`,
    );
    console.log(entry.command);
    console.log('');
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
