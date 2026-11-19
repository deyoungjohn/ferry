import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProcessSteps } from '../components/links/ProcessSteps';
import { payLinkSteps, sendLinkSteps } from '../lib/paylink/order-steps';

const H = (c: string) => c.repeat(64);

describe('the steps of a pay link and a send link', () => {
  it('pay link: marks the stage the swap has reached and links every transaction to its explorer', () => {
    const steps = payLinkSteps(
      'PUSD',
      { evmLock: `0x${H('a')}`, bchLock: H('b') },
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

  it('pay link: everything is done once it is paid, with the payment to the owner linked', () => {
    const steps = payLinkSteps(
      'MUSD',
      { evmLock: H('a'), bchLock: H('b'), bchClaim: H('c') },
      true,
    );
    expect(steps.every((s) => s.state === 'done')).toBe(true);
    expect(steps[3]!.label).toContain('MUSD');
    expect(steps[3]!.txs?.[0]?.url).toBe(
      `https://bchexplorer.info/tx/${H('c')}`,
    );
  });

  it('send link: waits at the solver lock until it exists, then at the receiver', () => {
    expect(
      sendLinkSteps('Base', { bchLock: H('a') }, false).map((s) => s.state),
    ).toEqual(['done', 'done', 'active', 'todo', 'todo']);
    expect(
      sendLinkSteps('Base', { bchLock: H('a'), evmLock: H('b') }, false).map(
        (s) => s.state,
      ),
    ).toEqual(['done', 'done', 'done', 'active', 'todo']);
    expect(
      sendLinkSteps(
        'Base',
        { bchLock: H('a'), evmLock: H('b') },
        true,
        true,
      ).every((s) => s.state === 'done'),
    ).toBe(true);
  });
});
