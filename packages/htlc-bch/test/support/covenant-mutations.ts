import {
  decodeAuthenticationInstructions,
  decodeTransaction,
  hash256,
  hexToBin,
  sha256,
  type Output,
  type Transaction,
} from '@bitauth/libauth';
import {
  buildClaimTransaction,
  buildRefundTransaction,
  encodeHtlcParameters,
  verifyBchTransactionWithVm,
  type BuiltTransaction,
} from '../../src/index.js';

/** Token categories in display byte order (the order explorers show). */
export const TOKENS = {
  PUSD: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
  MUSD: 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366',
} as const;

export type TokenName = keyof typeof TOKENS;
export type Direction = 'claim' | 'refund';

const p2pkh = (fill: number): Uint8Array =>
  new Uint8Array([
    0x76,
    0xa9,
    0x14,
    ...new Uint8Array(20).fill(fill),
    0x88,
    0xac,
  ]);

const SECRET = new Uint8Array(32).fill(0x01);
const RECIPIENT = p2pkh(0x11);
const REFUND = p2pkh(0x22);
const OTHER = p2pkh(0x33);
const AMOUNT = 1000n;
const MAX_FEE = 1500n;
const REFUND_HEIGHT = 500_000;
const INPUT_SATS = 3000n;

/**
 * libauth 3.0.0 evaluates the redeem script of a P2SH32 output but never
 * compares its hash with the locking script, so `verify` alone accepts any
 * redeem script. Consensus does check it; this reproduces that check.
 */
function redeemScriptMatchesLock(tx: Transaction, sources: Output[]): boolean {
  return tx.inputs.every((input, i) => {
    const lock = sources[i]!.lockingBytecode;
    const isP2sh32 =
      lock.length === 35 &&
      lock[0] === 0xaa &&
      lock[1] === 0x20 &&
      lock[34] === 0x87;
    if (!isP2sh32) return true;
    const instructions = decodeAuthenticationInstructions(
      input.unlockingBytecode,
    );
    const last = instructions[instructions.length - 1];
    if (last === undefined || !('data' in last)) return false;
    const hash = hash256(last.data);
    return hash.every((byte, j) => byte === lock[2 + j]);
  });
}

export interface MutationCase {
  /** Human-readable mutation id, stable across runs. */
  name: string;
  /** Set only when the covenant is meant to accept this change; the text says why. */
  allowed?: string;
  apply: (tx: Transaction) => void;
}

export interface MutationReport {
  total: number;
  rejected: number;
  allowedAccepted: string[];
  /** Mutations that were accepted but are not documented as allowed. */
  unexpectedlyAccepted: string[];
  /** Mutations documented as allowed that the VM rejected. */
  unexpectedlyRejected: string[];
}

function fixture(direction: Direction, token: TokenName) {
  const params = encodeHtlcParameters({
    hashLock: sha256.hash(SECRET),
    recipientLockingBytecode: RECIPIENT,
    refundLockingBytecode: REFUND,
    tokenCategory: TOKENS[token],
    tokenAmount: AMOUNT,
    refundHeight: REFUND_HEIGHT,
    maxFee: MAX_FEE,
  });
  const utxo = { txid: '11'.repeat(32), vout: 0, satoshis: INPUT_SATS };
  const built: BuiltTransaction =
    direction === 'claim'
      ? buildClaimTransaction({ params, utxo, secret: SECRET })
      : buildRefundTransaction({ params, utxo });
  return built;
}

function decode(built: BuiltTransaction): Transaction {
  const tx = decodeTransaction(hexToBin(built.txHex));
  if (typeof tx === 'string') throw new Error(tx);
  return tx;
}

function category(token: TokenName): Uint8Array {
  // libauth holds token categories in display order and reverses on encode.
  return hexToBin(TOKENS[token]);
}

