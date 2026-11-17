import {
  MockNetworkProvider,
  Network,
  SignatureTemplate,
  TransactionBuilder,
  type NetworkProvider,
} from 'cashscript';
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  hexToBin,
  sha256,
  type Output,
  type Transaction,
} from '@bitauth/libauth';
import { internalToDisplayCategory } from './byte-order.js';
import { assertLockOutputBindsRedeemScript } from './p2sh32.js';
import {
  deriveHtlcAddresses,
  encodeHtlcParameters,
  resolveLockingBytecode,
} from './contract.js';
import type { ElectrumUtxo } from './electrum.js';
import { verifyBchTransactionWithVm } from './spends.js';
import type {
  BchHtlcParameters,
  CashAddressNetwork,
  HtlcInputTerms,
  OrderTerms,
} from './types.js';

export type DerivationBranch = 'receive' | 'change';
export type InputDerivationPath = [
  inputIndex: number,
  branch: DerivationBranch,
  addressIndex: number,
];

export interface LockUtxo {
  txid: string;
  vout: number;
  satoshis: bigint;
  lockingBytecode?: Uint8Array | undefined;
  derivationPath?: [DerivationBranch, number] | undefined;
  token?:
    | {
        category: string;
        amount: bigint;
        nft?:
          | {
              capability?: string | undefined;
              commitment?: string | Uint8Array | undefined;
            }
          | undefined;
      }
    | undefined;
}

export interface WcSourceOutput {
  outpointIndex: number;
  outpointTransactionHash: Uint8Array;
  sequenceNumber: number;
  unlockingBytecode: Uint8Array;
  valueSatoshis: bigint;
  lockingBytecode: Uint8Array;
  token?:
    | {
        category: Uint8Array;
        amount: bigint;
        nft?: {
          capability: 'none' | 'mutable' | 'minting';
          commitment: Uint8Array;
        };
      }
    | undefined;
}

export interface WcSignTransactionRequest {
  transaction: Transaction | string;
  sourceOutputs: WcSourceOutput[];
  derivationPaths: InputDerivationPath[];
  broadcast?: boolean | undefined;
  userPrompt?: string | undefined;
}

export interface UnsignedLockTransaction {
  transaction: Transaction;
  txHex: string;
  txid: string;
  sourceOutputs: WcSourceOutput[];
  derivationPaths: InputDerivationPath[];
  wcSignRequest: WcSignTransactionRequest;
}

export interface SignedLockTransaction {
  transaction: Transaction;
  txHex: string;
  txid: string;
}

export interface SelectLockInputsOptions {
  utxos: Array<LockUtxo | ElectrumUtxo | unknown>;
  tokenCategory: string | Uint8Array;
  tokenAmount: bigint | number;
  bchCarrySats?: bigint | number | undefined;
  tokenChangeCarrySats?: bigint | number | undefined;
  feeRateSatPerByte?: number | undefined;
  userLockingBytecode?: Uint8Array | string | undefined;
  userAddress?: string | undefined;
}

export interface SelectedLockInputs {
  tokenInputs: LockUtxo[];
  bchInputs: LockUtxo[];
  allInputs: LockUtxo[];
  totalTokenAmount: bigint;
  totalSatoshis: bigint;
  hasTokenChange: boolean;
  tokenChangeAmount: bigint;
  estimatedFeeSats: bigint;
}

export interface BuildLockTxOptions {
  params: BchHtlcParameters | HtlcInputTerms | OrderTerms;
  inputs?: Array<LockUtxo | ElectrumUtxo | unknown> | undefined;
  utxos?: Array<LockUtxo | ElectrumUtxo | unknown> | undefined;
  selectedInputs?: SelectedLockInputs | undefined;
  changeAddress: string;
  tokenChangeAddress?: string | undefined;
  bchCarrySats?: bigint | number | undefined;
  tokenChangeCarrySats?: bigint | number | undefined;
  feeSats?: bigint | number | undefined;
  feeRateSatPerByte?: number | undefined;
  dustLimitSats?: bigint | number | undefined;
  wif?: string | undefined;
  privateKey?: Uint8Array | undefined;
  network?: CashAddressNetwork | undefined;
  provider?: NetworkProvider | undefined;
  userPrompt?: string | undefined;
}

export interface BuildLockTxResult {
  unsigned: UnsignedLockTransaction;
  signed?: SignedLockTransaction | undefined;
  htlcOutputIndex: number;
  htlcP2sh32Address: string;
  htlcTokenAddress: string;
  htlcLockingBytecode: Uint8Array;
  feeSats: bigint;
  tokenChangeAmount: bigint;
  bchChangeSats: bigint;
  selectedInputs: SelectedLockInputs;
}

