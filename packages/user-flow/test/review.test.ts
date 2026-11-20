import { describe, expect, it } from 'vitest';
import {
  binToHex,
  decodeTransaction,
  hexToBin,
  type Transaction,
} from '@bitauth/libauth';
import type { Hex32 } from '@ferry/core';
import { parseTermsOutput } from '@ferry/htlc-bch';
import {
  UserFlowError,
  UserSwapSession,
  createKeyBackedBchSigner,
  lockUserOnBch,
  resumeAll,
  type BchChainPort,
  type BchSignerPort,
  type BchUtxo,
  type QuoteInput,
} from '../src/index.js';
import {
  BCH_CATEGORY,
  EVM_CHAIN_ID,
  EVM_TOKEN,
  USER_CASH_ADDRESS,
  USER_KEY,
  USER_LOCKING_HEX,
  createWorld,
} from './support/world.js';

const reverse: QuoteInput = {
  direction: 'BCH_TO_EVM',
  token: 'PUSD',
  chainId: EVM_CHAIN_ID,
  evmToken: EVM_TOKEN,
  amountIn: 1000n,
  evmTokenDecimals: 6,
  bchTokenDecimals: 2,
};
const forward: QuoteInput = {
  ...reverse,
  direction: 'EVM_TO_BCH',
  amountIn: 10_000_000n,
};
const wait = { pollIntervalMs: 15_000, timeoutMs: 300_000 };

async function lockContext(utxos: readonly BchUtxo[]) {
  const { deps } = createWorld();
  const session = new UserSwapSession(deps());
  const quote = await session.quote(reverse);
  const broadcasts: string[] = [];
  const requests: Parameters<BchSignerPort['signTransaction']>[0][] = [];
  const signer = createKeyBackedBchSigner(USER_KEY);
  const bchChain: BchChainPort = {
    getTipHeight: () => Promise.resolve(500_000),
    getUtxos: () => Promise.resolve(utxos),
    broadcast: (hex) => {
      broadcasts.push(hex);
      return Promise.resolve('ab'.repeat(32));
    },
  };
  const context = {
    bchSigner: {
      signTransaction: (request) => {
        requests.push(request);
        return signer.signTransaction(request);
      },
    } satisfies BchSignerPort,
    bchChain,
    bchNetwork: 'mainnet' as const,
    bchCashAddress: USER_CASH_ADDRESS,
    userLockingBytecodeHex: USER_LOCKING_HEX,
  };
  return { context, terms: quote.terms, broadcasts, requests };
}

describe('funding outputs that carry more than the stablecoin', () => {
  it('never spends an output that also holds an NFT', async () => {
    const nftOutput: BchUtxo = {
      txid: 'aa'.repeat(32),
      vout: 0,
      satoshis: 60_000n,
      token: { category: BCH_CATEGORY, amount: 5_000n },
      nft: { capability: 'none', commitment: '01' },
    };
    const plain: BchUtxo = {
      txid: 'bb'.repeat(32),
      vout: 1,
      satoshis: 60_000n,
      token: { category: BCH_CATEGORY, amount: 1_000n },
    };
    const { context, terms, broadcasts } = await lockContext([
      nftOutput,
      plain,
    ]);

    await lockUserOnBch(context, terms);

    const tx = decodeTransaction(hexToBin(broadcasts[0]!)) as Transaction;
    const spent = tx.inputs.map((i) => binToHex(i.outpointTransactionHash));
    expect(spent).toContain('bb'.repeat(32));
    expect(spent).not.toContain('aa'.repeat(32));
  });

  it('hands the wallet the derivation path of each funding output', async () => {
    const utxo: BchUtxo = {
      txid: 'cc'.repeat(32),
      vout: 0,
      satoshis: 60_000n,
      token: { category: BCH_CATEGORY, amount: 1_000n },
      derivationPath: ['change', 7],
    };
    const { context, terms, requests } = await lockContext([utxo]);
    await lockUserOnBch(context, terms);
    expect(requests[0]!.inputPaths).toEqual([[0, 'change', 7]]);
  });

  it('includes terms OP_RETURN output with recoveryTag', async () => {
    const utxo: BchUtxo = {
      txid: 'dd'.repeat(32),
      vout: 0,
      satoshis: 80_000n,
      token: { category: BCH_CATEGORY, amount: 1_000n },
    };
    const tag = '0x1122334455667788' as const;
    const { context, terms, broadcasts } = await lockContext([utxo]);
    await lockUserOnBch({ ...context, recoveryTag: tag }, terms);

    const tx = decodeTransaction(hexToBin(broadcasts[0]!)) as Transaction;
    const dataOutput = tx.outputs.find(
      (out) => out.lockingBytecode[0] === 0x6a,
    );
    expect(dataOutput).toBeDefined();
    expect(dataOutput!.valueSatoshis).toBe(0n);

    const parsed = parseTermsOutput(dataOutput!.lockingBytecode);
    expect(parsed.tag).toBe(tag);
    expect(parsed.token).toBe(terms.bchToken);
    expect(parsed.tokenAmount).toBe(terms.bchTokenAmount);
  });

  it('includes terms OP_RETURN output with 8 zero bytes when recoveryTag is omitted', async () => {
    const utxo: BchUtxo = {
      txid: 'ee'.repeat(32),
      vout: 0,
      satoshis: 80_000n,
      token: { category: BCH_CATEGORY, amount: 1_000n },
    };
    const { context, terms, broadcasts } = await lockContext([utxo]);
    await lockUserOnBch(context, terms);

    const tx = decodeTransaction(hexToBin(broadcasts[0]!)) as Transaction;
    const dataOutput = tx.outputs.find(
      (out) => out.lockingBytecode[0] === 0x6a,
    );
    expect(dataOutput).toBeDefined();

    const parsed = parseTermsOutput(dataOutput!.lockingBytecode);
    expect(parsed.tag).toBe('0x0000000000000000');
  });
});

