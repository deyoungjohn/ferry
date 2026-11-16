import { describe, expect, it } from 'vitest';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import type { PublicClient } from 'viem';
import { ferryHtlcAbi } from '@ferry/htlc-evm/abi';
import {
  ARBITRUM_NODE_INTERFACE_ADDRESS,
  BASE_GAS_PRICE_ORACLE_ADDRESS,
  estimateArbitrumGasComponents,
  estimateBaseL1FeeWei,
  estimateRelayCostUsd,
} from '../src/index.js';

const RUN_LIVE = process.env.FERRY_L2_COST_LIVE === '1';

const sampleCalldata = encodeFunctionData({
  abi: ferryHtlcAbi,
  functionName: 'claim',
  args: [`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`],
});

describe('L2 data fee and relay cost estimators (unit)', () => {
  it('reads Base L1 fee from GasPriceOracle predeploy and adds it to execution cost', async () => {
    const fakeClient = {
      getGasPrice: async () => 10_000_000n, // 0.01 gwei
      readContract: async (args: { address: string; functionName: string }) => {
        expect(args.address).toBe(BASE_GAS_PRICE_ORACLE_ADDRESS);
        expect(args.functionName).toBe('getL1Fee');
        return 1_500_000_000_000n; // 1.5e12 wei
      },
    } as unknown as PublicClient;

    const estimate = await estimateRelayCostUsd({
      chain: 'base',
      calldata: sampleCalldata,
      client: fakeClient,
      nativeUsd: 3000,
      gasUsed: 80_000n,
    });

    expect(estimate.executionGas).toBe(80_000n);
    expect(estimate.l1FeeWei).toBe(1_500_000_000_000n);
    expect(estimate.l2ExecutionUsd).toBeCloseTo(
      ((80_000 * 10_000_000) / 1e18) * 3000,
      10,
    );
    expect(estimate.l1DataFeeUsd).toBeCloseTo((1.5e12 / 1e18) * 3000, 10);
    expect(estimate.totalUsd).toBeCloseTo(
      estimate.l2ExecutionUsd + estimate.l1DataFeeUsd,
      10,
    );
  });

  it('reads Arbitrum NodeInterface gasEstimateComponents and computes L1 + L2 fee', async () => {
    const fakeClient = {
      getGasPrice: async () => 100_000_000n, // 0.1 gwei
      simulateContract: async (args: {
        address: string;
        functionName: string;
      }) => {
        expect(args.address).toBe(ARBITRUM_NODE_INTERFACE_ADDRESS);
        expect(args.functionName).toBe('gasEstimateComponents');
        return {
          result: [
            120_000n, // gasEstimate
            40_000n, // gasEstimateForL1
            100_000_000n, // baseFee (0.1 gwei)
            20_000_000_000n, // l1BaseFeeEstimate (20 gwei)
          ],
        };
      },
    } as unknown as PublicClient;

    const estimate = await estimateRelayCostUsd({
      chain: 'arbitrum',
      calldata: sampleCalldata,
      client: fakeClient,
      nativeUsd: 3000,
      to: '0x8b968625F983420B571C102eC0b57F7e509c916e',
    });

    expect(estimate.executionGas).toBe(80_000n);
    expect(estimate.l1FeeWei).toBe(40_000n * 100_000_000n);
    expect(estimate.totalUsd).toBeCloseTo(
      estimate.l2ExecutionUsd + estimate.l1DataFeeUsd,
      10,
    );
  });

  it('returns zero L1 data fee on Ethereum, BNB, and Arc', async () => {
    const fakeClient = {
      getGasPrice: async () => 2_000_000_000n,
    } as unknown as PublicClient;

    for (const chain of ['ethereum', 'bnb', 'arc'] as const) {
      const estimate = await estimateRelayCostUsd({
        chain,
        calldata: sampleCalldata,
        client: fakeClient,
        nativeUsd: chain === 'arc' ? 1 : 3000,
        gasUsed: 80_000n,
      });
      expect(estimate.l1FeeWei).toBe(0n);
      expect(estimate.l1DataFeeUsd).toBe(0);
      expect(estimate.totalUsd).toBe(estimate.l2ExecutionUsd);
    }
  });
});

describe.skipIf(!RUN_LIVE)('L2 data fee live public RPC check', () => {
  it('queries Base GasPriceOracle and Arbitrum NodeInterface', async () => {
    const baseClient = createPublicClient({
      transport: http('https://mainnet.base.org'),
    });
    const baseRes = await estimateRelayCostUsd({
      chain: 'base',
      calldata: sampleCalldata,
      client: baseClient,
      nativeUsd: 3000,
      to: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      gasUsed: 78_808n,
    });
    expect(baseRes.l1FeeWei).toBeGreaterThan(0n);

    const arbClient = createPublicClient({
      transport: http('https://arb1.arbitrum.io/rpc'),
    });
    const arbComp = await estimateArbitrumGasComponents(arbClient, {
      to: '0x8b968625F983420B571C102eC0b57F7e509c916e',
      data: sampleCalldata,
    });
    expect(arbComp.gasEstimate).toBeGreaterThan(0n);

    const baseDirect = await estimateBaseL1FeeWei(baseClient, sampleCalldata);
    expect(baseDirect).toBeGreaterThan(0n);

    console.info('L2 live measurements:', {
      base: {
        gasPriceWei: baseRes.gasPriceWei.toString(),
        l1FeeWei: baseRes.l1FeeWei.toString(),
        l2ExecutionUsd: baseRes.l2ExecutionUsd,
        l1DataFeeUsd: baseRes.l1DataFeeUsd,
        totalUsd: baseRes.totalUsd,
      },
      arbitrum: {
        gasEstimate: arbComp.gasEstimate.toString(),
        gasEstimateForL1: arbComp.gasEstimateForL1.toString(),
        baseFee: arbComp.baseFee.toString(),
        l1BaseFeeEstimate: arbComp.l1BaseFeeEstimate.toString(),
        l1FeeWei: arbComp.l1FeeWei.toString(),
      },
    });
  });
});
