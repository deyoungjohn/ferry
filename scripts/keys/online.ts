import {
  classifyAccountCode,
  type AccountCodeKind,
} from '../../packages/chain-config/src/key-material.js';
import type {
  ChainConfig,
  ChainFactView,
} from '../../packages/chain-config/src/config.js';
import { ethGetCode } from '../../packages/chain-config/src/evm-read.js';
import { makeJsonRpc } from '../../packages/chain-config/src/rpc-client.js';
import type { RpcEndpointView } from '../../packages/chain-config/src/rpc-overrides.js';

export interface OnlineCodeCheck {
  name: string;
  ok: boolean;
  detail: string | null;
}

export type CodeReader = (
  chain: ChainFactView,
  address: string,
  endpoint: RpcEndpointView,
) => Promise<string>;

async function defaultCodeReader(
  chain: ChainFactView,
  address: string,
  endpoint: RpcEndpointView,
): Promise<string> {
  if (chain.rpcEndpoints.length === 0) throw new Error('no RPC endpoints');
  const caller = makeJsonRpc([endpoint.url], { attempts: 2 });
  return ethGetCode(caller, endpoint.url, address);
}

function codeCheck(name: string, kind: AccountCodeKind): OnlineCodeCheck {
  if (kind === 'empty') return { name, ok: true, detail: null };
  if (kind === 'delegated') {
    return { name, ok: false, detail: 'EIP-7702 delegation' };
  }
  return { name, ok: false, detail: 'account has code' };
}

export async function checkOnlineCodes(
  config: ChainConfig,
  addresses: { deployerEvm: string; solverEvm: string },
  read: CodeReader = defaultCodeReader,
): Promise<OnlineCodeCheck[]> {
  if (config.facts.length === 0) {
    return [
      {
        name: 'online configured chains',
        ok: false,
        detail: 'no configured chains',
      },
    ];
  }

  const checks: OnlineCodeCheck[] = [];
  for (const chain of config.facts) {
    for (const [role, address] of [
      ['deployer', addresses.deployerEvm],
      ['solver', addresses.solverEvm],
    ] as const) {
      const name = `online ${chain.id} ${role}`;
      const hosts = chain.rpcEndpoints.map((endpoint) => endpoint.host);
      let handled = false;
      for (const endpoint of chain.rpcEndpoints) {
        try {
          const code = await read(chain, address, endpoint);
          checks.push(codeCheck(name, classifyAccountCode(code)));
          handled = true;
          break;
        } catch {
          // Try the next configured endpoint.
        }
      }
      if (!handled) {
        checks.push({
          name,
          ok: false,
          detail: `RPC read failed (${hosts.join(', ') || 'no endpoints'})`,
        });
      }
    }
  }
  return checks;
}
