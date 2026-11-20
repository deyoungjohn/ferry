import { erc20Abi, type Address } from 'viem';
import { createBrowserEvmChain } from '../live/evm-chain';

/** The PUSD and MUSD token categories on Bitcoin Cash mainnet (display order). */
const BCH_CATEGORIES: Readonly<Record<string, string>> = {
  PUSD: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
  MUSD: 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
};

/** A token balance read straight from the chain through a public endpoint. */
async function readEvmTokenBalanceDirect(
  chainId: number,
  token: Address,
  owner: Address,
): Promise<bigint> {
  const { client } = createBrowserEvmChain(chainId);
  return (await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint;
}

/**
 * A token balance in the token's smallest units: from the solver first (its own paid endpoints,
 * so a busy public one does not matter), and from a public endpoint only when the solver does not
 * answer. A refusal by the solver (a 4xx) is an answer, not a reason to fall back.
 */
export async function readEvmTokenBalance(
  chainId: number,
  token: Address,
  owner: Address,
  options: { solverUrl?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<bigint> {
  const fetchFn = options.fetchFn ?? fetch;
  if (options.solverUrl) {
    let res: Response | null = null;
    try {
      const url = `${options.solverUrl.replace(/\/+$/, '')}/v1/evm/balance?chainId=${chainId}&token=${token}&owner=${owner}`;
      res = await fetchFn(url);
    } catch {
      // A network error: read the chain directly below.
    }
    if (res) {
      if (res.ok) {
        try {
          const body = (await res.json()) as { balance?: string };
          if (typeof body.balance === 'string' && /^\d+$/.test(body.balance)) {
            return BigInt(body.balance);
          }
        } catch {
          // An unreadable answer: read the chain directly below.
        }
      } else if (res.status < 500) {
        // The solver's answer (a refusal), not a reason to fall back.
        throw new Error(
          `The Ferry server refused the balance read (${res.status}).`,
        );
      }
    }
  }
  return readEvmTokenBalanceDirect(chainId, token, owner);
}

interface TokenUtxo {
  readonly token?: { readonly category: string; readonly amount: bigint };
}

/**
 * The PUSD or MUSD a Bitcoin Cash wallet holds: the token amount of every unspent output at its
 * addresses (outputs that hold the token's category), in cents.
 */
export async function readBchTokenBalance(
  symbol: string,
  lockingBytecodes: readonly string[],
  getUtxos: (bytecode: string) => Promise<readonly TokenUtxo[]>,
): Promise<bigint> {
  const category = BCH_CATEGORIES[symbol.replace(/^t/i, '').toUpperCase()];
  if (!category) return 0n;
  let total = 0n;
  for (const bytecode of lockingBytecodes) {
    for (const utxo of await getUtxos(bytecode)) {
      if (utxo.token?.category.toLowerCase().replace(/^0x/, '') === category) {
        total += utxo.token.amount;
      }
    }
  }
  return total;
}

/** The amount for a share of the balance: 25, 50, 75 or 100 percent, rounded down. */
export function shareOfBalance(balance: bigint, percent: number): bigint {
  return (balance * BigInt(Math.round(percent))) / 100n;
}

/** The nearest of the marks (0, 25, 50, 75, 100) when the slider is within a few percent of one. */
export function snapPercent(percent: number): number {
  for (const mark of [0, 25, 50, 75, 100]) {
    if (Math.abs(percent - mark) <= 2.5) return mark;
  }
  return Math.round(percent);
}
