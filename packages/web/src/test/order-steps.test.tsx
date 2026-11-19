import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcessSteps } from '../components/links/ProcessSteps';
import {
  payLinkSteps,
  sendLinkSteps,
  type OrderSnapshot,
} from '../lib/paylink/order-steps';

const H = (c: string) => c.repeat(64);
const snap = (
  txids: Record<string, string>,
  state = 'USER_LOCK_FINAL',
  timeline: OrderSnapshot['timeline'] = [],
): OrderSnapshot => ({ state, txids, timeline });

describe('the steps of a pay link and a send link', () => {
  it('pay link: marks the stage the swap has reached and links every transaction to its explorer', () => {
    const steps = payLinkSteps(
      'PUSD',
      snap({ evmLock: `0x${H('a')}`, bchLock: H('b') }),
      false,
    );
    expect(steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'active',
    ]);
    render(<ProcessSteps steps={steps} />);
    const links = screen
      .getAllByTestId('tx-link')
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      `https://basescan.org/tx/0x${H('a')}`,
      `https://bchexplorer.info/tx/${H('b')}`,
    ]);
  });

  it('pay link: never ticks ahead of its data (paid link, swap not read yet: only the first steps)', () => {
    // A link reported as paid whose swap record has not arrived yet must not show the later steps
    // as done without their transactions: the owner-paid step follows the paid flag only.
    const steps = payLinkSteps('PUSD', null, false);
    expect(steps.map((s) => s.state)).toEqual([
      'done',
      'active',
      'todo',
      'todo',
    ]);
  });

  it('pay link: everything is done once it is paid, with the payment to the owner linked and each step timed', () => {
    const steps = payLinkSteps(
      'MUSD',
      snap({ evmLock: H('a'), bchLock: H('b'), bchClaim: H('c') }, 'DONE', [
        { status: 'USER_LOCK_SEEN', at: 1_000 },
        { status: 'SOLVER_LOCK_SEEN', at: 1_010 },
        { status: 'DONE', at: 1_030 },
      ]),
      true,
      990,
    );
    expect(steps.every((s) => s.state === 'done')).toBe(true);
    expect(steps[3]!.label).toContain('MUSD');
    expect(steps[3]!.txs?.[0]?.url).toBe(
      `https://bchexplorer.info/tx/${H('c')}`,
    );
    expect(steps.map((s) => s.at)).toEqual([990, 1_000, 1_010, 1_030]);
  });

  it('send link: waits at the solver lock until it exists, then at the receiver', () => {
    expect(
      sendLinkSteps('Base', snap({ bchLock: H('a') }), false).map(
        (s) => s.state,
      ),
    ).toEqual(['done', 'done', 'active', 'todo', 'todo']);
    expect(
      sendLinkSteps(
        'Base',
        snap({ bchLock: H('a'), evmLock: H('b') }),
        false,
      ).map((s) => s.state),
    ).toEqual(['done', 'done', 'done', 'active', 'todo']);
    expect(
      sendLinkSteps(
        'Base',
        snap({ bchLock: H('a'), evmLock: H('b') }),
        true,
        true,
      ).every((s) => s.state === 'done'),
    ).toBe(true);
  });
});
