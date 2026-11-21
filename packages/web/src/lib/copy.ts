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
    actionLabel: 'Ferry it',
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
      'Ferry is trust-minimised. You do not trust a custodian with your funds, but you do depend on an active solver to provide liquidity and complete the counter-lock. If the solver will not counter-lock a swap that started on an EVM chain, it returns your deposit at once; in any case every deposit can be refunded when its deadline passes. Custody never passes to Ferry. The optional handoff makes the order of steps depend on Ferry’s code for the hours of the swap, and the page says so before you choose.',
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
    question: 'What is the security and testing status of Ferry?',
    answer:
      'Ferry was built as an experimental hackathon project for BCH BLAZE 2026. While the smart contracts and solver state machines are backed by formal timing invariants and automated crash simulation tests, they are experimental code.',
  },
] as const;

export const PEG_SOURCES = {
  title: 'BCH Stablecoin Pegs',
  description: 'Real-time parity vs USD on Bitcoin Cash CashTokens DEXs.',
} as const;

export function formatPegSources(
  sources?:
    readonly (string | undefined)[] | readonly { readonly source?: string }[],
): string {
  if (!sources || sources.length === 0) {
    return 'Real-time oracle references';
  }
  const names = sources
    .map((s) => (typeof s === 'string' ? s : s?.source))
    .filter((s): s is string => Boolean(s && s.trim().length > 0));
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return 'Real-time oracle references';
  return `Data sources: ${unique.join(', ')}`;
}

export const FOOTER_COPY = {
  tagline:
    'Trust-minimised atomic swaps between Bitcoin Cash and EVM networks.',
  howItWorks: 'How it works',
  faq: 'FAQ',
  status: 'Route Status',
  github: 'GitHub',
  license: 'MIT License',
} as const;

export const ROUTE_STATUS_COPY = {
  title: 'Route Status & Network Health',
  description:
    'Public real-time route verification, liquidity telemetry, and dry-run quoting.',
  testAllButton: 'Test All Routes (Quote-Only)',
  testAllDisclaimer:
    'Issues a minimum-amount dry-run quote across all enabled routes. Never locks funds or broadcasts transactions.',
  operatorSectionTitle: 'Operator Route Telemetry',
  operatorSectionDescription:
    'Provide an operator token for direct solver engine telemetry. Kept in memory only — never stored or logged.',
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

export interface HelpGuideSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps?: readonly string[];
  readonly details: readonly string[];
}

