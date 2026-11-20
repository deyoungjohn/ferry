import { decodeCashAddress } from '@ferry/core';

export interface RecipientCheck {
  readonly ok: boolean;
  /** A plain sentence for the person when it is not ok. */
  readonly message: string | null;
}

/**
 * The address a pay link pays to. It must be typed or pasted (never filled in for the person) and
 * must be a token-aware Bitcoin Cash address ("bitcoincash:z..." or "...:r..."): PUSD and MUSD are
 * CashTokens, and a plain address ("...:q...") cannot receive them, so funds sent there would be
 * lost to the recipient. The checksum is verified, so a typo is caught here.
 */
export function checkPayRecipient(
  input: string,
  prefix: 'bitcoincash' | 'bchtest' = 'bitcoincash',
): RecipientCheck {
  const value = input.trim();
  if (value.length === 0) {
    return {
      ok: false,
      message:
        'Enter the Bitcoin Cash address that should receive the payment.',
    };
  }
  let decoded;
  try {
    decoded = decodeCashAddress(value);
  } catch {
    return {
      ok: false,
      message:
        'That is not a valid Bitcoin Cash address. Check it for a typo, or paste it again.',
    };
  }
  if (decoded.prefix !== prefix) {
    return {
      ok: false,
      message: `Use a ${prefix}: address (this is a ${decoded.prefix}: address).`,
    };
  }
  if (!decoded.tokenAware) {
    return {
      ok: false,
      message:
        'This address cannot receive PUSD or MUSD. Use a token-aware address, the kind that starts with bitcoincash:z (copy it from your wallet\'s "Receive tokens" screen).',
    };
  }
  return { ok: true, message: null };
}
