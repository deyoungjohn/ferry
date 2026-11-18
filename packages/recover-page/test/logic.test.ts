import { describe, expect, it } from 'vitest';
import {
  inspectRecovery,
  loadRecoveryFile,
  type RecoveryPorts,
} from '../src/logic.js';
import { DEADLINE, REFUND_HEIGHT, fileJson, makeFile } from './fixture.js';

function ports(options: {
  evm?: {
    nowSeconds: number;
    lockStatus: 'none' | 'locked' | 'claimed' | 'refunded';
  };
  bch?: { tipHeight: number; hasUtxo: boolean };
  evmError?: string;
  bchError?: string;
}): RecoveryPorts {
  return {
    readEvm: async () => {
      if (options.evmError) throw new Error(options.evmError);
      return options.evm!;
    },
    readBch: async (file) => {
      if (options.bchError) throw new Error(options.bchError);
      return {
        tipHeight: options.bch!.tipHeight,
        utxos: options.bch!.hasUtxo
          ? [
              {
                txid: '11'.repeat(32),
                vout: 0,
                satoshis: 3000n,
                lockingBytecode: file.contracts.bch.lockingBytecode,
              },
            ]
          : [],
      };
    },
  };
}

describe('reading a recovery file', () => {
  it('accepts a good file', () => {
    const file = makeFile({ direction: 'EVM_TO_BCH' });
    expect(loadRecoveryFile(fileJson(file)).orderId).toBe(file.orderId);
  });

  it('refuses text that is not a recovery file', () => {
    expect(() => loadRecoveryFile('{"hello":1}')).toThrow(
      /not a Ferry recovery file/,
    );
    expect(() => loadRecoveryFile('nope')).toThrow(/not a Ferry recovery file/);
  });

  it('refuses a file whose order id is not the hash of its terms', () => {
    const file = JSON.parse(fileJson(makeFile({ direction: 'EVM_TO_BCH' })));
    file.orderId = `0x${'00'.repeat(32)}`;
    expect(() => loadRecoveryFile(JSON.stringify(file))).toThrow(
      /does not match itself/,
    );
  });
});

describe('what the page tells you to do', () => {
  it('forward swap, solver locked on Bitcoin Cash: builds the claim, no wallet needed', async () => {
    const file = makeFile({ direction: 'EVM_TO_BCH' });
    const result = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE - 3600, lockStatus: 'locked' },
        bch: { tipHeight: 800_000, hasUtxo: true },
      }),
    );
    expect(result.plan?.actions).toEqual([{ chain: 'BCH', action: 'claim' }]);
    expect(result.bchTx?.action).toBe('claim');
    expect(result.bchTx?.txHex).toMatch(/^[0-9a-f]+$/);
    expect(result.bchTx?.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('forward swap that never got a counter-lock: waits, then refunds on EVM after the deadline', async () => {
    const file = makeFile({ direction: 'EVM_TO_BCH' });
    const early = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE - 100, lockStatus: 'locked' },
        bch: { tipHeight: 800_000, hasUtxo: false },
      }),
    );
    expect(early.plan?.actions).toEqual([]);
    expect(early.plan?.waits.some((w) => w.chain === 'EVM')).toBe(true);
    expect(early.evmCall?.action).toBe('refund');

    const late = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE + 1, lockStatus: 'locked' },
        bch: { tipHeight: 800_000, hasUtxo: false },
      }),
    );
    expect(late.plan?.actions).toEqual([{ chain: 'EVM', action: 'refund' }]);
    expect(late.evmCall?.to.toLowerCase()).toBe(
      file.contracts.evm.htlcAddress.toLowerCase(),
    );
  });

  it('reverse swap: claim on EVM with the secret; refund on Bitcoin Cash only from the refund height', async () => {
    const file = makeFile({ direction: 'BCH_TO_EVM' });
    const claimable = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE - 3600, lockStatus: 'locked' },
        bch: { tipHeight: REFUND_HEIGHT - 10, hasUtxo: true },
      }),
    );
    expect(claimable.plan?.actions).toEqual([
      { chain: 'EVM', action: 'claim' },
    ]);
    expect(claimable.evmCall?.action).toBe('claim');
    expect(claimable.bchTx).toBeNull();

    const refundable = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE + 10, lockStatus: 'none' },
        bch: { tipHeight: REFUND_HEIGHT + 1, hasUtxo: true },
      }),
    );
    expect(refundable.plan?.actions).toEqual([
      { chain: 'BCH', action: 'refund' },
    ]);
    expect(refundable.bchTx?.action).toBe('refund');
  });

  it('a file without the secret cannot claim, and says it is waiting for the secret', async () => {
    const file = makeFile({ direction: 'BCH_TO_EVM', withSecret: false });
    const result = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE - 100, lockStatus: 'locked' },
        bch: { tipHeight: 1, hasUtxo: false },
      }),
    );
    expect(
      result.plan?.actions.find((a) => a.action === 'claim'),
    ).toBeUndefined();
    expect(result.evmCall).toBeNull();
  });

  it('makes no plan from a guess when a chain cannot be read, and says why', async () => {
    const file = makeFile({ direction: 'EVM_TO_BCH' });
    const result = await inspectRecovery(
      file,
      ports({
        evmError: 'No EVM endpoint answered',
        bch: { tipHeight: 1, hasUtxo: false },
      }),
    );
    expect(result.plan).toBeNull();
    expect(result.errors.evm).toMatch(/No EVM endpoint/);
    expect(result.bchTx).toBeNull();
    // The manual route is still offered.
    expect(result.evmCall?.action).toBe('refund');
  });

  it('a finished swap offers nothing to do', async () => {
    const file = makeFile({ direction: 'EVM_TO_BCH' });
    const result = await inspectRecovery(
      file,
      ports({
        evm: { nowSeconds: DEADLINE + 5, lockStatus: 'claimed' },
        bch: { tipHeight: 800_000, hasUtxo: false },
      }),
    );
    expect(result.plan?.actions).toEqual([]);
  });
});
