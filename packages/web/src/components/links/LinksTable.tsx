import { Link } from 'react-router';

export interface LinkRow {
  readonly id: string;
  /** Where the id leads: the page of the link. */
  readonly href: string;
  readonly amount: string;
  readonly createdAt: number;
  /** When it was paid or claimed; null while it is not. */
  readonly completedAt: number | null;
  readonly status: string;
  readonly tone: 'ok' | 'warn' | 'neutral';
}

export interface LinksTableProps {
  readonly title: string;
  /** Heading of the date column: "Payment date" or "Claim date". */
  readonly completedLabel: string;
  readonly rows: readonly LinkRow[];
  readonly emptyText: string;
  /** Extra action cell content per row (for example "Resume"). */
  readonly renderAction?: ((row: LinkRow) => React.ReactNode) | undefined;
}

function formatDate(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

const TONE: Record<LinkRow['tone'], string> = {
  ok: 'bg-ok/10 text-ok border-ok/20',
  warn: 'bg-warn/10 text-warn border-warn/20',
  neutral: 'bg-surface-3 text-text-muted border-hairline',
};

/** No., id (a link to its page), amount, creation date, payment or claim date, status. */
export function LinksTable({
  title,
  completedLabel,
  rows,
  emptyText,
  renderAction,
}: LinksTableProps) {
  return (
    <section
      className="overflow-hidden rounded-card border border-hairline bg-surface-1 shadow-elev-card"
      data-testid="links-table"
    >
      <h2 className="px-5 pt-4 text-sm font-semibold text-text">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-text-muted">
          {emptyText}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-text-dim">
              <tr className="border-b border-hairline">
                <th scope="col" className="px-5 py-2 font-medium">
                  No.
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  ID
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Created
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {completedLabel}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                {renderAction && <th scope="col" className="px-5 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  data-testid="links-row"
                  className="transition-colors hover:bg-surface-2/40"
                >
                  <td className="px-5 py-3 tabular-nums text-text-dim">
                    {rows.length - index}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      to={row.href}
                      className="font-mono text-lime underline-offset-2 hover:underline"
                    >
                      {row.id}
                    </Link>
                  </td>
                  <td className="px-3 py-3 font-medium tabular-nums text-text">
                    {row.amount}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap tabular-nums text-text-muted">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap tabular-nums text-text-muted">
                    {row.completedAt ? formatDate(row.completedAt) : '–'}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-pill border px-2 py-0.5 text-xs font-medium ${TONE[row.tone]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  {renderAction && (
                    <td className="px-5 py-3 text-right">
                      {renderAction(row)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
