import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { ArrowLeft, ArrowRight, Menu, Search, X } from 'lucide-react';
import {
  Markdown,
  headingsOf,
  textOf,
  type DocHeading,
} from '../docs/markdown';
import {
  DOCS_HOME,
  DOC_GROUPS,
  DOC_PAGES,
  pageOf,
  sourceOf,
  type DocPage,
} from '../docs/pages';
import { ROUTES } from '../lib/routes';

interface SearchHit {
  readonly page: DocPage;
  readonly heading: DocHeading | null;
  readonly score: number;
}

function useSearchIndex() {
  return useMemo(
    () =>
      DOC_PAGES.map((page) => {
        const source = sourceOf(page.slug) ?? '';
        return {
          page,
          headings: headingsOf(source),
          text: textOf(source).toLowerCase(),
        };
      }),
    [],
  );
}

function search(
  index: ReturnType<typeof useSearchIndex>,
  query: string,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const hits: SearchHit[] = [];
  for (const entry of index) {
    const title = entry.page.title.toLowerCase();
    if (words.every((w) => title.includes(w))) {
      hits.push({ page: entry.page, heading: null, score: 100 });
    }
    for (const h of entry.headings) {
      if (words.every((w) => h.text.toLowerCase().includes(w))) {
        hits.push({ page: entry.page, heading: h, score: 60 });
      }
    }
    if (
      !hits.some((h) => h.page === entry.page) &&
      words.every((w) => entry.text.includes(w))
    ) {
      hits.push({ page: entry.page, heading: null, score: 20 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

function SearchBox() {
  const index = useSearchIndex();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(index, query), [index, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (hit: SearchHit) => {
    navigate(
      `/docs/${hit.page.slug}${hit.heading ? `#${hit.heading.id}` : ''}`,
    );
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-full max-w-md">
      <label className="flex h-10 items-center gap-2.5 rounded-xl border border-hairline bg-surface-1/80 px-3 text-text-muted transition-colors focus-within:border-lime/40">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="sr-only">Search the docs</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) go(hits[0]);
            if (e.key === 'Escape') {
              setQuery('');
              inputRef.current?.blur();
            }
          }}
          placeholder="Search…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted"
        />
        <kbd className="hidden rounded-md border border-hairline px-1.5 py-0.5 text-[11px] text-text-dim sm:block">
          Ctrl K
        </kbd>
      </label>
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-hairline bg-surface-1 shadow-elev-card">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-[14px] text-text-muted">No results</p>
          ) : (
            <ul>
              {hits.map((hit, i) => (
                <li key={`${hit.page.slug}-${hit.heading?.id ?? ''}-${i}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(hit)}
                    className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-lime/[0.06]"
                  >
                    <span className="block text-[14px] font-medium text-text">
                      {hit.heading ? hit.heading.text : hit.page.title}
                    </span>
                    <span className="block text-[12.5px] text-text-muted">
                      {hit.heading ? hit.page.title : hit.page.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Docs" className="space-y-7">
      {DOC_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-2 px-3 text-[12px] font-semibold tracking-wide text-text-dim">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.pages.map((p) => {
              const active = p.slug === slug;
              return (
                <li key={p.slug}>
                  <Link
                    to={`/docs/${p.slug}`}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-lg px-3 py-[7px] text-[14px] transition-colors ${
                      active
                        ? 'bg-lime/[0.09] font-medium text-lime'
                        : 'text-text-muted hover:bg-white/[0.03] hover:text-text'
                    }`}
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function OnThisPage({ headings }: { headings: readonly DocHeading[] }) {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);
  useEffect(() => {
    setActive(headings[0]?.id ?? null);
    if (typeof IntersectionObserver === 'undefined') return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;
  return (
    <nav aria-label="On this page">
      <p className="mb-3 px-3 text-[12px] font-semibold tracking-wide text-text-dim">
        On this page
      </p>
      <ul className="space-y-0.5">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`block rounded-lg py-1.5 pr-3 text-[13.5px] transition-colors ${
                h.level === 3 ? 'pl-6' : 'pl-3'
              } ${
                active === h.id
                  ? 'bg-lime/[0.09] text-lime'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocsPage() {
  const params = useParams();
  const slug = params.slug ?? DOCS_HOME;
  const { hash } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const page = pageOf(slug);
  const source = page ? sourceOf(page.slug) : null;
  const headings = useMemo(() => (source ? headingsOf(source) : []), [source]);

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [slug, hash]);

  if (!page || source === null)
    return <Navigate to={`/docs/${DOCS_HOME}`} replace />;

  const at = DOC_PAGES.findIndex((p) => p.slug === page.slug);
  const prev = at > 0 ? DOC_PAGES[at - 1] : null;
  const next = at < DOC_PAGES.length - 1 ? DOC_PAGES[at + 1] : null;
  const group = DOC_GROUPS.find((g) => g.pages.includes(page));

  return (
    <div className="relative min-h-screen bg-bg text-text">
      {/* The accent's only large use: a faint lime light from the top of the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-[560px] bg-[radial-gradient(900px_420px_at_22%_-8%,rgba(198,242,25,0.075),transparent_70%),radial-gradient(700px_380px_at_88%_-12%,rgba(198,242,25,0.04),transparent_70%)]"
      />
      <header className="sticky top-0 z-40 border-b border-hairline bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-text-muted hover:text-text lg:hidden"
            aria-label="Open the docs menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="Ferry home"
          >
            <img src="/brand/ferry.svg" alt="" className="h-6 w-6" />
            <span className="text-[16px] font-semibold tracking-tight">
              Ferry
            </span>
            <span className="hidden rounded-md border border-hairline px-1.5 py-0.5 text-[11.5px] text-text-muted sm:inline">
              Docs
            </span>
          </Link>
          <div className="flex min-w-0 flex-1 justify-center">
            <SearchBox />
          </div>
          <Link
            to={ROUTES.swap}
            className="hidden shrink-0 rounded-pill bg-lime px-4 py-2 text-[13.5px] font-semibold text-lime-ink transition-opacity hover:opacity-90 sm:block"
          >
            Open Ferry
          </Link>
        </div>
      </header>

      {menuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close the docs menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[290px] overflow-y-auto border-r border-hairline bg-surface-1 p-4">
            <div className="mb-5 flex items-center justify-between">
              <span className="px-3 text-[14px] font-semibold">Ferry docs</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-2 text-text-muted hover:text-text"
                aria-label="Close the docs menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Sidebar slug={page.slug} onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="relative mx-auto flex max-w-[1440px] gap-10 px-4 sm:px-6">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[260px] shrink-0 overflow-y-auto py-8 lg:block">
          <Sidebar slug={page.slug} />
        </aside>

        <main className="min-w-0 flex-1 py-10 lg:py-12">
          <article className="mx-auto max-w-[760px]">
            {group && (
              <p className="mb-3 text-[13px] font-medium text-lime">
                {group.title}
              </p>
            )}
            <Markdown source={source} />

            <div className="mt-16 grid gap-3 border-t border-hairline pt-8 sm:grid-cols-2">
              {prev ? (
                <Link
                  to={`/docs/${prev.slug}`}
                  className="group rounded-2xl border border-hairline px-5 py-4 transition-colors hover:border-lime/30"
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] text-text-muted">
                    <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />{' '}
                    Previous
                  </span>
                  <span className="mt-1 block font-medium text-text group-hover:text-lime">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to={`/docs/${next.slug}`}
                  className="group rounded-2xl border border-hairline px-5 py-4 text-right transition-colors hover:border-lime/30"
                >
                  <span className="flex items-center justify-end gap-1.5 text-[12.5px] text-text-muted">
                    Next{' '}
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                  <span className="mt-1 block font-medium text-text group-hover:text-lime">
                    {next.title}
                  </span>
                </Link>
              )}
            </div>
          </article>
        </main>

        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[240px] shrink-0 overflow-y-auto py-12 xl:block">
          <OnThisPage key={page.slug} headings={headings} />
        </aside>
      </div>
    </div>
  );
}
