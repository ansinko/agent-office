import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { parseCookies, withoutOfficeCookies } from '../auth.js';

// The screen's window for an app on the office's own network ('proxy' pages): the app in an iframe,
// served by the office on a port of its own. A port of its own, rather than a path under the
// office's, so the app's absolute links (/login, fetch('/api/…')) land on the app and its cookies
// and redirects work unchanged, and so its pages are another origin than the office's and can't
// script it. The browser sends the office's cookie to every port of the office's host, so only
// people signed in to the office get through, and that cookie never goes on to the app. Which app a
// browser is looking at is a cookie of this port's own, set as its window opens (PROXY_OPEN), so the
// screen moving on to another page doesn't pull the app out from under someone using it.

/** Where the office keeps its own files on the app's port: the frame script below. */
export const PROXY_OWN = '/__agent-office/';
const FRAME_SCRIPT = `${PROXY_OWN}frame.js`;
/** Where a window opens page ?page=<id>: it's remembered in PAGE_COOKIE, then the page's own address. */
export const PROXY_OPEN = `${PROXY_OWN}open`;
const PAGE_COOKIE = 'ao_screen_page';
/** Lets the office close its window on Esc pressed inside the app, which the app's frame would keep to itself. */
const FRAME_JS = `addEventListener('keydown',function(e){if(e.key==='Escape'&&!e.defaultPrevented)parent.postMessage({agentOffice:'escape'},'*')});\n`;
/** Pages bigger than this go through as they are, without the frame script. */
const MAX_INJECT_BYTES = 4 * 1024 * 1024;

export interface ProxyDeps {
  /** The address of the saved page `id`, when it's one served through the office. */
  target(id: string | undefined): URL | undefined;
  /** Whether the request comes from someone signed in to the office. */
  signedIn(req: http.IncomingMessage): boolean;
  /** Whether this port serves https (it does when the office does). */
  secure: boolean;
}

/** The host a request was sent to, without its port: "100.64.0.1", "[::1]", "office.example.com". */
function hostnameOf(req: http.IncomingMessage): string {
  const host = req.headers.host ?? 'localhost';
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
}

/** The origin a request reached this port at. */
function proxyOrigin(req: http.IncomingMessage, secure: boolean): string {
  return `${secure ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;
}

/** A redirect to the app's own origin stays on this port; one anywhere else goes there. */
export function rewriteLocation(location: string, target: URL): string {
  try {
    const u = new URL(location, target);
    if (u.origin !== target.origin) return location;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return location;
  }
}

/**
 * A cookie the app sets, as this port can keep it: on the host the browser sees rather than the
 * app's (no Domain), and over plain http without Secure, which the browser would drop.
 */
export function rewriteSetCookie(cookie: string, secure: boolean): string {
  return cookie
    .split(';')
    .filter((part, i) => {
      const name = part.split('=', 1)[0].trim().toLowerCase();
      return i === 0 || (name !== 'domain' && (secure || name !== 'secure'));
    })
    .map((part, i) => (!secure && i > 0 && /^\s*samesite\s*=\s*none\s*$/i.test(part) ? ' SameSite=Lax' : part))
    .join(';');
}

/**
 * The app's response headers as the office's window may show them: framed only by a page on the
 * office's host (any port), its redirects and cookies kept on this port.
 */
export function responseHeaders(headers: http.IncomingHttpHeaders, target: URL, ancestor: string, secure: boolean): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...headers };
  delete out['x-frame-options'];
  delete out['strict-transport-security'];
  if (typeof headers.location === 'string') out.location = rewriteLocation(headers.location, target);
  if (headers['set-cookie']) out['set-cookie'] = headers['set-cookie'].map((c) => rewriteSetCookie(c, secure));
  const csp = headers['content-security-policy'];
  const policies = (Array.isArray(csp) ? csp : csp ? [csp] : []).map((p) =>
    p
      .split(';')
      .filter((d) => d.trim() && !/^\s*frame-ancestors\b/i.test(d))
      .join(';'),
  );
  // Policies separated by commas are each enforced, as if each came in a header of its own.
  out['content-security-policy'] = [...policies.filter((p) => p.trim()), `frame-ancestors ${ancestor}`].join(', ');
  return out;
}

/** What the office asks the app with: for the app's host, without the office's cookie, from the app's own origin. */
export function requestHeaders(req: http.IncomingMessage, target: URL, secure: boolean): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': secure ? 'https' : 'http' };
  const cookie = withoutOfficeCookies(req.headers.cookie)
    ?.split(';')
    .filter((part) => part.split('=', 1)[0].trim() !== PAGE_COOKIE)
    .join(';')
    .trim();
  if (cookie) headers.cookie = cookie;
  else delete headers.cookie;
  // Pages come back uncompressed, for the frame script to go in.
  headers['accept-encoding'] = 'identity';
  // An app that checks where a form came from sees itself.
  const here = proxyOrigin(req, secure);
  for (const name of ['origin', 'referer'] as const) {
    const v = req.headers[name];
    if (typeof v === 'string' && (v === here || v.startsWith(`${here}/`))) headers[name] = target.origin + v.slice(here.length);
  }
  return headers;
}

/** The frame script, first thing in the page's head. */
export function withFrameScript(html: string): string {
  const tag = `<script src="${FRAME_SCRIPT}"></script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html;
}

