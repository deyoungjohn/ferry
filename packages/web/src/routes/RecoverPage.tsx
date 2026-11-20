import {
  listDeployedContracts,
  loadChainConfig,
  PREDICTED_FERRY_HTLC_ADDRESS,
  PREVIOUS_FERRY_HTLC_ADDRESS,
} from '@ferry/chain-config/browser';
import chainsData from '../../../chain-config/src/data/chains.json';
import { useState, useContext, type ChangeEvent, type FormEvent } from 'react';
import { ROUTES } from '../lib/routes';
import { Link } from 'react-router';
import {
  parseRecoveryFileJson,
  recoveryActions,
  buildEvmRecoveryCalldata,
  orderId as computeOrderId,
  type RecoveryFile,
  type RecoveryPlan,
  formatDuration,
  evmLockId,
  EVM_RECOVERY_KEY_TYPED_DATA,
  type Hex32,
} from '@ferry/core';
import {
  scanEvmSignature,
  type BchWalletSwap,
  type WalletEvmSwap,
} from '@ferry/recover-cli/wallet-scan';
import { scanBchWalletHistory } from '../lib/live/wallet-bch-history';
import {
  getOrCreateRescueRoot,
  getOrDeriveRecoveryRoot,
} from '../lib/recovery/recovery-key-service';
import { DEFAULT_MAINNET_FULCRUM } from '../lib/live/bch-chain';
import {
  getEvmWalletRecoveryActions,
  inspectEvmWalletRecovery,
  type EvmWalletRecoveryPlan,
} from '@ferry/chain-evm';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { WalletContext } from '../lib/wallet/context';
import { readBchTipHeight } from '../lib/solver/tip';
import { bchTxUrl, evmTxUrl } from '../lib/explorer';
import { createBrowserBchChain } from '../lib/live/bch-chain';
import { buildBchRecoveryTransaction } from '@ferry/htlc-bch';
import { CopyDiagnosticsButton } from '../components/CopyDiagnosticsButton';
import { InfoIcon, ExternalLinkIcon } from '../components/icons';
import { useToast } from '../lib/toast/ToastContext';
import { readOrderTxids, type OrderSnapshot } from '../lib/paylink/order-steps';

const deployed = listDeployedContracts(chainsData);
const walletRecoveryChains = loadChainConfig({
  data: chainsData,
  network: 'mainnet',
}).facts.map((chain) => ({
  chainId: chain.chainId,
  name: chain.name,
  rpcUrls: chain.rpcUrls,
  htlcAddresses: [
    PREDICTED_FERRY_HTLC_ADDRESS,
    PREVIOUS_FERRY_HTLC_ADDRESS,
    ...deployed
      .filter((item) => item.chain === chain.id)
      .map((item) => item.address),
  ].filter(
    (address, index, all) =>
      all.findIndex(
        (candidate) => candidate.toLowerCase() === address.toLowerCase(),
      ) === index,
  ),
}));

