import { describe, expect, it } from 'vitest';
import { wizardSignParams } from '../lib/wallet/wizard-sign';

// A request shaped like the one the lock builder hands to the wallet: native bigint and byte
// arrays inside it. The wallet transport sends JSON, which cannot carry either.
const request = {
  transaction: {
    transaction: { version: 2, inputs: [], outputs: [], locktime: 0 },
    sourceOutputs: [
      {
        outpointIndex: 0,
        outpointTransactionHash: new Uint8Array(32).fill(1),
        sequenceNumber: 0,
        unlockingBytecode: new Uint8Array(0),
        valueSatoshis: 5_000n,
        lockingBytecode: new Uint8Array([0x76, 0xa9]),
      },
    ],
    broadcast: false,
    userPrompt: 'Sign',
  },
  relayTransaction: {
    transaction: 'ab'.repeat(40),
    sourceOutputs: [
      {
        outpointTransactionHash: '01'.repeat(32),
        outpointIndex: 0,
        unlockingBytecode: '',
        sequenceNumber: 0,
        valueSatoshis: '<bigint: 5000n>',
        lockingBytecode: '76a9',
      },
    ],
    broadcast: false,
    userPrompt: 'Sign',
  },
  inputPaths: [[0, 'receive', 0]],
} as never;

describe('what is handed to the WizardConnect manager', () => {
  it('survives JSON, the way the relay sends it', () => {
    const params = wizardSignParams(request);
    expect(() => JSON.stringify(params)).not.toThrow();
    const text = JSON.stringify(params);
    expect(text).toContain('<bigint: 5000n>');
  });

  it('keeps one input path per input, with the input index first', () => {
    expect(wizardSignParams(request).inputPaths).toEqual([[0, 'receive', 0]]);
  });
});
