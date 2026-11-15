import { describe, expect, it } from 'vitest';
import { binToHex, encodeTransaction, sha256 } from '@bitauth/libauth';
import { MockNetworkProvider, TransactionBuilder } from 'cashscript';
import {
  buildClaimTransaction,
  buildRefundTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
  fetchBchActivity,
  mergeActivity,
  type BchElectrum,
} from '../src/index.js';

const USER_LOCKING = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0xaa),
  0x88,
  0xac,
]);
const SOLVER_LOCKING = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0xbb),
  0x88,
  0xac,
]);
const OTHER_LOCKING = new Uint8Array([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0xcc),
  0x88,
  0xac,
]);
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';

function scripthashOf(lockingBytecode: Uint8Array): string {
  return binToHex(sha256.hash(lockingBytecode).reverse());
}

function buildFundingTx(params: {
  inputTxid: string;
  toLockingBytecode: Uint8Array;
  satoshis: bigint;
  tokenAmount: bigint;
}): { txHex: string; txid: string } {
  const provider = new MockNetworkProvider();
  const builder = new TransactionBuilder({ provider });
  builder.addInput(
    {
      txid: params.inputTxid,
      vout: 0,
      satoshis: params.satoshis + 500n,
      lockingBytecode: binToHex(USER_LOCKING),
      token: { category: DISPLAY_CATEGORY, amount: params.tokenAmount },
    },
    {
      generateUnlockingBytecode: () => new Uint8Array([0x51]),
    },
  );
  builder.addOutput({
    to: params.toLockingBytecode,
    amount: params.satoshis,
    token: { category: DISPLAY_CATEGORY, amount: params.tokenAmount },
  });
  const txHex = builder.build();
  const decodedHash = sha256.hash(
    sha256.hash(
      encodeTransaction({
        version: 2,
        inputs: [],
        outputs: [],
        locktime: 0,
      }),
    ),
  );
  void decodedHash;
  const rawBytes = Uint8Array.from(Buffer.from(txHex, 'hex'));
  const txid = binToHex(sha256.hash(sha256.hash(rawBytes)).reverse());
  return { txHex, txid };
}

