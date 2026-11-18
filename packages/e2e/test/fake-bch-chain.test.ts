import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  encodeTransaction,
  hexToBin,
  lockingBytecodeToCashAddress,
  ripemd160,
  secp256k1,
  sha256,
  type Transaction,
} from '@bitauth/libauth';
import {
  buildClaimTransaction,
  buildLockTransaction,
  buildRefundTransaction,
  encodeHtlcParameters,
  getHtlcContract,
  deriveHtlcAddresses,
} from '@ferry/htlc-bch';
import {
  BroadcastRejectedError,
  FakeBchChain,
  scriptHashOf,
  txidOfHex,
} from './support/fake-bch-chain.js';

const USER_KEY = new Uint8Array(32).fill(0x42);
const USER_PUB = secp256k1.derivePublicKeyCompressed(USER_KEY) as Uint8Array;
const USER_LOCKING = Uint8Array.from([
  0x76,
  0xa9,
  0x14,
  ...ripemd160.hash(sha256.hash(USER_PUB)),
  0x88,
  0xac,
]);
const USER_ADDRESS = (
  lockingBytecodeToCashAddress({
    bytecode: USER_LOCKING,
    prefix: 'bchtest',
    tokenSupport: false,
  }) as { address: string }
).address;
const RECIPIENT_LOCKING = Uint8Array.from([
  0x76,
  0xa9,
  0x14,
  ...new Uint8Array(20).fill(0x77),
  0x88,
  0xac,
]);
const DISPLAY_CATEGORY =
  'ec335fd3ffa45f80cef7217cf98e8adf562df5a3e33f354f69df2951703586ac';
const CATEGORY_BYTES = hexToBin(DISPLAY_CATEGORY);
const SECRET = new Uint8Array(32).fill(0x01);

const params = encodeHtlcParameters({
  hashLock: sha256.hash(SECRET),
  recipientLockingBytecode: RECIPIENT_LOCKING,
  refundLockingBytecode: USER_LOCKING,
  tokenCategory: DISPLAY_CATEGORY,
  tokenAmount: 500n,
  refundHeight: 200_100,
  maxFee: 1500n,
});
const htlcLocking = deriveHtlcAddresses(params, 'chipnet').lockingBytecode;

/** A chain with a funded user: 800 tokens and 50,000 satoshis. */
function setup() {
  const chain = new FakeBchChain();
  chain.fund({
    lockingBytecode: USER_LOCKING,
    valueSatoshis: 20_000n,
    token: { category: CATEGORY_BYTES, amount: 800n },
  });
  chain.fund({ lockingBytecode: USER_LOCKING, valueSatoshis: 50_000n });
  return chain;
}

function buildLock(chain: FakeBchChain) {
  const utxos = chain.rpc('blockchain.scripthash.listunspent', [
    scriptHashOf(USER_LOCKING),
  ]);
  return buildLockTransaction({
    params,
    utxos: utxos as unknown[],
    changeAddress: USER_ADDRESS,
    privateKey: USER_KEY,
    network: 'chipnet',
  });
}

function lockAndGetUtxo(chain: FakeBchChain) {
  const lock = buildLock(chain);
  const txid = chain.broadcast(lock.signed!.txHex);
  const out = decodeTransaction(hexToBin(lock.signed!.txHex)) as Transaction;
  return {
    txid,
    vout: lock.htlcOutputIndex,
    satoshis: out.outputs[lock.htlcOutputIndex]!.valueSatoshis,
  };
}

