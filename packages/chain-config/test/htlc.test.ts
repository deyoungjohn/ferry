import { describe, expect, it } from 'vitest';
import { getAddress, stringToHex, keccak256 } from 'viem';
import {
  FERRY_HTLC_INIT_CODE_HASH,
  FERRY_HTLC_SALT,
  PREDICTED_FERRY_HTLC_ADDRESS,
  eip712DomainSeparator,
  predictHtlcAddress,
  usdt0Domain,
  usdt0DomainSeparator,
} from '../src/index.js';

describe('CREATE2 prediction', () => {
  it('matches the address in the blueprint', () => {
    expect(predictHtlcAddress()).toBe(PREDICTED_FERRY_HTLC_ADDRESS);
    expect(predictHtlcAddress()).toBe(
      '0x8b968625F983420B571C102eC0b57F7e509c916e',
    );
  });

  it('returns a checksummed address', () => {
    expect(getAddress(predictHtlcAddress())).toBe(predictHtlcAddress());
  });

  it('uses the committed salt and init-code hash', () => {
    expect(FERRY_HTLC_SALT).toBe(keccak256(stringToHex('ferry-htlc.v1')));
    expect(FERRY_HTLC_INIT_CODE_HASH).toBe(
      '0xd17effec64b5a29aadba48b4f69268a12e2316c04fbef16877c43b2595d0e430',
    );
  });
});

describe('EIP-712 domain helper', () => {
  it('reconstructs the USDT0 domain on Arbitrum', () => {
    const token = getAddress('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
    expect(usdt0Domain(42161, token)).toEqual({
      name: 'USD₮0',
      version: '1',
      chainId: 42161,
      verifyingContract: token,
    });
    expect(usdt0DomainSeparator(42161, token)).toBe(
      '0x566af68fb471b22d6421762f84aa7bd761c670a2e4d5c8a47d4085d5957b127c',
    );
  });

  it('reconstructs the Circle USDC domain on Base', () => {
    expect(
      eip712DomainSeparator({
        name: 'USD Coin',
        version: '2',
        chainId: 8453,
        verifyingContract: getAddress(
          '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        ),
      }),
    ).toBe(
      '0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f',
    );
  });
});