describe('a wallet that spreads its money over many addresses', () => {
  it("finds the funds on the other addresses and hands the wallet each output's path", async () => {
    const { context, terms, requests } = await lockContext([]);
    const fundedHex = 'ab'.repeat(25);
    const utxo: BchUtxo = {
      txid: 'cc'.repeat(32),
      vout: 1,
      satoshis: 60_000n,
      token: { category: BCH_CATEGORY, amount: 1_000n },
    };
    const wide = {
      ...context,
      bchSigner: {
        ...context.bchSigner,
        listFundingAddresses: () =>
          Promise.resolve([
            {
              lockingBytecodeHex: 'cd'.repeat(25),
              derivationPath: ['receive', 0] as const,
            },
            {
              lockingBytecodeHex: fundedHex,
              derivationPath: ['change', 3] as const,
            },
          ]),
      },
      bchChain: {
        ...context.bchChain,
        getUtxosMany: () =>
          Promise.resolve(
            new Map<string, readonly BchUtxo[]>([
              ['cd'.repeat(25), []],
              [fundedHex, [utxo]],
            ]),
          ),
      },
    };
    // The test key cannot unlock a made-up script, so the local check refuses after the wallet is
    // asked: the request is what this test looks at.
    await lockUserOnBch(wide, terms).catch(() => undefined);
    expect(requests[0]!.inputPaths).toEqual([[0, 'change', 3]]);
    // The input is described by the lock script of the address it sits on, not the first one's.
    const described = JSON.stringify(requests[0]!.relayTransaction);
    expect(described).toContain(fundedHex);
  });
});

describe('a server that reports the category in the other byte order', () => {
  it('stops with a typed error instead of a vague balance error', async () => {
    const reversed = binToHex(hexToBin(BCH_CATEGORY).reverse());
    const { context, terms, broadcasts } = await lockContext([
      {
        txid: 'dd'.repeat(32),
        vout: 0,
        satoshis: 60_000n,
        token: { category: reversed, amount: 1_000n },
      },
    ]);
    await expect(lockUserOnBch(context, terms)).rejects.toMatchObject({
      code: 'TOKEN_CATEGORY_ORDER',
    });
    expect(broadcasts).toEqual([]);
  });

  it('reports missing stablecoin and missing coins for fees in plain words', async () => {
    const none = await lockContext([]);
    await expect(lockUserOnBch(none.context, none.terms)).rejects.toMatchObject(
      { code: 'INSUFFICIENT_FUNDS' },
    );

    const noFee = await lockContext([
      {
        txid: 'ee'.repeat(32),
        vout: 0,
        satoshis: 100n,
        token: { category: BCH_CATEGORY, amount: 1_000n },
      },
    ]);
    const error = await lockUserOnBch(noFee.context, noFee.terms).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UserFlowError);
    expect((error as UserFlowError).code).toBe('INSUFFICIENT_FUNDS');
    expect((error as UserFlowError).message).toMatch(/Bitcoin Cash/);
  });
});

