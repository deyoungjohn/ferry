import { describe, expect, it } from 'vitest';
import {
  binToHex,
  hexToBin,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import { parseRecoveryFileJson, type Hex32 } from '@ferry/core';
import { deriveHtlcAddresses, encodeHtlcParameters } from '@ferry/htlc-bch';
import { sha256 } from 'viem';
import {
  UserFlowError,
  UserSwapSession,
  type QuoteInput,
} from '../src/index.js';
import {
  EVM_CHAIN_ID,
  EVM_TOKEN,
  USER_LOCKING_HEX,
  createWorld,
} from './support/world.js';

const forward: QuoteInput = {
  direction: 'EVM_TO_BCH',
  token: 'PUSD',
  chainId: EVM_CHAIN_ID,
  evmToken: EVM_TOKEN,
  amountIn: 10_000_000n,
  evmTokenDecimals: 6,
  bchTokenDecimals: 2,
};
const reverse: QuoteInput = {
  ...forward,
  direction: 'BCH_TO_EVM',
  amountIn: 1000n,
};
const wait = { pollIntervalMs: 15_000, timeoutMs: 300_000 };

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(UserFlowError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('the whole flow, both directions', () => {
  it('forward: quote, save recovery, lock on EVM, wait for the solver, claim on Bitcoin Cash', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    const states: string[] = [];
    session.subscribe((s) => states.push(`${s.step}:${s.status}`));

    const final = await session.run(forward, wait);

    expect(final.step).toBe('done');
    expect(final.txids.claim).toMatch(/^[0-9a-f]{64}$/);
    expect(world.events).toEqual([
      'save recovery',
      'evm signature',
      'evm signature',
      'relayLock',
      'solver counter-lock',
      'bch covenant spend',
    ]);
    expect(states).toContain('waitCounterLock:waiting');
    expect(states.at(-1)).toBe('done:ready');
  });

  it('forward: delegateFinish reveals secret to solver', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    await session.lock();
    await session.delegateFinish();
    expect(world.events).toContain('revealSecret');
  });

  it('reverse: delegateFinish is rejected as invalid direction', async () => {
    const { deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(reverse);
    await session.saveRecovery();
    await expectCode(session.delegateFinish(), 'INVALID_INPUT');
  });

  it('reverse: quote, save recovery, lock on Bitcoin Cash through the wallet, wait, claim on EVM', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    const final = await session.run(reverse, wait);

    expect(final.step).toBe('done');
    expect(world.events).toEqual([
      'save recovery',
      'bch signature',
      'bch lock',
      'solver counter-lock',
      'relayClaim',
    ]);
    expect(final.txids.userLock).toMatch(/^[0-9a-f]{64}$/);
  });

  it('forward with a token that has no permit: approve, then lock, both through the wallet', async () => {
    const { world, deps } = createWorld({ lockMode: 'approve' });
    const session = new UserSwapSession(deps());
    await session.run(forward, wait);
    expect(world.evmTransactions).toHaveLength(2);
    expect(world.events.slice(0, 4)).toEqual([
      'save recovery',
      expect.stringMatching(/^evm approve 0x095ea7b3/),
      'evm lock',
      'solver counter-lock',
    ]);
  });
});

