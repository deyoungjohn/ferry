import {
  buildRecoveryFile,
  orderId,
  serializeRecoveryFile,
  type Hex32,
  type RecoveryFile,
  type RecoveryTerms,
} from '@ferry/core';
import { deriveHtlcAddresses, encodeHtlcParameters } from '@ferry/htlc-bch';
import { sha256, stringToHex, toHex } from 'viem';

export const SECRET: Hex32 = sha256(stringToHex('recover-page-secret'));
export const HASH_LOCK: Hex32 = sha256(SECRET);
export const DEADLINE = 1_800_000_000;
export const REFUND_HEIGHT = 900_000;

export interface EvmSetup {
  readonly chainId: number;
  readonly htlc: `0x${string}`;
  readonly token: `0x${string}`;
  readonly user: `0x${string}`;
  readonly solver: `0x${string}`;
}

export function makeFile(options: {
  direction: 'EVM_TO_BCH' | 'BCH_TO_EVM';
  withSecret?: boolean;
  evm?: EvmSetup;
  deadline?: number;
  secret?: Hex32;
}): RecoveryFile {
  const deadline = options.deadline ?? DEADLINE;
  const secret = options.secret ?? SECRET;
  const hashLock = sha256(secret);
  const evm: EvmSetup = options.evm ?? {
    chainId: 8453,
    htlc: '0x8b968625F983420B571C102eC0b57F7e509c916e',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    user: '0x2222222222222222222222222222222222222222',
    solver: '0x3333333333333333333333333333333333333333',
  };
  const terms: RecoveryTerms = {
    version: 1,
    direction: options.direction,
    bchToken: 'PUSD',
    bchTokenCategory:
      '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    bchTokenAmount: 1000n,
    evmAmount: 10_000_000n,
    evmToken: evm.token,
    evmChainId: evm.chainId,
    evmHtlc: evm.htlc,
    userEvmAddress: evm.user,
    userBchLockingBytecode:
      '0x76a914111111111111111111111111111111111111111188ac',
    solverEvmAddress: evm.solver,
    solverBchLockingBytecode:
      '0x76a914222222222222222222222222222222222222222288ac',
    hashLock,
    evmDeadline: deadline,
    bchRefundHeight: REFUND_HEIGHT,
    bchCarrySats: 3000n,
    bchMaxFee: 1500n,
    quoteId: `q-${options.direction.toLowerCase()}`,
    quoteExpiry: deadline - 100,
    pricing: {
      refs: [
        {
          asset: 'PUSD',
          usdPrice: '1.000',
          source: 'cauldron',
          asOf: deadline - 200,
        },
        {
          asset: 'USDC',
          usdPrice: '1.000',
          source: 'chainlink:base:usdc-usd',
          asOf: deadline - 200,
        },
      ],
      spreadBps: 40,
      fixedFeeBase: 20n,
      rounding: 'floor',
    },
  };
  const addresses = deriveHtlcAddresses(encodeHtlcParameters(terms), 'mainnet');
  return buildRecoveryFile({
    orderId: orderId(terms),
    terms,
    solverSignature: `0x${'ab'.repeat(65)}`,
    ...(options.withSecret === false ? {} : { secret }),
    createdAt: deadline - 200,
    contracts: {
      evm: {
        chainId: evm.chainId,
        htlcAddress: terms.evmHtlc,
        tokenAddress: terms.evmToken,
      },
      bch: {
        network: 'mainnet',
        htlcAddress: addresses.p2sh32Address,
        tokenAddress: addresses.tokenAddress,
        redeemScript: toHex(addresses.redeemScript),
        lockingBytecode: toHex(addresses.lockingBytecode),
      },
    },
  });
}

export function fileJson(file: RecoveryFile): string {
  return serializeRecoveryFile(file);
}