/** The path (and query) a request asks for, whatever host or absolute form it names: always on the app. */
export function upstreamPath(raw: string | undefined): string {
  const u = new URL(raw ?? '/', 'http://x');
  return `${u.pathname}${u.search}`;
}

function page(res: http.ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#2b2d42;background:#fffaf3"><main style="max-width:460px;text-align:center"><h1 style="font-size:22px">${title}</h1><p>${body}</p></main>`);
}

/** Answers every request on the app's port: the frame script, or the app itself. */
export function proxyHandler(deps: ProxyDeps) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!deps.signedIn(req)) return page(res, 401, '🔒 Sign in to the office first', 'This is a page from the meeting room screen, shown through the office. Open the office in this browser and sign in, then come back.');
    let u: URL;
    try {
      u = new URL(req.url ?? '/', 'http://x');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (u.pathname === PROXY_OPEN) {
      const id = u.searchParams.get('page') ?? '';
      const to = deps.target(id);
      if (!to) return page(res, 404, '🖥️ No such page', 'That page isn’t on the meeting room screen any more, or the office doesn’t show it through itself.');
      res.writeHead(302, { location: `${to.pathname}${to.search}`, 'set-cookie': `${PAGE_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax`, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (u.pathname === FRAME_SCRIPT) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(FRAME_JS);
      return;
    }
    const target = deps.target(parseCookies(req.headers.cookie)[PAGE_COOKIE]);
    if (!target) return page(res, 503, '🖥️ No page here', 'Open a page from the meeting room screen in the office: its window comes here.');
    const p = `${u.pathname}${u.search}`;
    const ancestor = `${deps.secure ? 'https' : 'http'}://${hostnameOf(req)}:*`;
    const send = target.protocol === 'https:' ? https.request : http.request;
    const up = send(
      { protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: p, headers: requestHeaders(req, target, deps.secure), rejectUnauthorized: false },
      (ur) => {
        const headers = responseHeaders(ur.headers, target, ancestor, deps.secure);
        const html = /^text\/html\b/i.test(ur.headers['content-type'] ?? '') && !ur.headers['content-encoding'] && req.method !== 'HEAD';
        if (!html) {
          res.writeHead(ur.statusCode ?? 502, ur.statusMessage, headers);
          ur.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        ur.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size > MAX_INJECT_BYTES) {
            // Too big to hold: what's come so far, then the rest as it comes.
            ur.removeAllListeners('data');
            ur.removeAllListeners('end');
            delete headers['content-length'];
            res.writeHead(ur.statusCode ?? 502, ur.statusMessage, headers);
            res.write(Buffer.concat(chunks));
            ur.pipe(res);
          }
        });
        ur.on('end', () => {
          if (res.headersSent) return void res.end();
          const body = Buffer.from(withFrameScript(Buffer.concat(chunks).toString('utf8')), 'utf8');
          res.writeHead(ur.statusCode ?? 502, ur.statusMessage, { ...headers, 'content-length': String(body.length) });
          res.end(body);
        });
        ur.on('error', () => res.destroy());
      },
    );
    up.on('error', () => {
      if (!res.headersSent) page(res, 502, '🔌 The app isn’t answering', `Nothing answered at ${target.host}. It may be restarting: try again in a moment.`);
      else res.destroy();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  };
}

/** WebSockets (live updates and the like): the handshake replayed to the app, then the two spliced. */
export function proxyUpgrade(deps: ProxyDeps) {
  return (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const target = deps.target(parseCookies(req.headers.cookie)[PAGE_COOKIE]);
    if (!deps.signedIn(req) || !target) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n');
      return;
    }
    let p: string;
    try {
      p = upstreamPath(req.url);
    } catch {
      socket.destroy();
      return;
    }
    const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    const secure = target.protocol === 'https:';
    const up = secure ? tls.connect({ host: target.hostname, port, servername: net.isIP(target.hostname) ? undefined : target.hostname, rejectUnauthorized: false }) : net.connect(port, target.hostname);
    const lines = [`${req.method} ${p} HTTP/1.1`];
    for (const [k, v] of Object.entries(requestHeaders(req, target, deps.secure))) {
      for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`);
    }
    up.once(secure ? 'secureConnect' : 'connect', () => {
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const close = () => {
      up.destroy();
      socket.destroy();
    };
    up.on('error', close);
    socket.on('error', close);
    up.on('close', close);
    socket.on('close', close);
  };
}
