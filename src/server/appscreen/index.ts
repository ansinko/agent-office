import http from 'node:http';
import https from 'node:https';
import { screenView } from '../../shared/appscreen.js';
import type { AppScreenLogin, AppScreenState, ScreenPage } from '../../shared/protocol.js';
import { AppScreenConfig } from './config.js';
import { HeadlessBrowser } from './browser.js';
import { proxyHandler, proxyUpgrade } from './proxy.js';
import { Snapshots, type ShotResult } from './snapshots.js';

export interface AppScreenOptions {
  dataDir: string;
  /** --meeting-screen-url: saved as a page if it isn't one, and put up at every start. */
  url?: string;
  /** Where 'proxy' pages' windows are served (see proxy.ts): the office's address, on a port of its own. */
  host: string;
  port: number;
  tls?: { cert: string; key: string };
  /** Whether the request comes from someone signed in to the office. */
  signedIn(req: http.IncomingMessage): boolean;
  /** Whether anyone is on a floor that has the screen, to see it. */
  active(): boolean;
  /** Tells everyone what's on the screen now. */
  changed(state: AppScreenState): void;
  /** Takes a snapshot (tests); the headless browser otherwise. */
  capture?(key: string, url: string, login: AppScreenLogin | undefined): Promise<ShotResult>;
  now?(): number;
}

/** A page's latest snapshot, and what the browser learned taking it. */
interface Shot {
  body?: Buffer;
  at?: number;
  /** Why it won't be framed, from the headers it came with. */
  blocked?: string;
  error?: string;
}

/**
 * The screen in the meeting room: its saved pages and the one that's up (app-screen.json), their
 * turns when they take them, their snapshots, and the port 'proxy' pages are served on.
 */
export class AppScreen {
  readonly config: AppScreenConfig;
  private readonly browser = new HeadlessBrowser();
  private readonly snapshots: Snapshots;
  private readonly shots = new Map<string, Shot>();
  /** When the page that's up went up, for its turn. */
  private shownAt: number;
  private server?: http.Server;
  private listening = false;
  private proxyError?: string;
  private timer?: NodeJS.Timeout;
  private readonly now: () => number;

  constructor(private readonly opts: AppScreenOptions) {
    this.now = opts.now ?? Date.now;
    this.shownAt = this.now();
    this.config = new AppScreenConfig(opts.dataDir);
    if (opts.url) {
      const err = this.config.showUrl(opts.url, 'the command line');
      if (err) console.error(`agent-office: --meeting-screen-url: ${err}`);
    }
    const capture = opts.capture ?? ((key, url, login) => this.browser.capture(key, url, login));
    this.snapshots = new Snapshots({
      url: () => this.config.current?.url ?? '',
      active: opts.active,
      capture: (url) => {
        const page = this.config.current!;
        return capture(page.id, url, page.login);
      },
      done: (result, at) => this.done(result, at),
      idle: () => void this.browser.close(),
      now: this.now,
    });
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.serve();
  }

  stop(): void {
    clearInterval(this.timer);
    this.server?.close();
    this.server = undefined;
    void this.browser.close();
  }

  /** Every second: the next page's turn when it's come, and a snapshot when one's due. */
  tick(): void {
    const { pages, rotate, current } = this.config;
    if (rotate && pages.length > 1 && this.opts.active() && this.now() - this.shownAt >= rotate * 1000) {
      const i = pages.findIndex((p) => p.id === current?.id);
      this.put(pages[(i + 1) % pages.length].id, 'the rotation');
    }
    this.snapshots.tick();
  }

  state(): AppScreenState {
    const pages = this.config.pages.map((p): ScreenPage => {
      const shot = this.shots.get(p.id);
      const view = screenView(p.url, shot?.blocked);
      return {
        id: p.id,
        name: p.name,
        url: p.url,
        ...(p.login ? { login: p.login.cookie ? 'cookie' : 'form' } : {}),
        ...(shot?.at ? { shotAt: shot.at } : {}),
        ...(shot?.error ? { error: shot.error } : {}),
        ...view,
      };
    });
    const { by, at } = this.config.shown;
    return {
      pages,
      current: this.config.current?.id,
      by,
      at,
      rotate: this.config.rotate,
      proxyPort: this.listening ? this.opts.port : undefined,
      proxyError: pages.some((p) => p.view === 'proxy') ? this.proxyError : undefined,
    };
  }

