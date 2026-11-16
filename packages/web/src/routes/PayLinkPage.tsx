import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { getModeCopy } from '../lib/copy';
import { NETWORK_PROFILE } from '../lib/config';
import { useSolver } from '../lib/solver/useSolver';
import { WalletContext } from '../lib/wallet/context';
import { chunkCashaddr } from '../lib/paylink/link';
import type { ChainDisplay } from '../lib/network';
import type { QuoteResponse } from '../lib/solver/types';

export function PayLinkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const solver = useSolver();
  const walletContext = useContext(WalletContext);
  const evm = walletContext?.evm ?? { status: 'disconnected', address: null };
  const copy = getModeCopy('pay-link');

  // Sample data for demo/mock pay link
  const [recipientCashaddr] = useState(
    'bchtest:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy6fphnwyk',
  );
  const [token] = useState<'PUSD' | 'MUSD'>('PUSD');
  const [requestedAmount] = useState<number>(25.0);
  const [note] = useState<string>('Dinner split');
  const [verified] = useState(true);

  // Payer options
  const farChains = NETWORK_PROFILE.farChains;
  const [selectedChainId, setSelectedChainId] = useState<string | number>(
    farChains[0]?.id ?? 84532,
  );
  const selectedChain: ChainDisplay =
    farChains.find((c) => c.id === selectedChainId) ?? farChains[0]!;
  const [selectedPayerToken] = useState<string>(
    selectedChain?.tokenSymbols[0] ?? 'USDC',
  );

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [paying, setPaying] = useState(false);

  // Exact-output quote: recipient receives exact amount
  useEffect(() => {
    let active = true;
    solver
      .getQuote({
        fromToken: selectedPayerToken,
        toToken: token,
        fromChain: selectedChain.name,
        toChain: NETWORK_PROFILE.bch.name,
        fromAmount: requestedAmount * 1.004 + 0.05, // exact out calculation
        lane: 'fast',
      })
      .then((res) => {
        if (active) setQuote(res);
      })
      .catch(() => {
        if (active) setQuote(null);
      });

    return () => {
      active = false;
    };
  }, [requestedAmount, selectedPayerToken, selectedChain, token, solver]);

  async function handlePay() {
    setPaying(true);
    try {
      const orderId = `paylink-${id ?? 'order'}`;
      if (solver.createOrder && quote?.signedQuote) {
        await solver.createOrder(quote.signedQuote, evm.address ?? undefined);
      }
      void navigate(`/swap/${orderId}`);
    } catch {
      setPaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:px-6">
      {/* Back button */}
      <div className="mb-4">
        <Link
          to="/pay-links"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          ← All Pay Links
        </Link>
      </div>

      <div className="card-ring relative rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
        {/* Title */}
        <div className="mb-4 border-b border-hairline pb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-lime">
              Pay Link
            </span>
            {verified && (
              <span className="rounded-pill bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok border border-ok/20">
                Verified Recipient
              </span>
            )}
          </div>
          <h1 className="mt-1 text-xl font-bold text-text">
            Pay {requestedAmount.toFixed(2)} {token}
          </h1>
          {note && <p className="mt-1 text-xs text-text-muted">{note}</p>}
        </div>

        {/* Recipient Details (Chunked for anti-phishing) */}
        <div className="mb-4 rounded-well border border-hairline bg-surface-2 p-3 text-xs">
          <span className="text-text-dim block mb-1">Recipient Address</span>
          <p className="font-mono text-text break-all text-[11px]">
            {chunkCashaddr(recipientCashaddr)}
          </p>
        </div>

        {/* Payment Summary */}
        <div className="space-y-3 mb-5">
          {/* They Receive */}
          <div className="rounded-well border border-hairline bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>{copy.receiveLabel}</span>
              <span className="text-[11px] text-text-dim">Bitcoin Cash</span>
            </div>
            <div className="text-xl font-semibold text-text">
              {requestedAmount.toFixed(2)} {token}
            </div>
          </div>

          {/* You Pay */}
          <div className="rounded-well border border-hairline bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>{copy.sendLabel}</span>
              <select
                aria-label="Payer chain"
                value={selectedChainId}
                onChange={(e) => setSelectedChainId(Number(e.target.value))}
                className="appearance-none bg-surface-3 pl-2 pr-6 py-0.5 rounded-pill text-xs font-medium text-text border border-hairline cursor-pointer focus:outline-none focus:border-lime"
              >
                {farChains.map((c) => (
                  <option key={c.id} value={c.id} className="bg-surface-2">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xl font-semibold text-text">
              {quote
                ? quote.fromAmount.toFixed(2)
                : (requestedAmount * 1.004).toFixed(2)}{' '}
              {selectedPayerToken}
            </div>
          </div>
        </div>

        {/* Primary Action Button */}
        <button
          type="button"
          disabled={paying}
          onClick={handlePay}
          data-testid="pay-link-submit-button"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-olive text-text font-semibold hover:bg-olive/90 transition-colors cursor-pointer shadow-elev-pill disabled:opacity-40"
        >
          <span>{paying ? 'Initiating payment…' : copy.actionLabel}</span>
        </button>

        <p className="mt-3 text-center text-[11px] text-text-dim">
          Atomic swap through Ferry. Funds never touch a custodian or bridge.
        </p>
      </div>
    </div>
  );
}
