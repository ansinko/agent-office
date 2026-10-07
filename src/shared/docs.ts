// The bookshelf: the project's Markdown files, listed by the office (server/docs.ts) and read in a
// window in the office (features/bookshelf/ui.ts).

/** One Markdown file in the project. */
export interface DocFile {
  /** From the project folder, with forward slashes: "docs/setup.md". */
  path: string;
  /** Its first heading (or front matter title), when it has one near the top. */
  title?: string;
  size: number;
  /** Last modified (on a branch: last committed), ms since epoch. */
  mtime: number;
  /** The floor's bookshelf.json leaves it off the shelf until you filter for it. */
  hidden?: boolean;
}

/**
 * Where the shelf reads the project from: the checkout as it is on disk (ref ""), or a branch as
 * git has it ("origin/main"), so the docs that merged can be read whatever the checkout is on.
 */
export interface DocSource {
  ref: string;
  label: string;
}

/** What GET /api/docs answers: every Markdown file in the floor's project, by path. */
export interface DocList {
  files: DocFile[];
  /** There were more than the office lists. */
  more: boolean;
  /** The one these files are from, and the others it can read from. */
  source: string;
  sources: DocSource[];
  /** The doc bookshelf.json opens first, when it's on the shelf. */
  start?: string;
}

/**
 * How the shelf is laid out, kept with the floor's own data (`.agent-office/bookshelf.json`) rather
 * than in the project, so a project never needs to know about the office.
 */
export const SHELF_CONFIG = 'bookshelf.json';

export interface ShelfConfig {
  /** The doc to open first, rather than the README. */
  start?: string;
  /** Globs of docs to leave off the list (`**` crosses folders, `*` doesn't, a trailing / is a folder). */
  hide: string[];
}

/** bookshelf.json, as far as it makes sense: anything it doesn't say, or says wrong, is left out. */
export function parseShelfConfig(text: string | undefined): ShelfConfig {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : undefined;
  } catch {
    raw = undefined;
  }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const start = typeof o.start === 'string' && isDocPath(o.start.replace(/^\.?\//, '')) ? o.start.replace(/^\.?\//, '') : undefined;
  const hide = Array.isArray(o.hide) ? o.hide.filter((g): g is string => typeof g === 'string' && !!g.trim()).slice(0, 100) : [];
  return { start, hide };
}

/** Whether `p` (from the project folder) matches the glob. A glob without a / matches at any depth. */
export function globMatch(glob: string, p: string): boolean {
  let g = glob.trim().replace(/^\.?\//, '');
  if (g.endsWith('/')) g += '**';
  if (!g.includes('/')) g = `**/${g}`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      // "**/" is any folders, or none; a "**" elsewhere is anything at all.
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(p);
}

/** What GET /api/docs/file answers. */
export interface DocText {
  path: string;
  text: string;
}

/** A file the bookshelf shows: Markdown, by its extension. */
export function isDocPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p) && !/(^|\/)\.\.?(\/|$)/.test(p);
}

/**
 * Where a link in the doc at `from` goes in the project, as a path from the project folder, with any
 * #anchor apart: "../README.md#setup" from "docs/a.md" is { path: "README.md", hash: "setup" }. A link
 * starting with / is from the project folder, as on GitHub. Undefined for links elsewhere (another
 * site, mailto:…) or out of the project.
 */
export function resolveDocLink(from: string, href: string): { path: string; hash: string } | undefined {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt + 1) : '';
  let rel = (hashAt >= 0 ? href.slice(0, hashAt) : href).replace(/\?.*$/, '');
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return undefined;
  }
  // Just an anchor: somewhere in this same doc.
  if (!rel) return { path: from, hash };
  const parts = rel.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? { path: parts.join('/'), hash } : undefined;
}
