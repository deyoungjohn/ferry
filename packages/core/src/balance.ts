export interface BalanceUtxo {
  readonly satoshis: bigint;
  readonly token?:
    | {
        readonly category: string;
        readonly amount: bigint;
      }
    | undefined;
}

export interface UtxoBalances {
  readonly satoshis: bigint;
  readonly tokenAmount: bigint;
}

function normalizeCategoryHex(category: string): string {
  return category.replace(/^0x/i, '').toLowerCase();
}

/**
 * Sum satoshi and token balances across a list of UTXOs.
 * When `category` is provided, only tokens matching that category are summed.
 */
export function sumUtxoBalances(
  utxos: readonly BalanceUtxo[],
  category?: string,
): UtxoBalances {
  const targetCategory =
    category !== undefined ? normalizeCategoryHex(category) : null;
  let satoshis = 0n;
  let tokenAmount = 0n;
  for (const utxo of utxos) {
    if (utxo.satoshis < 0n) {
      throw new RangeError('UTXO satoshis cannot be negative');
    }
    satoshis += utxo.satoshis;
    if (utxo.token) {
      if (utxo.token.amount < 0n) {
        throw new RangeError('UTXO token amount cannot be negative');
      }
      if (
        targetCategory === null ||
        normalizeCategoryHex(utxo.token.category) === targetCategory
      ) {
        tokenAmount += utxo.token.amount;
      }
    }
  }
  return { satoshis, tokenAmount };
}

/**
 * Format an integer base-unit amount with `decimals` fractional digits.
 */
export function formatTokenUnits(amount: bigint, decimals: number): string {
  if (amount < 0n) {
    throw new RangeError('Amount must be non-negative');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError('Decimals must be an integer from 0 to 36');
  }
  if (decimals === 0) {
    return amount.toString();
  }
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0');
  return `${whole.toString()}.${fraction}`;
}

export interface BalanceShortfallResult {
  readonly sufficient: boolean;
  readonly shortfall: bigint;
  readonly message: string | null;
}

/**
 * Check whether `available` covers `required` and format a user-facing
 * shortfall sentence when it does not.
 */
export function checkBalanceShortfall(params: {
  readonly required: bigint;
  readonly available: bigint;
  readonly decimals: number;
  readonly symbol: string;
}): BalanceShortfallResult {
  const { required, available, decimals, symbol } = params;
  if (required < 0n || available < 0n) {
    throw new RangeError('Amounts must be non-negative');
  }
  if (available >= required) {
    return { sufficient: true, shortfall: 0n, message: null };
  }
  const shortfall = required - available;
  const neededText = formatTokenUnits(required, decimals);
  const availableText = formatTokenUnits(available, decimals);
  return {
    sufficient: false,
    shortfall,
    message: `You need ${neededText} ${symbol}; this wallet has ${availableText}`,
  };
}
