import { isAddress } from 'viem';
import { z } from 'zod';
import type { Hex, Hex32, OrderTerms } from './terms.js';
import type { Lane } from './reveal.js';

export const EVM_CHAIN_IDS = [
  'base',
  'ethereum',
  'arbitrum',
  'bnb',
  'robinhood',
  'arc',
] as const;

export type EvmChainId = (typeof EVM_CHAIN_IDS)[number];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const nonZeroEvmAddress = z
  .string()
  .refine(
    (value) => isAddress(value) && value.toLowerCase() !== ZERO_ADDRESS,
    'Expected non-zero EVM address',
  )
  .transform((value) => value.toLowerCase() as Hex);

export const EvmAssetConfigSchema = z.strictObject({
  symbol: z.enum(['USDC', 'USDT', 'USDG']),
  decimals: z.number().int().min(1).max(36),
  address: nonZeroEvmAddress,
  permit: z.boolean(),
});

export type EvmAssetConfig = z.infer<typeof EvmAssetConfigSchema>;

export const EvmFinalityPolicySchema = z.strictObject({
  fast: z.number().int().positive(),
  safe: z.union([
    z.literal('safe'),
    z.literal('finalized'),
    z.number().int().positive(),
  ]),
});

export type EvmFinalityPolicy = z.infer<typeof EvmFinalityPolicySchema>;

export const EvmChainConfigSchema = z.strictObject({
  id: z.enum(EVM_CHAIN_IDS),
  chainId: z.number().int().positive(),
  rpcUrls: z.array(z.string().url()).min(1),
  explorerUrl: z.string().url(),
  htlcAddress: nonZeroEvmAddress,
  deployBlock: z.number().int().positive().optional(),
  nativeGas: z.enum(['ETH', 'BNB', 'USDC']),
  finality: EvmFinalityPolicySchema,
  assets: z.array(EvmAssetConfigSchema).min(1),
  relayCostUsd: z.number().nonnegative(),
});

export type EvmChainConfig = z.infer<typeof EvmChainConfigSchema>;

export function parseEvmChainConfig(input: unknown): EvmChainConfig {
  return EvmChainConfigSchema.parse(input);
}

export function validateEvmChainConfig(
  input: unknown,
): { ok: true; config: EvmChainConfig } | { ok: false; error: string } {
  const result = EvmChainConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data };
  }
  return {
    ok: false,
    error: result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; '),
  };
}

export interface TxRef {
  chain: EvmChainId;
  txId: Hex32;
}

export interface UnsignedLock {
  chain: EvmChainId;
  orderId: Hex32;
  payload: unknown;
}

export interface SignedLock {
  chain: EvmChainId;
  orderId: Hex32;
  payload: unknown;
}

export interface LockData {
  owner: string;
  recipient: string;
  asset: EvmAssetConfig;
  amount: bigint;
  hashLock: Hex32;
  deadline: number;
}

export type LockState =
  | { status: 'absent' }
  | ({ status: 'locked'; lockTx: TxRef } & LockData)
  | ({
      status: 'claimed';
      lockTx: TxRef;
      claimTx: TxRef;
      secret: Hex32 | null;
    } & LockData)
  | ({ status: 'refunded'; lockTx: TxRef; refundTx: TxRef } & LockData);

export type LockEvent = {
  eventId: string;
  lockId: string;
  tx: TxRef;
  removed: boolean;
} & (
  | { type: 'Locked'; lock: LockData }
  | { type: 'Claimed'; secret: Hex32 }
  | { type: 'Refunded' }
);

export type Unsubscribe = () => void;

export interface ChainAdapter {
  readonly id: EvmChainId;
  readonly assets: readonly EvmAssetConfig[];
  lockId(owner: string, hashLock: Hex32): Hex32;
  buildUserLock(terms: OrderTerms): Promise<UnsignedLock>;
  relayLock(signed: SignedLock): Promise<TxRef>;
  lock(terms: OrderTerms): Promise<TxRef>;
  claim(lockId: string, secret: Hex32): Promise<TxRef>;
  refund(lockId: string): Promise<TxRef>;
  release?(lockId: string): Promise<TxRef>;
  getLock(lockId: string): Promise<LockState>;
  watch(onEvent: (event: LockEvent) => void): Unsubscribe;
  isFinal(tx: TxRef, lane: Lane): Promise<boolean>;
  estimateRelayCostUsd(): Promise<number>;
  getTip?(): Promise<{ height: number; timestamp: number; ageSeconds: number }>;
}
