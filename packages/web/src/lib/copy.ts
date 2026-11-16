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

export interface HowItWorksStep {
  readonly number: string;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
}

export const HOW_IT_WORKS_STEPS: readonly HowItWorksStep[] = [
  {
    number: '01',
    title: 'Lock',
    subtitle: 'User initiates the swap',
    description:
      'You deposit your source stablecoins into a trust-minimised Hash-Time-Locked Contract (HTLC) on the source chain with a 32-byte secret hash lock and a refund deadline.',
  },
  {
    number: '02',
    title: 'Counter-lock',
    subtitle: 'Solver matches the terms',
    description:
      'The automated solver detects your deposit and locks the target stablecoins into a matching CashTokens covenant or EVM contract using the exact same hash lock.',
  },
  {
    number: '03',
    title: 'Claim',
    subtitle: 'One secret unlocks both sides',
    description:
      'One 32-byte secret unlocks both sides. Revealing the secret on one chain allows the solver to complete their side, ensuring atomic execution with no custodian.',
  },
] as const;

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: 'How is this different from a cross-chain bridge?',
    answer:
      'Ferry is a trust-minimised atomic swap, not a bridge. There are no wrapped tokens, no custodian, and no multi-sig validator set. Two independent Hash-Time-Locked Contracts (HTLCs) are created, one per chain. Either both parties complete their half using the same 32-byte secret, or both sides can refund when their deadlines pass.',
  },
  {
    question: 'What is the trust model of Ferry?',
    answer:
      'Ferry is trust-minimised, not trustless. You do not trust a custodian with your funds, but you do depend on an active solver to provide liquidity and complete the counter-lock. If the solver is unavailable or fails to counter-lock, your deposit is safely returned after the refund deadline expires.',
  },
  {
    question: 'Can the solver steal my money or can I lose funds?',
    answer:
      'No. Cryptographic HTLC atomicity guarantees that the solver cannot claim your deposit without revealing the secret that simultaneously allows you to claim their counter-deposit. If the counterparty fails to counter-lock, your deposit unlocks automatically at the refund deadline and you can reclaim 100% of your funds.',
  },
  {
    question:
      'Can I recover my funds if this website or the solver goes offline?',
    answer:
      'Yes. When you initiate a swap, you can download a standalone recovery JSON file before or during the swap. Even if this website and every Ferry server vanish, you can execute your refund or claim directly via our offline recovery page or using the open-source terminal recovery tool @ferry/recover-cli (pnpm -w recover) via public RPC nodes.',
  },
  {
    question:
      'What are the token caveats for Binance-Peg USDT and non-standard tokens?',
    answer:
      'Binance-Peg USDT on BNB Smart Chain is a bridged BEP-20 token issued by Binance, not a native Tether issuance. It does not support EIP-2612 gasless permits and inherits bridge counterparty risk from Binance. Ferry labels route-specific token properties and disables routes when token contracts do not meet strict safety verification.',
  },
  {
    question: 'Has Ferry been audited?',
    answer:
      'No. Ferry was built as an experimental hackathon project for BCH BLAZE 2026. While the smart contracts and solver state machines are backed by formal timing invariants and automated crash simulation tests, they have not undergone a third-party security audit. Never transact with funds you cannot afford to risk.',
  },
] as const;

export const PEG_SOURCES = {
  title: 'BCH Stablecoin Pegs',
  description: 'Real-time parity vs USD on Bitcoin Cash CashTokens DEXs.',
  sourcesLabel:
    'Data sources: Paryon stats API & Cauldron DEX spot on Bitcoin Cash.',
} as const;

export const FOOTER_COPY = {
  tagline:
    'Trust-minimised atomic swaps between Bitcoin Cash and EVM networks.',
  howItWorks: 'How it works',
  faq: 'FAQ',
  github: 'GitHub',
  license: 'MIT License',
} as const;

export const STATUS_PLAIN_WORDS: Record<string, string> = {
  QUOTED: 'Waiting for Deposit',
  USER_LOCK_SEEN: 'Deposit Seen (Confirming)',
  USER_LOCK_FINAL: 'Deposit Confirmed · Solver Locking',
  SOLVER_LOCK_FINAL: 'Solver Locked · Ready to Claim',
  USER_CLAIM_SEEN: 'Claiming Funds',
  DONE: 'Swap Complete',
  REFUNDED: 'Deposit Refunded',
};

export const FAILURE_COPY = {
  solverUnreachable: {
    title: 'Solver Unreachable',
    message:
      'Unable to reach the solver network. Market quotes are temporarily offline.',
    action: 'Switch to Read-Only Mode',
    retry: 'Retry Connection',
  },
  allSolversRefused: {
    title: 'All Solvers Refused Quoting',
    message:
      'No participating solver could fulfill this quote. Try reducing the amount or selecting another chain.',
  },
  quoteExpired: {
    title: 'Quote Expired',
    message:
      'Quote terms expired while awaiting wallet signature (terms valid for 60s). Please request a fresh quote.',
    action: 'Get Fresh Quote',
  },
  walletRejected: {
    title: 'Transaction Rejected in Wallet',
    message:
      'Signature request was rejected in your wallet. Nothing was sent and no funds were locked.',
    action: 'Try Again',
  },
  wrongNetwork: {
    title: 'Wrong Network Detected',
    message:
      'Your wallet is connected to an unexpected network. Please switch to the required chain.',
    action: 'Switch Network',
  },
  counterLockLate: {
    title: 'Solver Counter-Lock is Late',
    message:
      'Your deposit is confirmed on chain, but the solver counter-lock has not arrived within the expected window.',
    guidance:
      'Your funds are cryptographically protected. You can wait for the solver or execute a 100% refund once the deadline arrives.',
  },
  readOnlyMode: {
    banner:
      'Read-only mode active. New swaps are paused, but you can inspect routes, check liquidity, or recover in-flight swaps.',
    button: 'Swaps Paused (Read-Only)',
  },
} as const;

const FORBIDDEN_WORDS = ['invoice', 'bill', 'tip'];

export function containsForbiddenWord(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_WORDS.some((word) => lower.includes(word));
}