describe('the request and the recovery file carry real values', () => {
  it('sends the wallet chain, the token, the real locking bytecode and a hash lock of the stored secret', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    const request = world.quoteRequests[0]!;

    expect(request.chainId).toBe(EVM_CHAIN_ID);
    expect(request.evmToken).toBe(EVM_TOKEN);
    expect(request.userEvmAddress).not.toMatch(/^0x0+$/);
    expect(request.userBchLockingBytecode).toBe(`0x${USER_LOCKING_HEX}`);
    expect(request.hashLock).toBe(sha256(`0x${'5a'.repeat(32)}` as Hex32));
    expect(request.dryRun).toBeUndefined();
  });

  it('saves a recovery file with the real covenant addresses and redeem script, not placeholders', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    const file = await session.saveRecovery();

    const saved = parseRecoveryFileJson(world.store.files.get(file.orderId)!);
    const derived = deriveHtlcAddresses(
      encodeHtlcParameters(saved.terms),
      'mainnet',
    );
    expect(saved.contracts.bch.htlcAddress).toBe(derived.p2sh32Address);
    expect(saved.contracts.bch.tokenAddress).toBe(derived.tokenAddress);
    expect(saved.contracts.bch.redeemScript).toBe(
      `0x${binToHex(derived.redeemScript)}`,
    );
    expect(saved.contracts.bch.lockingBytecode).toBe(
      `0x${binToHex(derived.lockingBytecode)}`,
    );
    expect(saved.contracts.bch.htlcAddress.startsWith('bitcoincash:')).toBe(
      true,
    );
    expect(saved.contracts.evm.chainId).toBe(EVM_CHAIN_ID);
    expect(saved.contracts.evm.htlcAddress).not.toMatch(/^0x0+$/);
    expect(saved.secret).toBe(`0x${'5a'.repeat(32)}`);
  });

  it('uses a fresh secret for every quote', async () => {
    const { deps } = createWorld();
    let counter = 0;
    const session = new UserSwapSession(
      deps({
        secretGenerator: () =>
          `0x${(++counter).toString(16).padStart(64, '0')}` as Hex32,
      }),
    );
    const a = await session.quote(forward);
    const b = await session.quote(forward);
    expect(a.terms.hashLock).not.toBe(b.terms.hashLock);
  });
});

describe('refusals before anything moves', () => {
  it('stops when the wallet is on another chain', async () => {
    const { world, deps } = createWorld();
    world.walletChainId = 1;
    await expectCode(new UserSwapSession(deps()).quote(forward), 'WRONG_CHAIN');
    expect(world.quoteRequests).toHaveLength(0);
  });

  it('asks the wallet to switch chain and goes on when it does', async () => {
    const { world, deps } = createWorld();
    world.walletChainId = 1;
    const asked: number[] = [];
    const built = deps();
    const evmSigner = {
      ...built.evmSigner,
      switchChain: (chainId: number) => {
        asked.push(chainId);
        world.walletChainId = chainId;
        return Promise.resolve();
      },
    };
    await new UserSwapSession({ ...built, evmSigner }).quote(forward);
    expect(asked).toEqual([forward.chainId]);
    expect(world.quoteRequests).toHaveLength(1);
  });

  it('stops with the chain to switch to when the wallet refuses to switch', async () => {
    const { world, deps } = createWorld();
    world.walletChainId = 1;
    const built = deps();
    const evmSigner = {
      ...built.evmSigner,
      switchChain: () => Promise.reject(new Error('User rejected')),
    };
    await expectCode(
      new UserSwapSession({ ...built, evmSigner }).quote(forward),
      'WRONG_CHAIN',
    );
    expect(world.quoteRequests).toHaveLength(0);
  });

  it('stops on an empty token address, a zero amount and an address for the wrong network', async () => {
    const { deps } = createWorld();
    await expectCode(
      new UserSwapSession(deps()).quote({
        ...forward,
        evmToken: `0x${'00'.repeat(20)}`,
      }),
      'INVALID_INPUT',
    );
    await expectCode(
      new UserSwapSession(deps()).quote({ ...forward, amountIn: 0n }),
      'INVALID_INPUT',
    );
    await expectCode(
      new UserSwapSession(
        deps({
          bchCashAddress: (
            lockingBytecodeToCashAddress({
              bytecode: hexToBin(USER_LOCKING_HEX),
              prefix: 'bchtest',
              tokenSupport: false,
            }) as { address: string }
          ).address,
        }),
      ).quote(forward),
      'INVALID_INPUT',
    );
    await expectCode(
      new UserSwapSession(
        deps({ bchCashAddress: 'bitcoincash:notanaddress' }),
      ).quote(forward),
      'INVALID_INPUT',
    );
  });

  it('refuses to lock before the recovery file is saved, and before any quote', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await expectCode(session.lock(), 'NO_QUOTE');
    await session.quote(forward);
    await expectCode(session.lock(), 'RECOVERY_NOT_SAVED');
    expect(world.events).toEqual([]);
    await expectCode(new UserSwapSession(deps()).saveRecovery(), 'NO_QUOTE');
  });

  it('refuses to save a recovery file without the session secret, and saves nothing', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    // The secret is lost (for example by a bug elsewhere): never invent a new one.
    (session as unknown as { secret: Hex32 | null }).secret = null;

    await expectCode(session.saveRecovery(), 'SECRET_MISSING');
    expect(world.store.files.size).toBe(0);
    expect(world.events).toEqual([]);
    expect(session.state.status).toBe('failed');
    await expectCode(session.lock(), 'RECOVERY_NOT_SAVED');
  });

  it('a dry-run quote sends dryRun, reserves nothing and cannot be locked', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    const final = await session.run({ ...forward, dryRun: true }, wait);
    expect(world.quoteRequests[0]!.dryRun).toBe(true);
    expect(final.step).toBe('quote');
    expect(world.events).toEqual([]);
    await expectCode(session.saveRecovery(), 'DRY_RUN_QUOTE');
  });

  it('reports a quote the solver did not answer as a failed state', async () => {
    const { world, deps } = createWorld();
    world.solverAnswers = false;
    const session = new UserSwapSession(deps());
    await expect(session.quote(forward)).rejects.toThrow();
    expect(session.state.status).toBe('failed');
  });
});

