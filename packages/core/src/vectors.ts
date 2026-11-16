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
  goldenOrder: {
    terms: {
      version: 1,
      direction: 'EVM_TO_BCH',
      bchToken: 'PUSD',
      bchTokenCategory:
        '0xec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac',
      bchTokenAmount: 10000n,
      evmAmount: 100500000n,
      evmToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      evmChainId: 8453,
      evmHtlc: '0x5a0c062f4b7b8ff2263530e12bc15de9c836a641',
      userEvmAddress: '0x87ea46fe296c1810ef234a8e8d782a2122defadd',
      userBchLockingBytecode:
        '0x76a914111111111111111111111111111111111111111188ac',
      solverEvmAddress: '0xc9ec91859bdb598dc2eee715934d8231478f7a70',
      solverBchLockingBytecode:
        '0x76a914222222222222222222222222222222222222222288ac',
      hashLock:
        '0x72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
      evmDeadline: 1794850000,
      bchRefundHeight: 974380,
      bchCarrySats: 3000n,
      bchMaxFee: 1500n,
      quoteId: 'q-golden-001',
      quoteExpiry: 1794764200,
      pricing: {
        refs: [
          {
            asset: 'PUSD',
            usdPrice: '0.998',
            source: 'cauldron',
            asOf: 1794764140,
          },
          {
            asset: 'USDC',
            usdPrice: '1.000',
            source: 'chainlink:base:usdc-usd',
            asOf: 1794764140,
          },
        ],
        spreadBps: 40,
        fixedFeeBase: 50n,
        rounding: 'floor',
      },
    },
    expectedOrderId:
      '0x232563e8cf27ec40c60f3b1586f86240bc803b7157edd18e990e44c44d6312d4',
  },
} as const;
