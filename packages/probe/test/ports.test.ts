import { describe, expect, it } from 'vitest';
import type { EvmChainConfig, Hex, Hex32, OrderTerms } from '@ferry/core';
import {
  binToHex,
  decodeTransaction,
  hexToBin,
  lockingBytecodeToCashAddress,
  type Transaction,
} from '@bitauth/libauth';
import { deriveHtlcAddresses, encodeHtlcParameters } from '@ferry/htlc-bch';
import { createKeyBackedBchSigner } from '@ferry/user-flow';
import { hashDomain } from 'viem';
import type { Address, PublicClient, WalletClient } from 'viem';
import {
  createDefaultBchPort,
  createDefaultEvmPort,
  formatEvidenceSummary,
  loadProbeKeys,
  parseProbeCliArgs,
  type ProbeEvidence,
} from '../src/index.js';

const CHAIN_CONFIG: EvmChainConfig = {
  id: 'base',
  chainId: 84532,
  rpcUrls: ['http://127.0.0.1:8545'],
  explorerUrl: 'https://sepolia.basescan.org',
  htlcAddress: '0x5a0c062f4b7b8ff2263530e12bc15de9c836a641',
  nativeGas: 'ETH',
  finality: { fast: 1, safe: 'finalized' },
  relayCostUsd: 0.05,
  assets: [
    {
      symbol: 'USDC',
      address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      decimals: 6,
      permit: false,
    },
  ],
};

const SAMPLE_TERMS: OrderTerms = {
  version: 1,
  direction: 'EVM_TO_BCH',
  bchToken: 'PUSD',
  bchTokenCategory: `0x${'ec'.repeat(32)}`,
  bchTokenAmount: 100n,
  evmAmount: 1_000_000n,
  evmToken: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  evmChainId: 84532,
  evmHtlc: '0x5a0c062f4b7b8ff2263530e12bc15de9c836a641',
  userEvmAddress: '0x87ea46fe296c1810ef234a8e8d782a2122defadd',
  userBchLockingBytecode: `0x76a914${'11'.repeat(20)}88ac`,
  solverEvmAddress: '0xc9ec91859bdb598dc2eee715934d8231478f7a70',
  solverBchLockingBytecode: `0x76a914${'22'.repeat(20)}88ac`,
  hashLock: `0x${'33'.repeat(32)}`,
  evmDeadline: 1_794_850_000,
  bchRefundHeight: 500_012,
  bchCarrySats: 3000n,
  bchMaxFee: 1500n,
  quoteId: 'q-port-001',
  quoteExpiry: 1_794_764_200,
  pricing: {
    refs: [
      {
        asset: 'PUSD',
        usdPrice: '1.000',
        source: 'cauldron',
        asOf: 1_794_763_900,
      },
    ],
    spreadBps: 50,
    fixedFeeBase: 0n,
    rounding: 'floor',
  },
};

