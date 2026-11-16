/**
 * Recorded offline fixtures captured from public read-only endpoints (no keys).
 */
export const RECORDED_PARYON_STATS = {
  period: 202,
  timeSnapshot: '2026-11-16T13:00:09.268Z',
  totalPusdSupply: '394069.94',
  totalBchTvl: '3112.41396136',
  bchUsdPrice: '204.05',
  oracleBchUsdPrice: '203.67',
  pusdUsdPrice: '0.99801856',
  cauldronPusdLiquidity: '106274.78',
  cauldronBchLiquidity: '519.7951625',
  cauldronPricePerToken: '0.00004891',
};

export const RECORDED_COINBASE_BCH_USD = {
  data: {
    amount: '205.755',
    base: 'BCH',
    currency: 'USD',
  },
};

export const RECORDED_KRAKEN_BCH_USD = {
  error: [] as string[],
  result: {
    BCHUSD: {
      c: ['205.660000', '0.29789414'] as [string, string],
    },
  },
};

export const RECORDED_CAULDRON_PUSD_POOLS = {
  active: [
    {
      pool_id:
        'dc7c57bb7963b7ed2039150b1eef0d6f21f71f8d33a6aecfce5a23b2f5f2c302',
      sats: 6_985_994,
      token_id:
        '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
      tokens: 1_437,
      tx_pos: 11,
      txid: 'e04bb56d0c219049b439242b92dcbb7332950a030fb412a600cec4f738c373a6',
    },
    {
      pool_id:
        'fac5a4a69f7c7459f751f43495cbee3821cbc478165d83e78db66a82cc697b0c',
      sats: 25_326_168_769,
      token_id:
        '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
      tokens: 5_218_992,
      tx_pos: 0,
      txid: '66e7cf09d7dcb61483cc9091a5063bcaeed2ef7f49e47a191efc9d9190d01747',
    },
  ],
};

export const RECORDED_CAULDRON_MUSD_POOLS = {
  active: [
    {
      pool_id:
        '872f375a87199803e063e285b0724f44fc683b8e913b6df99391ea968db07102',
      sats: 1_278_889,
      token_id:
        'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
      tokens: 260,
      tx_pos: 36,
      txid: 'aa5f468125b48c0f4df8cedb926a10d42d2903ff4919230f22ceeaf75f865aba',
    },
    {
      pool_id:
        '003278487e5f243e6629bf84e5dc85e842ea98c901909e48c89c0bfa4dfc3706',
      sats: 11_979_781,
      token_id:
        'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
      tokens: 2_450,
      tx_pos: 0,
      txid: 'bc10ad41aaeff2b16e5891d45d502a6ae192622b0499b6bf3e85e46f26d2ffaa',
    },
  ],
};