/** Every mutation of one spend. Pure: it only describes changes. */
export function buildMutations(
  direction: Direction,
  token: TokenName,
  unlockingLength: number,
  payeeLength: number,
): MutationCase[] {
  const cases: MutationCase[] = [];
  const payee = direction === 'claim' ? RECIPIENT : REFUND;
  const wrongPayees = [direction === 'claim' ? REFUND : RECIPIENT, OTHER];
  const out0 = (tx: Transaction): Output => tx.inputs && tx.outputs[0]!;
  const feeFloor = INPUT_SATS - MAX_FEE;

  for (let i = 0; i < unlockingLength; i++) {
    for (const mask of [0xff, 0x01]) {
      cases.push({
        name: `unlocking byte ${i} xor ${mask.toString(16)}`,
        apply: (tx) => {
          const bytes = new Uint8Array(tx.inputs[0]!.unlockingBytecode);
          bytes[i] = (bytes[i] ?? 0) ^ mask;
          tx.inputs[0] = { ...tx.inputs[0]!, unlockingBytecode: bytes };
        },
      });
    }
  }
  cases.push(
    {
      name: 'unlocking script truncated by one byte',
      apply: (tx) => {
        tx.inputs[0] = {
          ...tx.inputs[0]!,
          unlockingBytecode: tx.inputs[0]!.unlockingBytecode.slice(0, -1),
        };
      },
    },
    {
      name: 'unlocking script extended by one byte',
      apply: (tx) => {
        tx.inputs[0] = {
          ...tx.inputs[0]!,
          unlockingBytecode: new Uint8Array([
            ...tx.inputs[0]!.unlockingBytecode,
            0x00,
          ]),
        };
      },
    },
  );

  for (let i = 0; i < payeeLength; i++) {
    cases.push({
      name: `recipient bytecode byte ${i} xor ff`,
      apply: (tx) => {
        const bytes = new Uint8Array(out0(tx).lockingBytecode);
        bytes[i] = (bytes[i] ?? 0) ^ 0xff;
        tx.outputs[0] = { ...out0(tx), lockingBytecode: bytes };
      },
    });
  }
  for (const [n, wrong] of wrongPayees.entries()) {
    cases.push({
      name: `payee replaced by other party ${n}`,
      apply: (tx) => {
        tx.outputs[0] = { ...out0(tx), lockingBytecode: wrong };
      },
    });
  }
  cases.push(
    {
      name: 'payee bytecode lengthened',
      apply: (tx) => {
        tx.outputs[0] = {
          ...out0(tx),
          lockingBytecode: new Uint8Array([...payee, 0x00]),
        };
      },
    },
    {
      name: 'payee bytecode empty',
      apply: (tx) => {
        tx.outputs[0] = { ...out0(tx), lockingBytecode: new Uint8Array(0) };
      },
    },
  );

  for (let i = 0; i < 32; i++) {
    cases.push({
      name: `token category byte ${i} xor ff`,
      apply: (tx) => {
        const bytes = new Uint8Array(category(token));
        bytes[i] = (bytes[i] ?? 0) ^ 0xff;
        tx.outputs[0] = {
          ...out0(tx),
          token: { ...out0(tx).token!, category: bytes },
        };
      },
    });
  }
  const otherToken: TokenName = token === 'PUSD' ? 'MUSD' : 'PUSD';
  cases.push(
    {
      name: 'category swapped to the other stablecoin',
      apply: (tx) => {
        tx.outputs[0] = {
          ...out0(tx),
          token: { ...out0(tx).token!, category: category(otherToken) },
        };
      },
    },
    {
      name: 'category in reversed (wire) byte order',
      apply: (tx) => {
        tx.outputs[0] = {
          ...out0(tx),
          token: { ...out0(tx).token!, category: category(token).reverse() },
        };
      },
    },
    {
      name: 'token removed from output',
      apply: (tx) => {
        tx.outputs[0] = {
          lockingBytecode: out0(tx).lockingBytecode,
          valueSatoshis: out0(tx).valueSatoshis,
        };
      },
    },
  );

  for (const delta of [-AMOUNT, -1n, 1n, AMOUNT, 1n << 40n]) {
    cases.push({
      name: `token amount ${delta > 0n ? '+' : ''}${delta}`,
      apply: (tx) => {
        tx.outputs[0] = {
          ...out0(tx),
          token: { ...out0(tx).token!, amount: AMOUNT + delta },
        };
      },
    });
  }
  for (const capability of ['none', 'mutable', 'minting'] as const) {
    cases.push({
      name: `output gains ${capability} NFT`,
      apply: (tx) => {
        tx.outputs[0] = {
          ...out0(tx),
          token: {
            ...out0(tx).token!,
            nft: { capability, commitment: new Uint8Array([0x01]) },
          },
        };
      },
    });
  }

  const values: Array<[bigint, string | undefined]> = [
    [0n, undefined],
    [feeFloor - 1n, undefined],
    [feeFloor, 'output value at the maxFee floor'],
    [feeFloor + 1n, 'output value above the floor (less fee)'],
    [INPUT_SATS, 'output value equal to the input (zero fee)'],
  ];
  for (const [value, allowed] of values) {
    cases.push({
      name: `output value ${value}`,
      ...(allowed === undefined ? {} : { allowed }),
      apply: (tx) => {
        tx.outputs[0] = { ...out0(tx), valueSatoshis: value };
      },
    });
  }

  cases.push(
    {
      name: 'second output added (dust to attacker)',
      apply: (tx) => {
        tx.outputs.push({
          lockingBytecode: OTHER,
          valueSatoshis: 546n,
          token: { category: category(token), amount: 0n },
        });
      },
    },
    {
      name: 'second plain output added',
      apply: (tx) => {
        tx.outputs.push({ lockingBytecode: OTHER, valueSatoshis: 546n });
      },
    },
    {
      name: 'output duplicated',
      apply: (tx) => {
        tx.outputs.push({ ...out0(tx) });
      },
    },
    {
      name: 'outputs removed',
      apply: (tx) => {
        tx.outputs = [];
      },
    },
    {
      name: 'extra input added',
      apply: (tx) => {
        tx.inputs.push({
          outpointIndex: 1,
          outpointTransactionHash: new Uint8Array(32).fill(0x99),
          sequenceNumber: 0xffffffff,
          unlockingBytecode: new Uint8Array(0),
        });
      },
    },
  );

  for (const height of [
    0,
    REFUND_HEIGHT - 1,
    REFUND_HEIGHT,
    REFUND_HEIGHT + 1,
    499_999_999,
  ]) {
    const mustFail = direction === 'refund' && height < REFUND_HEIGHT;
    cases.push({
      name: `locktime ${height}`,
      ...(mustFail
        ? {}
        : {
            allowed:
              direction === 'claim'
                ? 'claim does not constrain locktime (documented race)'
                : 'refund at or after the refund height',
          }),
      apply: (tx) => {
        tx.locktime = height;
      },
    });
  }
  cases.push({
    name: 'locktime in time units (>= 500,000,000)',
    ...(direction === 'claim'
      ? { allowed: 'claim does not constrain locktime (documented race)' }
      : {}),
    apply: (tx) => {
      tx.locktime = 1_700_000_000;
    },
  });

  for (const sequence of [0xffffffff, 0xfffffffe, 0, 1, 0x80000000]) {
    const final = sequence === 0xffffffff;
    cases.push({
      name: `sequence ${sequence.toString(16)}`,
      ...(direction === 'refund' && final
        ? {}
        : {
            allowed:
              direction === 'claim'
                ? 'claim does not constrain sequence'
                : 'refund needs a non-final sequence so locktime applies',
          }),
      apply: (tx) => {
        tx.inputs[0] = { ...tx.inputs[0]!, sequenceNumber: sequence };
      },
    });
  }
  cases.push({
    name: 'transaction version 1',
    allowed: 'the script cannot see the transaction version',
    apply: (tx) => {
      tx.version = 1;
    },
  });
  return cases;
}

