import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMING_CONFIG,
  erlangQuantile,
  orderId as computeOrderId,
  orderTermsToJson,
  quoteOut,
  type Hex,
  type Hex32,
  type OrderTerms,
  type PricingEvidence,
} from '@ferry/core';
import type { QuoteRequest } from '@ferry/core/api';
import { SolverClient, type FetchLike } from '@ferry/solver-client';
import { privateKeyToAccount } from 'viem/accounts';
import {
  explorerTxUrl,
  formatEvidenceSummary,
  parseProbeCliArgs,
  runProbe,
  type ProbeBchPort,
  type ProbeEvmPort,
} from '../src/index.js';

const SOLVER_ACCOUNT = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const SOLVER_BCH_LOCKING = `0x76a914${'22'.repeat(20)}88ac` as Hex;
const PUSD_CATEGORY = `0x${'ec'.repeat(32)}` as Hex32;
const NOW_SECONDS = 1_794_764_000;
const BCH_TIP = 500_000;

const TEST_ENV = {
  PROBE_EVM_PRIVATE_KEY:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  PROBE_BCH_PRIVATE_KEY:
    '2222222222222222222222222222222222222222222222222222222222222222',
};

function createFakeSolverClient(): SolverClient {
  const fakeFetch: FetchLike = async (_input, init) => {
    const req = JSON.parse(String(init?.body)) as {
      direction: QuoteRequest['direction'];
      token: QuoteRequest['token'];
      chainId: number;
      evmToken: Hex;
      amountIn: string;
      userEvmAddress: Hex;
      userBchLockingBytecode: Hex;
      hashLock: Hex32;
    };

    const pricing: PricingEvidence = {
      refs: [
        {
          asset: req.token,
          usdPrice: '1.000',
          source: 'cauldron',
          asOf: NOW_SECONDS - 10,
        },
      ],
      spreadBps: 50,
      fixedFeeBase: 0n,
      rounding: 'floor',
    };

    const inputAmount = BigInt(req.amountIn);
    const outAmount = quoteOut(
      inputAmount,
      req.direction === 'EVM_TO_BCH' ? 6 : 2,
      req.direction === 'EVM_TO_BCH' ? 2 : 6,
      pricing,
    );

    const bchRefundHeight =
      req.direction === 'EVM_TO_BCH' ? BCH_TIP + 12 : BCH_TIP + 150;
    const evmDeadline =
      req.direction === 'EVM_TO_BCH'
        ? NOW_SECONDS +
          Math.ceil(
            erlangQuantile(12, 0.9999, DEFAULT_TIMING_CONFIG.blockMeanSeconds),
          ) +
          DEFAULT_TIMING_CONFIG.solverReactionSeconds +
          DEFAULT_TIMING_CONFIG.safetySeconds +
          120
        : NOW_SECONDS + 3600;

    const terms: OrderTerms = {
      version: 1,
      direction: req.direction,
      bchToken: req.token,
      bchTokenCategory: PUSD_CATEGORY,
      bchTokenAmount: req.direction === 'EVM_TO_BCH' ? outAmount : inputAmount,
      evmAmount: req.direction === 'EVM_TO_BCH' ? inputAmount : outAmount,
      evmToken: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      evmChainId: req.chainId,
      evmHtlc: '0x5a0c062f4b7b8ff2263530e12bc15de9c836a641',
      userEvmAddress: req.userEvmAddress,
      userBchLockingBytecode: req.userBchLockingBytecode,
      solverEvmAddress: SOLVER_ACCOUNT.address.toLowerCase() as Hex,
      solverBchLockingBytecode: SOLVER_BCH_LOCKING,
      hashLock: req.hashLock,
      evmDeadline,
      bchRefundHeight,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-probe-001',
      quoteExpiry: NOW_SECONDS + 300,
      pricing,
    };

    const id = computeOrderId(terms);
    const signature = await SOLVER_ACCOUNT.signMessage({
      message: { raw: id },
    });

    const body = {
      orderId: id,
      terms: orderTermsToJson(terms),
      signature,
      signerAddress: SOLVER_ACCOUNT.address.toLowerCase(),
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return new SolverClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetch: fakeFetch,
  });
}