describe('resumeAll', () => {
  it('finds nothing in an empty store', async () => {
    const { deps } = createWorld();
    expect(await resumeAll(deps())).toEqual({ resumed: [], failed: [] });
  });

  it('resumes every saved swap at its own step after a reload', async () => {
    const { deps, solverLocks } = createWorld({ autoCounterLock: false });
    // One swap finished, one waiting for the solver's lock.
    const done = new UserSwapSession(deps());
    await done.quote(forward);
    await done.saveRecovery();
    await done.lock();
    solverLocks();
    await done.waitCounterLock(wait);
    await done.claim();
    const doneId = done.state.orderId!;

    const open = new UserSwapSession(deps());
    await open.quote(reverse);
    await open.saveRecovery();
    await open.lock();
    const openId = open.state.orderId!;
    expect(openId).not.toBe(doneId);

    // Reload: fresh dependencies over the same store and the same chains.
    const result = await resumeAll(deps());

    expect(result.failed).toEqual([]);
    expect(result.resumed.map((r) => r.orderId)).toEqual([openId, doneId]);
    const [waiting, settled] = result.resumed;
    expect(waiting!.settled).toBe(false);
    expect(waiting!.state.step).toBe('waitCounterLock');
    expect(settled!.settled).toBe(true);
    expect(settled!.state.step).toBe('done');
  });

  it('a reverse swap whose Bitcoin Cash refund is done resumes as refunded', async () => {
    const { world, deps } = createWorld({ autoCounterLock: false });
    const session = new UserSwapSession(deps());
    await session.quote(reverse);
    await session.saveRecovery();
    await session.lock();
    world.tip += 145;
    await session.refund();

    const result = await resumeAll(deps());
    expect(result.resumed[0]!.state.step).toBe('refunded');
    expect(result.resumed[0]!.settled).toBe(true);
  });

  it('keeps going when one saved file is unreadable, and names it', async () => {
    const { world, deps } = createWorld({ autoCounterLock: false });
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    await session.lock();
    const goodId = session.state.orderId!;
    const badId = `0x${'ef'.repeat(32)}` as Hex32;
    await world.store.save(badId, '{ not json');

    const result = await resumeAll(deps());

    expect(result.resumed.map((r) => r.orderId)).toEqual([goodId]);
    expect(result.resumed[0]!.state.step).toBe('waitCounterLock');
    expect(result.resumed[0]!.settled).toBe(false);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.orderId).toBe(badId);
    expect(result.failed[0]!.error.length).toBeGreaterThan(0);
  });

  it('puts open swaps before settled ones', async () => {
    const { deps, solverLocks } = createWorld({ autoCounterLock: false });
    const finished = new UserSwapSession(deps());
    await finished.quote(forward);
    await finished.saveRecovery();
    await finished.lock();
    solverLocks();
    await finished.waitCounterLock(wait);
    await finished.claim();

    const result = await resumeAll(deps());
    expect(result.resumed[0]!.settled).toBe(true);
    expect(result.resumed.map((r) => r.settled)).toEqual(
      [...result.resumed.map((r) => r.settled)].sort(
        (a, b) => Number(a) - Number(b),
      ),
    );
  });
});

describe('a quote that is worse than the one the user saw', () => {
  it('refuses when the receive amount is below the minimum the page asks for, and sends nothing to lock', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    // The world's solver quotes 995 for this input; the user saw at least 1000.
    await expect(
      session.quote({ ...forward, minReceive: 1_000n }),
    ).rejects.toMatchObject({ code: 'QUOTE_BELOW_MINIMUM' });
    expect(session.state.status).toBe('failed');
    expect(world.events).toEqual([]);
    await expect(session.saveRecovery()).rejects.toMatchObject({
      code: 'NO_QUOTE',
    });
  });

  it('accepts a quote exactly at the minimum', async () => {
    const { deps } = createWorld();
    const session = new UserSwapSession(deps());
    const quote = await session.quote({ ...forward, minReceive: 995n });
    expect(quote.receiveAmount).toBe(995n);
  });
});
