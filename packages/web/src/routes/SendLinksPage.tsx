import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { isAddress } from 'viem';
import { sendLinkUrl, type SendLinkData } from '../lib/paylink/link';
import { NETWORK_PROFILE } from '../lib/config';

export function SendLinksPage() {
  const farChains = NETWORK_PROFILE.farChains;
  const [destChain, setDestChain] = useState(farChains[0]?.name ?? 'Base');
  const [destToken, setDestToken] = useState('USDC');
  const [recipientEvm, setRecipientEvm] = useState('');
  const [amount, setAmount] = useState('20.00');
  const [durationHours, setDurationHours] = useState('24');
  const [createdLinks, setCreatedLinks] = useState<SendLinkData[]>([
    {
      id: 'sl-sample-01',
      destinationChain: 'Base',
      destinationToken: 'USDC',
      recipientEvmAddress: '0x1111222233334444555566667777888899990000',
      amount: 50.0,
      durationHours: 24,
      status: 'open',
      createdAt: Math.floor(Date.now() / 1000) - 1800,
    },
  ]);
  const [activeCreated, setActiveCreated] = useState<SendLinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = recipientEvm.trim();
    if (!trimmed || !isAddress(trimmed)) {
      setError('Please enter a valid destination EVM address');
      return;
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    const newId = 'sl-' + Math.random().toString(36).substring(2, 10);
    const newLink: SendLinkData = {
      id: newId,
      destinationChain: destChain,
      destinationToken: destToken,
      recipientEvmAddress: trimmed,
      amount: numAmount,
      durationHours: parseInt(durationHours, 10) || 24,
      status: 'open',
      createdAt: Math.floor(Date.now() / 1000),
    };

    setCreatedLinks((prev) => [newLink, ...prev]);
    setActiveCreated(newLink);
  }

  function handleCopy(url: string) {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            Send Links
          </h1>
          <p className="text-xs text-text-muted">
            Send dollars from Bitcoin Cash to someone on another chain with an
            automatic refund window.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Creator Form */}
        <div className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
          <h2 className="text-sm font-semibold text-text mb-4">
            Create a Send Link
          </h2>
          <form onSubmit={handleCreate} className="space-y-4 text-xs">
            <div>
              <label
                htmlFor="send-dest-address"
                className="block text-text-muted mb-1"
              >
                Recipient EVM Address
              </label>
              <input
                id="send-dest-address"
                type="text"
                value={recipientEvm}
                onChange={(e) => setRecipientEvm(e.target.value)}
                placeholder="0x…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                inputMode="text"
                className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-text-muted mb-1">
                  Destination Chain
                </label>
                <select
                  aria-label="Destination Chain"
                  value={destChain}
                  onChange={(e) => {
                    const newChainName = e.target.value;
                    setDestChain(newChainName);
                    const chain = farChains.find(
                      (c) => c.name === newChainName,
                    );
                    if (chain && chain.tokenSymbols[0]) {
                      setDestToken(chain.tokenSymbols[0]);
                    }
                  }}
                  className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text focus:border-lime focus:outline-none cursor-pointer"
                >
                  {farChains.map((c) => (
                    <option key={c.id} value={c.name} disabled={!c.enabled}>
                      {c.name}{' '}
                      {!c.enabled && c.disabledReason
                        ? `(${c.disabledReason})`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-text-muted mb-1">Token</label>
                <select
                  aria-label="Token"
                  value={destToken}
                  onChange={(e) => setDestToken(e.target.value)}
                  className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text focus:border-lime focus:outline-none cursor-pointer"
                >
                  {(
                    farChains.find((c) => c.name === destChain)
                      ?.tokenSymbols ?? ['USDC']
                  ).map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="send-amount"
                className="block text-text-muted mb-1"
              >
                Amount to Send
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="send-amount"
                  type="number"
                  step="any"
                  min="1"
                  value={amount}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 rounded-well border border-hairline bg-surface-2 p-2.5 font-semibold text-text focus:border-lime focus:outline-none"
                />
                <span className="font-semibold text-text">{destToken}</span>
              </div>
            </div>

            <div>
              <label
                htmlFor="send-claim-window"
                className="block text-text-muted mb-1"
              >
                Claim Window
              </label>
              <select
                id="send-claim-window"
                aria-label="Claim Window"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                className="w-full rounded-well border border-hairline bg-surface-2 p-2.5 text-xs text-text focus:border-lime focus:outline-none cursor-pointer"
              >
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
              </select>
            </div>

            {error && (
              <p className="text-danger text-xs" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-pill bg-olive py-2.5 font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer"
            >
              Generate Send Link
            </button>
          </form>
        </div>

        {/* Generated Preview */}
        <div className="flex flex-col gap-6">
          {activeCreated ? (
            <div className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text">
                  Your Send Link is Ready
                </h2>
                <span className="rounded-pill bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok border border-ok/20">
                  Open
                </span>
              </div>

              <div className="flex justify-center my-4 p-4 rounded-xl bg-surface-2 border border-hairline">
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={sendLinkUrl(activeCreated.id)} size={160} />
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="rounded-well border border-hairline bg-surface-2 p-2.5">
                  <span className="text-text-dim block text-[11px] mb-0.5">
                    Shareable Link
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-text truncate">
                      {sendLinkUrl(activeCreated.id)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(sendLinkUrl(activeCreated.id))}
                      className="shrink-0 rounded-pill bg-surface-3 px-3 py-1 font-semibold text-text hover:text-lime cursor-pointer transition-colors"
                    >
                      {copied ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="rounded-well border border-hairline bg-surface-2 p-2.5 text-[11px]">
                  <span className="text-text-dim block mb-0.5">
                    Enforced Recipient
                  </span>
                  <span className="font-mono text-text break-all">
                    {activeCreated.recipientEvmAddress}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-card border border-dashed border-hairline bg-surface-1/40 p-8 text-center text-xs text-text-muted">
              Configure parameters on the left to create a send link.
            </div>
          )}

          {/* List */}
          <div className="rounded-card border border-hairline bg-surface-1 p-4 shadow-elev-card">
            <h3 className="text-xs font-semibold text-text mb-3">
              Recent Send Links
            </h3>
            <div className="space-y-2">
              {createdLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between rounded-well border border-hairline bg-surface-2 p-2.5 text-xs hover:border-lime/30 transition-colors"
                >
                  <div>
                    <div className="font-medium text-text">
                      <Link
                        to={`/s/${link.id}`}
                        className="hover:text-lime underline"
                      >
                        {link.amount.toFixed(2)} {link.destinationToken} →{' '}
                        {link.destinationChain}
                      </Link>
                    </div>
                    <span className="font-mono text-[10px] text-text-dim">
                      {link.id}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveCreated(link)}
                    className="rounded-pill bg-surface-3 px-2.5 py-1 text-[11px] font-semibold text-text hover:text-lime cursor-pointer"
                  >
                    View QR
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
