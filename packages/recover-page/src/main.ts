import type { RecoveryFile } from '@ferry/core';
import { inspectRecovery, loadRecoveryFile, type Inspection } from './logic.js';
import {
  broadcastBch,
  createBrowserPorts,
  sendWithWallet,
  type Eip1193,
} from './ports.js';

/** Replaced at build time from the chain facts: public endpoints per EVM chain id. */
declare const __RPC_URLS__: Record<number, string[]>;

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function')
      node.addEventListener(key.slice(2), value as EventListener);
    else if (value !== undefined && value !== null && value !== false)
      node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function copyButton(label: string, text: string): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'secondary',
      onclick: async (event: Event) => {
        const button = event.currentTarget as HTMLButtonElement;
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Select the text and copy it';
        }
      },
    },
    label,
  );
}

const root = document.getElementById('app')!;
const output = h('div', { id: 'output', 'aria-live': 'polite' });
const fileText = h('textarea', {
  id: 'file-text',
  rows: '6',
  placeholder: 'Or paste the contents of the recovery file here',
  'aria-label': 'Recovery file contents',
});
const evmEndpoint = h('input', {
  id: 'evm-endpoint',
  type: 'url',
  placeholder: 'https://… (optional)',
  'aria-label': 'EVM endpoint',
});
const bchServer = h('input', {
  id: 'bch-server',
  type: 'text',
  placeholder: 'wss://… (optional)',
  'aria-label': 'Bitcoin Cash server',
});

let current: RecoveryFile | null = null;

function show(...nodes: Child[]) {
  output.replaceChildren(...(nodes.filter(Boolean) as Node[]));
}

function note(text: string, kind: 'ok' | 'warn' | 'bad' = 'ok') {
  return h(
    'p',
    { class: `note ${kind}`, role: kind === 'bad' ? 'alert' : null },
    text,
  );
}

function ports() {
  return createBrowserPorts({
    rpcUrls: __RPC_URLS__,
    rpcOverride: evmEndpoint.value.trim() || undefined,
    fulcrumOverride: bchServer.value.trim() || undefined,
  });
}

function summary(file: RecoveryFile): HTMLElement {
  const forward = file.terms.direction === 'EVM_TO_BCH';
  return h(
    'section',
    { class: 'card', 'data-testid': 'summary' },
    h('h2', {}, 'Your swap'),
    h(
      'p',
      {},
      forward
        ? `You locked a stablecoin on chain ${file.contracts.evm.chainId} to receive ${file.terms.bchToken} on Bitcoin Cash.`
        : `You locked ${file.terms.bchToken} on Bitcoin Cash to receive a stablecoin on chain ${file.contracts.evm.chainId}.`,
    ),
    h(
      'dl',
      {},
      h('dt', {}, 'Order'),
      h('dd', {}, file.orderId),
      h('dt', {}, 'EVM contract'),
      h('dd', {}, file.contracts.evm.htlcAddress),
      h('dt', {}, 'EVM amount (smallest units)'),
      h('dd', {}, file.terms.evmAmount.toString()),
      h('dt', {}, `${file.terms.bchToken} amount (smallest units)`),
      h('dd', {}, file.terms.bchTokenAmount.toString()),
      h('dt', {}, 'EVM refund deadline'),
      h('dd', {}, new Date(file.terms.evmDeadline * 1000).toUTCString()),
      h('dt', {}, 'Bitcoin Cash refund height'),
      h('dd', {}, String(file.terms.bchRefundHeight)),
    ),
  );
}

function evmCard(result: Inspection): HTMLElement | null {
  const call = result.evmCall;
  if (!call) return null;
  const ready = result.plan?.actions.some((a) => a.chain === 'EVM') ?? false;
  const wallet = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  const status = h('div', { 'data-testid': 'evm-status' });
  const send = h(
    'button',
    {
      type: 'button',
      disabled: ready && wallet ? null : 'true',
      onclick: async () => {
        status.replaceChildren('Check your wallet…');
        try {
          const hash = await sendWithWallet(wallet!, {
            to: call.to,
            data: call.data,
            value: call.value,
            chainId: call.chainId,
          });
          status.replaceChildren(
            note(
              `Sent. Transaction: ${hash}. It can take a minute to confirm.`,
            ),
          );
        } catch (error) {
          status.replaceChildren(
            note(error instanceof Error ? error.message : String(error), 'bad'),
          );
        }
      },
    },
    `Send the ${call.action} with my wallet`,
  );
  return h(
    'section',
    { class: 'card', 'data-testid': 'evm-card' },
    h('h2', {}, `EVM: ${call.action}`),
    ready
      ? note('This is ready now.')
      : note(
          'Not ready yet, see the status above. Do not send it before then.',
          'warn',
        ),
    h(
      'p',
      {},
      call.action === 'refund'
        ? 'The refund returns your funds to the address that locked them. Anyone can send it, and any funded wallet can pay for it.'
        : 'The claim sends the stablecoin to you. Anyone can send it, and any funded wallet can pay for it.',
    ),
    wallet
      ? send
      : note(
          'No browser wallet was found. Use the details below instead.',
          'warn',
        ),
    status,
    h(
      'details',
      {},
      h('summary', {}, 'Send it yourself (any wallet or block explorer)'),
      h(
        'p',
        {},
        `On the block explorer for chain ${call.chainId}, open the contract below, choose Write Contract, connect a wallet and call ${call.action}.`,
      ),
      h(
        'pre',
        {},
        `Contract: ${call.to}\nFunction: ${call.action}\nLock id:  ${call.lockId}`,
      ),
      h('p', {}, 'Or send this raw call data to the contract (value 0):'),
      h('pre', { class: 'wrap' }, call.data),
      copyButton('Copy call data', call.data),
    ),
  );
}

