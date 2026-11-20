import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { evmLockId, parseEvmChainConfig, parseOrderTerms } from '@ferry/core';
import type {
  ChainAdapter,
  EvmChainConfig,
  Hex32,
  LockEvent,
  OrderTerms,
} from '@ferry/core';
import {
  ChainMismatchError,
  EvmChainAdapter,
  InvalidSecretError,
  RelayLockRejectedError,
  RelayLockTransportError,
  SendQueue,
  UnsupportedAssetError,
  fetchLogsChunked,
} from '../src/index.js';
import type { AnvilInstance } from './anvil.js';
import { loadForgeArtifact, startAnvil } from './anvil.js';

const deployerAccount = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const solverAccount = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const userAccount = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
);

const mockTokenAbi = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external',
]);

describe('EvmChainAdapter', () => {
  let anvil: AnvilInstance;
  let publicClient: PublicClient;
  let deployerClient: WalletClient;
  let solverClient: WalletClient;
  let userClient: WalletClient;

  let htlcAddress: Address;
  let usdcAddress: Address;
  let token18Address: Address;
  let usdtNoReturnAddress: Address;
  let chainConfig: EvmChainConfig;
  let adapter: EvmChainAdapter;

  beforeAll(async () => {
    anvil = await startAnvil();
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(anvil.rpcUrl),
      cacheTime: 0,
    });
    deployerClient = createWalletClient({
      account: deployerAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    solverClient = createWalletClient({
      account: solverAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    userClient = createWalletClient({
      account: userAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });

    const deployContract = async (
      artifactPath: string,
      args: readonly unknown[] = [],
    ): Promise<Address> => {
      const artifact = loadForgeArtifact(artifactPath);
      const hash = await deployerClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [...args],
        account: deployerAccount,
        chain: foundry,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) {
        throw new Error(`Missing contractAddress for ${artifactPath}`);
      }
      return receipt.contractAddress;
    };

    htlcAddress = await deployContract('FerryHTLC.sol/FerryHTLC.json');
    usdcAddress = await deployContract(
      'MockUSDCWithPermit.sol/MockUSDCWithPermit.json',
    );
    token18Address = await deployContract('MockERC20.sol/MockERC20.json', [
      'Mock 18',
      'M18',
      18,
    ]);
    usdtNoReturnAddress = await deployContract(
      'MockNoReturnToken.sol/MockNoReturnToken.json',
      ['Tether USD', 'USDT', 6],
    );

    const mint = async (token: Address, to: Address, amount: bigint) => {
      const hash = await deployerClient.writeContract({
        address: token,
        abi: mockTokenAbi,
        functionName: 'mint',
        args: [to, amount],
        account: deployerAccount,
        chain: foundry,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    };

    await mint(usdcAddress, userAccount.address, 1_000_000_000n);
    await mint(usdcAddress, solverAccount.address, 1_000_000_000n);
    await mint(token18Address, solverAccount.address, 1_000n * 10n ** 18n);
    await mint(usdtNoReturnAddress, solverAccount.address, 1_000_000_000n);

    chainConfig = parseEvmChainConfig({
      id: 'base',
      chainId: foundry.id,
      rpcUrls: [anvil.rpcUrl],
      explorerUrl: 'https://basescan.org',
      htlcAddress,
      nativeGas: 'ETH',
      finality: { fast: 2, safe: 'finalized' },
      assets: [
        { symbol: 'USDC', decimals: 6, address: usdcAddress, permit: true },
        {
          symbol: 'USDC',
          decimals: 18,
          address: token18Address,
          permit: false,
        },
        {
          symbol: 'USDT',
          decimals: 6,
          address: usdtNoReturnAddress,
          permit: false,
        },
      ],
      relayCostUsd: 0.02,
    });

    adapter = new EvmChainAdapter({
      config: chainConfig,
      client: publicClient,
      walletClient: solverClient,
      pollIntervalMs: 150,
    });
  });

  afterAll(async () => {
    if (anvil) {
      await anvil.stop();
    }
  });

  function makeTerms(
    secretLabel: string,
    overrides: Partial<OrderTerms> = {},
  ): OrderTerms {
    const secret = sha256(stringToHex(secretLabel));
    const hashLock = sha256(secret);
    const now = Math.floor(Date.now() / 1000);
    return parseOrderTerms({
      version: 1,
      direction: 'EVM_TO_BCH',
      bchToken: 'PUSD',
      bchTokenCategory: `0x${'aa'.repeat(32)}`,
      bchTokenAmount: 2500n,
      evmAmount: 25_000_000n,
      evmToken: usdcAddress,
      evmChainId: foundry.id,
      evmHtlc: htlcAddress,
      userEvmAddress: userAccount.address,
      userBchLockingBytecode:
        '0x76a91400112233445566778899aabbccddeeff0011223388ac',
      solverEvmAddress: solverAccount.address,
      solverBchLockingBytecode:
        '0x76a91433221100ffeeddccbbaa9988776655443322110088ac',
      hashLock,
      evmDeadline: now + 3600,
      bchRefundHeight: 200_000,
      bchCarrySats: 2000n,
      bchMaxFee: 1000n,
      quoteId: `q-${secretLabel}`,
      quoteExpiry: now + 600,
      pricing: {
        refs: [
          {
            asset: 'USDC',
            usdPrice: '1.00',
            source: 'test-fixture',
            asOf: now,
          },
        ],
        spreadBps: 25,
        fixedFeeBase: 0n,
        rounding: 'floor',
      },
      ...overrides,
    });
  }

  it('satisfies ChainAdapter interface and fails closed on invalid config or unconfigured assets', async () => {
    const checked: ChainAdapter = adapter;
    expect(checked.id).toBe('base');
    expect(checked.assets).toHaveLength(3);
    expect(await checked.estimateRelayCostUsd()).toBe(0.02);

    expect(
      () =>
        new EvmChainAdapter({
          config: {
            ...chainConfig,
            htlcAddress: `0x${'00'.repeat(20)}`,
          },
        }),
    ).toThrow();

    const unknownTokenTerms = makeTerms('unknown-token', {
      evmToken: `0x${'99'.repeat(20)}` as Address,
    });
    await expect(
      adapter.buildUserLock(unknownTokenTerms),
    ).rejects.toBeInstanceOf(UnsupportedAssetError);

    const wrongChainTerms = makeTerms('wrong-chain', { evmChainId: 1 });
    await expect(adapter.lock(wrongChainTerms)).rejects.toBeInstanceOf(
      ChainMismatchError,
    );
  });

  it('runs permit-intent buildUserLock, relayLock, getLock, and claim on anvil', async () => {
    const secretLabel = 'permit-flow-1';
    const secret = sha256(stringToHex(secretLabel));
    const terms = makeTerms(secretLabel);
    const unsigned = await adapter.buildUserLock(terms);
    const payload = unsigned.payload as {
      mode: string;
      lockIntentTypedData: Parameters<WalletClient['signTypedData']>[0];
      permitTypedData: Parameters<WalletClient['signTypedData']>[0];
    };
    expect(payload.mode).toBe('permit-intent');

    const intentSig = await userClient.signTypedData({
      ...payload.lockIntentTypedData,
      account: userAccount,
    });
    const permitSig = await userClient.signTypedData({
      ...payload.permitTypedData,
      account: userAccount,
    });
    const r = `0x${permitSig.slice(2, 66)}` as Hex32;
    const s = `0x${permitSig.slice(66, 130)}` as Hex32;
    const v = Number.parseInt(permitSig.slice(130, 132), 16);

    const intentMessage = payload.lockIntentTypedData.message as {
      deadline: bigint;
      intentDeadline: bigint;
    };

    const lockTx = await adapter.relayLock({
      chain: 'base',
      orderId: unsigned.orderId,
      payload: {
        owner: userAccount.address,
        token: usdcAddress,
        recipient: solverAccount.address,
        amount: terms.evmAmount,
        hashLock: terms.hashLock,
        deadline: intentMessage.deadline,
        intentDeadline: intentMessage.intentDeadline,
        intentSig,
        permitDeadline: intentMessage.intentDeadline,
        v,
        r,
        s,
      },
    });

    const lockId = evmLockId(userAccount.address, terms.hashLock);
    const lockedState = await adapter.getLock(lockId);
    expect(lockedState.status).toBe('locked');
    if (lockedState.status === 'locked') {
      expect(lockedState.asset.decimals).toBe(6);
      expect(lockedState.amount).toBe(25_000_000n);
    }

    const claimTx = await adapter.claim(lockId, secret);
    expect(claimTx.txId).toMatch(/^0x[0-9a-f]{64}$/);

    const claimedState = await adapter.getLock(lockId);
    expect(claimedState.status).toBe('claimed');
    if (claimedState.status === 'claimed') {
      expect(claimedState.secret).toBe(secret);
    }

    expect(await adapter.isFinal(lockTx, 'fast')).toBe(true);
  });

  it('rejects relayLock with INSUFFICIENT_USER_BALANCE and RELAY_LOCK_REVERTED', async () => {
    const terms = makeTerms('relay-errors', {
      evmAmount: 999_999_999_000_000n,
    });
    const now = BigInt(Math.floor(Date.now() / 1000));

    await expect(
      adapter.relayLock({
        chain: 'base',
        orderId: terms.hashLock,
        payload: {
          owner: userAccount.address,
          token: usdcAddress,
          recipient: solverAccount.address,
          amount: terms.evmAmount,
          hashLock: terms.hashLock,
          deadline: now + 3600n,
          intentDeadline: now + 600n,
          intentSig: `0x${'11'.repeat(65)}` as Hex,
          permitDeadline: now + 600n,
          v: 27,
          r: `0x${'22'.repeat(32)}` as Hex32,
          s: `0x${'33'.repeat(32)}` as Hex32,
        },
      }),
    ).rejects.toMatchObject({
      name: 'RelayLockRejectedError',
      code: 'INSUFFICIENT_USER_BALANCE',
    } satisfies Partial<RelayLockRejectedError>);

    await expect(
      adapter.relayLock({
        chain: 'base',
        orderId: terms.hashLock,
        payload: {
          owner: userAccount.address,
          token: usdcAddress,
          recipient: solverAccount.address,
          amount: 1_000_000n,
          hashLock: terms.hashLock,
          deadline: now + 3600n,
          intentDeadline: now + 600n,
          intentSig: `0x${'11'.repeat(65)}` as Hex,
          permitDeadline: now + 600n,
          v: 27,
          r: `0x${'22'.repeat(32)}` as Hex32,
          s: `0x${'33'.repeat(32)}` as Hex32,
        },
      }),
    ).rejects.toMatchObject({
      name: 'RelayLockRejectedError',
      code: 'RELAY_LOCK_REVERTED',
    } satisfies Partial<RelayLockRejectedError>);
  });

  it('rejects a bad secret in claim before sending any transaction', async () => {
    const terms = makeTerms('bad-secret-claim', { direction: 'BCH_TO_EVM' });
    await adapter.lock(terms);
    const lockId = adapter.lockId(solverAccount.address, terms.hashLock);
    const nonceBefore = await publicClient.getTransactionCount({
      address: solverAccount.address,
    });

    const badSecret = sha256(stringToHex('not-the-right-secret'));
    await expect(adapter.claim(lockId, badSecret)).rejects.toBeInstanceOf(
      InvalidSecretError,
    );

    const nonceAfter = await publicClient.getTransactionCount({
      address: solverAccount.address,
    });
    expect(nonceAfter).toBe(nonceBefore);
  });

  it('throws RelayLockTransportError when RPC is unreachable during relayLock send', async () => {
    const terms = makeTerms('transport-err');
    const now = BigInt(Math.floor(Date.now() / 1000));
    const failingWalletClient = {
      account: solverAccount,
      writeContract: async () => {
        throw Object.assign(new Error('fetch failed: connect ECONNREFUSED'), {
          name: 'HttpRequestError',
        });
      },
    } as unknown as WalletClient;

    const flakyAdapter = new EvmChainAdapter({
      config: chainConfig,
      client: publicClient,
      walletClient: failingWalletClient,
    });

    await expect(
      flakyAdapter.relayLock({
        chain: 'base',
        orderId: terms.hashLock,
        payload: {
          owner: userAccount.address,
          token: usdcAddress,
          recipient: solverAccount.address,
          amount: 1_000_000n,
          hashLock: terms.hashLock,
          deadline: now + 3600n,
          intentDeadline: now + 600n,
          intentSig: `0x${'11'.repeat(65)}` as Hex,
          permitDeadline: now + 600n,
          v: 27,
          r: `0x${'22'.repeat(32)}` as Hex32,
          s: `0x${'33'.repeat(32)}` as Hex32,
        },
      }),
    ).rejects.toBeInstanceOf(RelayLockTransportError);
  });

  it('supports 18-decimals token without permit, no-return-value token, exact approvals, and refund', async () => {
    const exact18 = 25n * 10n ** 18n + 123_456_789_012_345_678n;
    const terms18 = makeTerms('token-18d', {
      direction: 'BCH_TO_EVM',
      evmToken: token18Address,
      evmAmount: exact18,
    });
    const unsigned18 = await adapter.buildUserLock(terms18);
    expect((unsigned18.payload as { mode: string }).mode).toBe('approve-lock');

    await adapter.lock(terms18);
    const lockId18 = adapter.lockId(solverAccount.address, terms18.hashLock);
    const state18 = await adapter.getLock(lockId18);
    expect(state18.status).toBe('locked');
    if (state18.status === 'locked') {
      expect(state18.asset.decimals).toBe(18);
      expect(state18.amount).toBe(exact18);
    }

    // Drained allowance check: after lock(), allowance is 0 (exact approval, never unlimited).
    const remainingAllowance = await publicClient.readContract({
      address: token18Address,
      abi: mockTokenAbi,
      functionName: 'allowance',
      args: [solverAccount.address, htlcAddress],
    });
    expect(remainingAllowance).toBe(0n);

    await adapter.claim(lockId18, sha256(stringToHex('token-18d')));
    expect((await adapter.getLock(lockId18)).status).toBe('claimed');

    // No-return-value USDT-style token + refund after deadline.
    const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
    const shortDeadline = Number(latestBlock.timestamp) + 60;
    const usdtTerms = makeTerms('usdt-no-return', {
      direction: 'BCH_TO_EVM',
      evmToken: usdtNoReturnAddress,
      evmAmount: 15_000_000n,
      evmDeadline: shortDeadline,
    });
    await adapter.lock(usdtTerms);
    const usdtLockId = adapter.lockId(
      solverAccount.address,
      usdtTerms.hashLock,
    );

    await publicClient.request({
      method: 'evm_increaseTime' as never,
      params: [120] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });

    await adapter.refund(usdtLockId);
    expect((await adapter.getLock(usdtLockId)).status).toBe('refunded');
  });

  it('serialises concurrent transactions per signer via SendQueue without nonce collisions', async () => {
    const queue = new SendQueue();
    const order: string[] = [];
    await Promise.all([
      queue.enqueue(async () => {
        order.push('start-1');
        await new Promise((r) => setTimeout(r, 20));
        order.push('end-1');
      }),
      queue.enqueue(async () => {
        order.push('start-2');
        await new Promise((r) => setTimeout(r, 10));
        order.push('end-2');
      }),
      queue.enqueue(async () => {
        order.push('start-3');
        order.push('end-3');
      }),
    ]);
    expect(order).toEqual([
      'start-1',
      'end-1',
      'start-2',
      'end-2',
      'start-3',
      'end-3',
    ]);

    const t1 = makeTerms('concurrent-1', { direction: 'BCH_TO_EVM' });
    const t2 = makeTerms('concurrent-2', { direction: 'BCH_TO_EVM' });
    const t3 = makeTerms('concurrent-3', { direction: 'BCH_TO_EVM' });

    const [r1, r2, r3] = await Promise.all([
      adapter.lock(t1),
      adapter.lock(t2),
      adapter.lock(t3),
    ]);
    expect(r1.txId).not.toBe(r2.txId);
    expect(r2.txId).not.toBe(r3.txId);
  });

  it('chunks and halves eth_getLogs ranges when an RPC refuses wide ranges, and watches events', async () => {
    const rangesRequested: Array<[bigint, bigint]> = [];
    const mockClient = {
      getLogs: async ({
        fromBlock,
        toBlock,
      }: {
        fromBlock: bigint;
        toBlock: bigint;
      }) => {
        rangesRequested.push([fromBlock, toBlock]);
        if (toBlock - fromBlock > 5n) {
          throw new Error('query exceeds max block range of 5');
        }
        return [{ blockNumber: fromBlock }];
      },
    } as unknown as PublicClient;

    const logs = await fetchLogsChunked(mockClient, htlcAddress, 0n, 20n);
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(rangesRequested[0]).toEqual([0n, 20n]);
    expect(rangesRequested.some(([start, end]) => end - start <= 5n)).toBe(
      true,
    );

    const events: LockEvent[] = [];
    const stopWatch = adapter.watch((event) => {
      events.push(event);
    });
    const watchTerms = makeTerms('watch-test', { direction: 'BCH_TO_EVM' });
    await adapter.lock(watchTerms);
    const watchLockId = adapter.lockId(
      solverAccount.address,
      watchTerms.hashLock,
    );
    await adapter.claim(watchLockId, sha256(stringToHex('watch-test')));

    const waitStart = Date.now();
    while (
      Date.now() - waitStart < 3_000 &&
      (!events.some((e) => e.type === 'Locked' && e.lockId === watchLockId) ||
        !events.some((e) => e.type === 'Claimed' && e.lockId === watchLockId))
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    stopWatch();

    expect(
      events.some((e) => e.type === 'Locked' && e.lockId === watchLockId),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'Claimed' && e.lockId === watchLockId),
    ).toBe(true);
  });

  it('checks finality from config for fast and safe lanes', async () => {
    const receipt = { status: 'success', blockNumber: 100n };
    let currentBlock = 100n;
    let finalizedBlock = 98n;

    const mockClient = {
      getTransactionReceipt: async () => receipt,
      getBlockNumber: async () => currentBlock,
      getBlock: async ({ blockTag }: { blockTag: string }) => {
        if (blockTag === 'finalized') return { number: finalizedBlock };
        return { number: currentBlock, timestamp: 1_700_000_000n };
      },
    } as unknown as PublicClient;

    const mockAdapter = new EvmChainAdapter({
      config: { ...chainConfig, finality: { fast: 3, safe: 'finalized' } },
      client: mockClient,
    });
    const tx = {
      chain: 'base' as const,
      txId: `0x${'ab'.repeat(32)}` as Hex32,
    };

    // At block 100: 1 confirmation (< 3 required for fast lane).
    expect(await mockAdapter.isFinal(tx, 'fast')).toBe(false);
    // At block 102: 3 confirmations (>= 3 required for fast lane).
    currentBlock = 102n;
    expect(await mockAdapter.isFinal(tx, 'fast')).toBe(true);

    // Safe lane uses 'finalized' tag: finalizedBlock 98 < 100 -> false; 100 >= 100 -> true.
    expect(await mockAdapter.isFinal(tx, 'safe')).toBe(false);
    finalizedBlock = 100n;
    expect(await mockAdapter.isFinal(tx, 'safe')).toBe(true);
  });

  it('allows solver recipient to early-release funds back to sender', async () => {
    const userClient = createWalletClient({
      account: userAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    const userAdapter = new EvmChainAdapter({
      config: chainConfig,
      client: publicClient,
      walletClient: userClient,
    });

    const terms = makeTerms('early-release-test', { direction: 'EVM_TO_BCH' });
    await userAdapter.lock(terms);
    const lockId = adapter.lockId(userAccount.address, terms.hashLock);

    const lockBefore = await adapter.getLock(lockId);
    expect(lockBefore.status).toBe('locked');

    const balBefore = await publicClient.readContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });

    // Solver is the recipient, so solver adapter can call release
    const releaseTx = await adapter.release(lockId);
    expect(releaseTx.chain).toBe('base');
    expect(releaseTx.txId).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const lockAfter = await adapter.getLock(lockId);
    expect(lockAfter.status).toBe('refunded');

    const balAfter = await publicClient.readContract({
      address: usdcAddress,
      abi: mockTokenAbi,
      functionName: 'balanceOf',
      args: [userAccount.address],
    });
    expect(balAfter).toBe(balBefore + terms.evmAmount);

    // Calling release again is idempotent
    const repeatTx = await adapter.release(lockId);
    expect(repeatTx.txId).toBe(releaseTx.txId);
  });

  it('refunds lock after deadline has passed', async () => {
    const userClient = createWalletClient({
      account: userAccount,
      chain: foundry,
      transport: http(anvil.rpcUrl),
    });
    const userAdapter = new EvmChainAdapter({
      config: chainConfig,
      client: publicClient,
      walletClient: userClient,
    });

    const terms = makeTerms('refund-test', { direction: 'EVM_TO_BCH' });
    await userAdapter.lock(terms);
    const lockId = adapter.lockId(userAccount.address, terms.hashLock);

    // Fast-forward anvil time past deadline
    await publicClient.request({
      method: 'evm_increaseTime' as never,
      params: [4000] as never,
    });
    await publicClient.request({
      method: 'evm_mine' as never,
      params: [] as never,
    });

    const refundTx = await adapter.refund(lockId);
    expect(refundTx.chain).toBe('base');
    expect(refundTx.txId).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const lockState = await adapter.getLock(lockId);
    expect(lockState.status).toBe('refunded');
  });
});
