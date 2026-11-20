import {
  buildEvmRecoveryCalldata,
  evmLockId,
  parseRecoveryFileJson,
  recoveryActions,
  type EvmRecoveryCalldata,
  type Hex,
  type LockChainStatus,
  type RecoveryChainState,
  type RecoveryFile,
  type RecoveryPlan,
} from '@ferry/core';
import {
  buildBchRecoveryTransaction,
  type BchRecoveryTransactionResult,
  type HtlcUtxo,
} from '@ferry/htlc-bch';
import {
  PREDICTED_FERRY_HTLC_ADDRESS,
  PREVIOUS_FERRY_HTLC_ADDRESS,
} from '@ferry/chain-config';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const DEFAULT_KEY_ENV = 'FERRY_RECOVER_PRIVATE_KEY';

export const KNOWN_FERRY_HTLC_ADDRESSES: readonly Address[] = [
  PREDICTED_FERRY_HTLC_ADDRESS as Address,
  PREVIOUS_FERRY_HTLC_ADDRESS as Address,
];

const STATE_MAP: Record<number, LockChainStatus> = {
  0: 'none',
  1: 'locked',
  2: 'claimed',
  3: 'refunded',
};

export interface EvmChainProbeResult {
  nowSeconds: number;
  lockStatus: LockChainStatus;
  htlcAddress?: Address;
}

export async function probeEvmLockStatus(
  file: RecoveryFile,
  rpcUrl: string,
): Promise<EvmChainProbeResult> {
  const client: PublicClient = createPublicClient({
    transport: http(rpcUrl),
    cacheTime: 0,
  });

  const lockId =
    file.contracts.evm.lockId ??
    evmLockId(
      file.terms.direction === 'EVM_TO_BCH'
        ? file.terms.userEvmAddress
        : file.terms.solverEvmAddress,
      file.hashLock,
    );

  const block = await client.getBlock({ blockTag: 'latest' });
  const candidates: Address[] = [
    ...(file.contracts.evm.htlcAddress
      ? [file.contracts.evm.htlcAddress as Address]
      : []),
    ...KNOWN_FERRY_HTLC_ADDRESSES,
  ].filter(
    (addr, idx, arr) =>
      arr.findIndex((a) => a.toLowerCase() === addr.toLowerCase()) === idx,
  );

  let detectedStatus: LockChainStatus = 'none';
  let resolvedAddress: Address =
    (file.contracts.evm.htlcAddress as Address) ??
    KNOWN_FERRY_HTLC_ADDRESSES[0];

  for (const candidate of candidates) {
    try {
      const lockTuple = await client.readContract({
        address: candidate,
        abi: ferryHtlcAbi,
        functionName: 'locks',
        args: [lockId],
      });
      const rawState = Number(lockTuple[6]);
      const status = STATE_MAP[rawState] ?? 'none';
      if (status !== 'none') {
        detectedStatus = status;
        resolvedAddress = candidate;
        break;
      }
    } catch {
      // ignore read failure for candidate
    }
  }

  return {
    nowSeconds: Number(block.timestamp),
    lockStatus: detectedStatus,
    htlcAddress: resolvedAddress,
  };
}

export function planRecovery(
  file: RecoveryFile,
  chainState: RecoveryChainState,
): RecoveryPlan {
  return recoveryActions(file, chainState);
}

export interface EvmRecoveryExecutionResult {
  mode: 'dry-run' | 'broadcast';
  calldata: EvmRecoveryCalldata;
  txHash?: Hex;
  status?: 'success' | 'reverted';
}

export interface ExecuteEvmRecoveryOptions {
  file: RecoveryFile;
  rpcUrl?: string;
  broadcast?: boolean;
  keyEnv?: string;
  env?: Record<string, string | undefined>;
}

export async function executeEvmRecovery(
  options: ExecuteEvmRecoveryOptions,
): Promise<EvmRecoveryExecutionResult> {
  const calldata = buildEvmRecoveryCalldata(options.file);
  if (!options.broadcast) {
    return {
      mode: 'dry-run',
      calldata,
    };
  }

  if (!options.rpcUrl) {
    throw new Error('EVM broadcast requires an RPC URL (--rpc)');
  }

  const keyEnv = options.keyEnv ?? DEFAULT_KEY_ENV;
  const envSource = options.env ?? process.env;
  const privateKey = envSource[keyEnv];
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      `Missing or invalid 32-byte hex private key in environment variable ${keyEnv}`,
    );
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const publicClient = createPublicClient({
    transport: http(options.rpcUrl),
    cacheTime: 0,
  });

  const chain: Chain = {
    id: calldata.chainId,
    name: `evm-${calldata.chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [options.rpcUrl] } },
  };

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(options.rpcUrl),
  });

  const txHash = await walletClient.sendTransaction({
    account,
    chain,
    to: calldata.to as Address,
    data: calldata.data,
    value: calldata.value,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  return {
    mode: 'broadcast',
    calldata,
    txHash,
    status: receipt.status,
  };
}

export interface ExecuteBchRecoveryOptions {
  file: RecoveryFile;
  utxos: readonly HtlcUtxo[];
  feeSats?: bigint | number;
  locktime?: number;
}

export function executeBchRecovery(
  options: ExecuteBchRecoveryOptions,
): BchRecoveryTransactionResult {
  return buildBchRecoveryTransaction({
    file: options.file,
    utxos: options.utxos,
    ...(options.feeSats !== undefined ? { feeSats: options.feeSats } : {}),
    ...(options.locktime !== undefined ? { locktime: options.locktime } : {}),
  });
}

export function loadRecoveryFileFromJson(json: string): RecoveryFile {
  return parseRecoveryFileJson(json);
}
