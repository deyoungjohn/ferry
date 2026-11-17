import type { BchActivityItem, ChainLock, ActivityEntry } from './types';
import { mergeActivity } from './merge';

export const SAMPLE_MOCK_BCH_ACTIVITY: readonly BchActivityItem[] = [
  {
    key: 'mockbchfunding01',
    direction: 'COUNTER_TO_BCH',
    state: 'received',
    tokenAmount: 2000n, // 20.00 PUSD
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    time: 1731670000,
    txs: [
      { label: 'Covenant Lock', hash: 'mockbchlock01' },
      { label: 'User Claim', hash: 'mockbchclaim01' },
    ],
  },
  {
    key: 'mockbchfunding02',
    direction: 'BCH_TO_COUNTER',
    state: 'claimed',
    tokenAmount: 5000n, // 50.00 PUSD
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    time: 1731665000,
    txs: [
      { label: 'Covenant Lock', hash: 'mockbchlock02' },
      { label: 'Solver Claim', hash: 'mockbchclaim02' },
    ],
  },
  {
    key: 'mockbchfunding03',
    direction: 'BCH_TO_COUNTER',
    state: 'refunded',
    tokenAmount: 1500n, // 15.00 PUSD
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff',
    time: 1731660000,
    txs: [
      { label: 'Covenant Lock', hash: 'mockbchlock03' },
      { label: 'Refund', hash: 'mockbchrefund03' },
    ],
  },
  {
    key: 'mockbchfunding04',
    direction: 'COUNTER_TO_BCH',
    state: 'locked',
    tokenAmount: 3500n, // 35.00 PUSD
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x7777777777777777777777777777777777777777777777777777777777777777',
    time: 1731655000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock04' }],
  },
  {
    key: 'mockbchfunding05',
    direction: 'COUNTER_TO_BCH',
    state: 'received',
    tokenAmount: 1000n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x0505050505050505050505050505050505050505050505050505050505050505',
    time: 1731650000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock05' }],
  },
  {
    key: 'mockbchfunding06',
    direction: 'BCH_TO_COUNTER',
    state: 'claimed',
    tokenAmount: 2500n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x0606060606060606060606060606060606060606060606060606060606060606',
    time: 1731645000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock06' }],
  },
  {
    key: 'mockbchfunding07',
    direction: 'COUNTER_TO_BCH',
    state: 'received',
    tokenAmount: 4000n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x0707070707070707070707070707070707070707070707070707070707070707',
    time: 1731640000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock07' }],
  },
  {
    key: 'mockbchfunding08',
    direction: 'BCH_TO_COUNTER',
    state: 'claimed',
    tokenAmount: 1800n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x0808080808080808080808080808080808080808080808080808080808080808',
    time: 1731635000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock08' }],
  },
  {
    key: 'mockbchfunding09',
    direction: 'COUNTER_TO_BCH',
    state: 'received',
    tokenAmount: 3000n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x0909090909090909090909090909090909090909090909090909090909090909',
    time: 1731630000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock09' }],
  },
  {
    key: 'mockbchfunding10',
    direction: 'BCH_TO_COUNTER',
    state: 'claimed',
    tokenAmount: 6000n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x1010101010101010101010101010101010101010101010101010101010101010',
    time: 1731625000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock10' }],
  },
  {
    key: 'mockbchfunding11',
    direction: 'COUNTER_TO_BCH',
    state: 'received',
    tokenAmount: 1200n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    time: 1731620000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock11' }],
  },
  {
    key: 'mockbchfunding12',
    direction: 'BCH_TO_COUNTER',
    state: 'claimed',
    tokenAmount: 5500n,
    category:
      '0000000000000000000000000000000000000000000000000000000000000001',
    hashLock:
      '0x1212121212121212121212121212121212121212121212121212121212121212',
    time: 1731615000,
    txs: [{ label: 'Covenant Lock', hash: 'mockbchlock12' }],
  },
];

export const SAMPLE_MOCK_CHAIN_LOCKS: readonly ChainLock[] = [
  {
    id: '0xlock01' as `0x${string}`,
    role: 'sender',
    token: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    amount: 20_000_000n, // 20.00 USDC
    hashLock:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    deadline: 1731673600n,
    blockNumber: 12345678n,
    lockedAt: 1731669900,
    lockTx: '0xevmlocktx01' as `0x${string}`,
    state: 'claimed',
  },
  {
    id: '0xlock02' as `0x${string}`,
    role: 'recipient',
    token: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    amount: 49_750_000n, // 49.75 USDC
    hashLock:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    deadline: 1731668600n,
    blockNumber: 12345500n,
    lockedAt: 1731664900,
    lockTx: '0xevmlocktx02' as `0x${string}`,
    state: 'claimed',
  },
];

export function getMockActivity(address?: string): ActivityEntry[] {
  if (
    address &&
    (address.includes('rv3z') ||
      address.includes('qqqq') ||
      address.includes('empty'))
  ) {
    return [];
  }
  return mergeActivity({
    bch: SAMPLE_MOCK_BCH_ACTIVITY,
    locks: SAMPLE_MOCK_CHAIN_LOCKS,
  });
}