describe('fetchBchActivity and mergeActivity', () => {
  it('rebuilds the five BCH scenarios from a fake Electrum without network', async () => {
    const txs = new Map<string, { hex: string; time: number }>();
    const histories = new Map<
      string,
      Array<{ tx_hash: string; height: number }>
    >();

    const addHistory = (
      lockingBytecode: Uint8Array,
      tx_hash: string,
      height = 500_000,
    ) => {
      const sh = scripthashOf(lockingBytecode);
      const list = histories.get(sh) ?? [];
      list.push({ tx_hash, height });
      histories.set(sh, list);
    };

    // 1. Forward received: solver locks on BCH, user claims
    const secretFwd = new Uint8Array(32).fill(0x11);
    const paramsFwd = encodeHtlcParameters({
      hashLock: sha256.hash(secretFwd),
      recipientLockingBytecode: USER_LOCKING,
      refundLockingBytecode: SOLVER_LOCKING,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 2500n,
      refundHeight: 500_010,
      maxFee: 1500n,
    });
    const fwdLockTxid = 'aa'.repeat(32);
    const fwdClaim = buildClaimTransaction({
      params: paramsFwd,
      utxo: { txid: fwdLockTxid, vout: 0, satoshis: 3000n },
      secret: secretFwd,
    });
    txs.set(fwdClaim.txid, { hex: fwdClaim.txHex, time: 1_700_000_100 });
    addHistory(USER_LOCKING, fwdClaim.txid);

    // 2. Reverse claimed: user locks on BCH, solver claims
    const secretRev = new Uint8Array(32).fill(0x22);
    const paramsRev = encodeHtlcParameters({
      hashLock: sha256.hash(secretRev),
      recipientLockingBytecode: SOLVER_LOCKING,
      refundLockingBytecode: USER_LOCKING,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 1200n,
      refundHeight: 500_020,
      maxFee: 1500n,
    });
    const revDerived = deriveHtlcAddresses(paramsRev);
    const revLock = buildFundingTx({
      inputTxid: '01'.repeat(32),
      toLockingBytecode: revDerived.lockingBytecode,
      satoshis: 3000n,
      tokenAmount: 1200n,
    });
    const revClaim = buildClaimTransaction({
      params: paramsRev,
      utxo: { txid: revLock.txid, vout: 0, satoshis: 3000n },
      secret: secretRev,
    });
    txs.set(revLock.txid, { hex: revLock.txHex, time: 1_700_000_200 });
    txs.set(revClaim.txid, { hex: revClaim.txHex, time: 1_700_000_250 });
    addHistory(USER_LOCKING, revLock.txid);
    addHistory(revDerived.lockingBytecode, revLock.txid);
    addHistory(revDerived.lockingBytecode, revClaim.txid);

    // 3. Refund counted once: user locks AND refunds (both rows in user history)
    const secretRef = new Uint8Array(32).fill(0x33);
    const paramsRef = encodeHtlcParameters({
      hashLock: sha256.hash(secretRef),
      recipientLockingBytecode: SOLVER_LOCKING,
      refundLockingBytecode: USER_LOCKING,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 800n,
      refundHeight: 500_030,
      maxFee: 1500n,
    });
    const refDerived = deriveHtlcAddresses(paramsRef);
    const refLock = buildFundingTx({
      inputTxid: '02'.repeat(32),
      toLockingBytecode: refDerived.lockingBytecode,
      satoshis: 3000n,
      tokenAmount: 800n,
    });
    const refSpend = buildRefundTransaction({
      params: paramsRef,
      utxo: { txid: refLock.txid, vout: 0, satoshis: 3000n },
    });
    txs.set(refLock.txid, { hex: refLock.txHex, time: 1_700_000_300 });
    txs.set(refSpend.txid, { hex: refSpend.txHex, time: 1_700_000_350 });
    addHistory(USER_LOCKING, refLock.txid);
    addHistory(USER_LOCKING, refSpend.txid);
    addHistory(refDerived.lockingBytecode, refLock.txid);
    addHistory(refDerived.lockingBytecode, refSpend.txid);

    // 4. Lock not yet spent
    const secretOpen = new Uint8Array(32).fill(0x44);
    const paramsOpen = encodeHtlcParameters({
      hashLock: sha256.hash(secretOpen),
      recipientLockingBytecode: SOLVER_LOCKING,
      refundLockingBytecode: USER_LOCKING,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 500n,
      refundHeight: 500_040,
      maxFee: 1500n,
    });
    const openDerived = deriveHtlcAddresses(paramsOpen);
    const openLock = buildFundingTx({
      inputTxid: '03'.repeat(32),
      toLockingBytecode: openDerived.lockingBytecode,
      satoshis: 3000n,
      tokenAmount: 500n,
    });
    txs.set(openLock.txid, { hex: openLock.txHex, time: 1_700_000_400 });
    addHistory(USER_LOCKING, openLock.txid);
    addHistory(openDerived.lockingBytecode, openLock.txid);

    // 5. Ordinary P2PKH token send (not a Ferry covenant) -> ignored
    const plainSend = buildFundingTx({
      inputTxid: '04'.repeat(32),
      toLockingBytecode: OTHER_LOCKING,
      satoshis: 1000n,
      tokenAmount: 999n,
    });
    txs.set(plainSend.txid, { hex: plainSend.txHex, time: 1_700_000_500 });
    addHistory(USER_LOCKING, plainSend.txid);

    const electrum: BchElectrum = {
      async request<T>(method: string, params: readonly unknown[]): Promise<T> {
        if (method === 'blockchain.scripthash.get_history') {
          const sh = params[0] as string;
          return (histories.get(sh) ?? []) as T;
        }
        if (method === 'blockchain.transaction.get') {
          const txid = params[0] as string;
          const entry = txs.get(txid);
          if (!entry) throw new Error(`Missing fake tx ${txid}`);
          return { hex: entry.hex, blocktime: entry.time } as T;
        }
        throw new Error(`Unexpected Electrum method ${method}`);
      },
    };

    const res = await fetchBchActivity({
      electrum,
      userLockingBytecode: USER_LOCKING,
      categories: [DISPLAY_CATEGORY],
      limit: 20,
    });

    expect(res.items).toHaveLength(4);
    expect(res.items.map((i) => i.state)).toEqual([
      'locked',
      'refunded',
      'claimed',
      'received',
    ]);
    expect(res.items[0]?.key).toBe(openLock.txid);
    expect(res.items[1]?.key).toBe(refLock.txid);
    expect(res.items[2]?.key).toBe(revLock.txid);
    expect(res.items[3]?.key).toBe(fwdLockTxid);
    expect(res.items[3]?.direction).toBe('COUNTER_TO_BCH');
    expect(res.items[3]?.tokenAmount).toBe(2500n);
  });

  it('merges BCH items with orders and counter-chain locks by hashLock', () => {
    const hashLockFwd = binToHex(sha256.hash(new Uint8Array(32).fill(0x11)));
    const hashLockInFlight = `0x${'99'.repeat(32)}`;
    const merged = mergeActivity({
      bch: [
        {
          key: 'bch-lock-1',
          direction: 'COUNTER_TO_BCH',
          state: 'received',
          tokenAmount: 2500n,
          category: DISPLAY_CATEGORY,
          hashLock: hashLockFwd,
          time: 1_700_000_100,
          txs: [{ label: 'Your claim', hash: 'claim-1' }],
        },
      ],
      orders: [
        {
          orderId: 'order-1',
          createdAt: 1_700_000_090,
          direction: 'EVM_TO_BCH',
          hashLock: `0x${hashLockFwd}`,
        },
        {
          orderId: 'order-inflight',
          createdAt: 1_700_000_200,
          direction: 'EVM_TO_BCH',
          hashLock: hashLockInFlight,
        },
      ],
      locks: [
        {
          id: 'evm-lock-1',
          hashLock: hashLockFwd,
          lockedAt: 1_700_000_095,
          role: 'sender',
        },
        {
          id: 'evm-lock-inflight',
          hashLock: hashLockInFlight,
          lockedAt: 1_700_000_205,
          role: 'sender',
        },
      ],
    });

    expect(merged).toHaveLength(2);
    expect(merged[0]?.key).toBe('order-inflight');
    expect(merged[0]?.chain?.id).toBe('evm-lock-inflight');
    expect(merged[1]?.key).toBe('bch-lock-1');
    expect(merged[1]?.order?.orderId).toBe('order-1');
    expect(merged[1]?.chain?.id).toBe('evm-lock-1');
  });
});
