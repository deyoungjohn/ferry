import { z } from 'zod';

export const DEFAULT_DEV_EVM_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

export const KNOWN_DEV_EVM_KEYS: readonly string[] = [
  DEFAULT_DEV_EVM_PRIVATE_KEY.toLowerCase(),
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil 0
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Anvil 2
  '0x0000000000000000000000000000000000000000000000000000000000000000',
];

export const MAINNET_BCH_ELECTRUM_URLS =
  'wss://blackie.c3-soft.com:50004,wss://bch.imaginary.cash:50004';
export const CHIPNET_BCH_ELECTRUM_URLS =
  'wss://chipnet.imaginary.cash:50004,wss://blackie.c3-soft.com:64004';

export const SolverConfigSchema = z
  .object({
    port: z.coerce.number().default(8787),
    host: z.string().default('127.0.0.1'),
    dbPath: z.string().default(':memory:'),
    network: z.enum(['testnet', 'mainnet']).default('testnet'),
    bchElectrumUrls: z.string().default(CHIPNET_BCH_ELECTRUM_URLS),
    baseRpcUrl: z.string().default('https://sepolia.base.org'),
    baseChainId: z.coerce.number().default(84532),
    baseHtlcAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .default('0x5A0C062f4B7b8fF2263530e12bc15De9C836a641'),
    baseUsdcAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .default('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    solverEvmPrivateKey: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .default(DEFAULT_DEV_EVM_PRIVATE_KEY),
    solverBchWif: z.string().optional(),
    operatorToken: z.string().min(32).optional(),
    dsproofWindowMs: z.coerce.number().default(5000),
    doubleSpendWaitMs: z.coerce.number().optional(),
    tipMaxAgeBchSeconds: z.coerce.number().default(7200),
    tipMaxAgeBaseSeconds: z.coerce.number().default(60),
    quotingEnabled: z.coerce.boolean().default(true),
    trustedProxy: z.coerce.boolean().default(false),
    rateLimitWindowMs: z.coerce.number().default(60000),
    rateLimitMaxPerAddress: z.coerce.number().default(10),
    rateLimitMaxPerIp: z.coerce.number().default(30),
    spreadBps: z.coerce.number().default(40),
    fixedFeeUsdMicros: z.coerce.bigint().default(0n),
    minSwapUsdMicros: z.coerce.bigint().default(1000000n),
    maxSwapUsdMicros: z.coerce.bigint().default(50000000n),
    maxExposureUsdMicros: z.coerce.bigint().default(250000000n),
    reservationCapPerAddressUsdMicros: z.coerce.bigint().optional(),
    reservationCapPerIpUsdMicros: z.coerce.bigint().optional(),
    zeroConfMaxUsdMicros: z.coerce.bigint().default(25000000n),
    quoteTtlSeconds: z.coerce.number().int().min(30).max(900).default(300),
    evmConfs: z.coerce.number().default(1),
    fwdBchRefundBlocks: z.coerce.number().default(36),
    fwdEvmDeadlineSeconds: z.coerce.number().default(86400),
    revBchRefundBlocks: z.coerce.number().default(144),
    revEvmDeadlineSeconds: z.coerce.number().default(21600),
    bchCarrySats: z.coerce.bigint().default(3000n),
    bchMaxFeeSats: z.coerce.bigint().default(1500n),
    skewMaxBps: z.coerce.number().default(50),
    pegToleranceUsdMicros: z.coerce.bigint().default(10000n),
    sourceDisagreementWarnUsdMicros: z.coerce.bigint().default(10000n),
    sourceDisagreementRefuseUsdMicros: z.coerce.bigint().default(20000n),
    paryonMaxAgeSeconds: z.coerce.number().default(7200),
    costModelEnabled: z.coerce.boolean().default(true),
    costSafetyPercent: z.coerce.number().default(25),
    minMarginUsdMicros: z.coerce.bigint().default(0n),
    costCacheTtlSeconds: z.coerce.number().default(45),
    costFeedGraceSeconds: z.coerce.number().default(900),
    baseRpcUrls: z.string().optional(),
    ethUsdFeedAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .default('0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'),
    ethUsdMaxAgeSeconds: z.coerce.number().default(1800),
    bchUsdMaxAgeSeconds: z.coerce.number().default(300),
    baseGasMaxAgeSeconds: z.coerce.number().default(60),
    bchFeeRateMaxAgeSeconds: z.coerce.number().default(300),
    bchUsdDisagreementPercent: z.coerce.number().default(5),
    tpusdCategory: z
      .string()
      .default(
        'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
      ),
    tmusdCategory: z
      .string()
      .default(
        'c99627aec3e041f281068704c2609699d234586d5097301eff995f3bd00ac04d',
      ),
    allowMockPaylinkSignatures: z.coerce.boolean().default(false),
    allowDevKeys: z.coerce.boolean().default(false),
    executionReady: z.coerce.boolean().default(true),
    allowedOrigins: z.string().default('*'),
    logLevel: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    logFilePath: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.network === 'mainnet') {
      if (!data.operatorToken || data.operatorToken.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'An operator token with at least 32 characters is required on mainnet. Refusing to start.',
          path: ['operatorToken'],
        });
      }

      const urls = data.bchElectrumUrls
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
      const hosts = new Set(
        urls.map((u) => {
          try {
            return new URL(u).host.toLowerCase();
          } catch {
            return u.toLowerCase();
          }
        }),
      );
      if (hosts.size < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `At least two distinct Electrum hosts are required on mainnet (configured: ${hosts.size}). Refusing to start without redundant quorum.`,
          path: ['bchElectrumUrls'],
        });
      }

      if (KNOWN_DEV_EVM_KEYS.includes(data.solverEvmPrivateKey.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'A default or placeholder private key cannot be used on mainnet. Refusing to start.',
          path: ['solverEvmPrivateKey'],
        });
      }

      if (data.solverBchWif) {
        const wif = data.solverBchWif.trim();
        if (wif.startsWith('c') || wif.startsWith('9')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'A testnet BCH WIF cannot be used on mainnet. Refusing to start.',
            path: ['solverBchWif'],
          });
        }
      }
    }

    if (
      data.reservationCapPerAddressUsdMicros !== undefined &&
      data.reservationCapPerAddressUsdMicros <= 0n
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'RESERVATION_CAP_PER_ADDRESS_USD_MICROS must be positive. Refusing to start.',
        path: ['reservationCapPerAddressUsdMicros'],
      });
    }

    if (
      data.reservationCapPerIpUsdMicros !== undefined &&
      data.reservationCapPerIpUsdMicros <= 0n
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'RESERVATION_CAP_PER_IP_USD_MICROS must be positive. Refusing to start.',
        path: ['reservationCapPerIpUsdMicros'],
      });
    }

    if (data.costSafetyPercent < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'COST_SAFETY_PERCENT must be non-negative. Refusing to start.',
        path: ['costSafetyPercent'],
      });
    }

    if (data.minMarginUsdMicros < 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'MIN_MARGIN_USD_MICROS must be non-negative. Refusing to start.',
        path: ['minMarginUsdMicros'],
      });
    }

    if (data.costCacheTtlSeconds <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'COST_CACHE_TTL_SECONDS must be positive. Refusing to start.',
        path: ['costCacheTtlSeconds'],
      });
    }
  });

