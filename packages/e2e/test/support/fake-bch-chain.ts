// A simulated Bitcoin Cash chain for end-to-end tests. It speaks the Fulcrum
// protocol at the transport level, so the solver's real `BchQuorumClient` (quorum
// status, genesis check, failover) runs on top of it unchanged.
//
// It is strict on purpose: a broadcast is accepted only if every input spends an
// existing, unspent output, passes the libauth script VM against that output,
// satisfies the P2SH32 redeem script commitment (which libauth does not check),
// obeys value, dust, fee, token and locktime rules, and does not double-spend.
import {
  binToHex,
  createVirtualMachineBCH,
  decodeAuthenticationInstructions,
  decodeTransaction,
  encodeTransaction,
  hexToBin,
  sha256,
  type Input,
  type Output,
  type Transaction,
} from '@bitauth/libauth';
import { BchQuorumClient } from '@ferry/solver';
import type { BchChainPort } from '@ferry/solver';

export const CHIPNET_GENESIS_HASH =
  '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b';

const DUST_SATS = 546n;
const MIN_RELAY_SATS_PER_BYTE = 1n;
const MAX_TOKEN_AMOUNT = 9_223_372_036_854_775_807n;
const FINAL_SEQUENCE = 0xffffffff;
const LOCKTIME_THRESHOLD = 500_000_000;

type Bytes = Uint8Array;

export interface ChainToken {
  /** Category as libauth holds it (display order). */
  category: Bytes;
  amount: bigint;
  nft?: {
    capability: 'none' | 'mutable' | 'minting';
    commitment: Bytes;
  };
}

export interface ChainOutput {
  lockingBytecode: Bytes;
  valueSatoshis: bigint;
  token?: ChainToken;
}

export interface ChainUtxo {
  txid: string;
  vout: number;
  output: ChainOutput;
  /** 0 while the creating transaction is unconfirmed. */
  height: number;
}

interface ChainTx {
  txid: string;
  hex: string;
  tx: Transaction;
  sources: ChainOutput[];
  /** 0 while in the mempool. */
  height: number;
  order: number;
  time: number;
}

export class BroadcastRejectedError extends Error {
  constructor(reason: string) {
    super(`the transaction was rejected by network rules: ${reason}`);
    this.name = 'BroadcastRejectedError';
  }
}

// --- encoding helpers -------------------------------------------------------

const reverse = (bytes: Bytes): Bytes => Uint8Array.from(bytes).reverse();

/** The display transaction id: double SHA-256 of the raw transaction, reversed. */
export function txidOfHex(txHex: string): string {
  return binToHex(
    reverse(sha256.hash(sha256.hash(hexToBin(txHex.replace(/^0x/i, ''))))),
  );
}

/** Fulcrum script hash: SHA-256 of the locking bytecode, reversed. */
export function scriptHashOf(lockingBytecode: Bytes): string {
  return binToHex(reverse(sha256.hash(lockingBytecode)));
}

const outpointKey = (txid: string, vout: number): string => `${txid}:${vout}`;
// libauth holds outpoint hashes and token categories in display (big-endian) order.
const displayTxidOfInput = (input: Input): string =>
  binToHex(input.outpointTransactionHash);

function toChainOutput(output: Output): ChainOutput {
  return {
    lockingBytecode: output.lockingBytecode,
    valueSatoshis: output.valueSatoshis,
    ...(output.token
      ? {
          token: {
            category: output.token.category,
            amount: output.token.amount,
            ...(output.token.nft ? { nft: output.token.nft } : {}),
          },
        }
      : {}),
  };
}

function tokenDataOf(output: ChainOutput) {
  if (!output.token) return undefined;
  return {
    category: binToHex(output.token.category),
    amount: output.token.amount.toString(),
    ...(output.token.nft
      ? {
          nft: {
            capability: output.token.nft.capability,
            commitment: binToHex(output.token.nft.commitment),
          },
        }
      : {}),
  };
}

function isPayToScriptHash32(locking: Bytes): boolean {
  return (
    locking.length === 35 &&
    locking[0] === 0xaa &&
    locking[1] === 0x20 &&
    locking[34] === 0x87
  );
}

