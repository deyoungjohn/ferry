export interface TxLinkProps {
  readonly label: string;
  readonly hash: string;
  /** Null when no explorer is known: the hash is still shown. */
  readonly url: string | null;
}

/** One transaction: its label and a shortened hash that opens the block explorer. */
export function TxLink({ label, hash, url }: TxLinkProps) {
  const bare = hash.replace(/^0x/i, '');
  const text = `${bare.slice(0, 10)}…${bare.slice(-6)}`;
  return (
    <p className="mt-0.5 text-[11px] text-text-dim">
      {label}:{' '}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="tx-link"
          className="font-mono text-lime underline-offset-2 hover:underline"
        >
          {text} ↗
        </a>
      ) : (
        <span className="font-mono">{text}</span>
      )}
    </p>
  );
}
