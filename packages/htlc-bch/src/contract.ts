import {
  Contract,
  MockNetworkProvider,
  Network,
  type NetworkProvider,
  type SignatureTemplate,
  type Unlocker,
} from 'cashscript';
import {
  binToHex,
  cashAddressToLockingBytecode,
  hexToBin,
  lockingBytecodeToCashAddress,
  sha256,
} from '@bitauth/libauth';
import artifact from './artifact.json' with { type: 'json' };
import legacyArtifact from './legacy-artifact.json' with { type: 'json' };
import { displayToInternalCategory } from './byte-order.js';
import { p2sh32LockingBytecodeFor } from './p2sh32.js';
import type {
  BchHtlcParameters,
  CashAddressNetwork,
  HtlcAddressDerivationResult,
  HtlcInputTerms,
  OrderTerms,
} from './types.js';

export { artifact, legacyArtifact };

export type HtlcContract = Contract & {
  unlock: {
    claim: (secret: Uint8Array) => Unlocker;
    refund: () => Unlocker;
    release: (pk: Uint8Array, s: SignatureTemplate | Unlocker) => Unlocker;
  };
};

export function resolveLockingBytecode(
  addressOrBytecode: string | Uint8Array,
): Uint8Array {
  if (typeof addressOrBytecode === 'string') {
    const trimmed = addressOrBytecode.trim();
    if (
      trimmed.startsWith('bitcoincash:') ||
      trimmed.startsWith('bchtest:') ||
      trimmed.startsWith('bchreg:')
    ) {
      const decoded = cashAddressToLockingBytecode(trimmed);
      if (typeof decoded === 'string') {
        throw new Error(`Failed to decode CashAddress: ${decoded}`);
      }
      return decoded.bytecode;
    }
    const cleanHex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
    return hexToBin(cleanHex);
  }
  return addressOrBytecode;
}

export function encodeHtlcParameters(
  terms: OrderTerms | HtlcInputTerms,
): BchHtlcParameters {
  if ('direction' in terms && 'bchTokenCategory' in terms) {
    const isForward = terms.direction === 'EVM_TO_BCH';
    const recipientLockingBytecode = resolveLockingBytecode(
      isForward ? terms.userBchLockingBytecode : terms.solverBchLockingBytecode,
    );
    const refundLockingBytecode = resolveLockingBytecode(
      isForward ? terms.solverBchLockingBytecode : terms.userBchLockingBytecode,
    );
    const hashLockBytes = hexToBin(
      terms.hashLock.startsWith('0x')
        ? terms.hashLock.slice(2)
        : terms.hashLock,
    );
    const tokenCategory = displayToInternalCategory(terms.bchTokenCategory);

    return {
      hashLock: hashLockBytes,
      recipientLockingBytecode,
      refundLockingBytecode,
      tokenCategory,
      tokenAmount: terms.bchTokenAmount,
      refundHeight: terms.bchRefundHeight,
      maxFee: BigInt(terms.bchMaxFee),
    };
  }

  let hashLockBytes: Uint8Array;
  if (terms.hashLock) {
    hashLockBytes =
      typeof terms.hashLock === 'string'
        ? hexToBin(
            terms.hashLock.startsWith('0x')
              ? terms.hashLock.slice(2)
              : terms.hashLock,
          )
        : terms.hashLock;
  } else if (terms.secret) {
    const secretBytes =
      typeof terms.secret === 'string'
        ? hexToBin(
            terms.secret.startsWith('0x')
              ? terms.secret.slice(2)
              : terms.secret,
          )
        : terms.secret;
    if (secretBytes.length !== 32) {
      throw new Error(
        `Invalid secret length: expected 32 bytes, got ${secretBytes.length}`,
      );
    }
    hashLockBytes = sha256.hash(secretBytes);
  } else {
    throw new Error('Either hashLock or secret must be provided');
  }

  if (hashLockBytes.length !== 32) {
    throw new Error(
      `Invalid hashLock length: expected 32 bytes, got ${hashLockBytes.length}`,
    );
  }

  const recipientSource =
    terms.recipientLockingBytecode ?? terms.recipientAddress;
  if (!recipientSource) {
    throw new Error('recipientLockingBytecode or recipientAddress is required');
  }
  const refundSource = terms.refundLockingBytecode ?? terms.refundAddress;
  if (!refundSource) {
    throw new Error('refundLockingBytecode or refundAddress is required');
  }

  const recipientLockingBytecode = resolveLockingBytecode(recipientSource);
  const refundLockingBytecode = resolveLockingBytecode(refundSource);

  let tokenCategory: Uint8Array;
  if (typeof terms.tokenCategory === 'string') {
    tokenCategory = terms.tokenCategoryIsInternal
      ? hexToBin(
          terms.tokenCategory.startsWith('0x')
            ? terms.tokenCategory.slice(2)
            : terms.tokenCategory,
        )
      : displayToInternalCategory(terms.tokenCategory);
  } else {
    tokenCategory = terms.tokenCategory;
  }

  if (tokenCategory.length !== 32) {
    throw new Error(
      `Invalid tokenCategory length: expected 32 bytes, got ${tokenCategory.length}`,
    );
  }

  const tokenAmount = BigInt(terms.tokenAmount);
  if (tokenAmount <= 0n) {
    throw new Error(
      `Invalid tokenAmount: must be positive, got ${tokenAmount}`,
    );
  }

  const refundHeight = Number(terms.refundHeight);
  if (refundHeight >= 500_000_000 || refundHeight < 0) {
    throw new Error(
      `Invalid refundHeight: must be block height (< 500,000,000), got ${refundHeight}`,
    );
  }

  const maxFee = terms.maxFee !== undefined ? BigInt(terms.maxFee) : 1500n;

  return {
    hashLock: hashLockBytes,
    recipientLockingBytecode,
    refundLockingBytecode,
    tokenCategory,
    tokenAmount,
    refundHeight,
    maxFee,
  };
}