/**
 * The redeem script a P2SH32 input reveals: the last data push of its unlocking
 * bytecode. Returns null when the unlocking bytecode is not a sequence of pushes.
 */
function revealedRedeemScript(unlocking: Bytes): Bytes | null {
  const instructions = decodeAuthenticationInstructions(unlocking);
  let last: Bytes | null = null;
  for (const instruction of instructions) {
    if ('data' in instruction) last = instruction.data;
    else if (instruction.opcode > 0x60) return null;
  }
  return last;
}

// --- the chain ---------------------------------------------------------------

export interface FakeBchChainOptions {
  /** Height of the first mined block. */
  startHeight?: number;
  now?: () => number;
}

export class FakeBchChain {
  readonly genesisHash = CHIPNET_GENESIS_HASH;
  private readonly now: () => number;
  private readonly txs = new Map<string, ChainTx>();
  private readonly spentBy = new Map<string, string>();
  private readonly blockTimes: number[] = [];
  private readonly baseHeight: number;
  private counter = 0;
  private readonly transports = new Set<FakeElectrumTransport>();
  private readonly doubleSpendProofs = new Map<string, unknown>();
  /** Every broadcast attempt, accepted or not, for test assertions. */
  readonly broadcasts: Array<{
    hex: string;
    txid: string | null;
    error: string | null;
  }> = [];

  constructor(options: FakeBchChainOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.baseHeight = options.startHeight ?? 200_000;
    this.blockTimes.push(this.now());
  }

  // -- tip and blocks ---------------------------------------------------------

  get tipHeight(): number {
    return this.baseHeight + this.blockTimes.length - 1;
  }

  get tipTimeMs(): number {
    return this.blockTimes[this.blockTimes.length - 1]!;
  }

  /** Mine `count` blocks; the first one confirms everything in the mempool. */
  mine(count = 1): number {
    for (let i = 0; i < count; i++) {
      this.blockTimes.push(this.now());
      const height = this.tipHeight;
      for (const entry of this.txs.values()) {
        if (entry.height === 0) entry.height = height;
      }
    }
    this.notifyAll();
    return this.tipHeight;
  }

  /**
   * A reorg: the last `blocks` blocks are disconnected and their transactions go
   * back to the mempool, as on a real node. Combine with `evict` to model a lock
   * transaction that does not come back on the new branch.
   */
  disconnectBlocks(blocks: number): void {
    const newTip = this.tipHeight - blocks;
    if (newTip < this.baseHeight)
      throw new Error('Cannot reorg past the start');
    this.blockTimes.length = newTip - this.baseHeight + 1;
    for (const entry of this.txs.values()) {
      if (entry.height > newTip) entry.height = 0;
    }
    this.notifyAll();
  }

  /** Remove a transaction and everything that spends it, as if it never existed. */
  evict(txid: string): string[] {
    const removed: string[] = [];
    const visit = (id: string): void => {
      const entry = this.txs.get(id);
      if (!entry) return;
      this.txs.delete(id);
      removed.push(id);
      for (const input of entry.tx.inputs) {
        this.spentBy.delete(
          outpointKey(displayTxidOfInput(input), input.outpointIndex),
        );
      }
      entry.tx.outputs.forEach((_, vout) => {
        const spender = this.spentBy.get(outpointKey(id, vout));
        if (spender) visit(spender);
      });
    };
    visit(txid);
    this.notifyAll();
    return removed;
  }

  setDoubleSpendProof(txid: string, proof: unknown): void {
    this.doubleSpendProofs.set(txid, proof);
  }

  // -- funding (test setup) ---------------------------------------------------

  /** Creates a confirmed output out of nothing, like a coinbase for tests. */
  fund(output: ChainOutput): { txid: string; vout: number } {
    this.counter += 1;
    const tx: Transaction = {
      version: 2,
      locktime: 0,
      inputs: [
        {
          outpointTransactionHash: new Uint8Array(32),
          outpointIndex: 0xffffffff,
          sequenceNumber: FINAL_SEQUENCE,
          unlockingBytecode: Uint8Array.from([
            0x04,
            this.counter & 0xff,
            (this.counter >> 8) & 0xff,
            (this.counter >> 16) & 0xff,
            (this.counter >> 24) & 0xff,
          ]),
        },
      ],
      outputs: [output],
    };
    const hex = binToHex(encodeTransaction(tx));
    const txid = txidOfHex(hex);
    this.blockTimes.push(this.now());
    this.txs.set(txid, {
      txid,
      hex,
      tx,
      sources: [],
      height: this.tipHeight,
      order: ++this.counter,
      time: this.now(),
    });
    this.notifyAll();
    return { txid, vout: 0 };
  }

