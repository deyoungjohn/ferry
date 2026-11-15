export type SwapMode = 'swap' | 'pay-link' | 'send-link';

export interface ModeCopy {
  readonly mode: SwapMode;
  readonly title: string;
  readonly sendLabel: string;
  readonly receiveLabel: string;
  readonly actionLabel: string;
  readonly statusTitle: string;
  readonly completedMessage: string;
}

export const MODE_COPY: Record<SwapMode, ModeCopy> = {
  swap: {
    mode: 'swap',
    title: 'Swap',
    sendLabel: 'You send',
    receiveLabel: 'You receive',
    actionLabel: 'Ferry it ›',
    statusTitle: 'Swap Status',
    completedMessage: 'Swap completed successfully.',
  },
  'pay-link': {
    mode: 'pay-link',
    title: 'Pay Link',
    sendLabel: 'You pay',
    receiveLabel: 'They receive',
    actionLabel: 'Pay now ›',
    statusTitle: 'Payment Status',
    completedMessage: 'Payment settled directly to the recipient wallet.',
  },
  'send-link': {
    mode: 'send-link',
    title: 'Send Link',
    sendLabel: 'You send',
    receiveLabel: 'They receive',
    actionLabel: 'Send link ›',
    statusTitle: 'Transfer Status',
    completedMessage: 'Transfer locked for recipient claim.',
  },
} as const;

export function getModeCopy(mode: SwapMode): ModeCopy {
  const copy = MODE_COPY[mode];
  if (!copy) {
    throw new Error(`Unknown mode: ${mode}`);
  }
  return copy;
}

const FORBIDDEN_WORDS = ['invoice', 'bill', 'tip'];

export function containsForbiddenWord(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_WORDS.some((word) => lower.includes(word));
}