describe('a wallet that says no', () => {
  it('EVM signature rejected: nothing is locked and the error says so', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    world.rejectSignatures = true;
    await expectCode(session.lock(), 'WALLET_REJECTED');
    expect(world.events).toEqual(['save recovery']);
    expect(session.state).toMatchObject({ status: 'failed' });
    expect(session.state.error).toMatch(/Nothing was locked/);
  });

  it('Bitcoin Cash wallet rejects the request: nothing is broadcast', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(reverse);
    await session.saveRecovery();
    world.rejectSignatures = true;
    await expectCode(session.lock(), 'WALLET_REJECTED');
    expect(world.broadcasts).toEqual([]);
  });

  it('a wallet that returns an unsigned transaction is caught before broadcast', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(reverse);
    await session.saveRecovery();
    world.tamperSignedTransaction = true;
    await expectCode(session.lock(), 'SIGNED_TRANSACTION_REJECTED');
    expect(world.broadcasts).toEqual([]);
  });
});

describe('a solver that goes quiet: the user can still refund', () => {
  it('forward: the wait times out, then the EVM refund opens at the deadline', async () => {
    const { world, deps } = createWorld({ autoCounterLock: false });
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    await session.lock();
    world.solverAnswers = false;

    await expect(
      session.waitCounterLock({ pollIntervalMs: 15_000, timeoutMs: 60_000 }),
    ).rejects.toMatchObject({
      code: 'COUNTER_LOCK_TIMEOUT',
      refundPossible: true,
    });
    expect(session.state.step).toBe('refund');

    await expectCode(session.refund(), 'NOT_READY');
    world.now += 28_801;
    const txid = await session.refund();
    expect(txid).toMatch(/^0x/);
    expect(session.state.step).toBe('refunded');
    expect(world.events.at(-1)).toBe('evm refund');
  });

  it('reverse: the Bitcoin Cash refund is built with a locktime at or after the refund height', async () => {
    const { world, deps } = createWorld({ autoCounterLock: false });
    const session = new UserSwapSession(deps());
    await session.quote(reverse);
    await session.saveRecovery();
    await session.lock();
    world.solverAnswers = false;

    await expect(
      session.waitCounterLock({ pollIntervalMs: 15_000, timeoutMs: 60_000 }),
    ).rejects.toMatchObject({ code: 'COUNTER_LOCK_TIMEOUT' });

    await expectCode(session.refund(), 'NOT_READY');
    world.tip += 145;
    await session.refund();
    expect(session.state.step).toBe('refunded');
    expect(world.events.at(-1)).toBe('bch covenant spend');
  });

  it('still sees the solver lock on the chain when the solver itself does not answer', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    await session.lock();
    world.solverAnswers = false;
    await session.waitCounterLock(wait);
    expect(session.state.step).toBe('claim');
    await session.claim();
    expect(session.state.step).toBe('done');
  });

  it('refuses to lock after the quote has expired, before anything is signed', async () => {
    const { world, deps } = createWorld();
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    world.now += 24 * 3600;
    await expectCode(session.lock(), 'QUOTE_EXPIRED');
    expect(session.state.step).not.toBe('waitCounterLock');
  });

  it('claim with nothing on chain says there is nothing to claim', async () => {
    const { deps } = createWorld({ autoCounterLock: false });
    const session = new UserSwapSession(deps());
    await session.quote(forward);
    await session.saveRecovery();
    await session.lock();
    await expectCode(session.claim(), 'NOTHING_TO_SPEND');
  });
});

