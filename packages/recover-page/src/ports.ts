import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import {
  evmLockId,
  type LockChainStatus,
  type RecoveryFile,
} from '@ferry/core';
import { FulcrumClient, type HtlcUtxo } from '@ferry/htlc-bch';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import { createPublicClient, http, type Address } from 'viem';
import type { BchReading, EvmReading, RecoveryPorts } from './logic.js';

/** Public servers, tried in order. The two Bitcoin Cash mainnet hosts are independent operators. */
export const FULCRUM_URLS = {
  mainnet: [
    'wss://bch.imaginary.cash:50004',
    'wss://blackie.c3-soft.com:50004',
  ],
  chipnet: ['wss://chipnet.imaginary.cash:50004'],
} as const;

const STATE_MAP: Record<number, LockChainStatus> = {
  0: 'none',
  1: 'locked',
  2: 'claimed',
  3: 'refunded',
};

function scriptHashOf(lockingBytecodeHex: string): string {
  const bytes = hexToBin(lockingBytecodeHex.replace(/^0x/, ''));
  return binToHex(sha256.hash(bytes).reverse());
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PortOptions {
  /** Public RPC endpoints per EVM chain id, embedded when the page is built. */
  readonly rpcUrls: Readonly<Record<number, readonly string[]>>;
  /** Overrides, typed by the user. */
  readonly rpcOverride?: string | undefined;
  readonly fulcrumOverride?: string | undefined;
}

export function createBrowserPorts(options: PortOptions): RecoveryPorts {
  return {
    async readEvm(file: RecoveryFile): Promise<EvmReading> {
      const chainId = file.contracts.evm.chainId;
      const urls = options.rpcOverride
        ? [options.rpcOverride]
        : (options.rpcUrls[chainId] ?? []);
      if (urls.length === 0) {
        throw new Error(
          `No public endpoint is known for chain ${chainId}. Type one in "EVM endpoint".`,
        );
      }
      const lockId =
        file.contracts.evm.lockId ??
        evmLockId(
          file.terms.direction === 'EVM_TO_BCH'
            ? file.terms.userEvmAddress
            : file.terms.solverEvmAddress,
          file.hashLock,
        );
      const failures: string[] = [];
      for (const url of urls) {
        try {
          const client = createPublicClient({
            transport: http(url, { timeout: 15_000 }),
            cacheTime: 0,
          });
          const [block, tuple] = await Promise.all([
            client.getBlock({ blockTag: 'latest' }),
            client.readContract({
              address: file.contracts.evm.htlcAddress as Address,
              abi: ferryHtlcAbi,
              functionName: 'locks',
              args: [lockId],
            }),
          ]);
          return {
            nowSeconds: Number(block.timestamp),
            lockStatus: STATE_MAP[Number(tuple[6])] ?? 'none',
          };
        } catch (error) {
          failures.push(`${url}: ${messageOf(error)}`);
        }
      }
      throw new Error(`No EVM endpoint answered. ${failures.join('; ')}`);
    },

    async readBch(file: RecoveryFile): Promise<BchReading> {
      const urls = options.fulcrumOverride
        ? [options.fulcrumOverride]
        : FULCRUM_URLS[file.contracts.bch.network];
      const scriptHash = scriptHashOf(file.contracts.bch.lockingBytecode);
      const failures: string[] = [];
      for (const url of urls) {
        const client = new FulcrumClient(url, { timeoutMs: 15_000 });
        try {
          await client.connect();
          const tipHeight = await client.getTipHeight();
          const rows = await client.listUnspent(scriptHash, 'include_tokens');
          const utxos: HtlcUtxo[] = rows.map((row) => ({
            txid: row.tx_hash,
            vout: row.tx_pos,
            satoshis: BigInt(row.value),
            lockingBytecode: file.contracts.bch.lockingBytecode,
          }));
          return { tipHeight, utxos };
        } catch (error) {
          failures.push(`${url}: ${messageOf(error)}`);
        } finally {
          client.close();
        }
      }
      throw new Error(
        `No Bitcoin Cash server answered. ${failures.join('; ')}`,
      );
    },
  };
}

/** Send a transaction through a browser wallet (MetaMask and similar). Anyone may submit it. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export async function sendWithWallet(
  provider: Eip1193,
  call: { to: string; data: string; value: bigint; chainId: number },
): Promise<string> {
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[];
  const from = accounts[0];
  if (!from) throw new Error('The wallet did not share an account.');
  const hexChain = `0x${call.chainId.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChain }],
    });
  } catch (error) {
    throw new Error(
      `Switch your wallet to chain ${call.chainId} and try again. ${messageOf(error)}`,
      { cause: error },
    );
  }
  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from,
        to: call.to,
        data: call.data,
        value: `0x${call.value.toString(16)}`,
      },
    ],
  })) as string;
}

/**
 * Send a signed Bitcoin Cash transaction. Servers are tried only until one CONNECTS; after the
 * transaction has gone out on one server it is never repeated on another.
 */
export async function broadcastBch(
  file: RecoveryFile,
  txHex: string,
  fulcrumOverride?: string,
): Promise<string> {
  const urls = fulcrumOverride
    ? [fulcrumOverride]
    : FULCRUM_URLS[file.contracts.bch.network];
  const failures: string[] = [];
  for (const url of urls) {
    const client = new FulcrumClient(url, { timeoutMs: 15_000 });
    try {
      await client.connect();
    } catch (error) {
      failures.push(`${url}: ${messageOf(error)}`);
      client.close();
      continue;
    }
    try {
      return await client.broadcast(txHex);
    } finally {
      client.close();
    }
  }
  throw new Error(
    `No Bitcoin Cash server answered. Nothing was sent. ${failures.join('; ')}`,
  );
}
