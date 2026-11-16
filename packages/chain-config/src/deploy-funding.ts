import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { estimateDeployFunding } from '@ferry/chain-evm';
import { formatEther } from 'viem';
import { CHAIN_IDS, type ChainId } from './schema.js';
import { parseRpcOverrides, redactRpcUrl } from './rpc-overrides.js';
import { makeJsonRpc } from './rpc-client.js';

const DEPLOY_GAS: Record<ChainId, bigint> = {
  base: 804_543n,
  ethereum: 5_520_829n,
  arbitrum: 804_543n,
  arc: 789_951n,
  bnb: 804_543n,
  robinhood: 804_543n,
};

const RELAY_GAS = 700_000n;
const SAFETY_MARGIN_BPS = 2_000;

const NATIVE_GAS: Record<ChainId, string> = {
  base: 'ETH',
  ethereum: 'ETH',
  arbitrum: 'ETH',
  arc: 'USDC',
  bnb: 'BNB',
  robinhood: 'ETH',
};

function roundedNative(wei: bigint): string {
  const value = formatEther(wei);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function gwei(wei: bigint): string {
  return (Number(wei) / 1e9).toFixed(4);
}

export async function runDeployFunding(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const overrides = parseRpcOverrides(env);
  const urls = Object.values(overrides).flatMap((list) => list ?? []);
  const rpc = makeJsonRpc(urls);
  const readAt = new Date().toISOString().slice(0, 10);

  console.log('Deploy and Minimum-tier relay gas (rounded, native units)');
  console.log(
    `Read at: ${readAt}; safety margin: 20%; relay gas: ${RELAY_GAS} per chain`,
  );
  console.log(
    [
      'Chain'.padEnd(10),
      'Native'.padEnd(7),
      'Gas price'.padEnd(12),
      'Deploy gas'.padEnd(11),
      'Deploy native'.padEnd(15),
      'Relay native'.padEnd(15),
      'Total native',
    ].join(' '),
  );
  console.log('-'.repeat(100));

  for (const chain of CHAIN_IDS) {
    const url = overrides[chain]?.[0];
    if (!url) {
      console.log(`${chain.padEnd(10)} no override`);
      continue;
    }
    try {
      const gasPriceWei = BigInt(await rpc<string>(url, 'eth_gasPrice', []));
      const deploy = estimateDeployFunding({
        chain,
        nativeGasSymbol: NATIVE_GAS[chain],
        deployGas: DEPLOY_GAS[chain],
        gasPriceWei,
        safetyMarginBps: SAFETY_MARGIN_BPS,
      });
      const relay = estimateDeployFunding({
        chain,
        nativeGasSymbol: NATIVE_GAS[chain],
        deployGas: RELAY_GAS,
        gasPriceWei,
        safetyMarginBps: SAFETY_MARGIN_BPS,
      });
      const totalWei = deploy.requiredWei + relay.requiredWei;
      console.log(
        [
          chain.padEnd(10),
          NATIVE_GAS[chain].padEnd(7),
          `${gwei(gasPriceWei)} gwei`.padEnd(12),
          DEPLOY_GAS[chain].toString().padEnd(11),
          `${roundedNative(deploy.requiredWei)} ${NATIVE_GAS[chain]}`.padEnd(
            15,
          ),
          `${roundedNative(relay.requiredWei)} ${NATIVE_GAS[chain]}`.padEnd(15),
          `${roundedNative(totalWei)} ${NATIVE_GAS[chain]}`,
        ].join(' '),
      );
    } catch (error) {
      console.log(
        `${chain.padEnd(10)} ${redactRpcUrl(url)} ERROR ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runDeployFunding().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