describe('@ferry/probe default ports and formatters', () => {
  it('exercises createDefaultEvmPort approve-lock, waitForSolverLock, claim, waitForRefundDeadline, refund', async () => {
    const writes: string[] = [];
    const publicClient = {
      readContract: async (args: { functionName: string }) =>
        // The user has approved nothing yet; the lock record is read as a tuple.
        args.functionName === 'allowance'
          ? 0n
          : [
              SAMPLE_TERMS.solverEvmAddress,
              SAMPLE_TERMS.evmToken,
              SAMPLE_TERMS.userEvmAddress,
              1_000_000n,
            ],
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      getBlock: async () => ({
        timestamp: BigInt(SAMPLE_TERMS.evmDeadline + 1),
      }),
    } as unknown as PublicClient;

    const walletClient = {
      writeContract: async (args: { functionName: string }) => {
        writes.push(args.functionName);
        return `0x${'ab'.repeat(32)}` as Hex32;
      },
      // The lock goes through the shared user-flow code, which sends encoded calls.
      sendTransaction: async (args: { data: Hex }) => {
        writes.push(args.data.startsWith('0x095ea7b3') ? 'approve' : 'lock');
        return `0x${'ab'.repeat(32)}` as Hex32;
      },
      signTypedData: async () => `0x${'11'.repeat(65)}` as Hex,
    } as unknown as WalletClient;

    const port = createDefaultEvmPort({
      chainConfig: CHAIN_CONFIG,
      publicClient,
      walletClient,
      userAddress: SAMPLE_TERMS.userEvmAddress,
    });

    await port.buildDryRunLock(SAMPLE_TERMS);
    const lockHash = await port.lock(SAMPLE_TERMS, {} as never);
    expect(lockHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(writes).toEqual(['approve', 'lock']);

    const solverLock = await port.waitForSolverLock(SAMPLE_TERMS, {
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(solverLock).toMatch(/^0x[0-9a-f]{64}$/);

    const claimHash = await port.claim(SAMPLE_TERMS, `0x${'44'.repeat(32)}`);
    expect(claimHash).toMatch(/^0x[0-9a-f]{64}$/);

    await port.waitForRefundDeadline(SAMPLE_TERMS, {
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    const refundHash = await port.refund(SAMPLE_TERMS);
    expect(refundHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(writes).toEqual(['approve', 'lock', 'claim', 'refund']);
  });

  it('a token with a smaller non-zero allowance is approved, then locked (no reset outside Ethereum USDT)', async () => {
    const sent: { data: Hex }[] = [];
    const publicClient = {
      readContract: async () => 500_000n,
      estimateGas: async () => 60_000n,
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    } as unknown as PublicClient;
    const walletClient = {
      sendTransaction: async (args: { data: Hex }) => {
        sent.push(args);
        return `0x${'ab'.repeat(32)}` as Hex32;
      },
    } as unknown as WalletClient;
    const port = createDefaultEvmPort({
      chainConfig: CHAIN_CONFIG,
      publicClient,
      walletClient,
      userAddress: SAMPLE_TERMS.userEvmAddress,
    });

    await port.lock(SAMPLE_TERMS, {} as never);

    expect(sent).toHaveLength(2);
    // approve(spender, amount), lock(...)
    expect(sent[0]!.data.startsWith('0x095ea7b3')).toBe(true);
    expect(sent[0]!.data.endsWith('0'.repeat(64))).toBe(false);
    expect(sent[1]!.data.startsWith('0x095ea7b3')).toBe(false);
  });

  it('locks with a permit through the real adapter payload: two signatures, then the relay', async () => {
    const signed: string[] = [];
    const relayed: unknown[] = [];
    const publicClient = {
      // The permit domain is checked against the token's own separator, so the
      // fake chain answers with the separator of a "USD Coin" version "1" domain.
      readContract: async (args: {
        functionName: string;
        address: Address;
      }) => {
        if (args.functionName === 'nonces') return 0n;
        if (args.functionName === 'DOMAIN_SEPARATOR') {
          return hashDomain({
            domain: {
              name: 'USD Coin',
              version: '1',
              chainId: BigInt(CHAIN_CONFIG.chainId),
              verifyingContract: args.address,
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
        return 'USD Coin';
      },
    } as unknown as PublicClient;
    const walletClient = {
      signTypedData: async (args: { primaryType: string }) => {
        signed.push(args.primaryType);
        return `0x${'11'.repeat(32)}${'22'.repeat(32)}1b` as Hex;
      },
    } as unknown as WalletClient;
    const permitConfig: EvmChainConfig = {
      ...CHAIN_CONFIG,
      assets: CHAIN_CONFIG.assets.map((a) => ({ ...a, permit: true })),
    };
    const port = createDefaultEvmPort({
      chainConfig: permitConfig,
      publicClient,
      walletClient,
      userAddress: SAMPLE_TERMS.userEvmAddress,
    });
    const solver = {
      relayLock: async (_orderId: Hex32, request: unknown) => {
        relayed.push(request);
        return { ok: true, orderId: _orderId, txHash: `0x${'cd'.repeat(32)}` };
      },
    };

    const hash = await port.lock(SAMPLE_TERMS, solver as never);

    expect(hash).toBe(`0x${'cd'.repeat(32)}`);
    expect(signed).toEqual(['Permit', 'LockIntent']);
    const request = relayed[0] as {
      permit: { deadline: number; v: number };
      intent: { deadline: number };
    };
    expect(request.permit.deadline).toBe(SAMPLE_TERMS.quoteExpiry + 3600);
    expect(request.intent.deadline).toBe(SAMPLE_TERMS.quoteExpiry + 3600);
    expect(request.permit.v).toBe(27);
  });

  it('locks on Bitcoin Cash through the shared library, keeping the token data of the funding output', async () => {
    const privateKey = new Uint8Array(32).fill(0x31);
    const signer = createKeyBackedBchSigner(privateKey);
    const lockingHex = binToHex(signer.lockingBytecode);
    const keys = {
      evmPrivateKey: `0x${'01'.repeat(32)}` as Hex32,
      evmAddress: SAMPLE_TERMS.userEvmAddress,
      bchPrivateKey: privateKey,
      bchLockingBytecode: `0x${lockingHex}` as Hex,
      bchCashAddress: (
        lockingBytecodeToCashAddress({
          bytecode: signer.lockingBytecode,
          prefix: 'bchtest',
          tokenSupport: false,
        }) as { address: string }
      ).address,
      source: 'env' as const,
    };
    const terms: OrderTerms = {
      ...SAMPLE_TERMS,
      direction: 'BCH_TO_EVM',
      userBchLockingBytecode: keys.bchLockingBytecode,
    };
    const asked: string[] = [];
    const broadcasts: string[] = [];
    const port = createDefaultBchPort(
      {
        getTipHeight: async () => 500_000,
        getUtxos: async (lockingBytecode) => {
          asked.push(String(lockingBytecode));
          // The shape a Fulcrum server answers with.
          return [
            {
              tx_hash: 'ab'.repeat(32),
              tx_pos: 1,
              value: 50_000,
              token_data: { category: 'ec'.repeat(32), amount: '1000' },
            },
          ] as never;
        },
        broadcast: async (txHex) => {
          broadcasts.push(txHex);
          return 'cd'.repeat(32);
        },
      },
      'chipnet',
    );

    const txid = await port.lock(terms, keys, 1);

    expect(txid).toBe(`0x${'cd'.repeat(32)}`);
    expect(asked).toEqual([`0x${lockingHex}`]);
    const tx = decodeTransaction(hexToBin(broadcasts[0]!)) as Transaction;
    const covenant = deriveHtlcAddresses(
      encodeHtlcParameters(terms),
      'chipnet',
    );
    expect(binToHex(tx.outputs[0]!.lockingBytecode)).toBe(
      binToHex(covenant.lockingBytecode),
    );
    expect(tx.outputs[0]!.token?.amount).toBe(terms.bchTokenAmount);
    expect(tx.inputs.every((i) => i.unlockingBytecode.length > 0)).toBe(true);
  });

  it('exercises createDefaultBchPort tip, UTXO polling, and refund height polling', async () => {
    const port = createDefaultBchPort(
      {
        getTipHeight: async () => 500_020,
        getUtxos: async () => [
          {
            txid: 'aa'.repeat(32),
            vout: 0,
            satoshis: 3000n,
          },
        ],
        broadcast: async () => 'bb'.repeat(32),
      },
      'chipnet',
    );

    expect(await port.getTipHeight()).toBe(500_020);
    const funding = await port.getFundingUtxos(
      SAMPLE_TERMS.userBchLockingBytecode,
    );
    expect(funding).toHaveLength(1);

    const htlc = await port.waitForHtlcUtxo(SAMPLE_TERMS, {
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(htlc.lockTxid).toBe(`0x${'aa'.repeat(32)}`);

    const tip = await port.waitForRefundHeight(SAMPLE_TERMS, {
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(tip).toBe(500_020);
  });

  it('formats evidence summaries with all txids, explorer links, and waits', () => {
    const evidence: ProbeEvidence = {
      schemaVersion: 1,
      network: 'testnet',
      mode: 'swap',
      dryRun: false,
      status: 'claimed',
      direction: 'EVM_TO_BCH',
      chainId: 84532,
      orderId: `0x${'11'.repeat(32)}`,
      quoteId: 'q-1',
      recoveryFilePath: '.probe-recovery/file.json',
      recoverySavedBeforeLock: true,
      amounts: {
        evmToken: SAMPLE_TERMS.evmToken,
        evmAmount: '1000000',
        bchToken: 'PUSD',
        bchTokenAmount: '100',
      },
      pricing: {
        spreadBps: 50,
        fixedFeeBase: '0',
        rounding: 'floor',
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '1.000',
            source: 'cauldron',
            asOf: 1_794_763_900,
          },
        ],
      },
      txids: {
        userLockTxid: `0x${'aa'.repeat(32)}`,
        solverLockTxid: `0x${'bb'.repeat(32)}`,
        claimTxid: `0x${'cc'.repeat(32)}`,
        refundTxid: `0x${'dd'.repeat(32)}`,
      },
      explorerLinks: {
        userLock: 'https://sepolia.basescan.org/tx/0xaa',
        solverLock: 'https://chipnet.chaingraph.cash/tx/bb',
        claim: 'https://chipnet.chaingraph.cash/tx/cc',
        refund: 'https://sepolia.basescan.org/tx/0xdd',
      },
      waits: [
        {
          name: 'waiting for solver BCH lock',
          startedAtMs: 0,
          finishedAtMs: 50,
          durationMs: 50,
        },
      ],
      durationsMs: {
        total: 100,
        quote: 10,
        lock: 20,
        counterpartyWait: 50,
        settle: 20,
      },
    };

    const text = formatEvidenceSummary(evidence);
    expect(text).toContain('User lock:');
    expect(text).toContain('Solver lock:');
    expect(text).toContain('Claim:');
    expect(text).toContain('Refund:');
    expect(text).toContain('waiting for solver BCH lock (50ms)');
  });

  it('parses remaining CLI flags cleanly', () => {
    const opts = parseProbeCliArgs([
      '--dry-run',
      '--token',
      'MUSD',
      '--chain-id',
      '84532',
      '--solver-url',
      'http://127.0.0.1:8787',
      '--recovery-dir',
      '/tmp/rec',
      '--poll-ms',
      '500',
      '--timeout-ms',
      '5000',
      '--bch-fee-rate',
      '1.5',
    ]);
    expect(opts.token).toBe('MUSD');
    expect(opts.chainId).toBe(84532);
    expect(opts.recoveryDir).toBe('/tmp/rec');
    expect(opts.pollIntervalMs).toBe(500);
    expect(opts.timeoutMs).toBe(5000);
    expect(opts.bchFeeRateSatPerByte).toBe(1.5);

    expect(() =>
      loadProbeKeys(
        {
          PROBE_EVM_PRIVATE_KEY: 'not-hex',
          PROBE_BCH_PRIVATE_KEY: '22'.repeat(32),
        },
        { network: 'testnet', requireEnvKeys: true },
      ),
    ).toThrowError();
  });
});