  // -- queries ----------------------------------------------------------------

  hasTx(txid: string): boolean {
    return this.txs.has(txid);
  }

  txHeight(txid: string): number | null {
    return this.txs.get(txid)?.height ?? null;
  }

  confirmations(txid: string): number {
    const entry = this.txs.get(txid);
    if (!entry || entry.height === 0) return 0;
    return this.tipHeight - entry.height + 1;
  }

  getTxHex(txid: string): string | null {
    return this.txs.get(txid)?.hex ?? null;
  }

  isSpent(txid: string, vout: number): boolean {
    return this.spentBy.has(outpointKey(txid, vout));
  }

  spenderOf(txid: string, vout: number): string | null {
    return this.spentBy.get(outpointKey(txid, vout)) ?? null;
  }

  /** Accepted transactions in broadcast order (funding transactions excluded). */
  acceptedBroadcasts(): string[] {
    return this.broadcasts.flatMap((b) => (b.txid !== null ? [b.txid] : []));
  }

  utxosForScriptHash(scriptHash: string): ChainUtxo[] {
    const found: ChainUtxo[] = [];
    for (const entry of this.sortedTxs()) {
      entry.tx.outputs.forEach((output, vout) => {
        if (this.spentBy.has(outpointKey(entry.txid, vout))) return;
        const chainOutput = toChainOutput(output);
        if (scriptHashOf(chainOutput.lockingBytecode) !== scriptHash) return;
        found.push({
          txid: entry.txid,
          vout,
          output: chainOutput,
          height: entry.height,
        });
      });
    }
    return found;
  }

  historyForScriptHash(
    scriptHash: string,
  ): Array<{ tx_hash: string; height: number }> {
    const history: Array<{ tx_hash: string; height: number }> = [];
    for (const entry of this.sortedTxs()) {
      const touches =
        entry.tx.outputs.some(
          (o) => scriptHashOf(o.lockingBytecode) === scriptHash,
        ) ||
        entry.sources.some(
          (o) => scriptHashOf(o.lockingBytecode) === scriptHash,
        );
      if (touches) history.push({ tx_hash: entry.txid, height: entry.height });
    }
    return history;
  }

  /**
   * The secret a spend reveals: the 32-byte push in any input's unlocking bytecode
   * whose SHA-256 equals `hashLock`.
   */
  secretRevealedBy(txid: string, hashLock: string): string | null {
    const entry = this.txs.get(txid);
    if (!entry) return null;
    const wanted = hashLock.replace(/^0x/i, '').toLowerCase();
    for (const input of entry.tx.inputs) {
      for (const instruction of decodeAuthenticationInstructions(
        input.unlockingBytecode,
      )) {
        if (
          'data' in instruction &&
          instruction.data.length === 32 &&
          binToHex(sha256.hash(instruction.data)) === wanted
        ) {
          return `0x${binToHex(instruction.data)}`;
        }
      }
    }
    return null;
  }

  private sortedTxs(): ChainTx[] {
    return [...this.txs.values()].sort((a, b) => {
      const ah = a.height === 0 ? Infinity : a.height;
      const bh = b.height === 0 ? Infinity : b.height;
      return ah === bh ? a.order - b.order : ah - bh;
    });
  }

  private statusOf(scriptHash: string): string | null {
    const history = this.historyForScriptHash(scriptHash);
    if (history.length === 0) return null;
    const text = history.map((h) => `${h.tx_hash}:${h.height}:`).join('');
    return binToHex(sha256.hash(new TextEncoder().encode(text)));
  }

  // -- broadcast --------------------------------------------------------------