function computeTxId(txHex: string): string {
  const raw = hexToBin(txHex);
  const hash = sha256.hash(sha256.hash(raw));
  const reversed = new Uint8Array(hash.length);
  for (let i = 0; i < hash.length; i++) {
    reversed[i] = hash[hash.length - 1 - i]!;
  }
  return binToHex(reversed);
}

export function normaliseLockUtxo(
  u: unknown,
  defaultLockingBytecode?: Uint8Array | undefined,
): LockUtxo {
  if (!u || typeof u !== 'object') {
    throw new Error(`Invalid UTXO object: ${JSON.stringify(u)}`);
  }
  const obj = u as Record<string, unknown>;
  const txid = (obj.txid ?? obj.tx_hash) as string;
  if (!txid || typeof txid !== 'string') {
    throw new Error('UTXO missing txid/tx_hash');
  }
  const vout = (obj.vout ?? obj.tx_pos) as number;
  if (typeof vout !== 'number') {
    throw new Error('UTXO missing vout/tx_pos');
  }
  const satsRaw = obj.satoshis ?? obj.value;
  if (satsRaw === undefined) {
    throw new Error('UTXO missing satoshis/value');
  }
  const satoshis = BigInt(satsRaw as string | number | bigint);

  let lockingBytecode: Uint8Array | undefined;
  if (obj.lockingBytecode) {
    lockingBytecode =
      typeof obj.lockingBytecode === 'string'
        ? resolveLockingBytecode(obj.lockingBytecode)
        : (obj.lockingBytecode as Uint8Array);
  } else if (defaultLockingBytecode) {
    lockingBytecode = defaultLockingBytecode;
  }

  let token: LockUtxo['token'];
  const tokenData = (obj.token ?? obj.token_data) as
    Record<string, unknown> | undefined;
  if (tokenData && typeof tokenData === 'object') {
    const cat = tokenData.category as string;
    const amt = BigInt((tokenData.amount ?? 0) as string | number | bigint);
    token = {
      category: cat.toLowerCase(),
      amount: amt,
      ...(tokenData.nft
        ? { nft: tokenData.nft as NonNullable<LockUtxo['token']>['nft'] }
        : {}),
    };
  }

  const derivationPath = Array.isArray(obj.derivationPath)
    ? (obj.derivationPath as [DerivationBranch, number])
    : undefined;

  return {
    txid,
    vout,
    satoshis,
    ...(lockingBytecode ? { lockingBytecode } : {}),
    ...(derivationPath ? { derivationPath } : {}),
    ...(token ? { token } : {}),
  };
}

export function estimateLockFee(
  inputCount: number,
  outputCount: number,
  feeRateSatPerByte = 1.2,
  marginSats = 150n,
): bigint {
  const vbytes = 10 + inputCount * 148 + 77 + Math.max(0, outputCount - 1) * 50;
  return BigInt(Math.ceil(vbytes * feeRateSatPerByte)) + marginSats;
}

