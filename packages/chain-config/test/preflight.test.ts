import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  parsePreflightAddresses,
  scripthashForCashAddress,
  sumBchUtxos,
} from '../src/preflight.js';

const EVM = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EVM2 = '0x1111111111111111111111111111111111111111';
const BCH = 'bchtest:qq2azmyyv6dtgczexyalqar70q036yund53jvfde0x';
const PUSD = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const MUSD = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366';

describe('preflight addresses', () => {
  it('classifies EVM and BCH addresses', () => {
    expect(parsePreflightAddresses(`${EVM}, ${BCH}`)).toEqual({
      evm: [getAddress(EVM)],
      bch: [BCH],
      deployerEvm: getAddress(EVM),
      solverEvm: getAddress(EVM),
      solverBch: BCH,
    });
  });

  it('returns empty lists for an unset value', () => {
    expect(parsePreflightAddresses(undefined)).toEqual({
      evm: [],
      bch: [],
      deployerEvm: null,
      solverEvm: null,
      solverBch: null,
    });
    expect(parsePreflightAddresses('  ')).toEqual({
      evm: [],
      bch: [],
      deployerEvm: null,
      solverEvm: null,
      solverBch: null,
    });
  });

  it('accepts labelled deployer, solver and BCH addresses', () => {
    expect(
      parsePreflightAddresses(`deployer=${EVM},solver=${EVM2},bch=${BCH}`),
    ).toEqual({
      evm: [getAddress(EVM), getAddress(EVM2)],
      bch: [BCH],
      deployerEvm: getAddress(EVM),
      solverEvm: getAddress(EVM2),
      solverBch: BCH,
    });
  });

  it('rejects an invalid entry without echoing it', () => {
    try {
      parsePreflightAddresses('not-an-address');
    } catch (error) {
      expect(String(error)).toContain('position 1');
      expect(String(error)).not.toContain('not-an-address');
      return;
    }
    throw new Error('expected parsePreflightAddresses to throw');
  });

  it('computes an Electrum scripthash for a CashAddr', () => {
    expect(scripthashForCashAddress(BCH)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('BCH balance summing', () => {
  it('sums BCH sats and PUSD/MUSD token amounts', () => {
    expect(
      sumBchUtxos(
        [
          {
            height: 1,
            tx_hash: 'aa',
            tx_pos: 0,
            value: 1000,
            token_data: { category: PUSD, amount: '1500' },
          },
          {
            height: 1,
            tx_hash: 'bb',
            tx_pos: 1,
            value: 2000,
            token_data: { category: `0x${MUSD}`, amount: '500' },
          },
          { height: 1, tx_hash: 'cc', tx_pos: 2, value: 3000 },
        ],
        PUSD,
        MUSD,
      ),
    ).toEqual({ sats: 6000n, pusd: 1500n, musd: 500n });
  });

  it('ignores unrelated token categories', () => {
    expect(
      sumBchUtxos(
        [
          {
            height: 1,
            tx_hash: 'dd',
            tx_pos: 0,
            value: 1000,
            token_data: { category: '11'.repeat(32), amount: '99' },
          },
        ],
        PUSD,
        MUSD,
      ),
    ).toEqual({ sats: 1000n, pusd: 0n, musd: 0n });
  });
});