  /** Validates and accepts a transaction into the mempool, or throws. */
  broadcast(txHex: string): string {
    const clean = txHex.replace(/^0x/i, '');
    try {
      const txid = this.accept(clean);
      this.broadcasts.push({ hex: clean, txid, error: null });
      this.notifyAll();
      return txid;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.broadcasts.push({ hex: clean, txid: null, error: message });
      throw error instanceof BroadcastRejectedError
        ? error
        : new BroadcastRejectedError(message);
    }
  }

  private accept(hex: string): string {
    if (!/^([0-9a-fA-F]{2})+$/.test(hex)) {
      throw new BroadcastRejectedError('the transaction is not valid hex');
    }
    const decoded = decodeTransaction(hexToBin(hex));
    if (typeof decoded === 'string') {
      throw new BroadcastRejectedError(`decode error: ${decoded}`);
    }
    const tx = decoded;
    const txid = txidOfHex(hex);
    if (this.txs.has(txid)) {
      throw new BroadcastRejectedError('txn-already-in-mempool');
    }
    if (tx.inputs.length === 0 || tx.outputs.length === 0) {
      throw new BroadcastRejectedError(
        'bad-txns-vin-empty or bad-txns-vout-empty',
      );
    }

    // Inputs: exist, are unspent, appear once.
    const seen = new Set<string>();
    const sources: ChainOutput[] = [];
    for (const [index, input] of tx.inputs.entries()) {
      const key = outpointKey(displayTxidOfInput(input), input.outpointIndex);
      if (seen.has(key)) {
        throw new BroadcastRejectedError(
          `bad-txns-inputs-duplicate (input ${index})`,
        );
      }
      seen.add(key);
      const parent = this.txs.get(displayTxidOfInput(input));
      const parentOutput = parent?.tx.outputs[input.outpointIndex];
      if (!parent || !parentOutput) {
        throw new BroadcastRejectedError(
          `missing-inputs: input ${index} spends ${key}, which does not exist`,
        );
      }
      if (this.spentBy.has(key)) {
        throw new BroadcastRejectedError(
          `txn-mempool-conflict: input ${index} spends ${key}, already spent by ${this.spentBy.get(key)}`,
        );
      }
      sources.push(toChainOutput(parentOutput));
    }

    // Locktime finality against the next block.
    this.assertFinal(tx);

    // P2SH32: the revealed redeem script must hash to the locking commitment.
    // libauth runs the redeem script but does not check this.
    tx.inputs.forEach((input, index) => {
      const locking = sources[index]!.lockingBytecode;
      if (!isPayToScriptHash32(locking)) return;
      const redeem = revealedRedeemScript(input.unlockingBytecode);
      if (redeem === null) {
        throw new BroadcastRejectedError(
          `input ${index}: no redeem script is revealed for a pay-to-script-hash-32 output`,
        );
      }
      const hash = sha256.hash(sha256.hash(redeem));
      if (binToHex(hash) !== binToHex(locking.slice(2, 34))) {
        throw new BroadcastRejectedError(
          `input ${index}: the revealed redeem script does not hash to the P2SH32 commitment`,
        );
      }
    });

    // The script VM, with every source output including its token.
    const vm = createVirtualMachineBCH();
    const verdict = vm.verify({
      sourceOutputs: sources.map((s) => ({
        lockingBytecode: s.lockingBytecode,
        valueSatoshis: s.valueSatoshis,
        ...(s.token ? { token: s.token } : {}),
      })) as Output[],
      transaction: tx,
    });
    if (typeof verdict === 'string') {
      throw new BroadcastRejectedError(
        `mandatory-script-verify-flag-failed: ${verdict}`,
      );
    }

    this.assertValueAndFee(tx, sources, hex.length / 2);
    this.assertTokens(tx, sources);

    for (const input of tx.inputs) {
      this.spentBy.set(
        outpointKey(displayTxidOfInput(input), input.outpointIndex),
        txid,
      );
    }
    this.txs.set(txid, {
      txid,
      hex,
      tx,
      sources,
      height: 0,
      order: ++this.counter,
      time: this.now(),
    });
    return txid;
  }