export function selectLockInputs(
  options: SelectLockInputsOptions,
): SelectedLockInputs {
  const targetCategoryHex = (
    typeof options.tokenCategory === 'string'
      ? options.tokenCategory
      : binToHex(options.tokenCategory)
  )
    .trim()
    .toLowerCase();

  const targetAmount = BigInt(options.tokenAmount);
  if (targetAmount <= 0n) {
    throw new Error(
      `Token amount must be greater than zero, got ${targetAmount}`,
    );
  }

  const bchCarrySats = BigInt(options.bchCarrySats ?? 3000n);
  const tokenChangeCarrySats = BigInt(options.tokenChangeCarrySats ?? 1000n);
  const feeRate = options.feeRateSatPerByte ?? 1.2;

  let defaultLockingBytecode: Uint8Array | undefined;
  if (options.userLockingBytecode) {
    defaultLockingBytecode = resolveLockingBytecode(
      options.userLockingBytecode,
    );
  } else if (options.userAddress) {
    defaultLockingBytecode = resolveLockingBytecode(options.userAddress);
  }

  const normalisedUtxos = options.utxos.map((u) =>
    normaliseLockUtxo(u, defaultLockingBytecode),
  );

  const candidateTokenUtxos: LockUtxo[] = [];
  const candidateBchUtxos: LockUtxo[] = [];

  for (const u of normalisedUtxos) {
    if (u.token) {
      if (u.token.nft || u.token.category !== targetCategoryHex) {
        continue;
      }
      if (u.token.amount > 0n) {
        candidateTokenUtxos.push(u);
      } else {
        candidateBchUtxos.push(u);
      }
    } else {
      candidateBchUtxos.push(u);
    }
  }

  candidateTokenUtxos.sort((a, b) => {
    if (b.token!.amount !== a.token!.amount) {
      return b.token!.amount > a.token!.amount ? 1 : -1;
    }
    const cmp = a.txid.localeCompare(b.txid);
    return cmp !== 0 ? cmp : a.vout - b.vout;
  });

  const selectedTokenInputs: LockUtxo[] = [];
  let accumulatedTokens = 0n;
  for (const u of candidateTokenUtxos) {
    selectedTokenInputs.push(u);
    accumulatedTokens += u.token!.amount;
    if (accumulatedTokens >= targetAmount) break;
  }

  if (accumulatedTokens < targetAmount) {
    throw new Error(
      `Insufficient token balance for category ${targetCategoryHex}: required ${targetAmount}, available ${accumulatedTokens}`,
    );
  }

  const hasTokenChange = accumulatedTokens > targetAmount;
  const tokenChangeAmount = accumulatedTokens - targetAmount;
  const tokenInputsSatoshis = selectedTokenInputs.reduce(
    (sum, u) => sum + u.satoshis,
    0n,
  );

  const expectedOutputsCount = 1 + (hasTokenChange ? 1 : 0) + 1;
  const estimatedInitialFee = estimateLockFee(
    selectedTokenInputs.length + 1,
    expectedOutputsCount,
    feeRate,
  );
  const baseRequiredSats =
    bchCarrySats +
    (hasTokenChange ? tokenChangeCarrySats : 0n) +
    estimatedInitialFee;

  const selectedBchInputs: LockUtxo[] = [];
  let currentTotalSatoshis = tokenInputsSatoshis;

  if (currentTotalSatoshis < baseRequiredSats) {
    const deficitSats = baseRequiredSats - currentTotalSatoshis;
    candidateBchUtxos.sort((a, b) => {
      if (a.satoshis !== b.satoshis) {
        return a.satoshis > b.satoshis ? 1 : -1;
      }
      const cmp = a.txid.localeCompare(b.txid);
      return cmp !== 0 ? cmp : a.vout - b.vout;
    });

    const singleSufficient = candidateBchUtxos.find(
      (u) => u.satoshis >= deficitSats,
    );
    if (singleSufficient) {
      selectedBchInputs.push(singleSufficient);
      currentTotalSatoshis += singleSufficient.satoshis;
    } else {
      for (const u of candidateBchUtxos) {
        selectedBchInputs.push(u);
        currentTotalSatoshis += u.satoshis;
        const currentFee = estimateLockFee(
          selectedTokenInputs.length + selectedBchInputs.length,
          expectedOutputsCount,
          feeRate,
        );
        const currentRequired =
          bchCarrySats +
          (hasTokenChange ? tokenChangeCarrySats : 0n) +
          currentFee;
        if (currentTotalSatoshis >= currentRequired) break;
      }
    }
  }

  const finalFee = estimateLockFee(
    selectedTokenInputs.length + selectedBchInputs.length,
    expectedOutputsCount,
    feeRate,
  );
  const finalRequired =
    bchCarrySats + (hasTokenChange ? tokenChangeCarrySats : 0n) + finalFee;

  if (currentTotalSatoshis < finalRequired) {
    throw new Error(
      `Insufficient BCH balance for fees and carry satoshis: required ${finalRequired}, available ${currentTotalSatoshis}`,
    );
  }

  return {
    tokenInputs: selectedTokenInputs,
    bchInputs: selectedBchInputs,
    allInputs: [...selectedTokenInputs, ...selectedBchInputs],
    totalTokenAmount: accumulatedTokens,
    totalSatoshis: currentTotalSatoshis,
    hasTokenChange,
    tokenChangeAmount,
    estimatedFeeSats: finalFee,
  };
}

/**
 * Verify locally that a signed lock transaction has non-empty unlockingBytecode
 * on every input and passes the Libauth BCH VM against its sourceOutputs.
 */
