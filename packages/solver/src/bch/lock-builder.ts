import * as libauth from '@bitauth/libauth';
import {
  assertP2sh32Matches,
  buildClaimTransaction,
  buildLockTransaction,
  buildReleaseTransaction,
  deriveHtlcAddresses,
  displayToInternalCategory,
  encodeHtlcParameters,
  parseHtlcSpendInput,
  resolveLockingBytecode,
  type CashAddressNetwork,
  type ElectrumUtxo,
  type LockUtxo,
} from '@ferry/htlc-bch';
import { assertValidSecret, isValidSecret, type OrderTerms } from '@ferry/core';
import { isForwardDirection } from '../state-machine/transitions.js';
import type { SolverOrderRecord } from '../state-machine/types.js';

export function computeTxId(txHex: string): string {
  const raw = libauth.hexToBin(txHex);
  const hash = libauth.sha256.hash(libauth.sha256.hash(raw));
  const reversed = new Uint8Array(hash.length);
  for (let i = 0; i < hash.length; i++) {
    reversed[i] = hash[hash.length - 1 - i]!;
  }
  return libauth.binToHex(reversed);
}

export async function deriveBchKeyDetails(
  wif: string,
  prefix: 'bchtest' | 'bitcoincash' = 'bchtest',
) {
  const decoded = libauth.decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') {
    throw new Error(`Failed to decode WIF: ${decoded}`);
  }
  const secp = await libauth.instantiateSecp256k1();
  const pub = secp.derivePublicKeyCompressed(decoded.privateKey);
  if (typeof pub === 'string') {
    throw new Error('Failed to derive public key');
  }
  const pkh = libauth.hash160(pub);
  const p2pkhBytecode = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
  const p2pkhBytecodeHex = libauth.binToHex(p2pkhBytecode);
  const scriptHash = libauth.binToHex(
    libauth.sha256.hash(p2pkhBytecode).reverse(),
  );

  const cashAddressResult = libauth.lockingBytecodeToCashAddress({
    bytecode: p2pkhBytecode,
    prefix,
  });
  const address =
    typeof cashAddressResult === 'string'
      ? undefined
      : cashAddressResult.address;

  return {
    privateKey: decoded.privateKey,
    p2pkhBytecode,
    p2pkhBytecodeHex,
    lockingBytecodeHex: `0x${p2pkhBytecodeHex}` as `0x${string}`,
    scriptHash,
    address,
  };
}

export function extractSecretFromClaimUnlock(
  unlockingBytecode: Uint8Array,
  expectedHashLock: string,
): `0x${string}` | null {
  const cleanExpected = expectedHashLock.startsWith('0x')
    ? expectedHashLock.slice(2).toLowerCase()
    : expectedHashLock.toLowerCase();

  // 1. Direct check: standard CashScript push (0x20 = 32 bytes)
  if (unlockingBytecode.length >= 33 && unlockingBytecode[0] === 0x20) {
    const candidate = unlockingBytecode.slice(1, 33);
    const hash = libauth.binToHex(libauth.sha256.hash(candidate));
    if (hash === cleanExpected) {
      return `0x${libauth.binToHex(candidate)}`;
    }
  }

  // 2. Sliding window check
  for (let i = 0; i <= unlockingBytecode.length - 32; i++) {
    const candidate = unlockingBytecode.slice(i, i + 32);
    const hash = libauth.binToHex(libauth.sha256.hash(candidate));
    if (hash === cleanExpected) {
      return `0x${libauth.binToHex(candidate)}`;
    }
  }

  return null;
}

/**
 * Derives the 32-byte hex Electrum scripthash for an HTLC order covenant.
 */
