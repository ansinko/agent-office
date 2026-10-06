import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PAGES, LOGIN_MAX, MAX_PAGES, PAGE_NAME_MAX, ROTATE_CHOICES, checkScreenUrl, screenHost } from '../../shared/appscreen.js';
import type { AppScreenLogin } from '../../shared/protocol.js';

/** A saved page, with the sign-in its snapshots use. */
export interface SavedPage {
  id: string;
  name: string;
  url: string;
  login?: AppScreenLogin;
}

/** What's saved: the pages, which is up and who put it there, and how long each stays up. */
interface Saved {
  pages: SavedPage[];
  current?: string;
  by?: string;
  at?: number;
  rotate: number;
}

/** One cookie of a pasted Cookie header. */
export interface CookiePair {
  name: string;
  value: string;
}

/** "a=1; b=2" -> its cookies, skipping anything that isn't name=value. */
export function parseCookieHeader(header: string): CookiePair[] {
  const out: CookiePair[] = [];
  for (const part of header.replace(/^cookie:\s*/i, '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) out.push({ name, value });
  }
  return out;
}

/** Tidies a sign-in from a browser: a cookie, or a name and password; a string says why it won't do. */
export function checkLogin(raw: unknown): AppScreenLogin | string {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim() : '');
  const cookie = text(o.cookie);
  const user = text(o.user);
  const password = typeof o.password === 'string' ? o.password : '';
  if ([cookie, user, password].some((v) => v.length > LOGIN_MAX)) return 'That sign-in is too long';
  if (cookie) return parseCookieHeader(cookie).length ? { cookie } : 'Paste the cookie as name=value (several separated by ;)';
  if (user && password) return { user, password };
  return 'Give the snapshots a cookie, or a name and a password';
}

const newId = () => randomBytes(4).toString('hex');

/**
 * The screen's saved pages from a browser, in their order, keeping each one's sign-in by its id: or
 * why they won't do.
 */
export function checkPages(raw: unknown, old: readonly SavedPage[]): SavedPage[] | string {
  if (!Array.isArray(raw)) return 'Send the list of pages';
  if (raw.length > MAX_PAGES) return `The screen keeps ${MAX_PAGES} pages at most`;
  const out: SavedPage[] = [];
  for (const item of raw) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const url = checkScreenUrl(o.url);
    if ('error' in url) return url.error;
    const name = (typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim() : '').slice(0, PAGE_NAME_MAX) || screenHost(url.url);
    const was = typeof o.id === 'string' ? old.find((p) => p.id === o.id) : undefined;
    // A page whose address changed keeps its id but not its sign-in, which was for another site.
    const login = was && was.url === url.url ? was.login : undefined;
    if (was && out.some((p) => p.id === was.id)) return 'A page is in the list twice';
    out.push({ id: was?.id ?? newId(), name, url: url.url, ...(login ? { login } : {}) });
  }
  return out;
}

/**
 * The screen's pages and what's up, kept in .agent-office/app-screen.json. Only the office reads the
 * sign-ins: the file is the office user's alone.
 */
