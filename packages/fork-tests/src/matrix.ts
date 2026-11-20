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
import { runForwardFlow, runReverseFlow } from './flows.js';
import { chainConfig, FORK_CHAINS, rpcFor } from './chains.js';
import { deployHtlc } from './contract.js';
import {
  impersonateAccount,
  setBalance,
  setIntervalMining,
  startFork,
  stopImpersonatingAccount,
} from './fork.js';
import { findTokenHolder, setErc20Balance, transferToken } from './token.js';

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
    const detail =
      error && typeof error === 'object' && 'details' in error
        ? String((error as { details?: unknown }).details)
        : error instanceof Error
          ? error.message
          : String(error);
    return { chain, case: name, status: 'fail', detail };
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
    const deployBlock = await publicClient.getBlockNumber();
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
    const tokenPermit = token.permit;
    const amount = 1_000_000n * 10n ** BigInt(decimals);
    let tokenStage = 'finding a token holder';
    try {
      if (chain === 'arc') {
        const holder = await findTokenHolder({
          publicClient,
          token: tokenAddress,
          minimum: amount * 2n,
          lookback: 200n,
        });
        if (!holder) throw new Error('no Arc USDC holder found in recent logs');
        tokenStage = 'impersonating the token holder';
        await impersonateAccount(fork.rpcUrl, holder);
        await setBalance(fork.rpcUrl, holder, GAS);
        try {
          tokenStage = 'transferring USDC to the user';
          await transferToken({
            rpcUrl: fork.rpcUrl,
            publicClient,
            token: tokenAddress,
            from: holder,
            to: user.address,
            amount,
          });
          tokenStage = 'transferring USDC to the solver';
          await transferToken({
            rpcUrl: fork.rpcUrl,
            publicClient,
            token: tokenAddress,
            from: holder,
            to: solverWallet.account!.address,
            amount,
          });
        } finally {
          await stopImpersonatingAccount(fork.rpcUrl, holder).catch(
            () => undefined,
          );
        }
      } else {
        tokenStage = 'setting the user token balance';
        await setErc20Balance({
          rpcUrl: fork.rpcUrl,
          publicClient,
          token: tokenAddress,
          account: user.address,
          amount,
        });
        tokenStage = 'setting the solver token balance';
        await setErc20Balance({
          rpcUrl: fork.rpcUrl,
          publicClient,
          token: tokenAddress,
          account: solverWallet.account!.address,
          amount,
        });
      }
    } catch (error) {
      rows.push({
        chain,
        case: 'token-balance',
        status: 'fail',
        detail: `${tokenStage}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return rows;
    }

    const bch = new FakeBchChain();
    const solverBch = makeBchIdentity(0x52);
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
      tokenPermit,
      solverEvmKey: solverKey,
      bchChain: bch,
      solverBch,
      referenceActions: true,
      deployBlock,
    });

    solver.evmConfirmations.value = 0;
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

      const flowContext = {
        solver,
        chain: bch,
        chainConfig: {
          id: facts.chainId,
          name: facts.name,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [fork.rpcUrl] } },
        },
        publicClient,
        user,
        userWallet,
        solverEvmAddress: solverWallet.account!.address,
        token: tokenAddress,
        tokenDecimals: decimals,
        tokenPermit,
        userBch: makeBchIdentity(0x31),
        solverBch,
      };
      rows.push(
        await runCase(chain, 'forward-swap', () => runForwardFlow(flowContext)),
      );
      rows.push(
        await runCase(chain, 'reverse-swap', () => runReverseFlow(flowContext)),
      );
      for (const [name, detail] of [
        [
          'finality-boundaries',
          'not run within the stop: the real ports are wired, the boundary and reorg assertions are not written',
        ],
        [
          'two-chains-same-lock',
          'not run: the harness starts one fork at a time; two simultaneous forks need a second anvil process',
        ],
        [
          'release-keeper',
          'not run: the early-release and keeper paths are unit-tested in the solver package, not yet driven here',
        ],
        [
          'crash-safety',
          'not run: the restart hook exists, the kill-at-each-step rows are not written',
        ],
        [
          'wallet-amounts',
          'partial: minimum, maximum, wrong token and wrong chain are covered; insufficient balance/allowance, bad permits and rounding are not',
        ],
        [
          'gas',
          'not run: gas spike, replacement and nonce-gap rows are not written',
        ],
      ] as const) {
        rows.push({ chain, case: name, status: 'skip', detail });
      }

      rows.push(
        await runCase(chain, 'relay-lock', async () => {
          if (!orderId || !terms || !hashLock) {
            throw new Error('quote did not produce terms');
          }
          const orderTerms = terms as unknown as OrderTerms;
          if (!tokenPermit) {
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
          return tokenPermit
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
  const requested = process.env['FERRY_FORK_CHAINS']
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const chains = requested?.length
    ? FORK_CHAINS.filter((chain) => requested.includes(chain))
    : FORK_CHAINS;
  const rows: MatrixRow[] = [];
  for (const chain of chains) {
    rows.push(...(await runChain(chain)));
  }
  return rows;
}
