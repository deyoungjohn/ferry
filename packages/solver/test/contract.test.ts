import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { runContractSuite } from '@ferry/solver-client/testing';
import {
  evmLockId,
  type EvmAssetConfig,
  type Hex32,
  type LockState,
} from '@ferry/core';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import { buildServer } from '../src/api/server.js';
import { SolverDatabase } from '../src/db/database.js';
import { loadConfigFromEnv } from '../src/config.js';
import { SolverEngine } from '../src/engine/runner.js';
import type { BchQuorumClient } from '../src/bch/quorum-client.js';
import { MockPriceSource } from '../src/pricing/price-source.js';

describe('Contract Suite (@ferry/solver-client contract runner)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let db: SolverDatabase;

  const solverEvmKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const solverAccount = privateKeyToAccount(solverEvmKey);
  const bearerToken = 'contract-suite-operator-token-32b';

  beforeAll(async () => {
    db = new SolverDatabase(':memory:');

    const expiredOrderId =
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const now = Math.floor(Date.now() / 1000);
    db.saveOrder({
      id: expiredOrderId,
      direction: 'EVM_TO_BCH',
      status: 'EXPIRED',
      userCounterAddress: '0x1111111111111111111111111111111111111111',
      lockId: expiredOrderId,
      termsJson: JSON.stringify(
        {
          version: 1,
          direction: 'EVM_TO_BCH',
          bchToken: 'PUSD',
          bchTokenCategory: '0x' + '00'.repeat(32),
          evmToken: '0x2222222222222222222222222222222222222222',
          evmChainId: 84532,
          evmHtlc: '0x3333333333333333333333333333333333333333',
          userEvmAddress: '0x1111111111111111111111111111111111111111',
          userBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          solverEvmAddress: solverAccount.address,
          solverBchLockingBytecode:
            '0x76a914000000000000000000000000000000000000000088ac',
          hashLock:
            '0xabababababababababababababababababababababababababababababababab',
          evmDeadline: now - 3600,
          bchRefundHeight: 320000,
          bchCarrySats: 1000,
          bchMaxFee: 500,
          bchTokenAmount: 1000000n,
          evmAmount: 1000000n,
          quoteId: 'quote-expired',
          quoteExpiry: now - 3600,
          pricing: {
            refs: [],
            spreadBps: 40,
            fixedFeeBase: 0n,
            rounding: 'floor',
          },
        },
        (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v),
      ),
      hashLock:
        '0xabababababababababababababababababababababababababababababababab',
      lane: 'safe',
      fastOptIn: false,
      firstSeenAtMs: (now - 3600) * 1000,
      needsAttention: false,
      createdAt: now - 3600,
      updatedAt: now - 3600,
    });

    const fakeBchClient = {
      getQuorumStatus: () => ({
        quorumTip: 330000,
        tips: { 'wss://mock1': 330000, 'wss://mock2': 330000 },
        isQuorumHealthy: true,
        isLivenessHealthy: true,
        ageSeconds: 15,
        lastConfirmedAt: Math.floor(Date.now() / 1000) - 15,
      }),
      listUnspent: async () => [
        {
          height: 330000,
          tx_hash: '11'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
            amount: '100000000',
          },
        },
        {
          height: 330000,
          tx_hash: '22'.repeat(32),
          tx_pos: 0,
          value: 100000,
          token_data: {
            category:
              'c99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
            amount: '100000000',
          },
        },
      ],
      getHistory: async () => [],
      broadcast: async () => '0xmock-bch-broadcast',
      subscribeScriptHash: async () => {},
      unsubscribeScriptHash: async () => {},
      close: () => {},
    } as unknown as BchQuorumClient;

    const mockAsset: EvmAssetConfig = {
      symbol: 'USDC',
      decimals: 6,
      address: '0x1111111111111111111111111111111111111111',
      permit: false,
    };
    const knownLocks = new Map<string, LockState>();
    const fakeEvmAdapter = {
      id: 'base',
      address: solverAccount.address,
      getTokenBalance: async () => 100_000_000_000n,
      getNativeBalance: async () => 10_000_000_000_000_000_000n,
      getTip: async () => ({
        height: 1234567,
        ageSeconds: 5,
        stale: false,
      }),
      getLock: async (lockId: string) => {
        return (
          knownLocks.get(lockId.toLowerCase()) ?? { status: 'absent' as const }
        );
      },
      isFinal: async () => true,
      relayLock: async (input: {
        chain: string;
        orderId: `0x${string}`;
        payload: Parameters<EvmChainAdapter['relayLock']>[0]['payload'];
      }) => {
        const txId = ('0x' + 'aa'.repeat(32)) as Hex32;
        const order = db.getOrder(input.orderId);
        const lockId = order?.lockId ?? input.orderId;
        const payload = input.payload as unknown as Record<string, unknown>;
        const innerPayload =
          (payload?.payload as Record<string, unknown> | undefined) ?? payload;
        const owner =
          (innerPayload?.owner as `0x${string}` | undefined) ??
          ((innerPayload?.intent as Record<string, unknown> | undefined)
            ?.owner as `0x${string}` | undefined) ??
          (order?.userCounterAddress as `0x${string}` | undefined) ??
          solverAccount.address;
        const hashLock =
          (innerPayload?.hashLock as Hex32 | undefined) ??
          (order?.hashLock as Hex32 | undefined) ??
          (('0x' + '00'.repeat(32)) as Hex32);

        const derivedId = evmLockId(owner, hashLock);
        const lockState: LockState = {
          status: 'locked' as const,
          owner,
          recipient:
            (innerPayload?.recipient as `0x${string}` | undefined) ??
            solverAccount.address,
          asset: mockAsset,
          amount: BigInt(String(innerPayload?.amount ?? 1000000)),
          hashLock,
          deadline: Math.floor(Date.now() / 1000) + 7200,
          lockTx: { chain: 'base', txId },
        };
        knownLocks.set(lockId.toLowerCase(), lockState);
        knownLocks.set(derivedId.toLowerCase(), lockState);
        return {
          chain: 'base' as const,
          txId,
        };
      },
      claim: async (lockId: string, secret: Hex32) => {
        const lock = knownLocks.get(lockId.toLowerCase());
        if (!lock || lock.status === 'absent') {
          throw new Error(`Lock ${lockId} is absent`);
        }
        const claimTxId = ('0x' + 'bb'.repeat(32)) as Hex32;
        if (lock.status === 'locked' || lock.status === 'claimed') {
          knownLocks.set(lockId.toLowerCase(), {
            ...lock,
            status: 'claimed' as const,
            claimTx: { chain: 'base', txId: claimTxId },
            secret,
          });
        }
        return {
          chain: 'base' as const,
          txId: claimTxId,
        };
      },
      refund: async (lockId: string) => {
        const lock = knownLocks.get(lockId.toLowerCase());
        if (!lock || lock.status === 'absent') {
          throw new Error(`Lock ${lockId} is absent`);
        }
        const refundTxId = ('0x' + 'cc'.repeat(32)) as Hex32;
        if (lock.status === 'locked' || lock.status === 'refunded') {
          knownLocks.set(lockId.toLowerCase(), {
            ...lock,
            status: 'refunded' as const,
            refundTx: { chain: 'base', txId: refundTxId },
          });
        }
        return {
          chain: 'base' as const,
          txId: refundTxId,
        };
      },
    } as unknown as EvmChainAdapter;

    const engine = {
      isQuotingEnabled: () => true,
      start: async () => {},
      stop: () => {},
    } as unknown as SolverEngine;

    const priceSource = new MockPriceSource();
    priceSource.setPrice('USDC', {
      usdPrice: 1_000_000n,
      source: 'chainlink',
      asOf: now,
    });
    priceSource.setPrice('PUSD', {
      usdPrice: 1_000_000n,
      source: 'cauldron',
      asOf: now,
    });
    priceSource.setPrice('MUSD', {
      usdPrice: 1_000_000n,
      source: 'cauldron',
      asOf: now,
    });

    const config = loadConfigFromEnv({
      NETWORK: 'testnet',
      HOST: '127.0.0.1',
      PORT: '0',
      SOLVER_EVM_PRIVATE_KEY: solverEvmKey,
      OPERATOR_TOKEN: bearerToken,
      ALLOW_DEV_KEYS: '1',
      ALLOW_MOCK_PAYLINK_SIGNATURES: '1',
      BCH_ELECTRUM_URLS: 'wss://mock1.electrum:50004',
      BASE_CHAIN_ID: '84532',
      BASE_RPC_URL: 'http://127.0.0.1:8545',
      BASE_HTLC_ADDRESS: '0x3333333333333333333333333333333333333333',
      BASE_USDC_ADDRESS: '0x2222222222222222222222222222222222222222',
      BCH_TMUSD_CATEGORY:
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      BCH_TPUSD_CATEGORY:
        '0x0000000000000000000000000000000000000000000000000000000000000002',
    });

    app = buildServer({
      config,
      db,
      evmAdapter: fakeEvmAdapter,
      bchClient: fakeBchClient,
      engine,
      priceSource,
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('passes runContractSuite against the in-process solver', async () => {
    const report = await runContractSuite(baseUrl, {
      bearerToken,
    });

    if (!report.ok) {
      const failures = report.results.filter((r) => !r.ok);
      console.error(
        'Contract suite failures:',
        JSON.stringify(failures, null, 2),
      );
    }

    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThan(0);
  });
});
