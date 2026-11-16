import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { sha256 } from 'viem';
import {
  RecoveryFileSchema,
  buildEvmRecoveryCalldata,
  buildRecoveryFile,
  orderId,
  parseRecoveryFileJson,
  recoveryActions,
  recoveryFileName,
  serializeRecoveryFile,
  signOrderId,
  type RecoveryTerms,
} from '../src/index.js';

const SECRET =
  '0x0101010101010101010101010101010101010101010101010101010101010101' as const;
const HASH_LOCK = sha256(SECRET);

function makeTerms(direction: 'EVM_TO_BCH' | 'BCH_TO_EVM'): RecoveryTerms {
  return {
    version: 1,
    direction,
    bchToken: 'PUSD',
    bchTokenCategory:
      '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    bchTokenAmount: 10000n,
    evmAmount: 100500000n,
    evmToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    evmChainId: 8453,
    evmHtlc: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    userEvmAddress: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    userBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    solverEvmAddress: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
    solverBchLockingBytecode:
      '0x76a914222222222222222222222222222222222222222288ac',
    hashLock: HASH_LOCK,
    evmDeadline: 1794850000,
    bchRefundHeight: 974380,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: 'q-recovery-001',
    quoteExpiry: 1794764200,
    pricing: {
      refs: [
        {
          asset: 'PUSD',
          usdPrice: '0.998',
          source: 'cauldron',
          asOf: 1794764140,
        },
        {
          asset: 'USDC',
          usdPrice: '1.000',
          source: 'chainlink:base:usdc-usd',
          asOf: 1794764140,
        },
      ],
      spreadBps: 40,
      fixedFeeBase: 50n,
      rounding: 'floor',
    },
  };
}