export function runCovenantMutations(
  direction: Direction,
  token: TokenName,
): MutationReport {
  const built = fixture(direction, token);
  const baseline = verifyBchTransactionWithVm({
    transaction: built.libauthTx,
    sourceOutputs: [built.sourceOutput],
  });
  if (
    baseline !== true ||
    !redeemScriptMatchesLock(built.libauthTx, [built.sourceOutput as Output])
  )
    throw new Error(`baseline spend invalid: ${baseline}`);

  const base = decode(built);
  const cases = buildMutations(
    direction,
    token,
    base.inputs[0]!.unlockingBytecode.length,
    base.outputs[0]!.lockingBytecode.length,
  );
  const report: MutationReport = {
    total: cases.length,
    rejected: 0,
    allowedAccepted: [],
    unexpectedlyAccepted: [],
    unexpectedlyRejected: [],
  };
  for (const mutation of cases) {
    const tx = decode(built);
    mutation.apply(tx);
    const sources: Output[] = [built.sourceOutput as Output];
    if (tx.inputs.length > 1) {
      sources.push({ lockingBytecode: OTHER, valueSatoshis: 1000n });
    }
    const result = verifyBchTransactionWithVm({
      transaction: tx,
      sourceOutputs: sources,
    });
    const accepted = result === true && redeemScriptMatchesLock(tx, sources);
    if (!accepted) report.rejected++;
    if (accepted && mutation.allowed !== undefined) {
      report.allowedAccepted.push(`${mutation.name}: ${mutation.allowed}`);
    } else if (accepted) {
      report.unexpectedlyAccepted.push(mutation.name);
    } else if (mutation.allowed !== undefined) {
      report.unexpectedlyRejected.push(`${mutation.name}: ${String(result)}`);
    }
  }
  return report;
}
