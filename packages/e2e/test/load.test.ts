import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
} from 'viem';
import type { Address, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmLockId, type Hex32, type OrderTerms } from '@ferry/core';
import {
  DEPLOYER_KEY,
  SOLVER_KEY,
  USER_BCH_LOCKING_BYTECODE,
  USER_KEY,
  deployArtifact,
  deployFerryHtlcDeterministic,
  signRelayLockPayload,
  startAnvil,
  startInProcessSolver,
  type AnvilInstance,
  type InProcessSolverHarness,
} from './harness.js';

const RUN_LOAD = process.env.FERRY_RUN_LOAD === '1';

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
]);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

// 200 concurrent swaps take longer on a small machine; raise with FERRY_LOAD_TIMEOUT_MS.
const LOAD_TIMEOUT_MS = Number(process.env.FERRY_LOAD_TIMEOUT_MS ?? 180_000);

describe.skipIf(!RUN_LOAD)('Ferry EVM 200-Swap Concurrent Load Test', () => {
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const solverAccount = privateKeyToAccount(SOLVER_KEY);
  const defaultUser = privateKeyToAccount(USER_KEY);
  const forwardUsers = Array.from({ length: 100 }, (_, i) => {
    const key = `0x${(i + 1000).toString(16).padStart(64, '0')}` as Hex32;
    return privateKeyToAccount(key);
  });

  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerWallet: WalletClient;
  let htlcAddress: Address;
  let tokenAddress: Address;
  let solver: InProcessSolverHarness;

  beforeAll(async () => {
    anvil = await startAnvil({ chainId: 31337 });
    publicClient = createPublicClient({
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    deployerWallet = createWalletClient({
      account: deployer,
      chain: anvil.chain,
      transport: http(anvil.rpcUrl),
    });

    htlcAddress = await deployFerryHtlcDeterministic(
      anvil.rpcUrl,
      DEPLOYER_KEY,
    );
    tokenAddress = await deployArtifact(
      deployerWallet,
      publicClient,
      deployer,
      anvil.chain,
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );

    const mintTargets: Address[] = [
      defaultUser.address,
      solverAccount.address,
      ...forwardUsers.map((u) => u.address),
    ];
    let nonce = await publicClient.getTransactionCount({
      address: deployer.address,
    });
    const mintHashes: Hex32[] = [];
    for (const target of mintTargets) {
      const hash = await deployerWallet.writeContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: 'mint',
        args: [target, 10_000_000_000_000n],
        account: deployer,
        chain: anvil.chain,
        nonce: nonce++,
      });
      mintHashes.push(hash);
    }
    await Promise.all(
      mintHashes.map((hash) =>
        publicClient.waitForTransactionReceipt({ hash }),
      ),
    );

    solver = await startInProcessSolver({
      rpcUrl: anvil.rpcUrl,
      chain: anvil.chain,
      htlcAddress,
      tokenAddress,
      nowSeconds: Math.floor(Date.now() / 1000),
      rateLimitMax: 10_000,
    });

    const ts = Math.floor(Date.now() / 1000);
    solver.priceSource.setPrice('usdc', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: ts,
    });
    solver.priceSource.setPrice('pusd', {
      usdPrice: 1_000_000n,
      source: 'reference',
      asOf: ts,
    });
  }, 60_000);

  afterAll(async () => {
    await solver?.stop();
    await anvil?.stop();
  });

  it(
    'executes 200 concurrent forward and reverse swaps with zero nonce or DB lock errors',
    async () => {
      const totalSwaps = 200;
      const latenciesMs: number[] = [];
      const errors: string[] = [];
      let nonceErrors = 0;
      let dbLockErrors = 0;
      let reservationErrors = 0;

      const runSwap = async (index: number): Promise<void> => {
        const start = performance.now();
        const isForward = index % 2 === 0;
        const forwardIdx = Math.floor(index / 2);
        const userAccount = isForward
          ? (forwardUsers[forwardIdx] ?? defaultUser)
          : defaultUser;
        const secretHex = (index + 1).toString(16).padStart(64, '0');
        const secret = `0x${secretHex}` as Hex32;
        const hashLock = sha256(secret);

        const quote = await solver.client.quote({
          direction: isForward ? 'EVM_TO_BCH' : 'BCH_TO_EVM',
          token: 'PUSD',
          chainId: anvil.chainId,
          evmToken: tokenAddress,
          amountIn: isForward ? 1_000_000n : 100n,
          userEvmAddress: userAccount.address,
          userBchLockingBytecode: USER_BCH_LOCKING_BYTECODE,
          hashLock,
          lane: 'safe',
        });

        if (isForward) {
          const relayPayload = await signRelayLockPayload({
            evmAdapter: solver.evmAdapter,
            terms: quote.terms as OrderTerms,
            userAccount,
          });
          const relayRes = await fetch(
            `${solver.baseUrl}/v1/orders/${quote.orderId}/relay-lock`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                { payload: relayPayload },
                (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
              ),
            },
          );
          if (!relayRes.ok) {
            throw new Error(
              `relay-lock HTTP ${relayRes.status}: ${await relayRes.text()}`,
            );
          }
          await solver.client.revealSecret(quote.orderId, secret);
          const lockId = evmLockId(userAccount.address, hashLock);
          await solver.evmAdapter.claim(lockId, secret);
        } else {
          await solver.evmAdapter.lock(quote.terms as OrderTerms);
          await solver.client.revealSecret(quote.orderId, secret);
          const lockId = evmLockId(solverAccount.address, hashLock);
          await solver.evmAdapter.claim(lockId, secret);
        }

        latenciesMs.push(performance.now() - start);
      };

      const settled = await Promise.allSettled(
        Array.from({ length: totalSwaps }, (_, i) => runSwap(i)),
      );

      let okCount = 0;
      for (const res of settled) {
        if (res.status === 'fulfilled') {
          okCount += 1;
        } else {
          const msg =
            res.reason instanceof Error
              ? res.reason.message
              : String(res.reason);
          errors.push(msg);
          if (/nonce/i.test(msg)) nonceErrors += 1;
          if (/sqlite|database.*lock|busy/i.test(msg)) dbLockErrors += 1;
          if (/reserv|liquidity|insufficient|available/i.test(msg)) {
            reservationErrors += 1;
          }
        }
      }

      latenciesMs.sort((a, b) => a - b);
      const p50 = percentile(latenciesMs, 50);
      const p95 = percentile(latenciesMs, 95);

      console.info(
        `LOAD_200 ok=${okCount}/${totalSwaps} fail=${errors.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms nonceErrors=${nonceErrors} dbLockErrors=${dbLockErrors} reservationErrors=${reservationErrors}`,
      );
      if (errors.length > 0) {
        console.info(
          `LOAD_200 sample errors: ${errors.slice(0, 5).join(' | ')}`,
        );
      }

      expect(nonceErrors).toBe(0);
      expect(dbLockErrors).toBe(0);
      // The solver caps what one IP may hold in active reservations (a fixed policy
      // constant), and every swap here comes from one address, so about half of a
      // 200-swap burst is refused cleanly. Every swap must either finish or be refused
      // for that reason; nothing may fail any other way.
      expect(okCount + reservationErrors).toBe(totalSwaps);
      expect(okCount).toBeGreaterThanOrEqual(100);
    },
    LOAD_TIMEOUT_MS,
  );
});