export class AppScreenConfig {
  private saved: Saved;
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'app-screen.json');
    const loaded = this.load();
    this.saved = loaded ?? { pages: DEFAULT_PAGES.map((p) => ({ id: newId(), ...p })), rotate: 0 };
    this.saved.current ??= this.saved.pages[0]?.id;
    // The defaults keep their ids from now on, which windows and snapshots go by.
    if (!loaded) this.save();
  }

  get pages(): readonly SavedPage[] {
    return this.saved.pages;
  }

  get rotate(): number {
    return this.saved.rotate;
  }

  /** The page up now, and who put it there when. */
  get current(): SavedPage | undefined {
    return this.saved.pages.find((p) => p.id === this.saved.current);
  }

  get shown(): { by?: string; at?: number } {
    return { by: this.saved.by, at: this.saved.at };
  }

  page(id: string): SavedPage | undefined {
    return this.saved.pages.find((p) => p.id === id);
  }

  /** Puts page `id` up; false when there's no such page. */
  show(id: string, by: string): boolean {
    if (!this.page(id)) return false;
    this.saved = { ...this.saved, current: id, by, at: Date.now() };
    this.save();
    return true;
  }

  /** Puts `url` up, saving it as a page first if it isn't one (--meeting-screen-url). */
  showUrl(raw: unknown, by: string): string | undefined {
    const url = checkScreenUrl(raw);
    if ('error' in url) return url.error;
    let page = this.saved.pages.find((p) => p.url === url.url);
    if (!page) {
      if (this.saved.pages.length >= MAX_PAGES) return `The screen keeps ${MAX_PAGES} pages at most`;
      page = { id: newId(), name: screenHost(url.url), url: url.url };
      this.saved.pages.push(page);
    }
    this.show(page.id, by);
  }

  /**
   * Puts up the page at `path` on saved page `from`'s site, saving it first when it isn't one, named
   * after the site's first saved page and signed in the way `from` is. A string says why it can't.
   */
  pin(from: string, path: unknown, by: string): string | undefined {
    const source = this.page(from);
    if (!source) return 'That page isn’t on the screen’s list any more';
    const origin = new URL(source.url).origin;
    let target: URL;
    try {
      target = new URL(typeof path === 'string' && path.startsWith('/') ? path : '//', source.url);
    } catch {
      return 'That isn’t a page on the same site';
    }
    if (target.origin !== origin) return 'That isn’t a page on the same site';
    const url = checkScreenUrl(target.href);
    if ('error' in url) return url.error;
    let page = this.saved.pages.find((p) => p.url === url.url);
    if (!page) {
      if (this.saved.pages.length >= MAX_PAGES) return `The screen keeps ${MAX_PAGES} pages at most`;
      const site = this.saved.pages.find((p) => new URL(p.url).origin === origin) ?? source;
      const where = new URL(url.url);
      page = { id: newId(), name: `${site.name} ${where.pathname}${where.search}`.slice(0, PAGE_NAME_MAX), url: url.url, ...(source.login ? { login: { ...source.login } } : {}) };
      this.saved.pages.push(page);
    }
    this.show(page.id, by);
  }

  /** Replaces the saved pages; the one up stays up if it's still there, else the first goes up. */
  setPages(raw: unknown, by: string): string | undefined {
    const pages = checkPages(raw, this.saved.pages);
    if (typeof pages === 'string') return pages;
    const kept = pages.some((p) => p.id === this.saved.current);
    this.saved = kept ? { ...this.saved, pages } : { ...this.saved, pages, current: pages[0]?.id, by, at: Date.now() };
    this.save();
  }

  /** How page `id`'s snapshots sign in; null forgets it. A string says why it won't do. */
  setLogin(id: string, raw: unknown): string | undefined {
    const page = this.page(id);
    if (!page) return 'There’s no such page on the screen';
    if (raw === null) delete page.login;
    else {
      const login = checkLogin(raw);
      if (typeof login === 'string') return login;
      page.login = login;
    }
    this.save();
  }

  setRotate(every: unknown): string | undefined {
    if (!ROTATE_CHOICES.includes(every as (typeof ROTATE_CHOICES)[number])) return 'Pick how long each page stays up from the list';
    this.saved.rotate = every as number;
    this.save();
  }

  private load(): Saved | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const pages = checkPages(Array.isArray(s.pages) ? s.pages : [], []);
      const list = typeof pages === 'string' ? [] : pages;
      // Ids and sign-ins as they were saved: checkPages makes new ones for pages it doesn't know.
      (Array.isArray(s.pages) ? s.pages : []).forEach((p, i) => {
        if (!list[i] || !p || typeof p.id !== 'string' || !/^[0-9a-f]{1,32}$/.test(p.id)) return;
        list[i].id = p.id;
        const login = p.login === undefined ? undefined : checkLogin(p.login);
        if (typeof login === 'object') list[i].login = login;
      });
      return {
        pages: list,
        current: typeof s.current === 'string' ? s.current : undefined,
        by: typeof s.by === 'string' ? s.by : undefined,
        at: typeof s.at === 'number' ? s.at : undefined,
        rotate: ROTATE_CHOICES.includes(s.rotate as (typeof ROTATE_CHOICES)[number]) ? (s.rotate as number) : 0,
      };
    } catch {
      return undefined;
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
      // A file made before by someone else's umask keeps its mode through a write.
      chmodSync(this.file, 0o600);
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