export function verifySignedLockTransaction(
  signedTxHex: string,
  sourceOutputs: WcSourceOutput[],
): SignedLockTransaction {
  const decoded = decodeTransaction(hexToBin(signedTxHex));
  if (typeof decoded === 'string') {
    throw new Error(`Failed to decode signed lock transaction: ${decoded}`);
  }
  if (decoded.inputs.length !== sourceOutputs.length) {
    throw new Error(
      `Input count mismatch: tx has ${decoded.inputs.length}, expected ${sourceOutputs.length}`,
    );
  }
  for (let i = 0; i < decoded.inputs.length; i++) {
    if (decoded.inputs[i]!.unlockingBytecode.length === 0) {
      throw new Error(`Input ${i} is unsigned (empty unlockingBytecode)`);
    }
  }
  const vmResult = verifyBchTransactionWithVm({
    transaction: decoded,
    sourceOutputs,
  });
  if (vmResult !== true) {
    throw new Error(`BCH lock script VM verification failed: ${vmResult}`);
  }
  return {
    transaction: decoded,
    txHex: signedTxHex,
    txid: computeTxId(signedTxHex),
  };
}

export function buildLockTransaction(
  options: BuildLockTxOptions,
): BuildLockTxResult {
  const network = options.network ?? 'chipnet';
  const canonicalParams = encodeHtlcParameters(options.params);
  const htlcDerivation = deriveHtlcAddresses(canonicalParams, network);

  const rawCarry =
    options.bchCarrySats ??
    (options.params && 'bchCarrySats' in options.params
      ? (options.params as { bchCarrySats?: bigint | number }).bchCarrySats
      : undefined);
  const bchCarrySats = BigInt(rawCarry ?? 3000n);
  const tokenChangeCarrySats = BigInt(options.tokenChangeCarrySats ?? 1000n);
  const dustLimitSats = BigInt(options.dustLimitSats ?? 546n);

  const changeLockingBytecode = resolveLockingBytecode(options.changeAddress);
  const tokenChangeLockingBytecode = options.tokenChangeAddress
    ? resolveLockingBytecode(options.tokenChangeAddress)
    : changeLockingBytecode;

  const displayCategory = internalToDisplayCategory(
    canonicalParams.tokenCategory,
  ).toLowerCase();

  let selected: SelectedLockInputs;
  if (options.selectedInputs) {
    selected = options.selectedInputs;
  } else {
    const rawUtxos = options.inputs ?? options.utxos;
    if (!rawUtxos || rawUtxos.length === 0) {
      throw new Error(
        'buildLockTransaction requires inputs, utxos, or selectedInputs',
      );
    }
    selected = selectLockInputs({
      utxos: rawUtxos,
      tokenCategory: displayCategory,
      tokenAmount: canonicalParams.tokenAmount,
      bchCarrySats,
      tokenChangeCarrySats,
      ...(options.feeRateSatPerByte !== undefined
        ? { feeRateSatPerByte: options.feeRateSatPerByte }
        : {}),
      userLockingBytecode: changeLockingBytecode,
    });
  }

  for (const input of selected.allInputs) {
    if (!input.lockingBytecode) {
      input.lockingBytecode = changeLockingBytecode;
    }
  }

  for (const input of selected.tokenInputs) {
    if (!input.token) {
      throw new Error(
        `Selected token input ${input.txid}:${input.vout} has no token data`,
      );
    }
    if (input.token.nft) {
      throw new Error(
        `Selected token input ${input.txid}:${input.vout} carries an NFT, which is forbidden`,
      );
    }
    if (input.token.category.toLowerCase() !== displayCategory) {
      throw new Error(
        `Selected token input category mismatch: expected ${displayCategory}, got ${input.token.category}`,
      );
    }
  }

  if (selected.totalTokenAmount < canonicalParams.tokenAmount) {
    throw new Error(
      `Insufficient token amount: required ${canonicalParams.tokenAmount}, selected ${selected.totalTokenAmount}`,
    );
  }

  let feeSats =
    options.feeSats !== undefined
      ? BigInt(options.feeSats)
      : selected.estimatedFeeSats;

  const totalInSats = selected.totalSatoshis;
  const tokenChangeAmount =
    selected.totalTokenAmount - canonicalParams.tokenAmount;
  const hasTokenChange = tokenChangeAmount > 0n;

  const baseAllocatedSats =
    bchCarrySats + (hasTokenChange ? tokenChangeCarrySats : 0n) + feeSats;

  if (totalInSats < baseAllocatedSats) {
    throw new Error(
      `Total input satoshis (${totalInSats}) insufficient for carry (${bchCarrySats}), token change carry (${hasTokenChange ? tokenChangeCarrySats : 0n}), and fee (${feeSats})`,
    );
  }

  const remainingBch = totalInSats - baseAllocatedSats;
  let bchChangeSats = 0n;
  if (remainingBch >= dustLimitSats) {
    bchChangeSats = remainingBch;
  } else if (remainingBch > 0n) {
    feeSats += remainingBch;
  }

  const categoryBytes = hexToBin(displayCategory);
  // Funds sent to an output whose hash does not match the redeem script can
  // never be spent: stop before anything is built or signed.
  assertLockOutputBindsRedeemScript(
    htlcDerivation.lockingBytecode,
    htlcDerivation.redeemScript,
  );
  const outputs: Output[] = [
    {
      lockingBytecode: htlcDerivation.lockingBytecode,
      valueSatoshis: bchCarrySats,
      token: {
        category: categoryBytes,
        amount: canonicalParams.tokenAmount,
      },
    },
  ];

  if (hasTokenChange) {
    outputs.push({
      lockingBytecode: tokenChangeLockingBytecode,
      valueSatoshis: tokenChangeCarrySats,
      token: {
        category: categoryBytes,
        amount: tokenChangeAmount,
      },
    });
  }

  if (bchChangeSats > 0n) {
    outputs.push({
      lockingBytecode: changeLockingBytecode,
      valueSatoshis: bchChangeSats,
    });
  }

  const unsignedLibauthTx: Transaction = {
    version: 2,
    inputs: selected.allInputs.map((u) => ({
      outpointIndex: u.vout,
      outpointTransactionHash: hexToBin(u.txid),
      sequenceNumber: 0,
      unlockingBytecode: new Uint8Array(0),
    })),
    outputs,
    locktime: 0,
  };

  const unsignedTxHex = binToHex(encodeTransaction(unsignedLibauthTx));
  const unsignedTxid = computeTxId(unsignedTxHex);

  const sourceOutputs: WcSourceOutput[] = selected.allInputs.map((u) => ({
    outpointIndex: u.vout,
    outpointTransactionHash: hexToBin(u.txid),
    sequenceNumber: 0,
    unlockingBytecode: new Uint8Array(0),
    valueSatoshis: u.satoshis,
    lockingBytecode: u.lockingBytecode ?? changeLockingBytecode,
    ...(u.token
      ? {
          token: {
            category: hexToBin(u.token.category),
            amount: u.token.amount,
          },
        }
      : {}),
  }));

  const derivationPaths: InputDerivationPath[] = selected.allInputs.map(
    (u, index) => [
      index,
      u.derivationPath?.[0] ?? 'receive',
      u.derivationPath?.[1] ?? 0,
    ],
  );

  const wcSignRequest: WcSignTransactionRequest = {
    transaction: unsignedTxHex,
    sourceOutputs,
    derivationPaths,
    broadcast: false,
    userPrompt:
      options.userPrompt ??
      `Lock ${canonicalParams.tokenAmount} tokens into Ferry HTLC`,
  };

  const unsignedResult: UnsignedLockTransaction = {
    transaction: unsignedLibauthTx,
    txHex: unsignedTxHex,
    txid: unsignedTxid,
    sourceOutputs,
    derivationPaths,
    wcSignRequest,
  };

  let signedResult: SignedLockTransaction | undefined;
  if (options.wif || options.privateKey) {
    const mockProvider = options.provider ?? new MockNetworkProvider();
    mockProvider.network =
      network === 'mainnet' ? Network.MAINNET : Network.CHIPNET;

    const sigTemplate = options.wif
      ? new SignatureTemplate(options.wif)
      : new SignatureTemplate(options.privateKey!);

    const tb = new TransactionBuilder({ provider: mockProvider });
    for (const u of selected.allInputs) {
      tb.addInput(
        {
          txid: u.txid,
          vout: u.vout,
          satoshis: u.satoshis,
          lockingBytecode: binToHex(u.lockingBytecode ?? changeLockingBytecode),
          ...(u.token
            ? {
                token: {
                  category: u.token.category,
                  amount: u.token.amount,
                },
              }
            : {}),
        },
        sigTemplate.unlockP2PKH(),
      );
    }

    for (const out of outputs) {
      tb.addOutput({
        to: out.lockingBytecode,
        amount: out.valueSatoshis,
        ...(out.token
          ? {
              token: {
                category: binToHex(out.token.category),
                amount: out.token.amount,
              },
            }
          : {}),
      });
    }

    const signedTxHex = tb.build();
    signedResult = verifySignedLockTransaction(signedTxHex, sourceOutputs);
  }

  return {
    unsigned: unsignedResult,
    ...(signedResult ? { signed: signedResult } : {}),
    htlcOutputIndex: 0,
    htlcP2sh32Address: htlcDerivation.p2sh32Address,
    htlcTokenAddress: htlcDerivation.tokenAddress,
    htlcLockingBytecode: htlcDerivation.lockingBytecode,
    feeSats,
    tokenChangeAmount,
    bchChangeSats,
    selectedInputs: selected,
  };
}
