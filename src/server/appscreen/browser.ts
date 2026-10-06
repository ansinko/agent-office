import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import { SHOT_HEIGHT, SHOT_WIDTH } from '../../shared/appscreen.js';
import type { AppScreenLogin } from '../../shared/protocol.js';
import { parseCookieHeader } from './config.js';
import type { ShotResult } from './snapshots.js';

const LOAD_TIMEOUT_MS = 20_000;
/** How long a page may keep fetching after it loads before it's snapshotted as it is. */
const SETTLE_MS = 4_000;

/** Where Playwright keeps the browsers it downloads (`npx playwright install`). */
function browsersDir(env: NodeJS.ProcessEnv): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA ?? os.homedir(), 'ms-playwright');
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

/**
 * The Chromium builds Playwright downloaded, newest first: they still run when they aren't the build
 * this playwright-core expects, which it would otherwise refuse to start.
 */
export function downloadedChromiums(dir: string, exists = existsSync, list = (d: string) => readdirSync(d)): string[] {
  let names: string[];
  try {
    names = list(dir);
  } catch {
    return [];
  }
  const builds = names
    .map((name) => /^(chromium_headless_shell|chromium)-(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => !!m)
    // Newest first, and of one build the headless shell, which is lighter, first.
    .sort((a, b) => Number(b[2]) - Number(a[2]) || (a[1] === 'chromium' ? 1 : 0) - (b[1] === 'chromium' ? 1 : 0));
  const out: string[] = [];
  for (const [name, kind] of builds) {
    const candidates =
      kind === 'chromium'
        ? ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe']
        : ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-win64/chrome-headless-shell.exe'];
    for (const c of candidates) {
      const file = path.join(dir, name, c);
      if (exists(file)) out.push(file);
    }
  }
  return out;
}

/**
 * Why a page won't be framed by the office, from the headers it was served with: X-Frame-Options, or
 * a Content-Security-Policy whose frame-ancestors don't take any https page.
 */
export function framingBlock(headers: Record<string, string>): string | undefined {
  const xfo = (headers['x-frame-options'] ?? '').trim().toLowerCase();
  if (xfo && xfo !== 'allowall') return 'It doesn’t let other sites show it in a frame (X-Frame-Options).';
  for (const policy of (headers['content-security-policy'] ?? '').split(/[\n,]/)) {
    const m = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(policy);
    if (!m) continue;
    const sources = m[1].trim().split(/\s+/);
    if (!sources.some((src) => src === '*' || src === 'https:' || src === 'https://*')) return 'It doesn’t let other sites show it in a frame (Content-Security-Policy).';
  }
  return undefined;
}

/**
 * The headless browser the screen is snapshotted in. It's started the first time it's needed and
 * kept between snapshots, with a context per page (so each keeps its own sign-in), until close().
 */
export class HeadlessBrowser {
  private browser?: Promise<Browser>;
  private contexts = new Map<string, Promise<BrowserContext>>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** Snapshots page `key` at `url`, signed in with `login`. */
  async capture(key: string, url: string, login: AppScreenLogin | undefined): Promise<ShotResult> {
    let context = this.contexts.get(key);
    if (!context) {
      context = this.newContext(url, login);
      this.contexts.set(key, context);
      context.catch(() => this.contexts.delete(key));
    }
    const page = await (await context).newPage();
    try {
      let response = await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
      if (login?.user && login.password) {
        const password = page.locator('input[type=password]:visible').first();
        if (await password.count()) {
          const name = page.locator('input[type=email]:visible, input[type=text]:visible, input:not([type]):visible').first();
          if (await name.count()) await name.fill(login.user);
          await password.fill(login.password);
          await Promise.all([page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => {}), password.press('Enter')]);
          await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {});
          if (page.url() !== url) response = await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        }
      }
      await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {});
      const blocked = response ? framingBlock(await response.allHeaders()) : undefined;
      return { body: await page.screenshot({ type: 'jpeg', quality: 80 }), blocked };
    } catch (err) {
      return { error: shortError(err as Error, url) };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Page `key` or its sign-in changed: its next snapshot starts with no cookies but the ones it's given. */
  forget(key: string): void {
    const old = this.contexts.get(key);
    this.contexts.delete(key);
    void old?.then((c) => c.close()).catch(() => {});
  }

  async close(): Promise<void> {
    const old = this.browser;
    this.browser = undefined;
    this.contexts.clear();
    await old?.then((b) => b.close()).catch(() => {});
  }

  private async newContext(url: string, login: AppScreenLogin | undefined): Promise<BrowserContext> {
    const browser = await (this.browser ??= this.launch());
    const context = await browser.newContext({ viewport: { width: SHOT_WIDTH, height: SHOT_HEIGHT }, ignoreHTTPSErrors: true });
    if (login?.cookie) await context.addCookies(parseCookieHeader(login.cookie).map((c) => ({ ...c, url: new URL(url).origin })));
    return context;
  }

  /** $AGENT_OFFICE_CHROMIUM, else Playwright's own Chromium, else any other build it downloaded. */
  private async launch(): Promise<Browser> {
    let chromium: typeof import('playwright-core').chromium;
    try {
      ({ chromium } = await import('playwright-core'));
    } catch {
      this.browser = undefined;
      throw new Error('The snapshots need playwright-core: run npm install in the office');
    }
    const own = this.env.AGENT_OFFICE_CHROMIUM;
    const tries = own ? [own] : [undefined, ...downloadedChromiums(browsersDir(this.env))];
    let last: Error | undefined;
    for (const executablePath of tries) {
      try {
        const browser = await chromium.launch({ headless: true, executablePath });
        browser.on('disconnected', () => {
          if (this.browser) void this.close();
        });
        return browser;
      } catch (err) {
        last = err as Error;
      }
    }
    this.browser = undefined;
    throw new Error(`No headless Chromium to take snapshots with: run npx playwright install chromium-headless-shell, or set AGENT_OFFICE_CHROMIUM${last ? ` (${firstLine(last.message)})` : ''}`);
  }
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim().slice(0, 200) ?? s;

/** Playwright's errors are pages long: the gist, for the screen and the window. */
function shortError(err: Error, url: string): string {
  const msg = err.message ?? '';
  const host = new URL(url).host;
  if (/ERR_CONNECTION_REFUSED/.test(msg)) return `Nothing is answering at ${host}`;
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) return `There's no ${host}`;
  if (err.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(msg)) return `${host} took too long to load`;
  return firstLine(msg.replace(/^page\.\w+:\s*/, ''));
}