export function RecoverPage() {
  const walletContext = useContext(WalletContext);
  const { showToast } = useToast();
  const [fileContent, setFileContent] = useState('');
  const [recoveryFile, setRecoveryFile] = useState<RecoveryFile | null>(null);
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [evmPlan, setEvmPlan] = useState<EvmWalletRecoveryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [evmCalldata, setEvmCalldata] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderSnapshot, setOrderSnapshot] = useState<OrderSnapshot | null>(
    null,
  );
  const [walletSwaps, setWalletSwaps] = useState<readonly WalletEvmSwap[]>([]);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [bchSwaps, setBchSwaps] = useState<readonly BchWalletSwap[]>([]);
  const [bchBusy, setBchBusy] = useState(false);
  const [bchError, setBchError] = useState<string | null>(null);

  /** The contract's lock id for this file's EVM lock (not the order id). */
  function evmLockIdOf(file: RecoveryFile): Hex32 {
    const owner =
      file.terms.direction === 'EVM_TO_BCH'
        ? file.terms.userEvmAddress
        : file.terms.solverEvmAddress;
    return (file.contracts.evm.lockId ??
      evmLockId(owner, file.hashLock)) as Hex32;
  }

  /** The EVM lock as the chain says it is, or null when the chain cannot be read. */
  async function readEvmLock(
    file: RecoveryFile,
  ): Promise<EvmWalletRecoveryPlan | null> {
    try {
      const client = createPublicClient({ chain: base, transport: http() });
      const candidates: Address[] = [
        ...(file.contracts.evm.htlcAddress
          ? [file.contracts.evm.htlcAddress as Address]
          : []),
        PREDICTED_FERRY_HTLC_ADDRESS as Address,
        PREVIOUS_FERRY_HTLC_ADDRESS as Address,
      ].filter(
        (addr, idx, arr) =>
          arr.findIndex((a) => a.toLowerCase() === addr.toLowerCase()) === idx,
      );

      for (const candidate of candidates) {
        try {
          const res = await inspectEvmWalletRecovery({
            client: client as unknown as Parameters<
              typeof inspectEvmWalletRecovery
            >[0]['client'],
            htlc: candidate,
            lockId: evmLockIdOf(file),
            ...(file.secret ? { secret: file.secret as Hex32 } : {}),
          });
          if (res.status !== 'none') {
            if (
              candidate.toLowerCase() !==
              file.contracts.evm.htlcAddress?.toLowerCase()
            ) {
              file.contracts.evm.htlcAddress = candidate;
            }
            return res;
          }
        } catch {
          // ignore candidate error
        }
      }

      return await inspectEvmWalletRecovery({
        client: client as unknown as Parameters<
          typeof inspectEvmWalletRecovery
        >[0]['client'],
        htlc: (file.contracts.evm.htlcAddress as Address) ?? candidates[0]!,
        lockId: evmLockIdOf(file),
        ...(file.secret ? { secret: file.secret as Hex32 } : {}),
      });
    } catch {
      return null;
    }
  }

  /** Whether an output sits at the covenant now ("locked") or not, or null when it cannot be read. */
  async function readBchLock(
    file: RecoveryFile,
  ): Promise<'locked' | 'none' | null> {
    try {
      const chain = createBrowserBchChain({
        solverUrl: (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
          ?.split(',')[0]
          ?.trim(),
      });
      const utxos = await chain.getUtxos(
        file.contracts.bch.lockingBytecode.replace(/^0x/i, ''),
      );
      return utxos.length > 0 ? 'locked' : 'none';
    } catch {
      return null;
    }
  }

  async function processJson(rawJson: string) {
    setError(null);
    setNotice(null);
    setActionResult(null);
    setEvmCalldata(null);

    let rawObj: Record<string, unknown>;
    try {
      rawObj = JSON.parse(rawJson);
    } catch {
      setRecoveryFile(null);
      setPlan(null);
      setEvmPlan(null);
      setError('Invalid JSON format');
      return;
    }

    const isSimulation =
      rawObj.isSimulation === true ||
      rawObj.solverKind === 'simulation' ||
      (rawObj.solverKind != null &&
        rawObj.solverKind !== 'real' &&
        rawObj.solverKind !== 'live') ||
      Boolean(rawObj.isSimulation);

    // Strip optional legacy metadata not part of strict RecoveryFile schema
    if ('solverKind' in rawObj) {
      delete rawObj.solverKind;
    }

    let parsed: RecoveryFile;
    try {
      parsed = parseRecoveryFileJson(JSON.stringify(rawObj));
    } catch (err) {
      setRecoveryFile(null);
      setPlan(null);
      setEvmPlan(null);
      setError(
        err instanceof Error ? err.message : 'Invalid recovery file structure',
      );
      return;
    }

    try {
      const calculatedId = computeOrderId(parsed.terms);
      if (calculatedId.toLowerCase() !== parsed.orderId.toLowerCase()) {
        throw new Error(
          'Order ID does not match the terms in this recovery file',
        );
      }
    } catch (err) {
      setRecoveryFile(null);
      setPlan(null);
      setEvmPlan(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Order ID does not match the terms in this recovery file',
      );
      return;
    }

    setRecoveryFile(parsed);

    const solverUrl = (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
      ?.split(',')[0]
      ?.trim();
    if (solverUrl) {
      readOrderTxids(solverUrl, parsed.orderId)
        .then((s) => setOrderSnapshot(s))
        .catch(() => undefined);
    } else {
      setOrderSnapshot(null);
    }

    // Run core's direction-aware recoveryActions planner (Requirement 3)
    const now = Math.floor(Date.now() / 1000);
    // The plan is worked out from the chains, not from assumptions: the real Bitcoin Cash height
    // and, when it can be read, the real state of the EVM lock.
    let bchTipHeight: number | null;
    try {
      if (isSimulation) throw new Error('simulation');
      bchTipHeight = await readBchTipHeight(
        (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
          ?.split(',')[0]
          ?.trim(),
      );
    } catch {
      bchTipHeight = null;
    }
    // The state of both locks is read from the chains; a lock is only assumed to exist when its
    // chain cannot be read (and the page then says so).
    // A file issued by an offline simulation has nothing on any chain to read.
    const evmRead = isSimulation ? null : await readEvmLock(parsed);
    const bchRead = isSimulation ? null : await readBchLock(parsed);
    const recoveryPlan = recoveryActions(parsed, {
      nowSeconds: now,
      // Unknown height: assume the refund height has not been reached, never that it has.
      bchTipHeight: bchTipHeight ?? parsed.terms.bchRefundHeight - 1,
      evmLock: { state: evmRead?.status ?? 'locked' },
      bchLock: { state: bchRead ?? 'locked' },
    });
    setPlan(recoveryPlan);

    // Run EVM wallet recovery plan calculation (Requirement 2)
    const evmRecovery =
      evmRead ??
      getEvmWalletRecoveryActions({
        status: 'locked',
        deadline: Number(parsed.terms.evmDeadline),
        nowSeconds: now,
        hashLock: parsed.terms.hashLock,
        ...(parsed.secret ? { secret: parsed.secret } : {}),
        blockTimeSeconds: 2,
      });
    setEvmPlan(evmRecovery);

    if (
      !isSimulation &&
      (bchTipHeight === null || evmRead === null || bchRead === null)
    ) {
      setNotice(
        'Recovery file loaded, but a chain could not be read, so what the page shows may be incomplete. Press "Verify On-Chain Status" or try again.',
      );
    } else if (isSimulation) {
      setNotice(
        'Recovery file loaded. This file was issued by an offline simulation and cannot be claimed on chain.',
      );
    } else {
      setNotice(
        'Recovery file loaded successfully. Contract parameters verified.',
      );
      showToast('Recovery file loaded successfully', 'success');
    }
  }

  async function recoverWithEvmWallet() {
    setWalletError(null);
    setWalletSwaps([]);
    const evm = walletContext?.evm;
    if (!evm || evm.status !== 'connected' || !evm.address) {
      evm?.connect();
      setWalletError(
        'Connect your EVM wallet in the dialog that opened, then press Recover with wallet again.',
      );
      return;
    }
    setWalletBusy(true);
    try {
      const signature = await evm.signTypedData(
        EVM_RECOVERY_KEY_TYPED_DATA as Parameters<typeof evm.signTypedData>[0],
      );
      const result = await scanEvmSignature({
        signature,
        owner: evm.address,
        chains: walletRecoveryChains,
        gap: 20,
      });
      setWalletSwaps(result.swaps);
      if (result.errors.length > 0) {
        setWalletError(
          `Some chains could not be read: ${result.errors.map((item) => item.chain).join(', ')}.`,
        );
      } else if (result.swaps.length === 0) {
        setWalletError('No Ferry locks were found for this wallet.');
      }
    } catch (err) {
      setWalletError(
        err instanceof Error ? err.message : 'The wallet scan did not finish.',
      );
    } finally {
      setWalletBusy(false);
    }
  }

  function walletAction(swap: WalletEvmSwap): string {
    if (swap.status === 'refunded') return 'Already refunded';
    if (swap.status === 'claimed') return 'Already claimed';
    if (swap.evmDeadline === null) return 'Locked';
    const now = Math.floor(Date.now() / 1000);
    return BigInt(now) >= swap.evmDeadline
      ? 'Refund is available'
      : `Refund after ${new Date(Number(swap.evmDeadline) * 1000).toUTCString()}`;
  }

  async function recoverWithBchWallet() {
    setBchError(null);
    setBchSwaps([]);
    const wallet = walletContext;
    if (!wallet) {
      setBchError('The wallet context is not ready.');
      return;
    }
    if (wallet.bch.status !== 'connected') {
      wallet.bch.connect();
      setBchError(
        'Connect your Bitcoin Cash wallet in the dialog that opened, then press Scan Bitcoin Cash wallet again.',
      );
      return;
    }
    if (!wallet.bch.listFundingAddresses) {
      setBchError('This Bitcoin Cash wallet cannot list its addresses.');
      return;
    }
    setBchBusy(true);
    try {
      const addresses = await wallet.bch.listFundingAddresses();
      let root;
      if (wallet.evm.status === 'connected' && wallet.evm.address) {
        const derived = await getOrDeriveRecoveryRoot(wallet.evm);
        root = derived.root ?? (await getOrCreateRescueRoot());
      } else {
        root = await getOrCreateRescueRoot();
      }
      const swaps = await scanBchWalletHistory({
        root,
        addresses,
        urls: DEFAULT_MAINNET_FULCRUM,
        network: 'mainnet',
      });
      setBchSwaps(swaps);
      if (swaps.length === 0) {
        setBchError(
          'No Ferry terms output was found in the scanned Bitcoin Cash addresses.',
        );
      }
    } catch (err) {
      setBchError(
        err instanceof Error
          ? err.message
          : 'The Bitcoin Cash history scan did not finish.',
      );
    } finally {
      setBchBusy(false);
    }
  }

  function bchAction(swap: BchWalletSwap): string {
    return `Refund at Bitcoin Cash block ${swap.terms.refundHeight.toLocaleString('en-US')}`;
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileContent(text);
      void processJson(text);
    };
    reader.readAsText(file);
  }

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    void processJson(fileContent);
  }

  /** Sends the recovery transaction (claim with the secret, or refund) from the connected EVM wallet. */
  async function sendEvmRecovery(expected: 'claim' | 'refund') {
    if (!recoveryFile) return;
    setBusy(true);
    setError(null);
    setActionResult(null);
    try {
      const evm = walletContext?.evm;
      if (!evm || evm.status !== 'connected' || !evm.sendTransaction) {
        evm?.connect();
        setNotice(
          'Connect your EVM wallet in the dialog that opened, then press the button again.',
        );
        return;
      }
      const call = buildEvmRecoveryCalldata(recoveryFile);
      if (call.action !== expected) {
        setError(
          expected === 'claim'
            ? 'The claim of this swap is on Bitcoin Cash, not on the EVM chain: open the swap from your swap list (or the standalone recovery page) to claim it.'
            : 'The refund of this lock is on Bitcoin Cash, not on the EVM chain: use the standalone recovery page once its refund height has passed.',
        );
        return;
      }
      if (evm.chainId !== undefined && evm.chainId !== call.chainId) {
        setError(
          `Switch your wallet to the chain of this swap (chain ${call.chainId}) and try again.`,
        );
        return;
      }
      const hash = await evm.sendTransaction({
        to: call.to as Hex,
        data: call.data,
        value: 0n,
        chainId: call.chainId,
      });
      const url = evmTxUrl(call.chainId, hash);
      setActionResult(
        `${expected === 'claim' ? 'Claim' : 'Refund'} sent. ${url ? `Check it on the explorer: ${url}` : `Transaction: ${hash}`}`,
      );
    } catch (err) {
      setError(walletErrorText(err, expected));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The Bitcoin Cash side: the claim of an EVM to BCH swap, or the refund of a BCH to EVM lock.
   * It needs no wallet and no signature (the covenant pays the address fixed in the file): the
   * page finds the locked output, builds the transaction and sends it through public servers.
   */
  async function recoverOnBch(action: 'claim' | 'refund') {
    if (!recoveryFile) return;
    setBusy(true);
    setError(null);
    setActionResult(null);
    try {
      const chain = createBrowserBchChain({
        solverUrl: (import.meta.env?.VITE_SOLVER_URLS as string | undefined)
          ?.split(',')[0]
          ?.trim(),
      });
      const utxos = await chain.getUtxos(
        recoveryFile.contracts.bch.lockingBytecode.replace(/^0x/i, ''),
      );
      if (utxos.length === 0) {
        setError(
          action === 'claim'
            ? "The solver's Bitcoin Cash lock was not found, so there is nothing to claim yet."
            : 'Your Bitcoin Cash lock was not found, so there is nothing to refund.',
        );
        return;
      }
      let locktime: number | undefined;
      if (action === 'refund') {
        const tip = await chain.getTipHeight();
        if (tip < recoveryFile.terms.bchRefundHeight) {
          setError(
            `The refund opens at Bitcoin Cash block ${recoveryFile.terms.bchRefundHeight.toLocaleString('en-US')}, about ${formatDuration((recoveryFile.terms.bchRefundHeight - tip) * 600)} from now.`,
          );
          return;
        }
        locktime = Math.max(tip, recoveryFile.terms.bchRefundHeight);
      }
      const built = buildBchRecoveryTransaction({
        file: recoveryFile,
        utxos: utxos.map((u) => ({
          txid: u.txid,
          vout: u.vout,
          satoshis: u.satoshis,
        })),
        ...(locktime !== undefined ? { locktime } : {}),
      });
      const txid = await chain.broadcast(built.txHex);
      setActionResult(
        `${action === 'claim' ? 'Claim' : 'Refund'} sent. Check it on the explorer: ${bchTxUrl(txid)}`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `The ${action} was not sent. Nothing changed on chain.`,
      );
    } finally {
      setBusy(false);
    }
  }

  /** What went wrong in one plain line: a cancelled request is not an error screen. */
  function walletErrorText(err: unknown, action: string): string {
    const short =
      (err as { shortMessage?: string } | null)?.shortMessage ??
      (err instanceof Error ? err.message.split('\n')[0] : '');
    if (/reject|denied|cancel/i.test(short ?? '')) {
      return 'You cancelled the request in your wallet. Nothing was sent.';
    }
    return `The ${action} was not sent: ${short || 'the wallet did not complete the request'}. Nothing changed on chain.`;
  }

  const forward = recoveryFile?.terms.direction === 'EVM_TO_BCH';
  const handleClaim = () =>
    forward ? recoverOnBch('claim') : sendEvmRecovery('claim');
  const handleRefund = () =>
    forward ? sendEvmRecovery('refund') : recoverOnBch('refund');

  function handleViewEvmCalldata() {
    if (!recoveryFile) return;
    try {
      const calldata = buildEvmRecoveryCalldata(recoveryFile);
      setEvmCalldata(
        JSON.stringify(
          calldata,
          (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not generate EVM recovery calldata',
      );
    }
  }

  async function handleInspectEvmOnChain() {
    if (!recoveryFile) return;
    setBusy(true);
    setError(null);
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(),
      });
      const onChainPlan = await inspectEvmWalletRecovery({
        client: client as unknown as Parameters<
          typeof inspectEvmWalletRecovery
        >[0]['client'],
        htlc: recoveryFile.contracts.evm.htlcAddress as Address,
        lockId: evmLockIdOf(recoveryFile),
        ...(recoveryFile.secret
          ? { secret: recoveryFile.secret as Hex32 }
          : {}),
      });
      setEvmPlan(onChainPlan);
      setNotice('On-chain EVM status verified.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not query on-chain EVM status',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Recover a Swap
          </h1>
          <p className="text-xs text-text-muted">
            Claim or refund an atomic swap directly from your recovery file,
            independent of any server.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-3 text-xs font-semibold text-text hover:border-lime/40 transition-colors self-start sm:self-auto"
        >
          ← Back to Swap
        </Link>
      </div>

      {/* Wallet recovery */}
      <div
        data-testid="recover-with-wallet"
        className="mb-6 rounded-card border border-lime/30 bg-lime/5 p-5 shadow-elev-card"
      >
        <h2 className="text-sm font-semibold text-text mb-1">
          Recover with your wallet
        </h2>
        <p className="text-xs text-text-muted leading-relaxed mb-3">
          Sign one fixed message with your EVM wallet. Ferry derives the swap
          secrets locally and scans every chain; the signature cannot move
          funds.
        </p>
        <button
          type="button"
          onClick={() => void recoverWithEvmWallet()}
          disabled={walletBusy}
          className="rounded-pill bg-lime px-4 py-1.5 text-xs font-semibold text-bg hover:bg-lime/90 transition-colors disabled:opacity-60"
        >
          {walletBusy ? 'Scanning…' : 'Recover with wallet'}
        </button>
        {walletError && (
          <p className="mt-3 text-xs text-warn" role="status">
            {walletError}
          </p>
        )}
        {walletSwaps.length > 0 && (
          <ul className="mt-4 divide-y divide-hairline/60">
            {walletSwaps.map((swap) => (
              <li
                key={`${swap.chainId}-${swap.index}-${swap.lockId}`}
                className="py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">
                    {swap.chainName} · {swap.status} · index {swap.index}
                  </span>
                  <span className="text-text-muted">{walletAction(swap)}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-text-dim break-all">
                  {swap.lockId}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-lime/20 pt-4">
          <h3 className="text-xs font-semibold text-text">
            Recover from your Bitcoin Cash wallet
          </h3>
          <p className="mt-1 text-xs text-text-muted leading-relaxed">
            Uses the wallet&apos;s rotating address history and the FRY1 terms
            output to find reverse swaps. The root comes from the EVM signature
            when connected, or the browser rescue key otherwise.
          </p>
          <button
            type="button"
            onClick={() => void recoverWithBchWallet()}
            disabled={bchBusy}
            className="mt-2 rounded-pill border border-lime/40 bg-transparent px-4 py-1.5 text-xs font-semibold text-lime hover:bg-lime/10 transition-colors disabled:opacity-60"
          >
            {bchBusy ? 'Scanning…' : 'Scan Bitcoin Cash wallet'}
          </button>
          {bchError && (
            <p className="mt-3 text-xs text-warn" role="status">
              {bchError}
            </p>
          )}
          {bchSwaps.length > 0 && (
            <ul className="mt-4 divide-y divide-hairline/60">
              {bchSwaps.map((swap) => (
                <li key={`${swap.txid}-${swap.index}`} className="py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-text">
                      {swap.terms.token} · {swap.terms.tokenAmount.toString()} ·
                      index {swap.index}
                    </span>
                    <span className="text-text-muted">{bchAction(swap)}</span>
                  </div>
                  <div className="mt-1 break-all font-mono text-[10px] text-text-dim">
                    {swap.address}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Upload Well */}
      <div className="mb-6 rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
        <h2 className="text-sm font-semibold text-text mb-2">
          Load Recovery File
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <label className="flex-1 cursor-pointer">
            <div className="flex flex-col items-center justify-center rounded-well border border-dashed border-hairline bg-surface-2/60 p-6 text-center hover:border-lime/50 transition-colors">
              <span className="text-xs font-medium text-text">
                Choose recovery JSON file
              </span>
              <span className="mt-1 text-[11px] text-text-dim">
                or drag and drop here
              </span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </div>
          </label>
        </div>

        {/* Or Paste Raw JSON */}
        <form onSubmit={handlePasteSubmit} className="mt-4">
          <label
            htmlFor="recovery-json"
            className="text-xs text-text-muted block mb-1"
          >
            Or paste recovery file JSON:
          </label>
          <textarea
            id="recovery-json"
            rows={3}
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            placeholder='{"version": 1, "orderId": "0x…", …}'
            className="w-full rounded-well border border-hairline bg-surface-2 p-3 font-mono text-xs text-text placeholder:text-text-dim focus:border-lime focus:outline-none"
          />
          <button
            type="submit"
            className="mt-2 rounded-pill bg-olive px-4 py-1.5 text-xs font-semibold text-text hover:bg-olive/90 transition-colors cursor-pointer"
          >
            Load File
          </button>
        </form>

        {/* Status Alerts */}
        {error && !plan && (
          <div
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger flex items-center justify-between gap-3"
            role="alert"
          >
            <span>{error}</span>
            <CopyDiagnosticsButton
              data={{
                route: ROUTES.recover,
                errorCode: 'RECOVERY_ERROR',
                errorMessage: error,
              }}
            />
          </div>
        )}
        {notice && !plan && (
          <div
            className="mt-4 rounded-lg border border-lime/30 bg-lime/10 p-3 text-xs text-lime"
            role="status"
          >
            {notice}
          </div>
        )}
      </div>

      {/* What is a recovery file explainer panel (Requirement 4) */}
      <div
        data-testid="what-is-recovery-panel"
        className="mb-6 rounded-card border border-hairline bg-surface-1/60 p-5 text-xs shadow-elev-card"
      >
        <div className="flex items-center gap-2 mb-2">
          <InfoIcon className="size-4 text-lime shrink-0" />
          <h2 className="text-sm font-semibold text-text">
            What is a recovery file?
          </h2>
        </div>
        <p className="text-text-muted leading-relaxed">
          A recovery file is a local JSON backup created when you start a swap.
          It holds the contract addresses, lock scripts, refund deadlines and
          secret hash. Ferry is non-custodial: the contracts, not this website
          or any solver, hold your funds, and a refund after the deadline needs
          nobody&apos;s permission.
        </p>
        <p className="mt-2 text-text-muted leading-relaxed">
          <span className="font-medium text-text">
            If this website is down:
          </span>{' '}
          download the standalone recovery page (one file, no installation).
          Open it from your own computer, load your recovery file, and it reads
          the blockchain servers directly, works out what you can do, and sends
          the refund or claim: an EVM transaction through your browser wallet,
          or a Bitcoin Cash transaction that needs no wallet and no signature.
          It needs no part of Ferry to be running. You can also refund on Base
          from the block explorer (Write Contract, then{' '}
          <span className="font-mono">refund</span>) after the deadline.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-dim border-t border-hairline/60 pt-2.5">
          {deployed.map((item) => (
            <a
              key={`${item.chain}-${item.address}`}
              href={`${item.explorerUrl}/address/${item.address}#writeContract`}
              target="_blank"
              rel="noreferrer"
              className="text-lime hover:underline inline-flex items-center gap-1"
            >
              <span>Refund on {item.name} (block explorer)</span>
              <ExternalLinkIcon className="size-3" />
            </a>
          ))}
          <a
            href="/recover.html"
            download="ferry-recover.html"
            data-testid="download-recover-page"
            className="text-lime hover:underline inline-flex items-center gap-1"
          >
            <span>Download the standalone recovery page</span>
          </a>
          <a
            href="https://github.com/deyoungjohn/ferry/blob/main/recover.html"
            target="_blank"
            rel="noreferrer"
            className="text-lime hover:underline inline-flex items-center gap-1"
          >
            <span>Same file on GitHub (works when this site is down)</span>
            <ExternalLinkIcon className="size-3" />
          </a>
          <a
            href="https://github.com/deyoungjohn/ferry/tree/main/packages/recover-cli"
            target="_blank"
            rel="noreferrer"
            className="text-lime hover:underline inline-flex items-center gap-1"
          >
            <span>Command-line tool: @ferry/recover-cli</span>
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>

      {/* File Details & Core recoveryActions Plan (Requirement 3) */}
      {recoveryFile && plan && (
        <div className="rounded-card border border-hairline bg-surface-1 p-5 shadow-elev-card">
          <h2 className="text-sm font-semibold text-text mb-4">
            Recovery Plan & Parameters
          </h2>

          {(() => {
            const isReleased = orderSnapshot?.state === 'RELEASED';
            const isKeeperRefund =
              orderSnapshot?.state === 'SOLVER_REFUNDED' ||
              Boolean(orderSnapshot?.txids?.evmRefund && !isReleased);
            const isForward = recoveryFile?.terms.direction === 'EVM_TO_BCH';
            const refundTxHash = isReleased
              ? isForward
                ? orderSnapshot?.txids?.evmRefund
                : (orderSnapshot?.txids?.bchRefund ??
                  orderSnapshot?.txids?.evmRefund)
              : orderSnapshot?.txids?.evmRefund;
            const refundTxUrl =
              refundTxHash && recoveryFile
                ? isForward
                  ? evmTxUrl(recoveryFile.contracts.evm.chainId, refundTxHash)
                  : bchTxUrl(refundTxHash)
                : null;

            return (
              <>
                {isReleased && (
                  <div
                    data-testid="recovery-released"
                    className="mb-4 rounded-well border border-hairline bg-surface-2 p-3.5 text-xs"
                  >
                    <p className="font-semibold text-text">
                      The solver returned your funds
                    </p>
                    {refundTxUrl && (
                      <a
                        href={refundTxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center text-xs text-lime underline"
                        data-testid="recovery-release-link"
                      >
                        View transaction on block explorer
                      </a>
                    )}
                  </div>
                )}
                {isKeeperRefund && (
                  <div
                    data-testid="recovery-keeper-refunded"
                    className="mb-4 rounded-well border border-hairline bg-surface-2 p-3.5 text-xs"
                  >
                    <p className="font-semibold text-text">
                      Refunded automatically
                    </p>
                    {refundTxUrl && (
                      <a
                        href={refundTxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center text-xs text-lime underline"
                        data-testid="recovery-keeper-link"
                      >
                        View transaction on block explorer
                      </a>
                    )}
                  </div>
                )}

                {/* Core Plan Summary */}
                <div
                  data-testid="recovery-plan-summary"
                  className="mb-4 rounded-well border border-lime/30 bg-lime/10 p-3.5 text-xs text-lime"
                >
                  <span className="font-semibold block text-[11px] uppercase tracking-wider text-text-dim mb-1">
                    Action Plan Summary
                  </span>
                  <p className="font-medium text-sm text-text">
                    {isReleased
                      ? 'The solver returned your funds'
                      : isKeeperRefund
                        ? 'Refunded automatically'
                        : plan.summary}
                  </p>
                </div>
              </>
            );
          })()}

          {/* EVM Wallet Recovery Status (§Requirement 2) */}
          {evmPlan && (
            <div
              data-testid="evm-recovery-plan"
              className="mb-4 rounded-well border border-hairline bg-surface-2 p-3.5 text-xs"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-[11px] uppercase tracking-wider text-text-dim">
                  EVM Contract Status
                </span>
                <span
                  className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                    evmPlan.actions.length > 0
                      ? 'bg-ok/10 text-ok border border-ok/30'
                      : 'bg-surface-3 text-text-muted border border-hairline'
                  }`}
                >
                  {evmPlan.status.toUpperCase()}
                </span>
              </div>
              <p className="text-text font-medium">{evmPlan.summary}</p>
              {evmPlan.secondsRemaining !== undefined &&
                evmPlan.secondsRemaining > 0 && (
                  <p className="mt-1 text-[11px] text-warn">
                    Time to refund deadline:{' '}
                    <span className="font-mono">
                      {formatDuration(evmPlan.secondsRemaining)}
                    </span>
                  </p>
                )}
            </div>
          )}

          {/* Actions & Waits directly from recoveryActions */}
          <div className="mb-4 space-y-2">
            {plan.actions.length > 0 && (
              <div className="rounded-well border border-hairline bg-surface-2 p-3">
                <span className="text-xs font-semibold text-ok uppercase tracking-wider block mb-2">
                  Ready Actions ({plan.actions.length})
                </span>
                <ul className="space-y-1 text-xs">
                  {plan.actions.map((act, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-text"
                    >
                      <span>
                        Chain:{' '}
                        <strong className="text-lime">{act.chain}</strong>
                      </span>
                      <span className="capitalize font-semibold text-ok">
                        {act.action}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.waits.length > 0 && (
              <div className="rounded-well border border-hairline bg-surface-2 p-3">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
                  Conditions to Wait For ({plan.waits.length})
                </span>
                <ul className="space-y-1.5 text-xs">
                  {plan.waits.map((wait, i) => (
                    <li
                      key={i}
                      className="text-text-muted border-l-2 border-warn/40 pl-2"
                    >
                      <span className="font-semibold text-text">
                        [{wait.chain} {wait.action}]:
                      </span>{' '}
                      {wait.waitingFor}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">Order ID</span>
              <span className="font-mono text-text font-medium break-all">
                {recoveryFile.orderId}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">Direction</span>
              <span className="font-medium text-text">
                {recoveryFile.terms.direction === 'EVM_TO_BCH'
                  ? 'EVM Stablecoin → Bitcoin Cash'
                  : 'Bitcoin Cash → EVM Stablecoin'}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">
                EVM HTLC Contract
              </span>
              <span className="font-mono text-text text-[11px] break-all">
                {recoveryFile.contracts.evm.htlcAddress}
              </span>
            </div>
            <div className="rounded-well border border-hairline bg-surface-2 p-3">
              <span className="text-text-dim block mb-1">BCH HTLC Network</span>
              <span className="font-semibold text-text capitalize">
                {recoveryFile.contracts.bch.network}
              </span>
            </div>
            <div className="col-span-full rounded-well border border-hairline bg-surface-2 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-text-dim">Secret Preimage</span>
                {recoveryFile.secret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="text-[11px] text-lime hover:underline cursor-pointer"
                  >
                    {showSecret ? 'Hide' : 'Reveal'}
                  </button>
                )}
              </div>
              <span className="font-mono text-text break-all">
                {recoveryFile.secret
                  ? showSecret
                    ? recoveryFile.secret
                    : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'
                  : 'Not present in this recovery file'}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={!plan.actions.some((a) => a.action === 'claim') || busy}
              onClick={handleClaim}
              className="flex-1 rounded-pill bg-olive py-2.5 text-xs font-semibold text-text hover:bg-olive/90 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Claim Funds with Secret
            </button>
            <button
              type="button"
              disabled={
                !plan.actions.some((a) => a.action === 'refund') || busy
              }
              onClick={handleRefund}
              className="flex-1 rounded-pill border border-hairline bg-surface-3 py-2.5 text-xs font-semibold text-text hover:border-warn/40 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Refund Expired Lock
            </button>
            <button
              type="button"
              onClick={handleViewEvmCalldata}
              className="rounded-pill border border-hairline bg-surface-2 px-3 py-2.5 text-xs font-semibold text-text hover:border-lime/40 transition-colors cursor-pointer"
            >
              Generate Calldata
            </button>
            <button
              type="button"
              data-testid="inspect-evm-button"
              disabled={busy}
              onClick={handleInspectEvmOnChain}
              className="rounded-pill border border-hairline bg-surface-2 px-3 py-2.5 text-xs font-semibold text-text hover:border-lime/40 transition-colors cursor-pointer"
            >
              Verify On-Chain Status
            </button>
          </div>

          {error && (
            <div
              className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
              role="alert"
              data-testid="recover-action-error"
            >
              {error}
            </div>
          )}
          {notice && (
            <div
              className="mt-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn"
              role="status"
            >
              {notice}
            </div>
          )}
          {actionResult && (
            <div
              className="mt-4 break-all rounded-lg border border-ok/30 bg-ok/10 p-3 text-xs text-ok"
              role="status"
              data-testid="recover-action-result"
            >
              {actionResult}
            </div>
          )}

          {evmCalldata && (
            <div className="mt-4 rounded-well border border-hairline bg-surface-2 p-3 text-xs">
              <span className="text-text-dim block mb-1">
                EVM Recovery Calldata
              </span>
              <pre className="font-mono text-[11px] text-text whitespace-pre-wrap break-all overflow-x-auto">
                {evmCalldata}
              </pre>
            </div>
          )}

          {/* CLI Link in plain words */}
          <p className="mt-5 border-t border-hairline/60 pt-3 text-xs text-text-dim">
            Need command-line recovery? You can run the terminal recovery tool{' '}
            <code className="text-text font-mono">@ferry/recover-cli</code> (run{' '}
            <code className="text-lime font-mono">pnpm -w recover</code>) to
            execute directly against public RPC nodes without any Ferry server.
          </p>
        </div>
      )}
    </div>
  );
}
