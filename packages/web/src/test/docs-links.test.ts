import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headingsOf } from '../docs/markdown';
import { DOC_PAGES, sourceOf } from '../docs/pages';

const SRC = join(__dirname, '..');

function anchorsOf(slug: string): Set<string> {
  return new Set(headingsOf(sourceOf(slug) ?? '').map((h) => h.id));
}

/** Throws a readable error when `/docs/<slug>#<anchor>` does not exist. */
function check(link: string, from: string): string | null {
  const m = /^\/docs(?:\/([a-z0-9-]+))?(?:#([a-z0-9-]+))?$/.exec(link);
  if (!m) return `${from}: malformed docs link ${link}`;
  const slug = m[1] ?? 'welcome';
  if (!DOC_PAGES.some((p) => p.slug === slug))
    return `${from}: no docs page ${slug}`;
  if (m[2] && !anchorsOf(slug).has(m[2]))
    return `${from}: no section #${m[2]} on ${slug}`;
  return null;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : walk(path);
    return /\.(tsx?|md)$/.test(name) ? [path] : [];
  });
}

describe('docs links', () => {
  it('every page in the sidebar has content and a title heading', () => {
    for (const page of DOC_PAGES) {
      const source = sourceOf(page.slug);
      expect(source, page.slug).toBeTruthy();
      expect(source!.startsWith('# '), page.slug).toBe(true);
    }
  });

  it('every link to /docs, in the docs and anywhere on the site, reaches a page and section', () => {
    const problems: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /["'(`](\/docs(?:\/[a-z0-9-]+)?(?:#[a-z0-9-]+)?)["')`]/g,
      )) {
        const problem = check(m[1]!, file.slice(SRC.length + 1));
        if (problem) problems.push(problem);
      }
    }
    expect(problems).toEqual([]);
  });

  it('internal links in the docs point at app routes that exist', () => {
    const known = [
      '/',
      '/app/swap',
      '/app/pay-link',
      '/app/pay-link?type=send',
      '/app/my-activity',
      '/app/recover',
      '/status',
      '/recover.html',
    ];
    const problems: string[] = [];
    for (const page of DOC_PAGES) {
      for (const m of (sourceOf(page.slug) ?? '').matchAll(
        /\]\((\/[^)\s]*)\)/g,
      )) {
        const link = m[1]!;
        if (link.startsWith('/docs')) continue;
        if (!known.includes(link)) problems.push(`${page.slug}: ${link}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