function createFakePorts(events: string[]): {
  evmPort: ProbeEvmPort;
  bchPort: ProbeBchPort;
} {
  const evmPort: ProbeEvmPort = {
    async buildDryRunLock() {
      events.push('evm:buildDryRunLock');
    },
    async lock() {
      events.push('evm:lock');
      return `0x${'aa'.repeat(32)}` as Hex32;
    },
    async waitForSolverLock() {
      events.push('evm:waitForSolverLock');
      return `0x${'bb'.repeat(32)}` as Hex32;
    },
    async claim() {
      events.push('evm:claim');
      return `0x${'cc'.repeat(32)}` as Hex32;
    },
    async waitForRefundDeadline() {
      events.push('evm:waitForRefundDeadline');
    },
    async refund() {
      events.push('evm:refund');
      return `0x${'dd'.repeat(32)}` as Hex32;
    },
  };

  const bchPort: ProbeBchPort = {
    async getTipHeight() {
      return BCH_TIP;
    },
    async getFundingUtxos() {
      return [];
    },
    async buildDryRunLock() {
      events.push('bch:buildDryRunLock');
    },
    async lock() {
      events.push('bch:lock');
      return `0x${'11'.repeat(32)}` as Hex32;
    },
    async waitForHtlcUtxo() {
      events.push('bch:waitForHtlcUtxo');
      return {
        utxos: [
          {
            txid: '22'.repeat(32),
            vout: 0,
            satoshis: 3000n,
          },
        ],
        lockTxid: `0x${'22'.repeat(32)}` as Hex32,
      };
    },
    async claim() {
      events.push('bch:claim');
      return `0x${'33'.repeat(32)}` as Hex32;
    },
    async waitForRefundHeight(terms) {
      events.push('bch:waitForRefundHeight');
      return terms.bchRefundHeight;
    },
    async refund() {
      events.push('bch:refund');
      return `0x${'44'.repeat(32)}` as Hex32;
    },
  };

  return { evmPort, bchPort };
}