  private assertFinal(tx: Transaction): void {
    if (tx.locktime === 0) return;
    if (tx.inputs.every((i) => i.sequenceNumber === FINAL_SEQUENCE)) return;
    const nextHeight = this.tipHeight + 1;
    const final =
      tx.locktime < LOCKTIME_THRESHOLD
        ? tx.locktime < nextHeight
        : tx.locktime < Math.floor(this.tipTimeMs / 1000);
    if (!final) {
      throw new BroadcastRejectedError(
        `non-final: locktime ${tx.locktime} is not yet reached (next block ${nextHeight})`,
      );
    }
  }

  private assertValueAndFee(
    tx: Transaction,
    sources: ChainOutput[],
    size: number,
  ): void {
    const inValue = sources.reduce((sum, s) => sum + s.valueSatoshis, 0n);
    let outValue = 0n;
    for (const [index, output] of tx.outputs.entries()) {
      const isDataOutput = output.lockingBytecode[0] === 0x6a;
      if (output.valueSatoshis < 0n) {
        throw new BroadcastRejectedError(
          `bad-txns-vout-negative (output ${index})`,
        );
      }
      if (!isDataOutput && output.valueSatoshis < DUST_SATS) {
        throw new BroadcastRejectedError(
          `dust: output ${index} carries ${output.valueSatoshis} satoshis`,
        );
      }
      outValue += output.valueSatoshis;
    }
    if (outValue > inValue) {
      throw new BroadcastRejectedError('bad-txns-in-belowout');
    }
    if (inValue - outValue < BigInt(size) * MIN_RELAY_SATS_PER_BYTE) {
      throw new BroadcastRejectedError(
        `min relay fee not met: ${inValue - outValue} satoshis for ${size} bytes`,
      );
    }
  }

  /** CashTokens conservation: nothing is minted or inflated outside a genesis. */
  private assertTokens(tx: Transaction, sources: ChainOutput[]): void {
    const key = (category: Bytes) => binToHex(category);
    const fungibleIn = new Map<string, bigint>();
    const nftsIn: Array<NonNullable<ChainToken['nft']> & { cat: string }> = [];
    for (const source of sources) {
      if (!source.token) continue;
      const cat = key(source.token.category);
      fungibleIn.set(cat, (fungibleIn.get(cat) ?? 0n) + source.token.amount);
      if (source.token.nft) nftsIn.push({ ...source.token.nft, cat });
    }
    const genesisCategories = new Set(
      tx.inputs
        .filter((input) => input.outpointIndex === 0)
        .map((input) => key(input.outpointTransactionHash)),
    );
    const fungibleOut = new Map<string, bigint>();
    for (const [index, output] of tx.outputs.entries()) {
      const token = output.token;
      if (!token) continue;
      const cat = key(token.category);
      if (token.amount < 0n || token.amount > MAX_TOKEN_AMOUNT) {
        throw new BroadcastRejectedError(
          `output ${index}: token amount out of range`,
        );
      }
      fungibleOut.set(cat, (fungibleOut.get(cat) ?? 0n) + token.amount);
      if (token.nft) {
        const idx = nftsIn.findIndex((nft) => {
          if (nft.cat !== cat) return false;
          if (nft.capability === 'minting') return true;
          if (nft.capability === 'mutable') {
            return token.nft!.capability !== 'minting';
          }
          return (
            token.nft!.capability === 'none' &&
            binToHex(token.nft!.commitment) === binToHex(nft.commitment)
          );
        });
        if (idx >= 0) {
          // A minting NFT stays available to mint more; others are consumed.
          if (nftsIn[idx]!.capability !== 'minting') nftsIn.splice(idx, 1);
        } else if (!genesisCategories.has(cat)) {
          throw new BroadcastRejectedError(
            `output ${index}: an NFT is created without a matching input or a genesis`,
          );
        }
      }
    }
    for (const [cat, out] of fungibleOut) {
      const available = fungibleIn.get(cat) ?? 0n;
      if (out > available && !genesisCategories.has(cat)) {
        throw new BroadcastRejectedError(
          `token category ${cat}: outputs carry ${out}, inputs only ${available}`,
        );
      }
    }
  }

  // -- Fulcrum protocol -------------------------------------------------------

