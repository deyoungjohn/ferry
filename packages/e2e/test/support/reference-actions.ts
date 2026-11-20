// A reference implementation of the engine's on-chain actions, built only from the
// library builders and the real EVM adapter. It exists to prove that the end-to-end
// tests (and the simulated chain under them) can pass against a correct engine; it is
// switched on with FERRY_E2E_REFERENCE_ACTIONS=1 and is never the default. The
// solver's own executors replace it once they build real transactions.
import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { evmLockId } from '@ferry/core';
import type { OrderTerms } from '@ferry/core';
import {
  buildClaimTransaction,
  buildLockTransaction,
  deriveHtlcAddresses,
  encodeHtlcParameters,
} from '@ferry/htlc-bch';
import { ActionExecutor, parseTermsJson } from '@ferry/solver';
import type {
  ExecuteOrAdoptParams,
  ExecuteOrAdoptResult,
  SolverDatabase,
} from '@ferry/solver';
import type { EvmChainAdapter } from '@ferry/chain-evm';
import type { BchIdentity } from './real-engine-solver.js';
import { scriptHashOf } from './fake-bch-chain.js';
import type { FakeBchChain, SimulatedBchPort } from './fake-bch-chain.js';

function cashAddress(lockingBytecode: Uint8Array): string {
  const result = lockingBytecodeToCashAddress({
    bytecode: lockingBytecode,
    prefix: 'bchtest',
    tokenSupport: false,
  });
  if (typeof result === 'string') throw new Error(result);
  return result.address;
}

function htlcScriptHash(terms: OrderTerms): string {
  return scriptHashOf(
    deriveHtlcAddresses(encodeHtlcParameters(terms), 'chipnet').lockingBytecode,
  );
}

export class ReferenceBchExecutor extends ActionExecutor {
  constructor(
    private readonly orders: SolverDatabase,
    port: SimulatedBchPort,
    private readonly chain: FakeBchChain,
    private readonly solver: BchIdentity,
  ) {
    super(orders, port);
  }

  override async executeOrAdopt(
    params: ExecuteOrAdoptParams,
  ): Promise<ExecuteOrAdoptResult> {
    const record = this.orders.getOrder(params.orderId);
    if (!record) throw new Error(`Unknown order ${params.orderId}`);
    const terms = parseTermsJson(record.termsJson);
    if (params.actionType === 'SOLVER_LOCK') {
      return super.executeOrAdopt({
        ...params,
        buildTx: async () => {
          const built = buildLockTransaction({
            params: terms,
            utxos: this.chain.rpc('blockchain.scripthash.listunspent', [
              scriptHashOf(this.solver.lockingBytecode),
            ]) as unknown[],
            changeAddress: cashAddress(this.solver.lockingBytecode),
            privateKey: this.solver.privateKey,
            network: 'chipnet',
          });
          return {
            txid: built.signed!.txid,
            txHex: built.signed!.txHex,
            inputs: built.selectedInputs.bchInputs
              .concat(built.selectedInputs.tokenInputs)
              .map((input) => ({ txid: input.txid, vout: input.vout })),
          };
        },
      });
    }
    if (params.actionType === 'SOLVER_CLAIM') {
      return super.executeOrAdopt({
        ...params,
        buildTx: async () => {
          const lock = this.chain
            .utxosForScriptHash(htlcScriptHash(terms))
            .find((u) => !this.chain.isSpent(u.txid, u.vout));
          if (!lock) throw new Error('No Bitcoin Cash lock to claim');
          const claim = buildClaimTransaction({
            params: encodeHtlcParameters(terms),
            utxo: {
              txid: lock.txid,
              vout: lock.vout,
              satoshis: lock.output.valueSatoshis,
            },
            secret: params.secret as string,
            network: 'chipnet',
          });
          return {
            txid: claim.txid,
            txHex: claim.txHex,
            inputs: [{ txid: lock.txid, vout: lock.vout }],
          };
        },
      });
    }
    return super.executeOrAdopt(params);
  }
}

/** EVM actions through the real adapter; the transaction is sent while it is built. */
export class ReferenceEvmExecutor extends ActionExecutor {
  constructor(
    private readonly orders: SolverDatabase,
    port: ConstructorParameters<typeof ActionExecutor>[1],
    private readonly adapter: EvmChainAdapter,
    private readonly adapters: ReadonlyMap<string, EvmChainAdapter> = new Map(),
  ) {
    super(orders, port);
  }

  private adapterFor(chainId: number): EvmChainAdapter {
    return this.adapters.get(String(chainId)) ?? this.adapter;
  }

  override async executeOrAdopt(
    params: ExecuteOrAdoptParams,
  ): Promise<ExecuteOrAdoptResult> {
    const record = this.orders.getOrder(params.orderId);
    if (!record) throw new Error(`Unknown order ${params.orderId}`);
    const terms = parseTermsJson(record.termsJson);
    if (params.actionType === 'SOLVER_LOCK') {
      return super.executeOrAdopt({
        ...params,
        buildTx: async () => {
          const sent = await this.adapterFor(terms.evmChainId).lock(terms);
          return { txid: sent.txId, txHex: sent.txId };
        },
      });
    }
    if (params.actionType === 'SOLVER_CLAIM') {
      const forward = terms.direction === 'EVM_TO_BCH';
      return super.executeOrAdopt({
        ...params,
        buildTx: async () => {
          const owner = forward ? terms.userEvmAddress : terms.solverEvmAddress;
          const sent = await this.adapterFor(terms.evmChainId).claim(
            evmLockId(owner, terms.hashLock),
            params.secret as `0x${string}`,
          );
          return { txid: sent.txId, txHex: sent.txId };
        },
      });
    }
    return super.executeOrAdopt(params);
  }
}

/**
 * The engine looks Bitcoin Cash locks up by the order's hash lock, where the chain
 * indexes them by the script hash of the covenant. The reference port translates.
 */
export function withCovenantLookup(
  port: SimulatedBchPort,
  orders: SolverDatabase,
  chain: FakeBchChain,
): SimulatedBchPort {
  const covenantFor = (key: string): string | null => {
    for (const record of orders.listNonTerminalOrders()) {
      const terms = parseTermsJson(record.termsJson);
      if (terms.hashLock.slice(2) === key) return htlcScriptHash(terms);
    }
    return null;
  };
  return {
    ...port,
    getScriptHashHistory: async (hash: string) =>
      port.getScriptHashHistory(covenantFor(hash) ?? hash),
    extractSecretFromSpend: async (txid: string) => {
      for (const record of orders.listNonTerminalOrders()) {
        const terms = parseTermsJson(record.termsJson);
        const secret = chain.secretRevealedBy(txid, terms.hashLock);
        if (secret) return secret as `0x${string}`;
      }
      return null;
    },
  };
}