describe('@ferry/probe runner', () => {
  it('runs dry-run by default without saving or broadcasting', async () => {
    const events: string[] = [];
    const { evmPort, bchPort } = createFakePorts(events);
    const options = parseProbeCliArgs(['--direction', 'EVM_TO_BCH']);

    const evidence = await runProbe(options, {
      solverClient: createFakeSolverClient(),
      evmPort,
      bchPort,
      env: TEST_ENV,
      nowSeconds: () => NOW_SECONDS,
      saveRecoveryFile: async () => {
        events.push('saveRecoveryFile');
      },
    });

    expect(evidence.dryRun).toBe(true);
    expect(evidence.status).toBe('dry-run');
    expect(evidence.txids.userLockTxid).toBeNull();
    expect(events).toEqual(['evm:buildDryRunLock']);
    expect(formatEvidenceSummary(evidence)).toContain('DRY-RUN');
  });

  it('executes EVM_TO_BCH swap: saves recovery file BEFORE locking, waits, claims, and formats evidence', async () => {
    const events: string[] = [];
    const { evmPort, bchPort } = createFakePorts(events);
    const options = parseProbeCliArgs([
      '--execute',
      '--direction',
      'EVM_TO_BCH',
    ]);

    const evidence = await runProbe(options, {
      solverClient: createFakeSolverClient(),
      evmPort,
      bchPort,
      env: TEST_ENV,
      nowSeconds: () => NOW_SECONDS,
      saveRecoveryFile: async (_path, json) => {
        events.push('saveRecoveryFile');
        expect(JSON.parse(json)).toHaveProperty('secret');
      },
    });

    expect(evidence.status).toBe('claimed');
    expect(evidence.recoverySavedBeforeLock).toBe(true);
    expect(events).toEqual([
      'saveRecoveryFile',
      'evm:lock',
      'bch:waitForHtlcUtxo',
      'bch:claim',
    ]);
    expect(evidence.waits.map((w) => w.name)).toEqual([
      'waiting for solver BCH lock',
      'claiming BCH HTLC',
    ]);
    expect(evidence.explorerLinks.userLock).toContain('sepolia.basescan.org');
    expect(evidence.explorerLinks.claim).toContain('chipnet.chaingraph.cash');
  });

  it('executes BCH_TO_EVM swap: saves recovery file BEFORE locking, waits, claims EVM', async () => {
    const events: string[] = [];
    const { evmPort, bchPort } = createFakePorts(events);
    const options = parseProbeCliArgs([
      '--execute',
      '--direction',
      'BCH_TO_EVM',
    ]);

    const evidence = await runProbe(options, {
      solverClient: createFakeSolverClient(),
      evmPort,
      bchPort,
      env: TEST_ENV,
      nowSeconds: () => NOW_SECONDS,
      saveRecoveryFile: async () => {
        events.push('saveRecoveryFile');
      },
    });

    expect(evidence.status).toBe('claimed');
    expect(events).toEqual([
      'saveRecoveryFile',
      'bch:lock',
      'evm:waitForSolverLock',
      'evm:claim',
    ]);
    expect(evidence.waits.map((w) => w.name)).toEqual([
      'waiting for solver EVM lock',
      'claiming EVM HTLC',
    ]);
    expect(evidence.explorerLinks.userLock).toContain(
      'chipnet.chaingraph.cash',
    );
    expect(evidence.explorerLinks.claim).toContain('sepolia.basescan.org');
  });

  it('executes refund drill in both directions', async () => {
    const fwdEvents: string[] = [];
    const fwdPorts = createFakePorts(fwdEvents);
    const fwdEvidence = await runProbe(
      parseProbeCliArgs([
        '--execute',
        '--mode',
        'refund',
        '--direction',
        'EVM_TO_BCH',
      ]),
      {
        solverClient: createFakeSolverClient(),
        ...fwdPorts,
        env: TEST_ENV,
        nowSeconds: () => NOW_SECONDS,
        saveRecoveryFile: async () => {
          fwdEvents.push('saveRecoveryFile');
        },
      },
    );
    expect(fwdEvidence.status).toBe('refunded');
    expect(fwdEvents).toEqual([
      'saveRecoveryFile',
      'evm:lock',
      'evm:waitForRefundDeadline',
      'evm:refund',
    ]);
    expect(fwdEvidence.explorerLinks.refund).toContain('sepolia.basescan.org');

    const revEvents: string[] = [];
    const revPorts = createFakePorts(revEvents);
    const revEvidence = await runProbe(
      parseProbeCliArgs([
        '--execute',
        '--mode',
        'refund',
        '--direction',
        'BCH_TO_EVM',
      ]),
      {
        solverClient: createFakeSolverClient(),
        ...revPorts,
        env: TEST_ENV,
        nowSeconds: () => NOW_SECONDS,
        saveRecoveryFile: async () => {
          revEvents.push('saveRecoveryFile');
        },
      },
    );
    expect(revEvidence.status).toBe('refunded');
    expect(revEvents).toEqual([
      'saveRecoveryFile',
      'bch:lock',
      'bch:waitForHtlcUtxo',
      'bch:waitForRefundHeight',
      'bch:refund',
    ]);
    expect(revEvidence.explorerLinks.refund).toContain(
      'chipnet.chaingraph.cash',
    );
  });

  it('builds explorer links for mainnet and testnet', () => {
    expect(explorerTxUrl({ kind: 'evm', chainId: 8453 }, '0xabc')).toBe(
      'https://basescan.org/tx/0xabc',
    );
    expect(explorerTxUrl({ kind: 'bch', network: 'mainnet' }, '0xdef')).toBe(
      'https://blockchair.com/bitcoin-cash/transaction/def',
    );
    expect(explorerTxUrl({ kind: 'evm', chainId: 8453 }, null)).toBeNull();
  });
});