describe('the simulated Bitcoin Cash chain accepts real flows', () => {
  it('accepts the user lock, serves it, and then accepts the claim that reveals the secret', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    const sh = scriptHashOf(htlcLocking);

    const listed = chain.rpc('blockchain.scripthash.listunspent', [
      sh,
      'tokens_only',
    ]) as Array<{
      tx_hash: string;
      tx_pos: number;
      value: number;
      height: number;
      token_data?: { category: string; amount: string };
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.tx_hash).toBe(utxo.txid);
    expect(listed[0]!.height).toBe(0);
    expect(listed[0]!.token_data).toEqual({
      category: DISPLAY_CATEGORY,
      amount: '500',
    });

    chain.mine();
    expect(chain.confirmations(utxo.txid)).toBe(1);
    expect(
      (chain.rpc('blockchain.scripthash.get_history', [sh]) as unknown[])
        .length,
    ).toBe(1);

    const claim = buildClaimTransaction({
      params,
      utxo,
      secret: SECRET,
      network: 'chipnet',
    });
    const claimId = chain.broadcast(claim.txHex);
    expect(claimId).toBe(txidOfHex(claim.txHex));
    expect(chain.isSpent(utxo.txid, utxo.vout)).toBe(true);
    expect(chain.secretRevealedBy(claimId, binToHex(sha256.hash(SECRET)))).toBe(
      `0x${binToHex(SECRET)}`,
    );
    expect(
      chain.rpc('blockchain.scripthash.listunspent', [sh]) as unknown[],
    ).toHaveLength(0);
    // The recipient now holds the tokens.
    expect(
      chain.utxosForScriptHash(scriptHashOf(RECIPIENT_LOCKING))[0]!.output.token
        ?.amount,
    ).toBe(500n);

    const verbose = chain.rpc('blockchain.transaction.get', [
      claimId,
      true,
    ]) as { hex: string; vin: Array<{ txid: string }>; confirmations?: number };
    expect(verbose.hex).toBe(claim.txHex);
    expect(verbose.vin[0]!.txid).toBe(utxo.txid);
    expect(verbose.confirmations).toBeUndefined();
    expect(chain.rpc('blockchain.transaction.get', [claimId, false])).toBe(
      claim.txHex,
    );
  });

  it('refuses the refund before its locktime and accepts it afterwards', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    const refund = buildRefundTransaction({ params, utxo, network: 'chipnet' });
    expect(() => chain.broadcast(refund.txHex)).toThrow(/non-final/);
    chain.mine(100_001 - (chain.tipHeight - 200_000));
    expect(chain.tipHeight).toBeGreaterThanOrEqual(params.refundHeight);
    expect(chain.broadcast(refund.txHex)).toBe(txidOfHex(refund.txHex));
  });

  it('notifies a subscriber when a script hash changes and reports tips', async () => {
    const chain = setup();
    const { client } = chain.createQuorumClient();
    await client.connect();
    const seen: Array<string | null> = [];
    await client.subscribeScriptHash(scriptHashOf(htlcLocking), (status) =>
      seen.push(status),
    );
    lockAndGetUtxo(chain);
    expect(seen.length).toBeGreaterThan(0);
    expect(client.getQuorumStatus()).toMatchObject({
      isQuorumHealthy: true,
      healthyServersCount: 2,
      quorumTip: chain.tipHeight,
    });
    chain.mine(2);
    expect(client.getTip()).toBe(chain.tipHeight);
    client.close();
  });
});