function bchCard(result: Inspection): HTMLElement | null {
  const wantsBch = result.plan?.actions.some((a) => a.chain === 'BCH') ?? false;
  if (!wantsBch) return null;
  const tx = result.bchTx;
  if (!tx) {
    return h(
      'section',
      { class: 'card', 'data-testid': 'bch-card' },
      h('h2', {}, 'Bitcoin Cash'),
      note(
        `The transaction could not be built. ${result.bchTxError ?? ''}`,
        'bad',
      ),
    );
  }
  const status = h('div', { 'data-testid': 'bch-status' });
  return h(
    'section',
    { class: 'card', 'data-testid': 'bch-card' },
    h('h2', {}, `Bitcoin Cash: ${tx.action}`),
    note(
      'This is ready now. It needs no wallet and no signature: the contract pays you directly.',
    ),
    h('p', {}, `Transaction id: ${tx.txid}`),
    h(
      'button',
      {
        type: 'button',
        onclick: async () => {
          status.replaceChildren('Sending…');
          try {
            const txid = await broadcastBch(
              result.file,
              tx.txHex,
              bchServer.value.trim() || undefined,
            );
            status.replaceChildren(note(`Sent. Transaction id: ${txid}`));
          } catch (error) {
            status.replaceChildren(
              note(
                error instanceof Error ? error.message : String(error),
                'bad',
              ),
            );
          }
        },
      },
      `Send the ${tx.action} through a public server`,
    ),
    status,
    h(
      'details',
      {},
      h('summary', {}, 'Send it yourself (any Bitcoin Cash node or explorer)'),
      h(
        'p',
        {},
        'Paste this signed transaction into any "broadcast transaction" tool:',
      ),
      h('pre', { class: 'wrap' }, tx.txHex),
      copyButton('Copy transaction', tx.txHex),
    ),
  );
}

function render(result: Inspection) {
  const parts: Child[] = [summary(result.file)];
  if (result.errors.evm) {
    parts.push(
      note(`Could not read the EVM chain. ${result.errors.evm}`, 'bad'),
    );
  }
  if (result.errors.bch) {
    parts.push(
      note(`Could not read Bitcoin Cash. ${result.errors.bch}`, 'bad'),
    );
  }
  if (result.plan) {
    parts.push(
      h(
        'section',
        { class: 'card', 'data-testid': 'plan' },
        h('h2', {}, 'Where things stand'),
        h('p', {}, result.plan.summary),
        result.plan.waits.length > 0 &&
          h(
            'ul',
            {},
            ...result.plan.waits.map((wait) =>
              h('li', {}, `${wait.chain} ${wait.action}: ${wait.waitingFor}`),
            ),
          ),
        result.evm &&
          h(
            'p',
            { class: 'muted' },
            `EVM lock: ${result.evm.lockStatus}. Chain time: ${new Date(result.evm.nowSeconds * 1000).toUTCString()}.`,
          ),
        result.bch &&
          h(
            'p',
            { class: 'muted' },
            `Bitcoin Cash height: ${result.bch.tipHeight}. Outputs on the swap contract: ${result.bch.utxos.length}.`,
          ),
      ),
    );
  } else {
    parts.push(
      note(
        'Because a chain could not be read, no plan was made. Fix the endpoint below and check again, or use the EVM details to send it yourself once the deadline has passed.',
        'warn',
      ),
    );
  }
  parts.push(evmCard(result), bchCard(result));
  show(...parts);
}

async function check() {
  if (!current) return;
  show(note('Reading the chains…'));
  try {
    render(await inspectRecovery(current, ports()));
  } catch (error) {
    show(note(error instanceof Error ? error.message : String(error), 'bad'));
  }
}

function load(json: string) {
  try {
    current = loadRecoveryFile(json);
  } catch (error) {
    current = null;
    show(note(error instanceof Error ? error.message : String(error), 'bad'));
    return;
  }
  show(summary(current), note('File read. Checking the chains…'));
  void check();
}

const fileInput = h('input', {
  id: 'file-input',
  type: 'file',
  accept: '.json,application/json',
  'aria-label': 'Recovery file',
  onchange: async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) load(await file.text());
  },
});

root.append(
  h('h1', {}, 'Ferry recovery'),
  h(
    'p',
    { class: 'lead' },
    'Get your funds back, or finish a swap, from your recovery file. This page is a single file. It needs no Ferry website and no solver: it reads public blockchain servers directly and works from your own computer.',
  ),
  h(
    'section',
    { class: 'card' },
    h('h2', {}, '1. Your recovery file'),
    fileInput,
    fileText,
    h(
      'button',
      { type: 'button', onclick: () => load(fileText.value) },
      'Read the pasted file',
    ),
  ),
  h(
    'details',
    { class: 'card' },
    h('summary', {}, 'Use different servers (optional)'),
    h('label', {}, 'EVM endpoint ', evmEndpoint),
    h('label', {}, 'Bitcoin Cash server ', bchServer),
    h(
      'button',
      { type: 'button', class: 'secondary', onclick: () => void check() },
      'Check again',
    ),
  ),
  h('h2', {}, '2. What you can do now'),
  output,
  h(
    'p',
    { class: 'muted' },
    'Nothing leaves this page except reads from the blockchain servers and the transactions you choose to send. Your recovery file stays on your computer.',
  ),
);