describe('RecoveryFile schema, serialization, and direction-aware recoveryActions', () => {
  it('round-trips a versioned recovery file with bigint fields and optional secret', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const terms = makeTerms('EVM_TO_BCH');
    const id = orderId(terms);
    const solverSignature = await signOrderId(id, account);

    const file = buildRecoveryFile({
      orderId: id,
      terms,
      solverSignature,
      secret: SECRET,
      createdAt: 1794764150,
      contracts: {
        evm: {
          chainId: 8453,
          htlcAddress: terms.evmHtlc,
          tokenAddress: terms.evmToken,
        },
        bch: {
          network: 'chipnet',
          htlcAddress: 'bchtest:p2sh32example',
          tokenAddress: 'bchtest:z2sh32example',
          redeemScript: '0x51',
          lockingBytecode: `0xaa20${'11'.repeat(32)}87`,
        },
      },
    });

    expect(recoveryFileName(id)).toBe(`ferry-${id}.json`);
    const json = serializeRecoveryFile(file);
    const parsed = parseRecoveryFileJson(json);
    expect(parsed.terms.bchTokenAmount).toBe(10000n);
    expect(parsed.terms.pricing.fixedFeeBase).toBe(50n);
    expect(parsed.secret).toBe(SECRET);

    // Rejects mismatched secret
    expect(() =>
      RecoveryFileSchema.parse({
        ...file,
        secret: `0x${'ff'.repeat(32)}`,
      }),
    ).toThrow();
  });

  it('offers only the user branch for EVM_TO_BCH (BCH claim, EVM refund) and names waits', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const terms = makeTerms('EVM_TO_BCH');
    const id = orderId(terms);
    const solverSignature = await signOrderId(id, account);

    const fileWithoutSecret = buildRecoveryFile({
      orderId: id,
      terms,
      solverSignature,
      createdAt: 1794764150,
      contracts: {
        evm: {
          chainId: 8453,
          htlcAddress: terms.evmHtlc,
          tokenAddress: terms.evmToken,
        },
        bch: {
          network: 'chipnet',
          htlcAddress: 'bchtest:p2sh32example',
          tokenAddress: 'bchtest:z2sh32example',
          redeemScript: '0x51',
          lockingBytecode: `0xaa20${'11'.repeat(32)}87`,
        },
      },
    });

    // Neither side ready yet -> waits name what they wait for
    const waitPlan = recoveryActions(fileWithoutSecret, {
      nowSeconds: 1794840000,
      bchTipHeight: 974350,
      evmLock: { state: 'locked' },
      bchLock: { state: 'none' },
    });
    expect(waitPlan.actions).toEqual([]);
    expect(waitPlan.waits.map((w) => w.waitingFor).join(' | ')).toMatch(
      /solver's BCH lock/i,
    );
    expect(waitPlan.waits.map((w) => w.waitingFor).join(' | ')).toMatch(
      /EVM refund deadline/i,
    );

    // BCH locked, secret present -> only BCH claim offered (never EVM claim or BCH refund)
    const claimPlan = recoveryActions(
      { ...fileWithoutSecret, secret: SECRET },
      {
        nowSeconds: 1794840000,
        bchTipHeight: 974390,
        evmLock: { state: 'locked' },
        bchLock: { state: 'locked' },
      },
    );
    expect(claimPlan.actions).toEqual([{ chain: 'BCH', action: 'claim' }]);

    // After EVM deadline -> EVM refund offered
    const refundPlan = recoveryActions(fileWithoutSecret, {
      nowSeconds: 1794850000,
      bchTipHeight: 974390,
      evmLock: { state: 'locked' },
      bchLock: { state: 'none' },
    });
    expect(refundPlan.actions).toEqual([{ chain: 'EVM', action: 'refund' }]);

    const calldata = buildEvmRecoveryCalldata(fileWithoutSecret);
    expect(calldata.action).toBe('refund');
    expect(calldata.to).toBe(terms.evmHtlc.toLowerCase());
    expect(calldata.data).toMatch(/^0x[0-9a-f]+$/);
  });

  it('offers only the user branch for BCH_TO_EVM (EVM claim, BCH refund) and builds EVM claim calldata', async () => {
    const account = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const terms = makeTerms('BCH_TO_EVM');
    const id = orderId(terms);
    const solverSignature = await signOrderId(id, account);

    const file = buildRecoveryFile({
      orderId: id,
      terms,
      solverSignature,
      secret: SECRET,
      createdAt: 1794764150,
      contracts: {
        evm: {
          chainId: 8453,
          htlcAddress: terms.evmHtlc,
          tokenAddress: terms.evmToken,
        },
        bch: {
          network: 'chipnet',
          htlcAddress: 'bchtest:p2sh32example',
          tokenAddress: 'bchtest:z2sh32example',
          redeemScript: '0x51',
          lockingBytecode: `0xaa20${'11'.repeat(32)}87`,
        },
      },
    });

    const plan = recoveryActions(file, {
      nowSeconds: 1794840000,
      bchTipHeight: 974380,
      evmLock: { state: 'locked' },
      bchLock: { state: 'locked' },
    });
    expect(plan.actions).toEqual([
      { chain: 'EVM', action: 'claim' },
      { chain: 'BCH', action: 'refund' },
    ]);

    const calldata = buildEvmRecoveryCalldata(file);
    expect(calldata.action).toBe('claim');
    expect(calldata.data).toMatch(/^0x[0-9a-f]+$/);

    // BCH_TO_EVM wait states and missing secret errors
    const noSecretFile = { ...file, secret: undefined };
    expect(() => buildEvmRecoveryCalldata(noSecretFile)).toThrow(/secret/i);

    const waitingBchToEvm = recoveryActions(noSecretFile, {
      nowSeconds: 1794840000,
      bchTipHeight: 974370,
      evmLock: { state: 'none' },
      bchLock: { state: 'none' },
    });
    expect(waitingBchToEvm.actions).toEqual([]);
    expect(waitingBchToEvm.waits).toHaveLength(2);

    const waitingHeight = recoveryActions(noSecretFile, {
      nowSeconds: 1794840000,
      bchTipHeight: 974370,
      evmLock: { state: 'locked' },
      bchLock: { state: 'locked' },
    });
    expect(waitingHeight.waits.map((w) => w.waitingFor).join(' | ')).toMatch(
      /10 blocks remaining/i,
    );

    const settled = recoveryActions(file, {
      nowSeconds: 1794840000,
      bchTipHeight: 974390,
      evmLock: { state: 'claimed' },
      bchLock: { state: 'claimed' },
    });
    expect(settled.actions).toEqual([]);
    expect(settled.summary).toMatch(/settled/i);

    // Mismatched hashLock rejected
    expect(() =>
      RecoveryFileSchema.parse({
        ...file,
        hashLock: `0x${'ee'.repeat(32)}`,
      }),
    ).toThrow(/hashLock/i);

    const { parseRecoveryFile } = await import('../src/index.js');
    expect(parseRecoveryFile(file).orderId).toBe(file.orderId);

    const evmToBchNoSecret = recoveryActions(
      {
        ...file,
        terms: { ...file.terms, direction: 'EVM_TO_BCH' },
        secret: undefined,
      },
      {
        nowSeconds: 1794840000,
        bchTipHeight: 974380,
        evmLock: { state: 'none' },
        bchLock: { state: 'locked' },
      },
    );
    expect(evmToBchNoSecret.actions).toEqual([]);
    expect(evmToBchNoSecret.waits).toHaveLength(2);
  });
});