export type SolverConfig = z.infer<typeof SolverConfigSchema>;

export function loadConfigFromEnv(
  env: Record<string, string | undefined>,
): SolverConfig {
  const network = (env.NETWORK || 'testnet').toLowerCase() as
    'testnet' | 'mainnet';
  const isMainnet = network === 'mainnet';

  const bchElectrumUrls = isMainnet
    ? env.BCH_ELECTRUM_URLS || MAINNET_BCH_ELECTRUM_URLS
    : env.BCH_CHIPNET_ELECTRUM_URLS ||
      env.BCH_ELECTRUM_URLS ||
      CHIPNET_BCH_ELECTRUM_URLS;

  const allowDevKeys =
    env.ALLOW_DEV_KEYS === '1' ||
    env.ALLOW_DEV_KEYS === 'true' ||
    env.FERRY_ALLOW_DEV_KEYS === '1';

  if (isMainnet && allowDevKeys) {
    throw new Error(
      'ALLOW_DEV_KEYS is not permitted on mainnet. Refusing to start.',
    );
  }

  const rawSolverKey = env.SOLVER_EVM_PRIVATE_KEY;
  let solverEvmPrivateKey: string;
  if (!rawSolverKey) {
    if (isMainnet) {
      throw new Error(
        'SOLVER_EVM_PRIVATE_KEY is required on mainnet. Refusing to start.',
      );
    }
    if (!allowDevKeys) {
      throw new Error(
        'SOLVER_EVM_PRIVATE_KEY is not set. Refusing to fall back to default dev key without explicit ALLOW_DEV_KEYS=1.',
      );
    }
    solverEvmPrivateKey = DEFAULT_DEV_EVM_PRIVATE_KEY;
  } else {
    solverEvmPrivateKey = rawSolverKey;
  }

  return SolverConfigSchema.parse({
    port: env.PORT,
    host: env.HOST,
    dbPath: env.DATABASE_PATH || env.DATABASE_URL,
    network,
    bchElectrumUrls,
    baseRpcUrl: env.BASE_RPC_URL,
    baseChainId: env.BASE_CHAIN_ID,
    baseHtlcAddress:
      env.BASE_FERRY_HTLC_ADDRESS ||
      env.BASE_HTLC_ADDRESS ||
      env.FERRY_HTLC_ADDRESS,
    baseUsdcAddress: env.BASE_USDC_ADDRESS || env.USDC_ADDRESS,
    solverEvmPrivateKey,
    solverBchWif: env.SOLVER_BCH_WIF || undefined,
    operatorToken: env.OPERATOR_TOKEN ? env.OPERATOR_TOKEN.trim() : undefined,
    dsproofWindowMs: env.DSPROOF_WINDOW_MS || env.DOUBLE_SPEND_WAIT_MS,
    doubleSpendWaitMs: env.DOUBLE_SPEND_WAIT_MS || env.DSPROOF_WINDOW_MS,
    tipMaxAgeBchSeconds: env.TIP_MAX_AGE_BCH_SECONDS,
    tipMaxAgeBaseSeconds: env.TIP_MAX_AGE_BASE_SECONDS,
    quotingEnabled:
      env.QUOTING_ENABLED !== undefined
        ? env.QUOTING_ENABLED === 'true'
        : undefined,
    trustedProxy:
      env.TRUSTED_PROXY !== undefined
        ? env.TRUSTED_PROXY === '1' || env.TRUSTED_PROXY === 'true'
        : env.TRUST_PROXY !== undefined
          ? env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true'
          : undefined,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxPerAddress: env.RATE_LIMIT_MAX_PER_ADDRESS,
    rateLimitMaxPerIp: env.RATE_LIMIT_MAX_PER_IP,
    spreadBps: env.SPREAD_BPS,
    fixedFeeUsdMicros: env.FIXED_FEE_USD_MICROS,
    minSwapUsdMicros: env.MIN_SWAP_USD_MICROS,
    maxSwapUsdMicros: env.MAX_SWAP_USD_MICROS,
    maxExposureUsdMicros: env.MAX_EXPOSURE_USD_MICROS,
    reservationCapPerAddressUsdMicros:
      env.RESERVATION_CAP_PER_ADDRESS_USD_MICROS ||
      env.MAX_RESERVATION_PER_ADDRESS_USD_MICROS,
    reservationCapPerIpUsdMicros:
      env.RESERVATION_CAP_PER_IP_USD_MICROS ||
      env.MAX_RESERVATION_PER_IP_USD_MICROS,
    zeroConfMaxUsdMicros: env.ZERO_CONF_MAX_USD_MICROS,
    quoteTtlSeconds: env.QUOTE_TTL_SECONDS,
    evmConfs: env.EVM_CONFS,
    fwdBchRefundBlocks: env.FWD_BCH_REFUND_BLOCKS,
    fwdEvmDeadlineSeconds: env.FWD_EVM_DEADLINE_SECONDS,
    revBchRefundBlocks: env.REV_BCH_REFUND_BLOCKS,
    revEvmDeadlineSeconds: env.REV_EVM_DEADLINE_SECONDS,
    bchCarrySats: env.BCH_CARRY_SATS,
    bchMaxFeeSats: env.BCH_MAX_FEE_SATS,
    skewMaxBps: env.SKEW_MAX_BPS,
    pegToleranceUsdMicros: env.PEG_TOLERANCE_USD_MICROS || env.PEG_TOLERANCE,
    sourceDisagreementWarnUsdMicros:
      env.SOURCE_DISAGREEMENT_WARN_USD_MICROS || env.SOURCE_DISAGREEMENT_WARN,
    sourceDisagreementRefuseUsdMicros:
      env.SOURCE_DISAGREEMENT_REFUSE_USD_MICROS ||
      env.SOURCE_DISAGREEMENT_REFUSE,
    paryonMaxAgeSeconds: env.PARYON_MAX_AGE_SECONDS || env.PARYON_MAX_AGE,
    costModelEnabled:
      env.COST_MODEL_ENABLED !== undefined
        ? env.COST_MODEL_ENABLED === '1' || env.COST_MODEL_ENABLED === 'true'
        : undefined,
    costSafetyPercent: env.COST_SAFETY_PERCENT,
    minMarginUsdMicros: env.MIN_MARGIN_USD_MICROS,
    costCacheTtlSeconds: env.COST_CACHE_TTL_SECONDS,
    costFeedGraceSeconds: env.COST_FEED_GRACE_SECONDS,
    baseRpcUrls: env.BASE_RPC_URLS,
    ethUsdFeedAddress: env.ETH_USD_FEED_ADDRESS,
    ethUsdMaxAgeSeconds: env.ETH_USD_MAX_AGE_SECONDS,
    bchUsdMaxAgeSeconds: env.BCH_USD_MAX_AGE_SECONDS,
    baseGasMaxAgeSeconds: env.BASE_GAS_MAX_AGE_SECONDS,
    bchFeeRateMaxAgeSeconds: env.BCH_FEE_RATE_MAX_AGE_SECONDS,
    bchUsdDisagreementPercent: env.BCH_USD_DISAGREEMENT_PERCENT,
    tpusdCategory: env.TPUSD_CATEGORY,
    tmusdCategory: env.TMUSD_CATEGORY,
    allowMockPaylinkSignatures:
      env.ALLOW_MOCK_PAYLINK_SIGNATURES === '1' ||
      env.ALLOW_MOCK_PAYLINK_SIGNATURES === 'true' ||
      allowDevKeys,
    allowDevKeys,
    allowedOrigins: env.ALLOWED_ORIGINS,
    logLevel: env.LOG_LEVEL?.toLowerCase(),
    logFilePath: env.LOG_FILE_PATH,
  });
}

/**
 * Returns a redacted representation of configuration safe for logging or terminal display.
 * Never prints private keys, WIFs or tokens.
 */
export function redactConfigForDisplay(config: SolverConfig): string {
  const safe = {
    network: config.network,
    host: config.host,
    port: config.port,
    dbPath: config.dbPath,
    bchElectrumUrls: config.bchElectrumUrls,
    baseRpcUrl: config.baseRpcUrl,
    baseChainId: config.baseChainId,
    baseHtlcAddress: config.baseHtlcAddress,
    baseUsdcAddress: config.baseUsdcAddress,
    solverEvmPrivateKey: '[REDACTED]',
    solverBchWif: config.solverBchWif ? '[REDACTED]' : undefined,
    operatorToken: config.operatorToken ? '[REDACTED]' : undefined,
    quotingEnabled: config.quotingEnabled,
    skewMaxBps: config.skewMaxBps,
    dsproofWindowMs: config.dsproofWindowMs,
  };
  return JSON.stringify(safe, null, 2);
}