export function getHtlcScriptHash(
  terms: OrderTerms,
  network: CashAddressNetwork = 'chipnet',
): string {
  const canonicalParams = encodeHtlcParameters(terms);
  const htlcDerivation = deriveHtlcAddresses(canonicalParams, network);
  const hash = libauth.sha256.hash(htlcDerivation.lockingBytecode);
  const reversed = new Uint8Array(hash.length);
  for (let i = 0; i < hash.length; i++) {
    reversed[i] = hash[hash.length - 1 - i]!;
  }
  return libauth.binToHex(reversed);
}

/**
 * Parses the spending transaction's inputs to extract the secret preimage revealed upon covenant claim.
 */
export function extractSecretFromSpendTx(
  txHex: string,
  expectedHashLock?: string,
): `0x${string}` | null {
  const decoded = libauth.decodeTransaction(libauth.hexToBin(txHex));
  if (typeof decoded === 'string') return null;

  for (const input of decoded.inputs) {
    const spendInfo = parseHtlcSpendInput(input.unlockingBytecode);
    if (spendInfo?.secret) {
      const secretHex =
        `0x${libauth.binToHex(spendInfo.secret)}` as `0x${string}`;
      if (
        !expectedHashLock ||
        isValidSecret(secretHex, expectedHashLock as `0x${string}`)
      ) {
        return secretHex;
      }
    }
    if (expectedHashLock) {
      const extracted = extractSecretFromClaimUnlock(
        input.unlockingBytecode,
        expectedHashLock,
      );
      if (extracted) return extracted;
    }
  }

  return null;
}

export type CovenantSpendClassification = 'claim' | 'refund' | 'unrelated';

/**
 * Validates whether a transaction spending or interacting with a forward swap covenant
 * is an exact claim paying the recipient script with the terms' token category and amount,
 * a refund spend paying the refund script, or an unrelated transaction.
 */
export function classifyCovenantSpend(
  txHexOrTx: unknown,
  terms: OrderTerms,
): CovenantSpendClassification {
  if (!txHexOrTx) return 'unrelated';

  let tx: libauth.Transaction;
  if (typeof txHexOrTx === 'string') {
    if (
      txHexOrTx.startsWith('hex_bch_claim_') ||
      txHexOrTx.startsWith('bch_claim_')
    ) {
      return 'claim';
    }
    if (
      txHexOrTx.startsWith('hex_bch_refund_') ||
      txHexOrTx.startsWith('bch_refund_')
    ) {
      return 'refund';
    }
    const cleanHex = txHexOrTx.replace(/^0x/i, '');
    const decoded = libauth.decodeTransaction(libauth.hexToBin(cleanHex));
    if (typeof decoded === 'string') return 'unrelated';
    tx = decoded;
  } else if (typeof txHexOrTx === 'object' && txHexOrTx !== null) {
    if (
      'outputs' in txHexOrTx &&
      Array.isArray((txHexOrTx as { outputs: unknown[] }).outputs)
    ) {
      tx = txHexOrTx as libauth.Transaction;
    } else if (
      'hex' in txHexOrTx &&
      typeof (txHexOrTx as { hex: unknown }).hex === 'string'
    ) {
      const cleanHex = (txHexOrTx as { hex: string }).hex.replace(/^0x/i, '');
      const decoded = libauth.decodeTransaction(libauth.hexToBin(cleanHex));
      if (typeof decoded === 'string') return 'unrelated';
      tx = decoded;
    } else if (
      'txHex' in txHexOrTx &&
      typeof (txHexOrTx as { txHex: unknown }).txHex === 'string'
    ) {
      const cleanHex = (txHexOrTx as { txHex: string }).txHex.replace(
        /^0x/i,
        '',
      );
      const decoded = libauth.decodeTransaction(libauth.hexToBin(cleanHex));
      if (typeof decoded === 'string') return 'unrelated';
      tx = decoded;
    } else {
      return 'unrelated';
    }
  } else {
    return 'unrelated';
  }

  const isForward = isForwardDirection(terms.direction);
  const recipientBytecode = resolveLockingBytecode(
    isForward ? terms.userBchLockingBytecode : terms.solverBchLockingBytecode,
  );
  const refundBytecode = resolveLockingBytecode(
    isForward ? terms.solverBchLockingBytecode : terms.userBchLockingBytecode,
  );

  const expectedRecipientHex = libauth
    .binToHex(recipientBytecode)
    .toLowerCase();
  const expectedRefundHex = libauth.binToHex(refundBytecode).toLowerCase();

  const expectedInternalCatHex = libauth
    .binToHex(displayToInternalCategory(terms.bchTokenCategory))
    .toLowerCase();
  const expectedDisplayCatHex = terms.bchTokenCategory
    .replace(/^0x/i, '')
    .toLowerCase();
  const expectedAmount = BigInt(terms.bchTokenAmount);

  let paysRecipient = false;
  let paysRefund = false;

  for (const out of tx.outputs) {
    if (!out) continue;
    const lockHex = (
      out.lockingBytecode instanceof Uint8Array
        ? libauth.binToHex(out.lockingBytecode)
        : String(out.lockingBytecode ?? '').replace(/^0x/i, '')
    ).toLowerCase();

    let tokenMatches = false;
    if (out.token) {
      const catHex = (
        out.token.category instanceof Uint8Array
          ? libauth.binToHex(out.token.category)
          : String(out.token.category ?? '').replace(/^0x/i, '')
      ).toLowerCase();

      const catMatches =
        catHex === expectedInternalCatHex || catHex === expectedDisplayCatHex;
      const amountMatches = BigInt(out.token.amount) === expectedAmount;

      if (catMatches && amountMatches) {
        tokenMatches = true;
      }
    }

    if (tokenMatches && lockHex === expectedRecipientHex) {
      paysRecipient = true;
    }
    if (tokenMatches && lockHex === expectedRefundHex) {
      paysRefund = true;
    }
  }

  if (paysRecipient && !paysRefund) return 'claim';
  if (paysRefund && !paysRecipient) return 'refund';
  if (paysRecipient) return 'claim';
  return 'unrelated';
}