describe('the simulated chain refuses what a real node would refuse', () => {
  function tamper(hex: string, edit: (tx: Transaction) => void): string {
    const tx = decodeTransaction(hexToBin(hex)) as Transaction;
    edit(tx);
    return binToHex(encodeTransaction(tx));
  }

  it('refuses a wrong signature on the user funding input', () => {
    const chain = setup();
    const lock = buildLock(chain);
    const bad = tamper(lock.signed!.txHex, (tx) => {
      const unlocking = tx.inputs[0]!.unlockingBytecode;
      unlocking[10] = unlocking[10]! ^ 0xff;
    });
    expect(() => chain.broadcast(bad)).toThrow(BroadcastRejectedError);
    expect(chain.acceptedBroadcasts()).toHaveLength(0);
  });

  it('refuses a claim whose output goes somewhere other than the covenant allows', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    const claim = buildClaimTransaction({
      params,
      utxo,
      secret: SECRET,
      network: 'chipnet',
    });
    const bad = tamper(claim.txHex, (tx) => {
      tx.outputs[0]!.lockingBytecode = USER_LOCKING;
    });
    expect(() => chain.broadcast(bad)).toThrow(
      /mandatory-script-verify-flag-failed/,
    );
  });

  it('refuses a claim that changes the token amount', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    const claim = buildClaimTransaction({
      params,
      utxo,
      secret: SECRET,
      network: 'chipnet',
    });
    const bad = tamper(claim.txHex, (tx) => {
      tx.outputs[0]!.token!.amount = 499n;
    });
    expect(() => chain.broadcast(bad)).toThrow(BroadcastRejectedError);
    const inflated = tamper(claim.txHex, (tx) => {
      tx.outputs[0]!.token!.amount = 501n;
    });
    expect(() => chain.broadcast(inflated)).toThrow(BroadcastRejectedError);
  });

  it('refuses a claim with the wrong secret', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    const claim = buildClaimTransaction({
      params,
      utxo,
      secret: SECRET,
      network: 'chipnet',
    });
    const wrong = new Uint8Array(32).fill(0x02);
    const bad = binToHex(
      encodeTransaction(
        (() => {
          const tx = decodeTransaction(hexToBin(claim.txHex)) as Transaction;
          const text = binToHex(tx.inputs[0]!.unlockingBytecode).replace(
            binToHex(SECRET),
            binToHex(wrong),
          );
          tx.inputs[0]!.unlockingBytecode = hexToBin(text);
          return tx;
        })(),
      ),
    );
    expect(() => chain.broadcast(bad)).toThrow(
      /mandatory-script-verify-flag-failed/,
    );
  });

  it('refuses a redeem script that does not hash to the P2SH32 commitment', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    // A covenant for a different refund height, but the same recipient, token and
    // amount: its claim satisfies the same output rules, so only the commitment
    // check can tell it apart from the real one.
    const otherParams = encodeHtlcParameters({
      hashLock: sha256.hash(SECRET),
      recipientLockingBytecode: RECIPIENT_LOCKING,
      refundLockingBytecode: USER_LOCKING,
      tokenCategory: DISPLAY_CATEGORY,
      tokenAmount: 500n,
      refundHeight: 200_101,
      maxFee: 1500n,
    });
    const otherLocking = deriveHtlcAddresses(
      otherParams,
      'chipnet',
    ).lockingBytecode;
    expect(binToHex(otherLocking)).not.toBe(binToHex(htlcLocking));
    const otherChain = setup();
    const otherUtxo = (() => {
      const lock = buildLockTransaction({
        params: otherParams,
        utxos: otherChain.rpc('blockchain.scripthash.listunspent', [
          scriptHashOf(USER_LOCKING),
        ]) as unknown[],
        changeAddress: USER_ADDRESS,
        privateKey: USER_KEY,
        network: 'chipnet',
      });
      const txid = otherChain.broadcast(lock.signed!.txHex);
      const out = decodeTransaction(
        hexToBin(lock.signed!.txHex),
      ) as Transaction;
      return {
        txid,
        vout: lock.htlcOutputIndex,
        satoshis: out.outputs[lock.htlcOutputIndex]!.valueSatoshis,
      };
    })();
    const otherClaim = buildClaimTransaction({
      params: otherParams,
      utxo: otherUtxo,
      secret: SECRET,
      network: 'chipnet',
    });
    const otherDecoded = decodeTransaction(
      hexToBin(otherClaim.txHex),
    ) as Transaction;
    // Spend the real UTXO with the other covenant's unlocking bytecode.
    const spliced = tamper(otherClaim.txHex, (tx) => {
      tx.inputs[0] = {
        ...otherDecoded.inputs[0]!,
        outpointTransactionHash: hexToBin(utxo.txid),
        outpointIndex: utxo.vout,
      };
    });
    expect(() => chain.broadcast(spliced)).toThrow(/P2SH32 commitment/);
    expect(getHtlcContract).toBeDefined();
  });

  it('refuses a double spend, a missing input and a transaction that pays no fee', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    const claim = buildClaimTransaction({
      params,
      utxo,
      secret: SECRET,
      network: 'chipnet',
    });
    chain.broadcast(claim.txHex);
    expect(() => chain.broadcast(claim.txHex)).toThrow(/already-in-mempool/);
    const second = buildClaimTransaction({
      params,
      utxo,
      secret: SECRET,
      network: 'chipnet',
      feeSats: 700n,
    });
    expect(() => chain.broadcast(second.txHex)).toThrow(/mempool-conflict/);

    // A claim that pays itself nearly the whole input: the covenant is satisfied,
    // but the fee is below the relay minimum.
    const fresh = setup();
    const freshUtxo = lockAndGetUtxo(fresh);
    const noFee = tamper(
      buildClaimTransaction({
        params,
        utxo: freshUtxo,
        secret: SECRET,
        network: 'chipnet',
      }).txHex,
      (tx) => {
        tx.outputs[0]!.valueSatoshis += 450n;
      },
    );
    expect(() => fresh.broadcast(noFee)).toThrow(/min relay fee not met/);
  });

  it('refuses a transaction spending an output that does not exist', () => {
    const chain = setup();
    const lock = buildLock(chain);
    const bad = tamper(lock.signed!.txHex, (tx) => {
      tx.inputs[0]!.outpointIndex = 9;
    });
    expect(() => chain.broadcast(bad)).toThrow(/missing-inputs/);
  });

  it('reorgs: a disconnected block returns its transactions to the mempool, and an evicted lock is gone', () => {
    const chain = setup();
    const utxo = lockAndGetUtxo(chain);
    chain.mine(2);
    expect(chain.confirmations(utxo.txid)).toBe(2);
    chain.disconnectBlocks(2);
    expect(chain.confirmations(utxo.txid)).toBe(0);
    expect(chain.hasTx(utxo.txid)).toBe(true);
    expect(chain.evict(utxo.txid)).toContain(utxo.txid);
    expect(chain.hasTx(utxo.txid)).toBe(false);
    // The funding outputs the lock had spent are spendable again.
    expect(
      chain.rpc('blockchain.scripthash.listunspent', [
        scriptHashOf(USER_LOCKING),
      ]) as unknown[],
    ).toHaveLength(2);
    expect(() =>
      chain.rpc('blockchain.transaction.get', [utxo.txid, false]),
    ).toThrow(/No such mempool or blockchain transaction/);
  });
});
