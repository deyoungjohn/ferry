import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, ChevronRight, Info, TriangleAlert } from 'lucide-react';

/**
 * A small Markdown renderer for the docs. It builds React elements directly (no HTML strings),
 * so page text can never inject markup. Supported: #/##/### headings, paragraphs, - and 1. lists
 * (one nested level with two spaces), fenced code, tables, > callouts (> **Note:** or
 * > **Warning:**), ::: cards blocks of "- [Title](/link): description" items, and inline
 * `code`, **bold** and [links](url).
 */

export interface DocHeading {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function plain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** Headings (## and ###) of a page, in order, for the "On this page" list. */
export function headingsOf(source: string): DocHeading[] {
  const out: DocHeading[] = [];
  let inCode = false;
  for (const line of source.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    if (inCode) continue;
    const m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) {
      const text = plain(m[2]!.trim());
      out.push({ id: slugify(text), text, level: m[1]!.length as 2 | 3 });
    }
  }
  return out;
}

/** Plain text of a page for search. */
export function textOf(source: string): string {
  return plain(
    source.replace(/```[\s\S]*?```/g, ' ').replace(/[#>|:*-]/g, ' '),
  );
}

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

export function DocLink({
  href,
  children,
  className,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const cls =
    className ??
    'font-medium text-lime underline decoration-lime/30 underline-offset-4 transition-colors hover:decoration-lime';
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
        <ArrowUpRight
          aria-hidden="true"
          className="ml-0.5 inline h-3.5 w-3.5 align-[-2px]"
        />
      </a>
    );
  }
  if (href.startsWith('#')) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  // Paths outside the single-page app (recover.html) load as files.
  if (href.endsWith('.html')) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={cls}>
      {children}
    </Link>
  );
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

export function inline(text: string): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code
          key={i}
          className="rounded-md border border-hairline bg-surface-2 px-1.5 py-0.5 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[0.86em] text-text"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-text">
          {inline(part.slice(2, -2))}
        </strong>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <DocLink key={i} href={link[2]!}>
          {inline(link[1]!)}
        </DocLink>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: { text: string; sub: string[] }[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'callout'; tone: 'note' | 'warning'; text: string }
  | { kind: 'cards'; items: { title: string; href: string; text: string }[] };

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```'))
        body.push(lines[i++]!);
      i++;
      blocks.push({ kind: 'code', lang, text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({
        kind: 'h',
        level: h[1]!.length as 1 | 2 | 3,
        text: h[2]!.trim(),
      });
      i++;
      continue;
    }
    if (line.trim() === '::: cards') {
      const items: { title: string; href: string; text: string }[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ':::') {
        const m = /^-\s+\[([^\]]+)\]\(([^)\s]+)\):?\s*(.*)$/.exec(
          lines[i]!.trim(),
        );
        if (m) items.push({ title: m[1]!, href: m[2]!, text: m[3] ?? '' });
        i++;
      }
      i++;
      blocks.push({ kind: 'cards', items });
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        body.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      let text = body.join(' ').trim();
      let tone: 'note' | 'warning' = 'note';
      const lead = /^\*\*(Note|Warning):\*\*\s*/i.exec(text);
      if (lead) {
        tone = lead[1]!.toLowerCase() === 'warning' ? 'warning' : 'note';
        text = text.slice(lead[0].length);
      }
      blocks.push({ kind: 'callout', tone, text });
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(cells(lines[i]!));
        i++;
      }
      const [head, sep, ...rest] = rows;
      const hasSep = sep?.every((c) => /^:?-{2,}:?$/.test(c));
      blocks.push({
        kind: 'table',
        head: head ?? [],
        rows: hasSep ? rest : [sep ?? [], ...rest].filter((r) => r.length),
      });
      continue;
    }
    const li = /^(-|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = li[1] !== '-';
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length) {
        const cur = lines[i]!;
        const top = /^(-|\d+\.)\s+(.*)$/.exec(cur);
        const sub = /^\s{2,}(-|\d+\.)\s+(.*)$/.exec(cur);
        if (top && (top[1] !== '-') === ordered) {
          items.push({ text: top[2]!, sub: [] });
        } else if (sub && items.length) {
          items[items.length - 1]!.sub.push(sub[2]!);
        } else if (/^\s{2,}\S/.test(cur) && items.length) {
          items[items.length - 1]!.text += ` ${cur.trim()}`;
        } else break;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,3}\s|```|>|\||-\s|\d+\.\s|::: )/.test(lines[i]!)
    ) {
      para.push(lines[i]!.trim());
      i++;
    }
    blocks.push({ kind: 'p', text: para.join(' ') });
  }
  return blocks;
}

