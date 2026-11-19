import {
  concat,
  encodeAbiParameters,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';

export const CREATE2_FACTORY: Address =
  '0x4e59b44847b379578588920cA78FbF26c0B4956C';

export const FERRY_HTLC_SALT: Hex = keccak256(stringToHex('ferry-htlc.v1'));

export const FERRY_HTLC_INIT_CODE_HASH: Hex =
  '0xd17effec64b5a29aadba48b4f69268a12e2316c04fbef16877c43b2595d0e430';

export const PREDICTED_FERRY_HTLC_ADDRESS: Address =
  '0x8b968625F983420B571C102eC0b57F7e509c916e';

const EIP712_DOMAIN_TYPEHASH: Hex = keccak256(
  stringToHex(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
  ),
);

export function predictHtlcAddress(): Address {
  const digest = keccak256(
    concat([
      '0xff',
      CREATE2_FACTORY,
      FERRY_HTLC_SALT,
      FERRY_HTLC_INIT_CODE_HASH,
    ]),
  );
  return getAddress(`0x${digest.slice(-40)}`);
}

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export function eip712DomainSeparator(domain: Eip712Domain): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        EIP712_DOMAIN_TYPEHASH,
        keccak256(stringToHex(domain.name)),
        keccak256(stringToHex(domain.version)),
        BigInt(domain.chainId),
        domain.verifyingContract,
      ],
    ),
  );
}

export function usdt0Domain(
  chainId: number,
  verifyingContract: Address,
): Eip712Domain {
  return {
    name: 'USD₮0',
    version: '1',
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

export function usdt0DomainSeparator(
  chainId: number,
  verifyingContract: Address,
): Hex {
  return eip712DomainSeparator(usdt0Domain(chainId, verifyingContract));
}

export function usdgDomain(
  chainId: number,
  verifyingContract: Address,
): Eip712Domain {
  return {
    name: 'Global Dollar',
    version: '1',
    chainId,
    verifyingContract: getAddress(verifyingContract),
  };
}

export function usdgDomainSeparator(
  chainId: number,
  verifyingContract: Address,
): Hex {
  return eip712DomainSeparator(usdgDomain(chainId, verifyingContract));
}