describe('resume after a reload', () => {
  it('knows nothing about an order it has no file for', async () => {
    const { deps } = createWorld();
    await expectCode(
      UserSwapSession.resume(deps(), `0x${'12'.repeat(32)}`),
      'NO_QUOTE',
    );
  });

  it('after the file is saved but before the lock: ready to lock, and the lock then works', async () => {
    const { world, deps } = createWorld();
    const first = new UserSwapSession(deps());
    await first.quote(forward);
    const file = await first.saveRecovery();

    const resumed = await UserSwapSession.resume(deps(), file.orderId);
    expect(resumed.state.step).toBe('lock');
    await resumed.lock();
    await resumed.waitCounterLock(wait);
    await resumed.claim();
    expect(resumed.state.step).toBe('done');
    expect(world.events.filter((e) => e === 'save recovery')).toHaveLength(1);
  });

  it.each([
    ['forward', forward],
    ['reverse', reverse],
  ] as const)(
    '%s: after the user lock, waits for the solver; once it locks, ready to claim',
    async (_name, input) => {
      const { world, deps, solverLocks } = createWorld({
        autoCounterLock: false,
      });
      const first = new UserSwapSession(deps());
      await first.quote(input);
      const file = await first.saveRecovery();
      await first.lock();

      const resumed = await UserSwapSession.resume(deps(), file.orderId);
      expect(resumed.state.step).toBe('waitCounterLock');
      expect(resumed.state.waiting).toMatch(/Waiting for/);

      solverLocks();
      expect((await resumed.refresh()).step).toBe('claim');
      await resumed.claim();
      expect(resumed.state.step).toBe('done');
      expect(world.events.at(-1)).toMatch(/bch covenant spend|relayClaim/);
    },
  );

  it('after the refund deadline: the refund is the current step', async () => {
    const { world, deps } = createWorld({ autoCounterLock: false });
    const first = new UserSwapSession(deps());
    await first.quote(forward);
    const file = await first.saveRecovery();
    await first.lock();
    world.now += 28_801;
    const resumed = await UserSwapSession.resume(deps(), file.orderId);
    expect(resumed.state.step).toBe('refund');
    await resumed.refund();
    expect(resumed.state.step).toBe('refunded');
    const again = await UserSwapSession.resume(deps(), file.orderId);
    expect(again.state.step).toBe('refunded');
  });
});

describe('tip height', () => {
  it('prefers the solver health tip and falls back to the chain reader', async () => {
    const { world, deps } = createWorld();
    let chainReads = 0;
    const base = deps();
    const session = new UserSwapSession({
      ...base,
      bchChain: {
        ...base.bchChain,
        getTipHeight: () => {
          chainReads++;
          return Promise.resolve(world.tip);
        },
      },
    });
    await session.quote(forward);
    expect(chainReads).toBe(0);

    world.healthHasTips = false;
    await session.quote(forward);
    expect(chainReads).toBe(1);

    world.healthHasTips = true;
    world.solverAnswers = false;
    await expect(session.quote(forward)).rejects.toThrow();
    expect(chainReads).toBe(2);
  });
});

describe('a used hash lock', () => {
  it('moves to the next secret when the solver says a hash lock was already used', async () => {
    const { deps } = createWorld();
    const built = deps();
    let calls = 0;
    const secrets = [`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`] as const;
    const seen: string[] = [];
    const solver = {
      ...built.solver,
      quote: async (request: Parameters<typeof built.solver.quote>[0]) => {
        calls += 1;
        seen.push(request.hashLock);
        if (calls === 1) {
          throw Object.assign(
            new Error('hashLock has already been used by another order'),
            { code: 'CONFLICT' },
          );
        }
        return built.solver.quote(request);
      },
    };
    let n = 0;
    const session = new UserSwapSession({
      ...built,
      solver,
      secretGenerator: () => secrets[n++ % 2]!,
    });
    await session.quote(forward);
    expect(calls).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