/**
 * Forward swap: builds the solver's real Bitcoin Cash lock transaction.
 * Selects solver UTXOs, binds covenant with P2SH32 check, signs with solver key,
 * and executes local Libauth script VM verification before returning.
 */
export async function buildSolverBchLock(params: {
  order: SolverOrderRecord;
  solverBchWif: string;
  utxos: Array<ElectrumUtxo | LockUtxo | unknown>;
  network?: CashAddressNetwork;
}): Promise<{
  txid: string;
  txHex: string;
  feeSats: bigint;
  inputs: Array<{ txid: string; vout: number; satoshis: bigint }>;
}> {
  const network = params.network ?? 'chipnet';
  const solverKeys = await deriveBchKeyDetails(
    params.solverBchWif,
    network === 'mainnet' ? 'bitcoincash' : 'bchtest',
  );

  const canonicalParams = encodeHtlcParameters(params.order.terms);
  const htlcDerivation = deriveHtlcAddresses(canonicalParams, network);

  // Covenant output must strictly match P2SH32 commitment to redeem script
  assertP2sh32Matches(
    htlcDerivation.lockingBytecode,
    htlcDerivation.redeemScript,
  );

  const result = buildLockTransaction({
    params: canonicalParams,
    utxos: params.utxos,
    changeAddress: solverKeys.lockingBytecodeHex,
    tokenChangeAddress: solverKeys.lockingBytecodeHex,
    bchCarrySats: params.order.terms.bchCarrySats,
    wif: params.solverBchWif,
    network,
  });

  if (!result.signed) {
    throw new Error('Failed to sign solver BCH lock transaction');
  }

  return {
    txid: result.signed.txid,
    txHex: result.signed.txHex,
    feeSats: result.feeSats,
    inputs: result.selectedInputs.allInputs.map((i) => ({
      txid: i.txid,
      vout: i.vout,
      satoshis: i.satoshis,
    })),
  };
}

