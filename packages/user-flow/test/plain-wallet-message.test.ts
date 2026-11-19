import { describe, expect, it } from 'vitest';
import { plainWalletMessage } from '../src/actions.js';

describe('plainWalletMessage', () => {
  it('says a cancelled request was cancelled, without library details', () => {
    const error = new Error(
      'User rejected the request.\n\nDetails: User denied request signature.\nVersion: viem@2.57.10',
    );
    expect(plainWalletMessage(error)).toBe(
      'You cancelled the request in your wallet. Nothing was locked.',
    );
    expect(
      plainWalletMessage(Object.assign(new Error('x'), { code: 4001 })),
    ).toMatch(/cancelled/);
  });

  it('explains missing gas and strips library tails from other errors', () => {
    expect(
      plainWalletMessage(
        new Error('insufficient funds for gas * price + value'),
      ),
    ).toMatch(/gas token/);
    const other = plainWalletMessage(
      new Error('Something odd happened.\nVersion: viem@2.57.10'),
    );
    expect(other).toBe(
      'The wallet did not complete the request: Something odd happened. Nothing was locked.',
    );
    expect(other).not.toMatch(/viem/);
  });
});
