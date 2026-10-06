import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_PAGES, checkScreenUrl, isLocalHost, screenView } from '../src/shared/appscreen.js';
import { AppScreenConfig, checkLogin, parseCookieHeader } from '../src/server/appscreen/config.js';
import { AppScreen } from '../src/server/appscreen/index.js';
import type { AppScreenState } from '../src/shared/protocol.js';
import { SHOT_EVERY_MS, SHOT_GAP_MS, BROWSER_IDLE_MS, Snapshots, type ShotResult } from '../src/server/appscreen/snapshots.js';
import { proxyHandler, proxyUpgrade, rewriteLocation, rewriteSetCookie, upstreamPath, withFrameScript } from '../src/server/appscreen/proxy.js';
import { downloadedChromiums, framingBlock } from '../src/server/appscreen/browser.js';

const tempDir = (t: { after(fn: () => void): void }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-screen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// ---- What can go up on the screen ------------------------------------------------------------

test('the screen takes http and https pages, and no name or password in the address', () => {
  assert.deepEqual(checkScreenUrl(' http://127.0.0.1:3000 '), { url: 'http://127.0.0.1:3000/' });
  assert.deepEqual(checkScreenUrl('https://app.example.com/board#top'), { url: 'https://app.example.com/board' });
  for (const bad of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/', 'not a url', 'http://me:secret@app/', `http://x/${'a'.repeat(2100)}`]) {
    assert.ok('error' in checkScreenUrl(bad), bad);
  }
});

test('a sign-in is a cookie, or a name and a password together', () => {
  assert.deepEqual(checkLogin({ cookie: ' session=abc; theme=dark ' }), { cookie: 'session=abc; theme=dark' });
  assert.deepEqual(checkLogin({ user: 'ana', password: ' p w ' }), { user: 'ana', password: ' p w ' });
  assert.equal(typeof checkLogin({ user: 'ana' }), 'string');
  assert.equal(typeof checkLogin({ cookie: 'no pairs here' }), 'string');
  assert.equal(typeof checkLogin({ cookie: `a=${'x'.repeat(9000)}` }), 'string');
  assert.deepEqual(parseCookieHeader('Cookie: a=1; b = two=2 ;bad; =x'), [
    { name: 'a', value: '1' },
    { name: 'b', value: 'two=2' },
  ]);
});

test('a new screen has the default pages, the first one up', (t) => {
  const cfg = new AppScreenConfig(tempDir(t));
  assert.deepEqual(
    cfg.pages.map(({ name, url }) => ({ name, url })),
    DEFAULT_PAGES.map((p) => ({ ...p, url: new URL(p.url).href })),
  );
  assert.equal(cfg.current?.name, 'spec-monitoring');
  assert.equal(cfg.rotate, 0);
});

test('the pages and their sign-ins are saved for the office alone; a changed address loses its sign-in', (t) => {
  const dir = tempDir(t);
  const cfg = new AppScreenConfig(dir);
  const [app, lunch] = cfg.pages;
  assert.equal(cfg.setLogin(app.id, { cookie: 'monitor=s3cret' }), undefined);
  const file = path.join(dir, 'app-screen.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(readFileSync(file, 'utf8'), /s3cret/);

  // Reordered and renamed, with one added: ids and the sign-in go with their pages.
  assert.equal(cfg.setPages([{ id: lunch.id, name: '  Lunch  ', url: lunch.url }, { id: app.id, name: 'Monitor', url: app.url }, { name: '', url: 'https://example.com/x' }], 'ana'), undefined);
  assert.deepEqual(
    cfg.pages.map((p) => [p.name, p.login?.cookie]),
    [
      ['Lunch', undefined],
      ['Monitor', 'monitor=s3cret'],
      ['example.com', undefined],
    ],
  );
  assert.equal(cfg.current?.id, app.id, 'the page up stays up');
  assert.equal(cfg.pages[1].id, app.id);

  const again = new AppScreenConfig(dir);
  assert.deepEqual(again.pages, cfg.pages, 'a restart reads it all back');
  assert.equal(again.current?.id, app.id);
  assert.equal(again.setPages([{ id: app.id, name: 'Monitor', url: 'http://127.0.0.1:3001/' }], 'ana'), undefined);
  assert.equal(again.page(app.id)?.login, undefined, 'its sign-in was for the old address');
  assert.doesNotMatch(readFileSync(file, 'utf8'), /s3cret/);

  // The page up taken off the list: the first goes up.
  assert.equal(again.setPages([{ name: 'Only', url: 'https://only.example/' }], 'ana'), undefined);
  assert.equal(again.current?.name, 'Only');
  assert.equal(again.setPages([{ name: 'x', url: 'gopher://x' }], 'ana'), 'The screen shows http and https pages only');
  assert.equal(typeof again.setPages(Array.from({ length: 30 }, () => ({ name: 'x', url: 'https://x/' })), 'ana'), 'string');
  assert.equal(again.setRotate(45), 'Pick how long each page stays up from the list');
  assert.equal(again.setRotate(60), undefined);
  assert.equal(new AppScreenConfig(dir).rotate, 60);
});

test("a page's window: through the office on its own network, framed over https unless it won't be, else its snapshot", () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '100.102.179.53', 'build-box', 'nas.local', '[::1]', 'office.tail1234.ts.net']) assert.ok(isLocalHost(h), h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', 'menu-picker-three.vercel.app']) assert.ok(!isLocalHost(h), h);
  assert.deepEqual(screenView('http://127.0.0.1:3000/'), { view: 'proxy' });
  assert.deepEqual(screenView('https://menu-picker-three.vercel.app/office/mocha'), { view: 'frame' });
  assert.equal(screenView('https://github.com/', 'no frames').view, 'shot');
  // A site out on the internet is never served through the office.
  assert.equal(screenView('http://example.com/').view, 'shot');

  assert.equal(framingBlock({}), undefined);
  assert.equal(framingBlock({ 'x-frame-options': 'ALLOWALL' }), undefined);
  assert.match(framingBlock({ 'x-frame-options': 'SAMEORIGIN' })!, /X-Frame-Options/);
  assert.match(framingBlock({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self' https://partner.example" })!, /Content-Security-Policy/);
  assert.equal(framingBlock({ 'content-security-policy': "default-src 'self'; frame-ancestors *" }), undefined);
  assert.equal(framingBlock({ 'content-security-policy': "script-src 'self'" }), undefined);
});

// ---- When it's snapshotted -------------------------------------------------------------------

function clockedSnapshots(over: { url?: () => string; active?: () => boolean } = {}) {
  let now = 1_000_000;
  const captured: string[] = [];
  const pending: ((r: ShotResult) => void)[] = [];
  const done: [ShotResult, number][] = [];
  let idled = 0;
  const shots = new Snapshots({
    url: over.url ?? (() => 'http://app/'),
    active: over.active ?? (() => true),
    capture: (url) => {
      captured.push(url);
      return new Promise((resolve) => pending.push(resolve));
    },
    done: (r, at) => void done.push([r, at]),
    idle: () => void idled++,
    now: () => now,
  });
  const finish = async (r: ShotResult = { body: Buffer.from('jpg') }) => {
    pending.shift()!(r);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { shots, captured, done, finish, idled: () => idled, advance: (ms: number) => void (now += ms), now: () => now };
}

test('the screen is snapshotted every SHOT_EVERY_MS while someone is about, one at a time', async () => {
  const s = clockedSnapshots();
  s.shots.tick();
  assert.equal(s.captured.length, 1);
  // Still taking it: no second one, however long it takes.
  s.advance(SHOT_EVERY_MS * 2);
  s.shots.tick();
  assert.equal(s.captured.length, 1);
  await s.finish();
  assert.equal(s.done.length, 1);
  // The next is due SHOT_EVERY_MS after the last one started, not before.
  s.shots.tick();
  assert.equal(s.captured.length, 2);
  await s.finish();
  s.advance(SHOT_EVERY_MS - 1);
  s.shots.tick();
  assert.equal(s.captured.length, 2);
  s.advance(1);
  s.shots.tick();
  assert.equal(s.captured.length, 3);
});

test('nobody about, or no page up: no snapshots, and the browser is let go after a while', async () => {
  let active = false;
  let url = 'http://app/';
  const s = clockedSnapshots({ active: () => active, url: () => url });
  s.shots.tick();
  s.advance(SHOT_EVERY_MS * 10);
  s.shots.tick();
  assert.equal(s.captured.length, 0);
  assert.equal(s.idled(), 0, 'no browser was opened, so none is closed');
  active = true;
  s.shots.tick();
  assert.equal(s.captured.length, 1);
  await s.finish();
  active = false;
  s.advance(BROWSER_IDLE_MS - 1);
  s.shots.tick();
  assert.equal(s.idled(), 0);
  s.advance(1);
  s.shots.tick();
  assert.equal(s.idled(), 1);
  s.advance(BROWSER_IDLE_MS);
  s.shots.tick();
  assert.equal(s.idled(), 1, 'closed once');
  active = true;
  url = '';
  s.advance(SHOT_EVERY_MS);
  s.shots.tick();
  assert.equal(s.captured.length, 1);
  assert.equal(s.shots.refresh(), 'There’s no page on the screen');
});

test('asking for a snapshot is held to SHOT_GAP_MS since the last one', async () => {
  const s = clockedSnapshots();
  assert.equal(s.shots.refresh(), undefined);
  assert.equal(s.captured.length, 1);
  assert.equal(s.shots.refresh(), 'A snapshot is being taken already');
  await s.finish();
  s.advance(SHOT_GAP_MS - 1500);
  assert.equal(s.shots.refresh(), 'Wait 2 s for the next snapshot');
  assert.equal(s.captured.length, 1);
  s.advance(1500);
  assert.equal(s.shots.refresh(), undefined);
  assert.equal(s.captured.length, 2);
});

test('a new page is snapshotted at the next tick the gap allows, and a stale snapshot is dropped', async () => {
  let url = 'http://one/';
  const s = clockedSnapshots({ url: () => url });
  s.shots.tick();
  url = 'http://two/';
  s.shots.reset();
  await s.finish();
  assert.equal(s.done.length, 0, "the old app's snapshot doesn't go up");
  s.advance(SHOT_GAP_MS - 1);
  s.shots.tick();
  assert.equal(s.captured.length, 1);
  s.advance(1);
  s.shots.tick();
  assert.deepEqual(s.captured, ['http://one/', 'http://two/']);
  await s.finish({ error: 'Nothing is answering at two' });
  assert.deepEqual(s.done[0][0], { error: 'Nothing is answering at two' });
});

// ---- The app's window ------------------------------------------------------------------------

test('redirects and cookies stay on the window’s port; the frame script goes first in the head', () => {
  const target = new URL('http://127.0.0.1:3000/board');
  assert.equal(rewriteLocation('http://127.0.0.1:3000/login?next=%2F', target), '/login?next=%2F');
  assert.equal(rewriteLocation('/login', target), '/login');
  assert.equal(rewriteLocation('https://login.microsoftonline.com/x', target), 'https://login.microsoftonline.com/x');
  assert.equal(rewriteSetCookie('s=1; Path=/; Domain=127.0.0.1; HttpOnly; Secure; SameSite=None', true), 's=1; Path=/; HttpOnly; Secure; SameSite=None');
  assert.equal(rewriteSetCookie('s=1; Path=/; Domain=app.example.com; Secure; SameSite=None', false), 's=1; Path=/; SameSite=Lax');
  assert.equal(withFrameScript('<!doctype html><html><head lang="sk"><title>x</title>'), '<!doctype html><html><head lang="sk"><script src="/__agent-office/frame.js"></script><title>x</title>');
  assert.equal(withFrameScript('<!DOCTYPE html><p>hi'), '<!DOCTYPE html><script src="/__agent-office/frame.js"></script><p>hi');
  // Whatever host or absolute form a request names, only its path goes on, to the app.
  assert.equal(upstreamPath('http://evil.example/steal?x=1'), '/steal?x=1');
  assert.equal(upstreamPath('//evil.example/steal'), '/steal');
});

/** An app to put behind the window, and the window in front of it, signed in when the cookie says so. */
async function appBehindWindow(t: { after(fn: () => void): void }, app: http.RequestListener) {
  const upstream = http.createServer(app);
  upstream.on('upgrade', (req, socket) => {
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nx-path: ${req.url}\r\nx-cookie: ${req.headers.cookie ?? ''}\r\n\r\n`);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const appPort = (upstream.address() as AddressInfo).port;
  let target: URL | undefined = new URL(`http://127.0.0.1:${appPort}/board?view=week`);
  const deps = { target: (id: string | undefined) => (id === 'p1' ? target : undefined), signedIn: (req: http.IncomingMessage) => /ao_session_4600=ok/.test(req.headers.cookie ?? ''), secure: false };
  const window = http.createServer(proxyHandler(deps));
  window.on('upgrade', proxyUpgrade(deps));
  await new Promise<void>((resolve) => window.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    window.close();
    upstream.close();
  });
  const port = (window.address() as AddressInfo).port;
  const get = (p: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p, headers: { cookie: 'ao_session_4600=ok; ao_screen_page=p1; app=1', ...headers } }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      }).on('error', reject);
    });
  return { get, port, appPort, takeDown: () => void (target = undefined) };
}

test('the window lets in only people signed in to the office, and never hands the app their office cookie', async (t) => {
  const seen: http.IncomingHttpHeaders[] = [];
  const w = await appBehindWindow(t, (req, res) => {
    seen.push(req.headers);
    res.end('app');
  });
  const out = await w.get('/', { cookie: 'ao_screen_page=p1; app=1' });
  assert.equal(out.status, 401);
  assert.equal((await w.get('/__agent-office/open?page=p1', { cookie: 'app=1' })).status, 401);
  assert.equal(seen.length, 0, 'the app is never asked');

  // The window opens on the page's own address, and remembers which page it's for.
  const open = await w.get('/__agent-office/open?page=p1', { cookie: 'ao_session_4600=ok' });
  assert.equal(open.status, 302);
  assert.equal(open.headers.location, '/board?view=week');
  assert.deepEqual(open.headers['set-cookie'], ['ao_screen_page=p1; Path=/; HttpOnly; SameSite=Lax']);
  assert.equal((await w.get('/__agent-office/open?page=nope')).status, 404);
  assert.equal((await w.get('/x', { cookie: 'ao_session_4600=ok; app=1' })).status, 503, 'no page remembered: nothing to show');
  assert.equal(seen.length, 0);

  const ok = await w.get('/x', { origin: `http://127.0.0.1:${w.port}` });
  assert.equal(ok.body, 'app');
  assert.equal(seen[0].cookie, 'app=1', "neither the office's cookie nor the window's own");
  assert.equal(seen[0].host, `127.0.0.1:${w.appPort}`);
  assert.equal(seen[0].origin, `http://127.0.0.1:${w.appPort}`, 'the app sees its own origin');

  // A Host naming somewhere else doesn't send the request there.
  const elsewhere = await w.get('/x', { host: 'evil.example' });
  assert.equal(elsewhere.body, 'app');
  assert.equal(seen[1].host, `127.0.0.1:${w.appPort}`);

  w.takeDown();
  assert.equal((await w.get('/x')).status, 503);
});

test('the app’s pages can be framed by the office’s host only, and redirect and set cookies on the window’s port', async (t) => {
  const w = await appBehindWindow(t, (req, res) => {
    if (req.url === '/') {
      res.writeHead(302, { location: `http://127.0.0.1:${(req.socket.address() as AddressInfo).port}/login`, 'set-cookie': 'state=1; Domain=127.0.0.1; Path=/' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'content-length': '31' });
    res.end('<html><head></head>login</html>');
  });
  const r = await w.get('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/login');
  assert.deepEqual(r.headers['set-cookie'], ['state=1; Path=/']);

  const login = await w.get('/login');
  assert.equal(login.headers['x-frame-options'], undefined, 'an app on the office’s own network is framed');
  assert.equal(login.headers['content-security-policy'], "default-src 'self', frame-ancestors http://127.0.0.1:*");
  assert.equal(login.body, '<html><head><script src="/__agent-office/frame.js"></script></head>login</html>');
  assert.equal(Number(login.headers['content-length']), Buffer.byteLength(login.body));

  const script = await w.get('/__agent-office/frame.js');
  assert.match(script.headers['content-type']!, /javascript/);
  assert.match(script.body, /postMessage\(\{agentOffice:'escape'\}/);
});

test('websockets go through to the app for people signed in, without their office cookie', async (t) => {
  const w = await appBehindWindow(t, (_req, res) => res.end());
  const handshake = (cookie: string) =>
    new Promise<string>((resolve, reject) => {
      const s = net.connect(w.port, '127.0.0.1', () => s.write(`GET http://evil.example/live HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: Upgrade\r\nupgrade: websocket\r\ncookie: ${cookie}\r\n\r\n`));
      let got = '';
      s.on('data', (d) => (got += d));
      s.on('end', () => resolve(got));
      s.on('close', () => resolve(got));
      s.on('error', reject);
    });
  assert.match(await handshake('ao_screen_page=p1; app=1'), /^HTTP\/1.1 401/);
  const ok = await handshake('ao_session_4600=ok; ao_screen_page=p1; app=1');
  assert.match(ok, /^HTTP\/1.1 101/);
  assert.match(ok, /x-path: \/live\r\n/);
  assert.match(ok, /x-cookie: app=1\r\n/);
});

// ---- The screen as a whole ------------------------------------------------------------------

test('the pages take turns while someone is about, each snapshot lands on its page, and no sign-in reaches a browser', async (t) => {
  let now = 5_000_000;
  let active = true;
  const states: AppScreenState[] = [];
  const shot: [string, string][] = [];
  const screen = new AppScreen({
    dataDir: tempDir(t),
    host: '127.0.0.1',
    port: 0,
    signedIn: () => true,
    active: () => active,
    changed: (s) => void states.push(s),
    capture: async (key, url) => {
      shot.push([key, url]);
      return url.startsWith('https://menu') ? { body: Buffer.from('menu') } : { body: Buffer.from('app'), blocked: 'no frames' };
    },
    now: () => now,
  });
  const [app, lunch] = screen.config.pages;
  assert.equal(screen.setLogin(app.id, { user: 'ana', password: 'hunter2' }), undefined);
  screen.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shot, [[app.id, app.url]]);
  assert.equal(screen.shot(app.id)?.toString(), 'app');
  assert.equal(screen.state().pages[0].login, 'form');
  assert.equal(screen.state().pages[0].view, 'proxy', "an app on the office's network is served through it, whatever it says about frames");
  assert.equal(screen.state().pages[1].view, 'frame');

  assert.equal(screen.setRotate(30), undefined);
  now += 29_000;
  screen.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(screen.state().current, app.id);
  now += 1_000;
  screen.tick();
  assert.equal(screen.state().current, lunch.id);
  assert.equal(screen.state().by, 'the rotation');
  // Its snapshot waits out the gap since the last one.
  assert.deepEqual(shot.at(-1), [app.id, app.url]);
  now += 4_000;
  screen.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shot.at(-1), [lunch.id, lunch.url]);
  assert.equal(screen.shot(lunch.id)?.toString(), 'menu');
  // Nobody about: no turns.
  active = false;
  now += 300_000;
  screen.tick();
  assert.equal(screen.state().current, lunch.id);
  assert.equal(screen.show('nope', 'ana'), 'That page isn’t on the screen’s list any more');
  assert.equal(screen.show(app.id, 'ana'), undefined);
  assert.equal(screen.state().by, 'ana');
  assert.doesNotMatch(JSON.stringify(states), /hunter2/);
  screen.stop();
});

// ---- The headless browser --------------------------------------------------------------------

test('a downloaded Chromium of any build is found, newest first and the headless shell before the full one', () => {
  const dir = '/pw';
  const files = new Set([
    '/pw/chromium-1100/chrome-linux/chrome',
    '/pw/chromium-1234/chrome-linux64/chrome',
    '/pw/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  ]);
  const found = downloadedChromiums(dir, (f) => files.has(f), () => ['ffmpeg-1011', 'chromium-1100', 'chromium-1234', 'chromium_headless_shell-1234', 'firefox-1500']);
  assert.deepEqual(found, ['/pw/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell', '/pw/chromium-1234/chrome-linux64/chrome', '/pw/chromium-1100/chrome-linux/chrome']);
  assert.deepEqual(
    downloadedChromiums('/nowhere', () => false, () => {
      throw new Error('ENOENT');
    }),
    [],
  );
});
