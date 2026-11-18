import { siteUrl } from '../site';

export interface PayLinkData {
  readonly id: string;
  readonly recipientCashaddr: string;
  readonly token: 'PUSD' | 'MUSD';
  readonly amountOut?: number | undefined;
  readonly minAmountOut?: number | undefined;
  readonly note?: string | undefined;
  readonly verified: boolean;
  readonly status: 'open' | 'reserved' | 'paid' | 'expired' | 'cancelled';
  readonly createdAt: number;
}

export interface SendLinkData {
  readonly id: string;
  readonly destinationChain: string;
  readonly destinationToken: string;
  readonly recipientEvmAddress: string;
  readonly amount: number;
  /** How long the receiver has to claim, in seconds. */
  readonly windowSeconds: number;
  /** When the claim window ends (Unix seconds). */
  readonly expiresAt: number;
  /** The sender's message for the receiver. Plain text; anyone with the link can read it. */
  readonly note?: string | undefined;
  readonly status: 'open' | 'claimed' | 'expired';
  readonly createdAt: number;
}

/**
 * Formats a CashAddress into 4-character chunks for checksum / phishing inspection,
 * keeping the prefix separated (e.g. "bchtest: zqg3 zyg3 ...").
 */
export function chunkCashaddr(address: string): string {
  const parts = address.split(':');
  if (parts.length === 2) {
    const prefix = parts[0]!;
    const payload = parts[1]!;
    const chunks = payload.match(/.{1,4}/g)?.join(' ') ?? payload;
    return `${prefix}: ${chunks}`;
  }
  return address.match(/.{1,4}/g)?.join(' ') ?? address;
}

export function payLinkUrl(id: string): string {
  return siteUrl(`/pay/${id}`);
}

export function sendLinkUrl(id: string): string {
  return siteUrl(`/send/${id}`);
}