  /** Page `id`'s latest snapshot. */
  shot(id: string): Buffer | undefined {
    return this.config.page(id) ? this.shots.get(id)?.body : undefined;
  }

  /** Puts page `id` up; a string says why it can't. */
  show(id: string, by: string): string | undefined {
    if (!this.config.page(id)) return 'That page isn’t on the screen’s list any more';
    if (this.config.current?.id === id) return;
    this.put(id, by);
  }

  /** Replaces the saved pages; a string says why they won't do. */
  setPages(raw: unknown, by: string): string | undefined {
    const before = new Map(this.config.pages.map((p) => [p.id, p.url]));
    const up = this.config.current?.id;
    const err = this.config.setPages(raw, by);
    if (err) return err;
    for (const [id, url] of before) {
      if (this.config.page(id)?.url === url) continue;
      this.shots.delete(id);
      this.browser.forget(id);
    }
    if (this.config.current?.id !== up || before.get(up ?? '') !== this.config.current?.url) this.moved();
    this.changed();
  }

  /** How page `id`'s snapshots sign in; null forgets it. */
  setLogin(id: string, raw: unknown): string | undefined {
    const err = this.config.setLogin(id, raw);
    if (err) return err;
    this.shots.set(id, { ...this.shots.get(id), error: undefined });
    this.browser.forget(id);
    if (this.config.current?.id === id) this.snapshots.reset();
    this.changed();
  }

  /** How long each page stays up when they take turns; 0 stops them. */
  setRotate(every: unknown): string | undefined {
    const err = this.config.setRotate(every);
    if (err) return err;
    this.shownAt = this.now();
    this.changed();
  }

  /** A snapshot of the page that's up, now rather than at the next turn; a string says why not. */
  refresh(): string | undefined {
    return this.snapshots.refresh();
  }

  private put(id: string, by: string) {
    this.config.show(id, by);
    this.moved();
    this.changed();
  }

  /** Another page is up: its turn starts now, and it's snapshotted as soon as it can be. */
  private moved() {
    this.shownAt = this.now();
    this.snapshots.reset();
  }

  private changed() {
    this.serve();
    this.opts.changed(this.state());
  }

  private done(result: ShotResult, at: number) {
    const id = this.config.current?.id;
    if (!id) return;
    const was = this.shots.get(id);
    this.shots.set(id, 'body' in result ? { body: result.body, at, blocked: result.blocked } : { ...was, error: result.error });
    this.opts.changed(this.state());
  }

  /** The address of saved page `id`, when the office serves its window. */
  private target(id: string | undefined): URL | undefined {
    const page = id ? this.config.page(id) : undefined;
    return page && screenView(page.url).view === 'proxy' ? new URL(page.url) : undefined;
  }

  /** The port for 'proxy' pages is open while there are any, and closed when there aren't. */
  private serve() {
    const want = this.config.pages.some((p) => screenView(p.url).view === 'proxy');
    if (want === !!this.server) return;
    if (!want) {
      this.server?.close();
      this.server = undefined;
      this.listening = false;
      return;
    }
    const { tls, host, port } = this.opts;
    const deps = { target: (id: string | undefined) => this.target(id), signedIn: this.opts.signedIn, secure: !!tls };
    const server = tls ? https.createServer({ cert: tls.cert, key: tls.key }, proxyHandler(deps)) : http.createServer(proxyHandler(deps));
    server.on('upgrade', proxyUpgrade(deps));
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.listening = false;
      this.proxyError = err.code === 'EADDRINUSE' ? `Port ${port} is taken: start the office with --meeting-screen-port <another>` : `The office can't serve the screen's apps on port ${port}: ${err.message}`;
      console.error(`agent-office: meeting room screen: ${this.proxyError}`);
      if (this.server === server) this.server = undefined;
      this.opts.changed(this.state());
    });
    server.listen(port, host, () => {
      this.listening = true;
      this.proxyError = undefined;
      this.opts.changed(this.state());
    });
    server.unref();
    this.server = server;
  }
}
