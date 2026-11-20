import { describe, expect, it } from 'vitest';
import { checkPayRecipient } from '../lib/paylink/recipient';

const TOKEN_AWARE = 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65';

describe('the address a pay link pays to', () => {
  it('needs something typed, and never fills one in', () => {
    expect(checkPayRecipient('').ok).toBe(false);
    expect(checkPayRecipient('   ').message).toMatch(/Enter the Bitcoin Cash/);
  });

  it('accepts a valid token-aware mainnet address', () => {
    expect(checkPayRecipient(TOKEN_AWARE).ok).toBe(true);
  });

  it('refuses a typo (the checksum fails)', () => {
    const typo = TOKEN_AWARE.replace('zplz', 'zplx');
    const check = checkPayRecipient(typo);
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/not a valid/);
  });

  it('refuses a plain address that cannot hold CashTokens, and the wrong network', () => {
    const plain = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
    expect(checkPayRecipient(plain).message).toMatch(/cannot receive PUSD/);
    expect(
      checkPayRecipient('bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvhygxf4kw')
        .ok,
    ).toBe(false);
  });
});