export const HELP_COPY = {
  title: 'User Guide & FAQ',
  subtitle:
    'Clear, honest explanations of how Ferry works, how to recover funds, fees, and privacy.',
  sections: [
    {
      id: 'send-dollars',
      title: 'Send stablecoins to Bitcoin Cash',
      summary:
        'Exchange EVM stablecoins (USDC/USDT) directly for native Bitcoin Cash stablecoins (PUSD/MUSD) without a custodial bridge.',
      steps: [
        'Select your source token (USDC on Base, Ethereum, or Arbitrum) and your destination (PUSD or MUSD on Bitcoin Cash).',
        'Enter the amount and paste your destination Bitcoin Cash CashAddress.',
        'Review the guaranteed quote and lock your tokens into the source Hash-Time-Locked Contract (HTLC).',
        'The solver detects your deposit and locks the matching target stablecoins into a Bitcoin Cash CashTokens covenant with the same secret hash.',
        'You or your wallet claims the PUSD on Bitcoin Cash by revealing the 32-byte secret. The solver then uses that secret to claim the source tokens. Both sides settle atomically.',
      ],
      details: [
        'Atomic execution guarantees that neither party can take funds without fulfilling the other side.',
        'No wrapped assets: you receive genuine native CashTokens stablecoins directly into your self-custody wallet.',
      ],
    },
    {
      id: 'pay-link',
      title: 'Get paid with a pay link',
      summary:
        'Create a reusable payment link or QR code to collect payments in stablecoins settled directly to your wallet.',
      steps: [
        'Open Pay link in the app menu and enter the exact dollar amount you wish to request.',
        'Copy the generated pay link or present the interactive QR code to the payer.',
        'The payer visits the link, connects any supported EVM or BCH wallet, and submits the payment.',
        'Settlement completes directly to your configured CashAddress without intermediate custody.',
      ],
      details: [
        'The payer does not need a Bitcoin Cash wallet or BCH to pay you.',
        'Pay links strictly avoid misleading terminology: they are direct payment requests.',
      ],
    },
    {
      id: 'send-link',
      title: 'Send a link to someone on another chain',
      summary:
        'Send stablecoins to anyone via a shareable URL fragment, redeemable by the recipient without prior coordination.',
      steps: [
        'Navigate to Send Links (/send-links) and lock the amount you want to transfer.',
        'The app generates a unique link containing the cryptographic claim secret inside the URL fragment (#secret=...).',
        'Share the link securely with your recipient via chat, email, or message.',
        'The recipient opens the link and claims the funds into their wallet on their preferred supported chain.',
      ],
      details: [
        'If the recipient does not claim the link before the expiration deadline, you can reclaim your full deposit.',
        'Never publish a Send Link publicly; anyone with the secret fragment can claim the funds.',
      ],
    },
    {
      id: 'stalls-and-recovery',
      title: 'What if something stalls?',
      summary:
        'Ferry is designed with deterministic refund timeouts and independent offline recovery tools so your funds are never trapped.',
      details: [
        'Refund Deadlines: Every contract deposit has an explicit on-chain deadline (e.g., 2 hours for safe swaps, 4 hours for links). If the counterparty or solver fails to act before the deadline, your deposit unlocks automatically for a 100% refund.',
        'Standalone Recovery File: When initiating a swap, download the recovery JSON file. It contains the complete contract terms, lock IDs, and the secret preimage.',
        'In-Page Recovery (/recover): If this website loses connection or a browser tab closes, open the /recover page and drop in your recovery file. You can monitor the state machine and trigger a refund or claim directly through public RPCs without any solver interaction.',
        'Terminal CLI (@ferry/recover-cli): Even if this website is completely offline or unreachable, run "pnpm -w recover" in the terminal with your recovery file to sign and broadcast refund transactions directly to the blockchain nodes.',
      ],
    },
    {
      id: 'fees-and-costs',
      title: 'What does it cost?',
      summary:
        'Transparent market pricing with zero hidden protocol fees or custody deductions.',
      details: [
        'Market Spread: Quotes include a transparent market spread (typically 40 basis points, or 0.40%) relative to real-time oracle reference prices from DEX pools (Cauldron and Paryon).',
        'Fixed Platform Fee: Zero ($0.00). Ferry charges no protocol take rate.',
        'Network Gas: You pay standard native transaction gas on the chain where you make your initial deposit (e.g., EVM gas for USDC lock, or Bitcoin Cash mining fee for CashTokens lock). The solver covers gas on their counter-lock and claim.',
        'Worked Example: If you swap 100.00 USDC at 1:1 parity with a 40 bps spread ($0.40), the quote guarantees 99.60 PUSD delivered to your Bitcoin Cash address. All numbers and reference sources are displayed before you confirm.',
      ],
    },
    {
      id: 'privacy-and-visibility',
      title: 'Who can see what?',
      summary:
        'Cryptographic secrets remain client-side until execution, and URL fragments protect private keys.',
      details: [
        'Secret in URL Fragment: For pay links and send links, the claim secret is stored after the hash (#) in the URL. Web browsers never transmit URL fragments to web servers, CDNs, or HTTP reverse proxies. The secret stays strictly inside the client browser memory.',
        'What the Solver Sees: Solvers only see the SHA-256 hash of the secret, the token contract addresses, the amount, the expiration timestamp, and the public blockchain transaction. Solvers cannot see or deduce the secret until you choose to reveal it.',
        'Public Blockchain Record: When a claim is executed, the 32-byte secret preimage is published to the blockchain as input to the smart contract, enabling both parties to settle.',
        'No Third-Party Analytics: Ferry bundles zero tracking scripts, telemetry pixels, or third-party cookies.',
      ],
    },
  ] as const,
} as const;

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
