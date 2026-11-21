import { useState } from 'react';
import { GlassModal } from '../GlassModal';

type Kind = 'pay' | 'send';

const STEPS: Record<Kind, { title: string; steps: readonly string[] }> = {
  pay: {
    title: 'How a pay link works',
    steps: [
      'You create the link with the Bitcoin Cash address that should receive the money. It must be a token-aware address (starting with bitcoincash:z), because PUSD and MUSD are tokens.',
      'You share the link. The payer opens it, picks the chain and the stablecoin they hold (USDC, USDT or another), and enters an amount if you left it open.',
      'The payer connects an EVM wallet and confirms. Their stablecoin is locked in a Ferry contract on their chain. This is a lock, not a payment: it can be refunded if anything goes wrong.',
      'Ferry locks the same amount of PUSD or MUSD for you on Bitcoin Cash. When you receive it, the payer’s lock is released to Ferry. Either both happen or neither does.',
      'The money arrives at your address in about two minutes. The fee is shown to the payer before they confirm.',
      'Custody never passes to Ferry. The optional handoff makes the order of steps depend on Ferry’s code for the hours of the swap, and the page says so before you choose.',
    ],
  },
  send: {
    title: 'How a send link works',
    steps: [
      'You enter the receiver’s EVM address, the chain and token they should get, and the amount they receive. Ferry adds its fee on top, so the receiver gets exactly the amount you typed.',
      'Your Bitcoin Cash wallet locks the PUSD or MUSD in a contract that only releases it with a secret known to your link. A recovery file is saved first, so you can always get your money back.',
      'You copy the link and send it to the receiver. Anyone with the link can see it, but the money can only go to the address you entered.',
      'The receiver opens the link, connects that wallet and presses Connect and claim. They sign a short message (it costs nothing) and the stablecoin arrives on their chain. Ferry pays the network fee.',
      'If the link is not claimed before the window ends, your Bitcoin Cash lock is refunded to you.',
    ],
  },
};

/** A small clickable text that opens a step-by-step explanation of the link type. */
export function LinkHowItWorks({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const content = STEPS[kind];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`how-${kind}-links-works`}
        className="text-xs font-medium text-lime underline-offset-4 transition-colors hover:underline"
      >
        How it works
      </button>
      <GlassModal open={open} onOpenChange={setOpen} title={content.title}>
        <ol className="space-y-3 text-xs text-text-muted">
          {content.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <a
          href={kind === 'pay' ? '/docs/pay-links' : '/docs/send-links'}
          className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-lime underline-offset-4 hover:underline"
        >
          Read the full guide in the docs →
        </a>
      </GlassModal>
    </>
  );
}