  /** Serves one Fulcrum request. Unknown methods are an error, as on a server. */
  rpc(method: string, params: unknown[] = []): unknown {
    switch (method) {
      case 'server.version':
        return ['FakeFulcrum 1.0', '1.4'];
      case 'server.ping':
        return null;
      case 'server.features':
        return {
          genesis_hash: this.genesisHash,
          server_version: 'FakeFulcrum 1.0',
          protocol_min: '1.4',
          protocol_max: '1.5',
        };
      case 'blockchain.headers.subscribe':
        return { height: this.tipHeight, hex: this.headerHex(this.tipHeight) };
      case 'blockchain.block.header':
        return this.headerHex(Number(params[0]));
      case 'blockchain.relayfee':
      case 'blockchain.estimatefee':
        return 0.00001;
      case 'blockchain.scripthash.listunspent': {
        const filter = String(params[1] ?? 'include_tokens');
        return this.utxosForScriptHash(String(params[0]))
          .filter((u) =>
            filter === 'tokens_only'
              ? u.output.token !== undefined
              : filter === 'exclude_tokens'
                ? u.output.token === undefined
                : true,
          )
          .map((u) => ({
            height: u.height,
            tx_hash: u.txid,
            tx_pos: u.vout,
            value: Number(u.output.valueSatoshis),
            ...(u.output.token ? { token_data: tokenDataOf(u.output) } : {}),
          }));
      }
      case 'blockchain.scripthash.get_history':
        return this.historyForScriptHash(String(params[0]));
      case 'blockchain.scripthash.subscribe':
        return this.statusOf(String(params[0]));
      case 'blockchain.scripthash.unsubscribe':
        return true;
      case 'blockchain.transaction.broadcast':
        return this.broadcast(String(params[0]));
      case 'blockchain.transaction.get':
        return this.getTransaction(String(params[0]), params[1] !== false);
      case 'blockchain.transaction.dsproof.get':
        return this.doubleSpendProofs.get(String(params[0])) ?? null;
      default:
        throw new Error(`unknown method ${method}`);
    }
  }

  private headerHex(height: number): string {
    return binToHex(sha256.hash(new TextEncoder().encode(`header:${height}`)));
  }

  private getTransaction(txid: string, verbose: boolean): unknown {
    const entry = this.txs.get(txid);
    if (!entry) {
      throw new Error(
        'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.',
      );
    }
    if (!verbose) return entry.hex;
    const confirmations = this.confirmations(txid);
    return {
      txid,
      hash: txid,
      version: entry.tx.version,
      size: entry.hex.length / 2,
      locktime: entry.tx.locktime,
      hex: entry.hex,
      vin: entry.tx.inputs.map((input) => ({
        txid: displayTxidOfInput(input),
        vout: input.outpointIndex,
        scriptSig: { hex: binToHex(input.unlockingBytecode) },
        sequence: input.sequenceNumber,
      })),
      vout: entry.tx.outputs.map((output, n) => ({
        n,
        value: Number(output.valueSatoshis) / 1e8,
        scriptPubKey: { hex: binToHex(output.lockingBytecode) },
        ...(output.token
          ? { tokenData: tokenDataOf(toChainOutput(output)) }
          : {}),
      })),
      ...(confirmations > 0
        ? {
            confirmations,
            blockhash: this.headerHex(entry.height),
            time: Math.floor(entry.time / 1000),
            blocktime: Math.floor(entry.time / 1000),
          }
        : {}),
    };
  }

  // -- notifications and clients ---------------------------------------------

  private readonly lastStatus = new Map<string, string | null>();

  /** @internal */
  registerTransport(transport: FakeElectrumTransport): void {
    this.transports.add(transport);
  }

  private notifyAll(): void {
    for (const transport of this.transports) {
      transport.notify(this.tipHeight, (scriptHash) =>
        this.statusOf(scriptHash),
      );
    }
  }

  /** @internal */
  statusFor(scriptHash: string): string | null {
    return this.statusOf(scriptHash);
  }

