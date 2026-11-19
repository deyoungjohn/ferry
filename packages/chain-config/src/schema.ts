import { z } from 'zod';

export const FACT_STATUSES = ['verified', 'reported', 'unavailable'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const CHAIN_IDS = [
  'base',
  'ethereum',
  'arbitrum',
  'arc',
  'bnb',
  'robinhood',
] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

export const NETWORKS = ['mainnet', 'testnet'] as const;
export type Network = (typeof NETWORKS)[number];

export const ASSET_SYMBOLS = ['USDC', 'USDT', 'USDG'] as const;
export type AssetSymbol = (typeof ASSET_SYMBOLS)[number];

export const NATIVE_GAS_TOKENS = ['ETH', 'BNB', 'USDC'] as const;
export type NativeGas = (typeof NATIVE_GAS_TOKENS)[number];

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte hex address');

const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hex value');

export const factEvidenceSchema = z.object({
  status: z.enum(FACT_STATUSES),
  source: z.string().min(1),
  date: dateSchema,
  note: z.string().optional(),
});
export type FactEvidence = z.infer<typeof factEvidenceSchema>;

const rpcSchema = z.object({
  url: z.string().url(),
  getLogsMaxRange: z.number().int().nonnegative().nullable(),
  evidence: factEvidenceSchema,
});
export type RpcFact = z.infer<typeof rpcSchema>;

const finalitySchema = z.object({
  fastBlocks: z.number().int().positive(),
  safeTag: z.enum(['safe', 'finalized']),
  blockTimeSeconds: z.number().positive(),
  safeTagWorks: z.boolean(),
  finalizedTagWorks: z.boolean(),
  evidence: factEvidenceSchema,
});
export type FinalityFact = z.infer<typeof finalitySchema>;

const create2FactorySchema = z.object({
  address: addressSchema,
  hasCode: z.boolean(),
  evidence: factEvidenceSchema,
});
export type Create2FactoryFact = z.infer<typeof create2FactorySchema>;

const tokenVerificationSchema = z.object({
  address: factEvidenceSchema,
  decimals: factEvidenceSchema,
  eip712: factEvidenceSchema,
  permit: factEvidenceSchema,
});
export type TokenVerification = z.infer<typeof tokenVerificationSchema>;

export const tokenFactsSchema = z.object({
  symbol: z.enum(ASSET_SYMBOLS),
  address: addressSchema.nullable(),
  decimals: z.number().int().min(0).max(36).nullable(),
  name: z.string().min(1).nullable(),
  version: z.string().min(1).nullable(),
  domainSeparator: bytes32Schema.nullable(),
  permit: z.boolean(),
  nonces: z.boolean(),
  nativeOrBridged: z.enum(['native', 'bridged', 'wrapped', 'native-gas']),
  issuer: z.string().min(1),
  verification: tokenVerificationSchema,
  notes: z.string().optional(),
});
export type TokenFacts = z.infer<typeof tokenFactsSchema>;

export const deploymentFactsSchema = z.object({
  htlcAddress: addressSchema.nullable(),
  deployBlock: z.number().int().positive().nullable(),
  relayCostUsd: z.number().nonnegative().nullable(),
  evidence: factEvidenceSchema,
});
export type DeploymentFacts = z.infer<typeof deploymentFactsSchema>;

export const priceFeedFactsSchema = z.object({
  asset: z.enum(ASSET_SYMBOLS),
  pair: z.enum(['USDC/USD', 'USDT/USD', 'USDG/USD']),
  source: z.literal('Chainlink'),
  address: addressSchema,
  decimals: z.number().int().min(0).max(36),
  heartbeatSeconds: z.number().int().positive(),
  deviationThresholdPercent: z.number().positive(),
  sampleAnswer: z.string().regex(/^\d+$/),
  sampleUpdatedAt: z.number().int().positive(),
  sampleReadAt: z.string().min(1),
  evidence: factEvidenceSchema,
});
export type PriceFeedFacts = z.infer<typeof priceFeedFactsSchema>;

export const networkFactsSchema = z.object({
  chainId: z.number().int().positive(),
  rpcUrls: z.array(rpcSchema).min(2),
  explorerUrl: z.string().url(),
  nativeGas: z.enum(NATIVE_GAS_TOKENS),
  finality: finalitySchema,
  create2Factory: create2FactorySchema,
  deployment: deploymentFactsSchema,
  tokens: z.array(tokenFactsSchema),
  priceFeeds: z.array(priceFeedFactsSchema),
  notes: z.string().optional(),
});
export type NetworkFacts = z.infer<typeof networkFactsSchema>;

const chainFactsSchema = z.object({
  name: z.string().min(1),
  mainnet: networkFactsSchema,
  testnet: networkFactsSchema,
});
export type ChainFacts = z.infer<typeof chainFactsSchema>;

export const chainConfigDataSchema = z.object({
  version: z.literal(1),
  generatedAt: dateSchema,
  chains: z.object({
    base: chainFactsSchema,
    ethereum: chainFactsSchema,
    arbitrum: chainFactsSchema,
    arc: chainFactsSchema,
    bnb: chainFactsSchema,
    robinhood: chainFactsSchema,
  }),
});
export type ChainConfigData = z.infer<typeof chainConfigDataSchema>;

export class ChainConfigDataError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Invalid chain facts data:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'ChainConfigDataError';
    this.issues = issues;
  }
}

export function parseChainConfigData(input: unknown): ChainConfigData {
  const result = chainConfigDataSchema.safeParse(input);
  if (result.success) return result.data;
  throw new ChainConfigDataError(
    result.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
    ),
  );
}

export function isVerified(evidence: FactEvidence): boolean {
  return evidence.status === 'verified';
}
