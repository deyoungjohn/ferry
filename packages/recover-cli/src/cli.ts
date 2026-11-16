import { readFileSync } from 'node:fs';
import { type LockChainStatus, type RecoveryChainState } from '@ferry/core';
import { type HtlcUtxo } from '@ferry/htlc-bch';
import {
  DEFAULT_KEY_ENV,
  executeBchRecovery,
  executeEvmRecovery,
  loadRecoveryFileFromJson,
  planRecovery,
  probeEvmLockStatus,
} from './recover.js';

export interface ParsedCliArgs {
  filePath: string;
  rpcUrl?: string;
  broadcast: boolean;
  keyEnv: string;
  evmState?: LockChainStatus;
  bchState?: LockChainStatus;
  bchTipHeight: number;
  nowSeconds?: number;
  bchUtxosPath?: string;
  feeSats?: bigint;
  locktime?: number;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  let filePath: string | undefined;
  let rpcUrl: string | undefined;
  let broadcast = false;
  let keyEnv = DEFAULT_KEY_ENV;
  let evmState: LockChainStatus | undefined;
  let bchState: LockChainStatus | undefined;
  let bchTipHeight = 0;
  let nowSeconds: number | undefined;
  let bchUtxosPath: string | undefined;
  let feeSats: bigint | undefined;
  let locktime: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--rpc') {
      rpcUrl = argv[++i];
    } else if (arg === '--broadcast') {
      broadcast = true;
    } else if (arg === '--key-env') {
      keyEnv = argv[++i] ?? DEFAULT_KEY_ENV;
    } else if (arg === '--evm-state') {
      evmState = argv[++i] as LockChainStatus;
    } else if (arg === '--bch-state') {
      bchState = argv[++i] as LockChainStatus;
    } else if (arg === '--bch-tip') {
      bchTipHeight = Number(argv[++i]);
    } else if (arg === '--now') {
      nowSeconds = Number(argv[++i]);
    } else if (arg === '--bch-utxos') {
      bchUtxosPath = argv[++i];
    } else if (arg === '--fee-sats') {
      feeSats = BigInt(argv[++i]!);
    } else if (arg === '--locktime') {
      locktime = Number(argv[++i]);
    } else if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    }
  }

  if (!filePath) {
    throw new Error(
      'Usage: ferry-recover <recovery-file.json> [--rpc <url>] [--broadcast] [--key-env <VAR>] [--bch-tip <height>] [--bch-utxos <utxos.json>]',
    );
  }

  return {
    filePath,
    ...(rpcUrl !== undefined ? { rpcUrl } : {}),
    broadcast,
    keyEnv,
    ...(evmState !== undefined ? { evmState } : {}),
    ...(bchState !== undefined ? { bchState } : {}),
    bchTipHeight,
    ...(nowSeconds !== undefined ? { nowSeconds } : {}),
    ...(bchUtxosPath !== undefined ? { bchUtxosPath } : {}),
    ...(feeSats !== undefined ? { feeSats } : {}),
    ...(locktime !== undefined ? { locktime } : {}),
  };
}

export async function runRecoverCli(
  argv: readonly string[],
  io: { log: (line: string) => void } = console,
): Promise<void> {
  const args = parseCliArgs(argv);
  const rawJson = readFileSync(args.filePath, 'utf8');
  const file = loadRecoveryFileFromJson(rawJson);

  let resolvedEvmState: LockChainStatus = args.evmState ?? 'none';
  let resolvedNow = args.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (args.rpcUrl && args.evmState === undefined) {
    const probe = await probeEvmLockStatus(file, args.rpcUrl);
    resolvedEvmState = probe.lockStatus;
    if (args.nowSeconds === undefined) {
      resolvedNow = probe.nowSeconds;
    }
  }

  const chainState: RecoveryChainState = {
    nowSeconds: resolvedNow,
    bchTipHeight: args.bchTipHeight,
    evmLock: { state: resolvedEvmState },
    bchLock: { state: args.bchState ?? 'none' },
  };

  const plan = planRecovery(file, chainState);
  io.log(`Order: ${file.orderId}`);
  io.log(`Direction: ${plan.direction}`);
  io.log(`Summary: ${plan.summary}`);
  for (const wait of plan.waits) {
    io.log(`Wait [${wait.chain} ${wait.action}]: ${wait.waitingFor}`);
  }
  for (const action of plan.actions) {
    io.log(`Ready [${action.chain} ${action.action}]`);
  }

  const evmReady = plan.actions.some((a) => a.chain === 'EVM');
  if (evmReady) {
    const evmResult = await executeEvmRecovery({
      file,
      ...(args.rpcUrl !== undefined ? { rpcUrl: args.rpcUrl } : {}),
      broadcast: args.broadcast,
      keyEnv: args.keyEnv,
    });
    io.log(
      JSON.stringify(
        {
          chain: 'EVM',
          mode: evmResult.mode,
          action: evmResult.calldata.action,
          chainId: evmResult.calldata.chainId,
          to: evmResult.calldata.to,
          data: evmResult.calldata.data,
          value: evmResult.calldata.value.toString(),
          lockId: evmResult.calldata.lockId,
          ...(evmResult.txHash !== undefined
            ? { txHash: evmResult.txHash, status: evmResult.status }
            : {}),
        },
        null,
        2,
      ),
    );
  }

  const bchReady = plan.actions.some((a) => a.chain === 'BCH');
  if (bchReady && args.bchUtxosPath) {
    const utxosRaw = JSON.parse(
      readFileSync(args.bchUtxosPath, 'utf8'),
    ) as HtlcUtxo[];
    const bchResult = executeBchRecovery({
      file,
      utxos: utxosRaw,
      ...(args.feeSats !== undefined ? { feeSats: args.feeSats } : {}),
      ...(args.locktime !== undefined ? { locktime: args.locktime } : {}),
    });
    io.log(
      JSON.stringify(
        {
          chain: 'BCH',
          action: bchResult.action,
          txid: bchResult.txid,
          txHex: bchResult.txHex,
        },
        null,
        2,
      ),
    );
  }
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('cli.ts');

if (isMain) {
  runRecoverCli(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
