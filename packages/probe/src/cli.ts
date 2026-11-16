#!/usr/bin/env node
import { loadChainConfig } from '@ferry/chain-config';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { formatEvidenceSummary } from './explorers.js';
import {
  createDefaultBchPort,
  createDefaultEvmPort,
  runProbe,
  type BchRpcTransport,
} from './runner.js';
import {
  assertProbeSafety,
  loadProbeKeys,
  parseProbeCliArgs,
} from './safety.js';

export function createJsonRpcBchTransport(rpcUrl: string): BchRpcTransport {
  let nextId = 1;
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    if (!res.ok) {
      throw new Error(`BCH RPC HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (body.error) {
      throw new Error(body.error.message ?? 'BCH RPC error');
    }
    return body.result as T;
  }

  return {
    getTipHeight: () => rpc<number>('blockchain.headers.get_tip_height', []),
    getUtxos: (lockingBytecode) =>
      rpc('blockchain.lockingbytecode.listunspent', [lockingBytecode]),
    broadcast: (txHex) =>
      rpc<string>('blockchain.transaction.broadcast', [txHex]),
  };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const options = parseProbeCliArgs(argv, env);
  assertProbeSafety(options, env);

  const keys = loadProbeKeys(env, {
    network: options.network,
    requireEnvKeys: options.execute,
  });

  const chainConfig = loadChainConfig({ network: options.network });
  const evmConfig = chainConfig.coreChains.find(
    (c) => c.chainId === options.chainId,
  );
  if (!evmConfig) {
    throw new Error(
      `No EVM chain configuration found for chainId ${options.chainId} on ${options.network}`,
    );
  }

  const rpcUrl = env.PROBE_EVM_RPC_URL ?? evmConfig.rpcUrls[0];
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const account = privateKeyToAccount(keys.evmPrivateKey);
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const evmPort = createDefaultEvmPort({
    chainConfig: evmConfig,
    publicClient,
    walletClient,
    userAddress: account.address,
  });

  const bchRpcUrl = env.PROBE_BCH_RPC_URL ?? 'http://127.0.0.1:8800';
  const bchPort = createDefaultBchPort(
    createJsonRpcBchTransport(bchRpcUrl),
    options.network === 'mainnet' ? 'mainnet' : 'chipnet',
  );

  const evidence = await runProbe(options, {
    evmPort,
    bchPort,
    env,
  });

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n\n`);
  process.stdout.write(`${formatEvidenceSummary(evidence)}\n`);
  return 0;
}

/* c8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Probe failed: ${msg}\n`);
    process.exitCode = 1;
  });
}