function Heading({ level, text }: { level: 1 | 2 | 3; text: string }) {
  const id = slugify(plain(text));
  if (level === 1) {
    return (
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] text-text sm:text-[40px]">
        {inline(text)}
      </h1>
    );
  }
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <Tag
      id={id}
      className={
        level === 2
          ? 'group mt-14 scroll-mt-24 text-[26px] font-semibold tracking-[-0.02em] text-text'
          : 'group mt-9 scroll-mt-24 text-[19px] font-semibold tracking-[-0.01em] text-text'
      }
    >
      {inline(text)}
      <a
        href={`#${id}`}
        aria-label={`Link to ${plain(text)}`}
        className="ml-2 text-text-dim opacity-0 transition-opacity hover:text-lime group-hover:opacity-100"
      >
        #
      </a>
    </Tag>
  );
}

export function Markdown({ source }: { readonly source: string }) {
  const blocks = parse(source);
  return (
    <div className="docs-prose text-[15.5px] leading-[1.75] text-text/85">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return <Heading key={i} level={b.level} text={b.text} />;
          case 'p':
            return (
              <p key={i} className="mt-5">
                {inline(b.text)}
              </p>
            );
          case 'code':
            return (
              <pre
                key={i}
                className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-surface-1 p-4 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[13px] leading-relaxed text-text/90"
              >
                <code>{b.text}</code>
              </pre>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={i}
                className={`mt-5 space-y-2 pl-6 marker:text-text-dim ${b.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {b.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    {inline(item.text)}
                    {item.sub.length > 0 && (
                      <ul className="mt-2 list-[circle] space-y-1.5 pl-5 marker:text-text-dim">
                        {item.sub.map((s, k) => (
                          <li key={k}>{inline(s)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div
                key={i}
                className="mt-6 overflow-x-auto rounded-2xl border border-hairline"
              >
                <table className="w-full border-collapse text-left text-[14px]">
                  <thead className="bg-surface-1">
                    <tr>
                      {b.head.map((c, j) => (
                        <th
                          key={j}
                          className="whitespace-nowrap border-b border-hairline px-4 py-3 font-semibold text-text"
                        >
                          {inline(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr
                        key={j}
                        className="border-b border-hairline last:border-0"
                      >
                        {r.map((c, k) => (
                          <td
                            key={k}
                            className="px-4 py-3 align-top text-text/80"
                          >
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'callout': {
            const Icon = b.tone === 'warning' ? TriangleAlert : Info;
            return (
              <div
                key={i}
                className={`mt-6 flex gap-3 rounded-2xl border px-4 py-3.5 text-[14.5px] leading-relaxed ${
                  b.tone === 'warning'
                    ? 'border-warn/25 bg-warn/[0.06]'
                    : 'border-hairline bg-surface-1'
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className={`mt-[3px] h-4 w-4 shrink-0 ${b.tone === 'warning' ? 'text-warn' : 'text-text-muted'}`}
                />
                <div className="text-text/85">{inline(b.text)}</div>
              </div>
            );
          }
          case 'cards':
            return (
              <div key={i} className="mt-6 grid gap-3">
                {b.items.map((c, j) => (
                  <DocLink
                    key={j}
                    href={c.href}
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-surface-1/60 px-5 py-4 transition-colors hover:border-lime/30 hover:bg-lime/[0.04]"
                  >
                    <span>
                      <span className="block font-medium text-text">
                        {c.title}
                      </span>
                      {c.text && (
                        <span className="mt-0.5 block text-[14px] text-text-muted">
                          {c.text}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-text-dim transition-colors group-hover:text-lime"
                    />
                  </DocLink>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
}
