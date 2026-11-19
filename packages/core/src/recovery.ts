import { encodeFunctionData, isAddress } from 'viem';
import { z } from 'zod';
import { evmLockId } from './evm.js';
import { isValidSecret } from './secret.js';
import {
  OrderTermsSchema,
  PricingEvidenceSchema,
  orderTermsFromJson,
  orderTermsToJson,
  unixTimestampSeconds,
  type Direction,
  type Hex,
  type Hex32,
  type OrderTerms,
  type PricingEvidence,
} from './terms.js';

const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected 32-byte 0x-prefixed hex')
  .transform((value) => value.toLowerCase() as Hex32);

const hexSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .transform((value) => value.toLowerCase() as Hex);

const evmAddressSchema = z
  .string()
  .refine((value) => isAddress(value), 'Malformed EVM address')
  .transform((value) => value.toLowerCase() as Hex);

export const RecoveryTermsSchema = OrderTermsSchema.safeExtend({
  pricing: PricingEvidenceSchema,
});

export type RecoveryTerms = OrderTerms & { pricing: PricingEvidence };

export const RecoveryFileSchema = z
  .strictObject({
    version: z.literal(1),
    orderId: hex32Schema,
    terms: RecoveryTermsSchema,
    solverSignature: hexSchema,
    hashLock: hex32Schema,
    secret: hex32Schema.optional(),
    createdAt: unixTimestampSeconds,
    contracts: z.strictObject({
      evm: z.strictObject({
        chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        htlcAddress: evmAddressSchema,
        tokenAddress: evmAddressSchema,
        lockId: hex32Schema.optional(),
      }),
      bch: z.strictObject({
        network: z.enum(['chipnet', 'mainnet']),
        htlcAddress: z.string().min(1).max(256),
        tokenAddress: z.string().min(1).max(256),
        redeemScript: hexSchema,
        lockingBytecode: hexSchema,
      }),
    }),
  })
  .superRefine((file, ctx) => {
    if (file.hashLock !== file.terms.hashLock) {
      ctx.addIssue({
        code: 'custom',
        message: 'hashLock does not match terms.hashLock',
        path: ['hashLock'],
      });
    }
    if (
      file.secret !== undefined &&
      !isValidSecret(file.secret, file.hashLock)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'secret does not match hashLock',
        path: ['secret'],
      });
    }
  });

export type RecoveryFile = z.infer<typeof RecoveryFileSchema>;

export interface BuildRecoveryFileInput {
  orderId: Hex32;
  terms: RecoveryTerms;
  solverSignature: Hex;
  secret?: Hex32;
  createdAt?: number;
  contracts: RecoveryFile['contracts'];
}

export function buildRecoveryFile(input: BuildRecoveryFileInput): RecoveryFile {
  return RecoveryFileSchema.parse({
    version: 1,
    orderId: input.orderId,
    terms: input.terms,
    solverSignature: input.solverSignature,
    hashLock: input.terms.hashLock,
    ...(input.secret !== undefined ? { secret: input.secret } : {}),
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1000),
    contracts: input.contracts,
  });
}

export function recoveryFileName(id: Hex32): string {
  return `ferry-${id.toLowerCase()}.json`;
}

export function serializeRecoveryFile(file: RecoveryFile): string {
  const validated = RecoveryFileSchema.parse(file);
  return JSON.stringify(
    {
      ...validated,
      terms: orderTermsToJson(validated.terms),
    },
    null,
    2,
  );
}

export function parseRecoveryFile(input: unknown): RecoveryFile {
  return RecoveryFileSchema.parse(input);
}

export function parseRecoveryFileJson(json: string): RecoveryFile {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (
    raw &&
    typeof raw === 'object' &&
    raw.terms &&
    typeof raw.terms === 'object'
  ) {
    return RecoveryFileSchema.parse({
      ...raw,
      terms: orderTermsFromJson(raw.terms),
    });
  }
  return RecoveryFileSchema.parse(raw);
}

export type LockChainStatus = 'none' | 'locked' | 'claimed' | 'refunded';

export interface RecoveryChainState {
  nowSeconds: number;
  bchTipHeight: number;
  evmLock: { state: LockChainStatus; txid?: Hex32 };
  bchLock: { state: LockChainStatus; txid?: Hex32 };
}

export interface RecoveryAction {
  chain: 'BCH' | 'EVM';
  action: 'claim' | 'refund';
}

export interface RecoveryWait {
  chain: 'BCH' | 'EVM';
  action: 'claim' | 'refund';
  waitingFor: string;
}

export interface RecoveryPlan {
  direction: Direction;
  actions: RecoveryAction[];
  waits: RecoveryWait[];
  summary: string;
}

/**
 * Direction-aware recovery planner (T20, NFR-8): returns only the user's own
 * branch (never the solver's branch) and names what every wait is waiting for.
 */
