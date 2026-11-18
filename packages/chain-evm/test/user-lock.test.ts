import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  hashDomain,
  parseAbi,
  sha256,
  stringToHex,
} from 'viem';
import type { Address, PublicClient } from 'viem';
import { parseEvmChainConfig, parseOrderTerms } from '@ferry/core';
import type { OrderTerms } from '@ferry/core';
import { EvmChainAdapter } from '../src/index.js';
import {
  buildLockIntentTypedData,
  prepareApproveAndLock,
  UserSideError,
} from '../src/browser.js';

const HTLC: Address = '0x8b968625F983420B571C102eC0b57F7e509c916e';
const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDT: Address = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USER: Address = '0x00000000000000000000000000000000000000a1';
const SOLVER: Address = '0x00000000000000000000000000000000000000b2';

const config = parseEvmChainConfig({
  id: 'base',
  chainId: 8453,
  rpcUrls: ['http://127.0.0.1:1'],
  explorerUrl: 'https://basescan.org',
  htlcAddress: HTLC,
  nativeGas: 'ETH',
  finality: { fast: 2, safe: 'finalized' },
  assets: [
    { symbol: 'USDC', decimals: 6, address: USDC, permit: true },
    { symbol: 'USDT', decimals: 6, address: USDT, permit: false },
  ],
  relayCostUsd: 0.02,
});

function domainSeparator(version: string): `0x${string}` {
  return hashDomain({
    domain: {
      name: 'USD Coin',
      version,
      chainId: 8453n,
      verifyingContract: USDC,
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
    },
  });
}

/** A chain whose USDC has no readable `version()` and a version-2 domain, like some real tokens. */
function stubClient(options: {
  separator: `0x${string}`;
  allowance?: bigint;
}): PublicClient {
  return {
    readContract: async (call: {
      address: Address;
      functionName: string;
    }): Promise<unknown> => {
      if (call.address === USDC) {
        if (call.functionName === 'name') return 'USD Coin';
        if (call.functionName === 'nonces') return 7n;
        if (call.functionName === 'DOMAIN_SEPARATOR') return options.separator;
        throw new Error('execution reverted');
      }
      if (call.functionName === 'allowance') return options.allowance ?? 0n;
      throw new Error('unexpected read');
    },
  } as unknown as PublicClient;
}

function makeTerms(token: Address): OrderTerms {
  const now = Math.floor(Date.now() / 1000);
  return parseOrderTerms({
    version: 1,
    direction: 'EVM_TO_BCH',
    bchToken: 'PUSD',
    bchTokenCategory: `0x${'aa'.repeat(32)}`,
    bchTokenAmount: 2500n,
    evmAmount: 25_000_000n,
    evmToken: token,
    evmChainId: 8453,
    evmHtlc: HTLC,
    userEvmAddress: USER,
    userBchLockingBytecode:
      '0x76a91400112233445566778899aabbccddeeff0011223388ac',
    solverEvmAddress: SOLVER,
    solverBchLockingBytecode:
      '0x76a91433221100ffeeddccbbaa9988776655443322110088ac',
    hashLock: sha256(stringToHex('user-lock')),
    evmDeadline: now + 3600,
    bchRefundHeight: 200_000,
    bchCarrySats: 2000n,
    bchMaxFee: 1000n,
    quoteId: 'q-user-lock',
    quoteExpiry: now + 600,
    pricing: {
      refs: [
        { asset: 'USDC', usdPrice: '1.00', source: 'test-fixture', asOf: now },
      ],
      spreadBps: 25,
      fixedFeeBase: 0n,
      rounding: 'floor',
    },
  });
}

describe('buildUserLock builds the same typed data the browser entry does', () => {
  it('signs a permit with the domain the token actually has, not a guessed version', async () => {
    const adapter = new EvmChainAdapter({
      config,
      client: stubClient({ separator: domainSeparator('2') }),
    });
    const unsigned = await adapter.buildUserLock(makeTerms(USDC));
    const payload = unsigned.payload as {
      mode: string;
      permitTypedData: {
        domain: { version: string };
        message: { nonce: bigint };
      };
      lockIntentTypedData: unknown;
    };
    expect(payload.mode).toBe('permit-intent');
    expect(payload.permitTypedData.domain.version).toBe('2');
    expect(payload.permitTypedData.message.nonce).toBe(7n);
    expect(payload.lockIntentTypedData).toEqual(
      buildLockIntentTypedData(makeTerms(USDC)),
    );
  });

  it('refuses to build a permit when no version reproduces the token domain separator', async () => {
    const adapter = new EvmChainAdapter({
      config,
      client: stubClient({ separator: domainSeparator('9') }),
    });
    await expect(adapter.buildUserLock(makeTerms(USDC))).rejects.toBeInstanceOf(
      UserSideError,
    );
  });

  it('adds the full wallet transaction list for a token without permit', async () => {
    const none = await new EvmChainAdapter({
      config,
      client: stubClient({ separator: domainSeparator('2'), allowance: 0n }),
    }).buildUserLock(makeTerms(USDT));
    const reset = await new EvmChainAdapter({
      config,
      client: stubClient({ separator: domainSeparator('2'), allowance: 5n }),
    }).buildUserLock(makeTerms(USDT));
    const kinds = (unsigned: { payload: unknown }) =>
      (
        unsigned.payload as { transactions: { kind: string }[] }
      ).transactions.map((t) => t.kind);
    expect(kinds(none)).toEqual(['approve', 'lock']);
    expect(kinds(reset)).toEqual(['reset-approval', 'approve', 'lock']);
    // The fields existing consumers read stay as they were.
    const payload = reset.payload as {
      mode: string;
      approve: { amount: bigint };
      lockCall: { functionName: string };
    };
    expect(payload.mode).toBe('approve-lock');
    expect(payload.approve.amount).toBe(25_000_000n);
    expect(payload.lockCall.functionName).toBe('lock');
  });
});

describe('gas for a USDT-style token that refuses to change a non-zero allowance', () => {
  // Real USDT reverts approve(spender, amount) while an allowance exists, so the
  // node cannot estimate the exact approve before the reset is mined.
  const approveAbi = parseAbi(['function approve(address,uint256)']);
  function usdtLikeClient(allowance: bigint): PublicClient {
    return {
      readContract: async () => allowance,
      estimateGas: async (call: { data: `0x${string}` }) => {
        const { args } = decodeFunctionData({
          abi: approveAbi,
          data: call.data,
        });
        if (allowance !== 0n && (args as [Address, bigint])[1] !== 0n) {
          throw new Error('execution reverted');
        }
        return 46_000n;
      },
    } as unknown as PublicClient;
  }

  it('estimates what the node can and marks the rest as a bound', async () => {
    const plan = await prepareApproveAndLock({
      client: usdtLikeClient(5n),
      terms: makeTerms(USDT),
    });
    expect(plan.map((t) => [t.kind, t.gasSource])).toEqual([
      ['reset-approval', 'node'],
      ['approve', 'bound'],
      ['lock', 'bound'],
    ]);
  });
});