export function getHtlcContract(
  params: BchHtlcParameters,
  options?: {
    provider?: NetworkProvider;
    network?: CashAddressNetwork;
    artifact?: typeof artifact;
    useLegacyArtifact?: boolean;
  },
): HtlcContract {
  let provider = options?.provider;
  if (!provider) {
    const mock = new MockNetworkProvider();
    mock.network =
      options?.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
    provider = mock;
  }

  const constructorArgs = [
    params.hashLock,
    params.recipientLockingBytecode,
    params.refundLockingBytecode,
    params.tokenCategory,
    params.tokenAmount,
    BigInt(params.refundHeight),
    BigInt(params.maxFee),
  ];

  const targetArtifact =
    options?.artifact ??
    (options?.useLegacyArtifact ? legacyArtifact : artifact);

  return new Contract(targetArtifact, constructorArgs, {
    provider,
  }) as unknown as HtlcContract;
}

export function deriveHtlcAddresses(
  params: BchHtlcParameters,
  network: CashAddressNetwork = 'chipnet',
  options?: {
    artifact?: typeof artifact;
    useLegacyArtifact?: boolean;
  },
): HtlcAddressDerivationResult {
  const contract = getHtlcContract(params, { network, ...options });
  const redeemScript = hexToBin(contract.bytecode);
  // The output hash comes from the redeem script itself; the library's own
  // value must agree, or the two derivations have drifted apart.
  const lockingBytecodeBytes = p2sh32LockingBytecodeFor(redeemScript);
  if (
    binToHex(lockingBytecodeBytes) !== contract.lockingBytecode.toLowerCase()
  ) {
    throw new Error(
      'The contract library and the P2SH32 helper disagree on the locking bytecode',
    );
  }
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';

  const p2sh32Res = lockingBytecodeToCashAddress({
    bytecode: lockingBytecodeBytes,
    prefix,
    tokenSupport: false,
  });
  if (typeof p2sh32Res === 'string') {
    throw new Error(`Failed to encode P2SH32 CashAddress: ${p2sh32Res}`);
  }

  const tokenRes = lockingBytecodeToCashAddress({
    bytecode: lockingBytecodeBytes,
    prefix,
    tokenSupport: true,
  });
  if (typeof tokenRes === 'string') {
    throw new Error(`Failed to encode token CashAddress: ${tokenRes}`);
  }

  return {
    p2sh32Address: p2sh32Res.address,
    tokenAddress: tokenRes.address,
    redeemScript,
    lockingBytecode: lockingBytecodeBytes,
  };
}

export function deriveLegacyHtlcAddresses(
  params: BchHtlcParameters,
  network: CashAddressNetwork = 'chipnet',
): HtlcAddressDerivationResult {
  return deriveHtlcAddresses(params, network, { useLegacyArtifact: true });
}

/**
 * Recompute HTLC locking bytecode and addresses from canonical terms and verify
 * that a candidate address/bytecode matches before funding.
 */
export function verifyHtlcAddressMatch(
  terms: OrderTerms | HtlcInputTerms,
  candidateAddressOrBytecode: string | Uint8Array,
  network: CashAddressNetwork = 'chipnet',
): {
  matches: boolean;
  isLegacy?: boolean;
  derived: HtlcAddressDerivationResult;
} {
  const params = encodeHtlcParameters(terms);
  const derivedCurrent = deriveHtlcAddresses(params, network);
  const candidateBytecode = resolveLockingBytecode(candidateAddressOrBytecode);
  const candidateHex = binToHex(candidateBytecode);

  if (candidateHex === binToHex(derivedCurrent.lockingBytecode)) {
    return { matches: true, isLegacy: false, derived: derivedCurrent };
  }

  const derivedLegacy = deriveLegacyHtlcAddresses(params, network);
  if (candidateHex === binToHex(derivedLegacy.lockingBytecode)) {
    return { matches: true, isLegacy: true, derived: derivedLegacy };
  }

  return { matches: false, isLegacy: false, derived: derivedCurrent };
}
