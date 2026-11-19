import {
  createPublicClient,
  createWalletClient,
  http,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { evmLockId } from '@ferry/core';
import type { Hex32, OrderTerms } from '@ferry/core';
import { signRelayLockRequest } from '../../e2e/test/harness.js';
import {
  makeBchIdentity,
  startRealEngineSolver,
} from '../../e2e/test/support/real-engine-solver.js';
import { FakeBchChain } from '../../e2e/test/support/fake-bch-chain.js';
import { chainConfig, FORK_CHAINS, rpcFor } from './chains.js';
import { deployHtlc } from './contract.js';
import { setBalance, setIntervalMining, startFork } from './fork.js';
import { setErc20Balance } from './token.js';

export type CaseStatus = 'pass' | 'fail' | 'skip';

export interface MatrixRow {
  chain: string;
  case: string;
  status: CaseStatus;
  detail: string;
}

const GAS = 10n ** 20n;

function price(solver: Awaited<ReturnType<typeof startRealEngineSolver>>) {
  const asOf = Math.floor(Date.now() / 1000);
  for (const asset of ['usdc', 'pusd']) {
    solver.priceSource.setPrice(asset, {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf,
    });
  }
}

async function runCase(
  chain: string,
  name: string,
  operation: () => Promise<string | void>,
): Promise<MatrixRow> {
  try {
    const detail = await operation();
    return { chain, case: name, status: 'pass', detail: detail ?? 'ok' };
  } catch (error) {
    return {
      chain,
      case: name,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runChain(
  chain: (typeof FORK_CHAINS)[number],
): Promise<MatrixRow[]> {
  const rpc = rpcFor(chain);
  if (rpc === null) {
    return [
      {
        chain,
        case: 'chain',
        status: 'skip',
        detail: `set ${chain.toUpperCase()} RPC env name`,
      },
    ];
  }

  if (chain === 'arc') {
    return [
      {
        chain,
        case: 'chain',
        status: 'skip',
        detail:
          'Arc native USDC balance cannot be set through a standard ERC-20 storage slot; manual checklist',
      },
    ];
  }
  const facts = chainConfig().facts.find((item) => item.id === chain);
  if (!facts) {
    return [
      { chain, case: 'chain', status: 'fail', detail: 'missing chain facts' },
    ];
  }
  const token = facts.assets.find((asset) => asset.address !== null);
  if (!token?.address || token.decimals === null) {
    return [
      { chain, case: 'chain', status: 'fail', detail: 'missing token facts' },
    ];
  }

  const rows: MatrixRow[] = [];
  let fork: Awaited<ReturnType<typeof startFork>> | null = null;
  let forkError: unknown = null;
  for (let attempt = 1; attempt <= 3 && fork === null; attempt += 1) {
    try {
      fork = await startFork(facts.chainId, rpc);
    } catch (error) {
      forkError = error;
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (fork === null) {
    return [
      {
        chain,
        case: 'chain',
        status: 'fail',
        detail:
          forkError instanceof Error ? forkError.message : String(forkError),
      },
    ];
  }
  await setIntervalMining(fork.rpcUrl, 1).catch(() => undefined);
  const publicClient: PublicClient = createPublicClient({
    chain: {
      id: facts.chainId,
      name: facts.name,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [fork.rpcUrl] } },
    },
    transport: http(fork.rpcUrl, { timeout: 180_000 }),
    cacheTime: 0,
    pollingInterval: 50,
  });

  try {
    const deployer = privateKeyToAccount(generatePrivateKey());
    const user = privateKeyToAccount(generatePrivateKey());
    const solverKey = generatePrivateKey();
    const userWallet = createWalletClient({
      account: user,
      chain: {
        id: facts.chainId,
        name: facts.name,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [fork.rpcUrl] } },
      },
      transport: http(fork.rpcUrl),
    });
    const solverWallet = createWalletClient({
      account: privateKeyToAccount(solverKey),
      chain: {
        id: facts.chainId,
        name: facts.name,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [fork.rpcUrl] } },
      },
      transport: http(fork.rpcUrl),
    });
    const deployWallet = createWalletClient({
      account: deployer,
      chain: {
        id: facts.chainId,
        name: facts.name,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [fork.rpcUrl] } },
      },
      transport: http(fork.rpcUrl, { timeout: 180_000 }),
    });
    for (const account of [
      deployer.address,
      user.address,
      solverWallet.account!.address,
    ]) {
      await setBalance(fork.rpcUrl, account, GAS);
    }

    let htlc: Address;
    try {
      htlc = await deployHtlc(
        deployWallet,
        publicClient,
        deployer,
        {
          id: facts.chainId,
          name: facts.name,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [fork.rpcUrl] } },
        },
        fork.rpcUrl,
      );
    } catch (error) {
      rows.push({
        chain,
        case: 'deploy',
        status: 'fail',
        detail:
          error instanceof Error
            ? error.message
            : 'deploy failed; run pnpm --filter @ferry/htlc-evm build',
      });
      return rows;
    }

    const tokenAddress = token.address as Address;
    const decimals = token.decimals;
    const amount = 1_000_000n * 10n ** BigInt(decimals);
    try {
      await setErc20Balance({
        rpcUrl: fork.rpcUrl,
        publicClient,
        token: tokenAddress,
        account: user.address,
        amount,
      });
      await setErc20Balance({
        rpcUrl: fork.rpcUrl,
        publicClient,
        token: tokenAddress,
        account: solverWallet.account!.address,
        amount,
      });
    } catch (error) {
      rows.push({
        chain,
        case: 'token-balance',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      });
      return rows;
    }

    const bch = new FakeBchChain();
    const solver = await startRealEngineSolver({
      rpcUrl: fork.rpcUrl,
      chain: {
        id: facts.chainId,
        name: facts.name,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [fork.rpcUrl] } },
      },
      htlcAddress: htlc,
      tokenAddress,
      tokenDecimals: decimals,
      tokenPermit: token.permit,
      solverEvmKey: solverKey,
      bchChain: bch,
      solverBch: makeBchIdentity(0x52),
    });

    try {
      let orderId: Hex32 | null = null;
      let terms: Record<string, unknown> | null = null;
      let hashLock: Hex32 | null = null;
      const secret = sha256(stringToHex(`fork-${chain}-${Date.now()}`));
      hashLock = sha256(secret);

      rows.push(
        await runCase(chain, 'health', async () => {
          const health = await solver.client.health();
          if (!health.ok) throw new Error('solver health was not ok');
        }),
      );

      rows.push(
        await runCase(chain, 'quote', async () => {
          price(solver);
          const quote = await solver.client.quote({
            direction: 'EVM_TO_BCH',
            token: 'PUSD',
            chainId: facts.chainId,
            evmToken: tokenAddress,
            amountIn: 5n * 10n ** BigInt(decimals),
            userEvmAddress: user.address,
            userBchLockingBytecode:
              '0x76a914111111111111111111111111111111111111111188ac',
            hashLock: hashLock!,
            lane: 'safe',
          });
          orderId = quote.orderId as Hex32;
          terms = quote.terms as Record<string, unknown>;
          return `order ${quote.orderId.slice(0, 10)}`;
        }),
      );

      rows.push(
        await runCase(chain, 'relay-lock', async () => {
          if (!orderId || !terms || !hashLock) {
            throw new Error('quote did not produce terms');
          }
          const orderTerms = terms as unknown as OrderTerms;
          if (!token.permit) {
            const unsigned = await solver.evmAdapter.buildUserLock(orderTerms);
            const payload = unsigned.payload as {
              mode: 'approve-lock';
              transactions: Array<{ to: Address; data: Hex; value: bigint }>;
            };
            if (payload.mode !== 'approve-lock') {
              throw new Error(`unexpected payload mode ${payload.mode}`);
            }
            for (const transaction of payload.transactions) {
              const hash = await userWallet.sendTransaction({
                to: transaction.to,
                data: transaction.data,
                value: transaction.value,
                account: user,
                chain: {
                  id: facts.chainId,
                  name: facts.name,
                  nativeCurrency: {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                  },
                  rpcUrls: { default: { http: [fork.rpcUrl] } },
                },
              });
              await publicClient.waitForTransactionReceipt({ hash });
            }
          } else {
            const request = await signRelayLockRequest({
              evmAdapter: solver.evmAdapter,
              orderId,
              terms: orderTerms,
              userAccount: user,
            });
            const response = await solver.client.relayLock(orderId, request, {
              timeoutMs: 60_000,
            });
            if (!response.ok) throw new Error('relay-lock was refused');
          }
          const lock = await solver.evmAdapter.getLock(
            evmLockId(user.address, hashLock),
          );
          if (lock.status !== 'locked') {
            throw new Error(`lock status is ${lock.status}`);
          }
          return token.permit
            ? `lock ${lock.status} (permit)`
            : `lock ${lock.status} (approve)`;
        }),
      );

      rows.push(
        await runCase(chain, 'refusal-minimum', async () => {
          price(solver);
          try {
            await solver.client.quote({
              direction: 'EVM_TO_BCH',
              token: 'PUSD',
              chainId: facts.chainId,
              evmToken: tokenAddress,
              amountIn: 1n,
              userEvmAddress: user.address,
              userBchLockingBytecode:
                '0x76a914111111111111111111111111111111111111111188ac',
              hashLock: sha256(stringToHex(`min-${chain}`)),
              lane: 'safe',
            });
          } catch {
            return 'refused';
          }
          throw new Error('below-minimum quote was accepted');
        }),
      );

      rows.push(
        await runCase(chain, 'refusal-maximum', async () => {
          price(solver);
          try {
            await solver.client.quote({
              direction: 'EVM_TO_BCH',
              token: 'PUSD',
              chainId: facts.chainId,
              evmToken: tokenAddress,
              amountIn: 1_000n * 10n ** BigInt(decimals),
              userEvmAddress: user.address,
              userBchLockingBytecode:
                '0x76a914111111111111111111111111111111111111111188ac',
              hashLock: sha256(stringToHex(`max-${chain}`)),
              lane: 'safe',
            });
          } catch {
            return 'refused';
          }
          throw new Error('above-maximum quote was accepted');
        }),
      );

      rows.push(
        await runCase(chain, 'refusal-wrong-chain', async () => {
          price(solver);
          try {
            await solver.client.quote({
              direction: 'EVM_TO_BCH',
              token: 'PUSD',
              chainId: facts.chainId + 1,
              evmToken: tokenAddress,
              amountIn: 5n * 10n ** BigInt(decimals),
              userEvmAddress: user.address,
              userBchLockingBytecode:
                '0x76a914111111111111111111111111111111111111111188ac',
              hashLock: sha256(stringToHex(`chain-${chain}`)),
              lane: 'safe',
            });
          } catch {
            return 'refused';
          }
          throw new Error('wrong-chain quote was accepted');
        }),
      );

      rows.push(
        await runCase(chain, 'wrong-token', async () => {
          price(solver);
          try {
            await solver.client.quote({
              direction: 'EVM_TO_BCH',
              token: 'PUSD',
              chainId: facts.chainId,
              evmToken: '0x0000000000000000000000000000000000000001',
              amountIn: 5n * 10n ** BigInt(decimals),
              userEvmAddress: user.address,
              userBchLockingBytecode:
                '0x76a914111111111111111111111111111111111111111188ac',
              hashLock: sha256(stringToHex(`token-${chain}`)),
              lane: 'safe',
            });
          } catch {
            return 'refused';
          }
          throw new Error('wrong-token quote was accepted');
        }),
      );
    } finally {
      await solver.stop();
    }
  } finally {
    await fork.stop();
  }
  return rows;
}

export async function runMatrix(): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];
  for (const chain of FORK_CHAINS) {
    rows.push(...(await runChain(chain)));
  }
  return rows;
}