/**
 * Reverse swap: builds the solver's real Bitcoin Cash claim transaction.
 * Validates secret preimage against hashLock, constructs claim, and verifies
 * in local Libauth script VM.
 */
export function buildSolverBchClaim(params: {
  order: SolverOrderRecord;
  utxo: {
    txid: string;
    vout: number;
    satoshis: bigint | number;
    lockingBytecode?: string | Uint8Array;
  };
  secret: `0x${string}`;
  network?: CashAddressNetwork;
  feeSats?: bigint | number;
}): {
  txid: string;
  txHex: string;
} {
  const secretHex = params.secret;
  const hashLockHex = params.order.hashLock;
  assertValidSecret(secretHex, hashLockHex, 'solver BCH claim secret');

  const network = params.network ?? 'chipnet';
  const canonicalParams = encodeHtlcParameters(params.order.terms);

  const result = buildClaimTransaction({
    params: canonicalParams,
    utxo: {
      txid: params.utxo.txid,
      vout: params.utxo.vout,
      satoshis: params.utxo.satoshis,
      ...(params.utxo.lockingBytecode
        ? {
            lockingBytecode:
              typeof params.utxo.lockingBytecode === 'string'
                ? params.utxo.lockingBytecode
                : libauth.binToHex(params.utxo.lockingBytecode),
          }
        : {}),
    },
    secret: secretHex,
    network,
    ...(params.feeSats !== undefined ? { feeSats: params.feeSats } : {}),
  });

  return {
    txid: result.txid,
    txHex: result.txHex,
  };
}

/**
 * Reverse swap: builds the solver's real Bitcoin Cash release transaction.
 * Signed by the solver (the recipient) to return locked funds directly to the user (refundLockingBytecode).
 * Verifies in local Libauth script VM before returning.
 */
export function buildSolverBchRelease(params: {
  order: SolverOrderRecord;
  utxo: {
    txid: string;
    vout: number;
    satoshis: bigint | number;
    lockingBytecode?: string | Uint8Array;
  };
  signerKey: Uint8Array | string;
  network?: CashAddressNetwork;
  feeSats?: bigint | number;
  useLegacyArtifact?: boolean;
}): {
  txid: string;
  txHex: string;
} {
  const network = params.network ?? 'chipnet';
  const canonicalParams = encodeHtlcParameters(params.order.terms);

  let useLegacyArtifact = params.useLegacyArtifact;
  if (useLegacyArtifact === undefined && params.utxo.lockingBytecode) {
    const rawLocking =
      typeof params.utxo.lockingBytecode === 'string'
        ? params.utxo.lockingBytecode.replace(/^0x/i, '').toLowerCase()
        : libauth.binToHex(params.utxo.lockingBytecode);
    const legacyAddrs = deriveHtlcAddresses(canonicalParams, network, {
      useLegacyArtifact: true,
    });
    if (rawLocking === libauth.binToHex(legacyAddrs.lockingBytecode)) {
      useLegacyArtifact = true;
    }
  }

  const result = buildReleaseTransaction({
    params: canonicalParams,
    utxo: {
      txid: params.utxo.txid,
      vout: params.utxo.vout,
      satoshis: params.utxo.satoshis,
      ...(params.utxo.lockingBytecode
        ? {
            lockingBytecode:
              typeof params.utxo.lockingBytecode === 'string'
                ? params.utxo.lockingBytecode
                : libauth.binToHex(params.utxo.lockingBytecode),
          }
        : {}),
    },
    signerKey: params.signerKey,
    network,
    ...(params.feeSats !== undefined ? { feeSats: params.feeSats } : {}),
    ...(useLegacyArtifact !== undefined ? { useLegacyArtifact } : {}),
  });

  return {
    txid: result.txid,
    txHex: result.txHex,
  };
}