export function recoveryActions(
  file: RecoveryFile,
  chainState: RecoveryChainState,
): RecoveryPlan {
  const actions: RecoveryAction[] = [];
  const waits: RecoveryWait[] = [];
  const { direction } = file.terms;

  if (direction === 'EVM_TO_BCH') {
    // User claims on BCH; user refunds on EVM.
    if (chainState.bchLock.state === 'locked') {
      if (file.secret) {
        actions.push({ chain: 'BCH', action: 'claim' });
      } else {
        waits.push({
          chain: 'BCH',
          action: 'claim',
          waitingFor:
            'Waiting for the swap secret (this recovery file does not contain the secret)',
        });
      }
    } else if (chainState.bchLock.state === 'none') {
      waits.push({
        chain: 'BCH',
        action: 'claim',
        waitingFor: "Waiting for the solver's BCH lock to appear on chain",
      });
    }

    if (chainState.evmLock.state === 'locked') {
      if (chainState.nowSeconds >= file.terms.evmDeadline) {
        actions.push({ chain: 'EVM', action: 'refund' });
      } else {
        const remaining = file.terms.evmDeadline - chainState.nowSeconds;
        waits.push({
          chain: 'EVM',
          action: 'refund',
          waitingFor: `Waiting for EVM refund deadline (${formatDuration(remaining)} remaining)`,
        });
      }
    } else if (chainState.evmLock.state === 'none') {
      waits.push({
        chain: 'EVM',
        action: 'refund',
        waitingFor: 'Waiting for your EVM lock to be confirmed on chain',
      });
    }
  } else {
    // BCH_TO_EVM: user claims on EVM; user refunds on BCH.
    if (chainState.evmLock.state === 'locked') {
      if (file.secret) {
        actions.push({ chain: 'EVM', action: 'claim' });
      } else {
        waits.push({
          chain: 'EVM',
          action: 'claim',
          waitingFor:
            'Waiting for the swap secret (this recovery file does not contain the secret)',
        });
      }
    } else if (chainState.evmLock.state === 'none') {
      waits.push({
        chain: 'EVM',
        action: 'claim',
        waitingFor: "Waiting for the solver's EVM lock to appear on chain",
      });
    }

    if (chainState.bchLock.state === 'locked') {
      if (chainState.bchTipHeight >= file.terms.bchRefundHeight) {
        actions.push({ chain: 'BCH', action: 'refund' });
      } else {
        const blocksRemaining =
          file.terms.bchRefundHeight - chainState.bchTipHeight;
        waits.push({
          chain: 'BCH',
          action: 'refund',
          waitingFor: `Waiting for BCH block height ${file.terms.bchRefundHeight} (${blocksRemaining.toLocaleString('en-US')} blocks remaining, about ${formatDuration(blocksRemaining * 600)})`,
        });
      }
    } else if (chainState.bchLock.state === 'none') {
      waits.push({
        chain: 'BCH',
        action: 'refund',
        waitingFor: 'Waiting for your BCH lock to be confirmed on chain',
      });
    }
  }

  const summary =
    actions.length > 0
      ? `Ready: ${actions.map((a) => `${a.chain} ${a.action}`).join(', ')}`
      : waits.length > 0
        ? waits.map((w) => w.waitingFor).join('; ')
        : 'Swap already settled on chain';

  return { direction, actions, waits, summary };
}

const FERRY_HTLC_RECOVERY_ABI = [
  {
    type: 'function',
    name: 'claim',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'secret', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'refund',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export interface EvmRecoveryCalldata {
  action: 'claim' | 'refund';
  chainId: number;
  to: Hex;
  data: Hex;
  value: 0n;
  lockId: Hex32;
}

/**
 * Build EVM calldata for the user's own recovery branch (never sends a tx):
 * - EVM_TO_BCH -> user refunds their own EVM lock
 * - BCH_TO_EVM -> user claims the solver's EVM lock with the secret
 */
export function buildEvmRecoveryCalldata(
  file: RecoveryFile,
): EvmRecoveryCalldata {
  const validated = RecoveryFileSchema.parse(file);
  if (validated.terms.direction === 'EVM_TO_BCH') {
    const lockId =
      validated.contracts.evm.lockId ??
      evmLockId(validated.terms.userEvmAddress, validated.hashLock);
    return {
      action: 'refund',
      chainId: validated.contracts.evm.chainId,
      to: validated.contracts.evm.htlcAddress,
      data: encodeFunctionData({
        abi: FERRY_HTLC_RECOVERY_ABI,
        functionName: 'refund',
        args: [lockId],
      }),
      value: 0n,
      lockId,
    };
  }

  if (!validated.secret) {
    throw new Error('Cannot build EVM claim calldata without the swap secret');
  }
  const lockId =
    validated.contracts.evm.lockId ??
    evmLockId(validated.terms.solverEvmAddress, validated.hashLock);
  return {
    action: 'claim',
    chainId: validated.contracts.evm.chainId,
    to: validated.contracts.evm.htlcAddress,
    data: encodeFunctionData({
      abi: FERRY_HTLC_RECOVERY_ABI,
      functionName: 'claim',
      args: [lockId, validated.secret],
    }),
    value: 0n,
    lockId,
  };
}

/** Seconds as a short human duration: "20 h 49 min", "7 min 30 s", "45 s". */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0)
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0)
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}