  /** The solver's real quorum client, backed by `servers` simulated Fulcrum servers. */
  createQuorumClient(
    options: { servers?: number; network?: 'chipnet' | 'mainnet' } = {},
  ): { client: BchQuorumClient; transports: FakeElectrumTransport[] } {
    const count = options.servers ?? 2;
    const transports = Array.from(
      { length: count },
      (_, i) =>
        new FakeElectrumTransport(
          `wss://fake-fulcrum-${i + 1}.test:50004`,
          this,
        ),
    );
    const client = new BchQuorumClient(transports, {
      network: options.network ?? 'chipnet',
    });
    return { client, transports };
  }

  /**
   * The engine's Bitcoin Cash port over a quorum client, with the same shape as the
   * one the solver builds, except that `isOnChain` asks the chain rather than
   * answering yes.
   */
  createPort(client: BchQuorumClient): BchChainPort {
    return {
      getTip: async () => {
        const status = client.getQuorumStatus();
        return {
          height: status.quorumTip,
          hash: this.headerHex(status.quorumTip),
        };
      },
      isQuorumHealthy: () => client.getQuorumStatus().isQuorumHealthy,
      isQuotingEnabled: () => client.getQuorumStatus().isQuorumHealthy,
      broadcast: (txHex: string) => client.broadcast(txHex),
      isOnChain: async (txid: string) => {
        try {
          await client.getTransaction(txid, false);
          return true;
        } catch {
          return false;
        }
      },
      getScriptHashHistory: async (hash: string) =>
        (await client.getHistory(hash)).map((e) => ({
          tx_hash: e.tx_hash,
          height: e.height,
        })),
      waitForDoubleSpendProof: (txid: string, windowMs?: number) =>
        client.waitForDoubleSpendProof(txid, windowMs),
    };
  }
}

export class FakeElectrumTransport {
  onTipUpdate?: (height: number) => void;
  onScriptHashNotification?: (scriptHash: string, status: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;

  private connected = false;
  private offline = false;
  private readonly subscribed = new Map<string, string | null>();
  private lastConfirmedAt = 0;
  /** Requests made, for assertions about what the solver asked. */
  readonly requests: Array<{ method: string; params: unknown[] }> = [];

  constructor(
    readonly url: string,
    private readonly chain: FakeBchChain,
  ) {
    chain.registerTransport(this);
  }

  async connect(): Promise<void> {
    this.connected = !this.offline;
    this.lastConfirmedAt = Date.now();
    if (this.connected) this.onConnect?.();
  }

  close(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && !this.offline;
  }

  /** Simulates a server outage (true) and recovery (false). */
  setOffline(offline: boolean): void {
    this.offline = offline;
    if (offline) {
      this.onDisconnect?.();
    } else {
      this.connected = true;
      this.lastConfirmedAt = Date.now();
      this.onConnect?.();
    }
  }

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.isConnected()) throw new Error('connection closed');
    this.requests.push({ method, params });
    this.lastConfirmedAt = Date.now();
    if (method === 'blockchain.scripthash.subscribe') {
      const scriptHash = String(params[0]);
      const status = this.chain.statusFor(scriptHash);
      this.subscribed.set(scriptHash, status);
      return status as T;
    }
    return this.chain.rpc(method, params) as T;
  }

  getGenesisHash(): string | null {
    return this.chain.genesisHash;
  }

  async fetchFeatures() {
    return this.chain.rpc('server.features') as {
      genesis_hash: string;
    };
  }

  getTip(): { height: number; timestamp: number } {
    return { height: this.chain.tipHeight, timestamp: this.chain.tipTimeMs };
  }

  getLastConfirmedAt(): number {
    return this.lastConfirmedAt;
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected()) return false;
    this.lastConfirmedAt = Date.now();
    return true;
  }

  getLastError(): Error | null {
    return null;
  }

  /** @internal */
  notify(
    height: number,
    statusOf: (scriptHash: string) => string | null,
  ): void {
    if (!this.isConnected()) return;
    this.lastConfirmedAt = Date.now();
    this.onTipUpdate?.(height);
    for (const [scriptHash, previous] of this.subscribed) {
      const status = statusOf(scriptHash);
      if (status !== previous) {
        this.subscribed.set(scriptHash, status);
        this.onScriptHashNotification?.(scriptHash, status as string);
      }
    }
  }
}
