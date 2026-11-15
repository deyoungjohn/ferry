/**
 * Cross-check vectors shared across @ferry/core, @ferry/htlc-evm, and @ferry/htlc-bch.
 */
export const CROSS_CHECK_VECTORS = {
  secret: '0x0101010101010101010101010101010101010101010101010101010101010101',
  hashLock:
    '0x72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
  evmLockId: {
    sender: '0x87Ea46fe296C1810eF234A8e8D782A2122deFaDd',
    hashLock:
      '0x72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
    expectedLockId:
      '0x419bc3514e68404430ce0e1b5c3488257f80b8e9a2834f2e9618122b4913b9cc',
  },
  lockIntent: {
    domain: {
      chainId: 8453,
      verifyingContract: '0x5A0C062f4B7b8fF2263530e12bc15De9C836a641',
    },
    message: {
      token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      recipient: '0xC9ec91859Bdb598dC2eeE715934D8231478f7A70',
      amount: 100500000n,
      hashLock:
        '0x72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
      deadline: 1794850000n,
      intentDeadline: 1794764500n,
    },
    expectedTypehash:
      '0x206bb7e43cb544526c2f09c034e6cd69fc2a725741b60f6348ae53779283d07d',
    expectedDomainSeparator:
      '0xdb0d9a9751020609fcb9bc1960a62585d04e76d08f3213f374feccc97736dbbc',
  },
  bchCategory: {
    displayHex:
      '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
    internalHex:
      '0xac8635705129df694f353fe3a3f52d56df8a8ef97c21f7ce805fa4ffd35f33ec',
  },
} as const;
