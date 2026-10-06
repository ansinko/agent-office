// The screen in the meeting room (see protocol/appscreen.ts): what both sides agree on.
import type { ScreenView } from './protocol/appscreen.js';

/** The snapshot's size in pixels: the screen's own 2:1, a desktop browser's width. */
export const SHOT_WIDTH = 1800;
export const SHOT_HEIGHT = 900;

/** Longest a pasted cookie or password may be. */
export const LOGIN_MAX = 8192;
export const MAX_PAGES = 24;
export const PAGE_NAME_MAX = 60;

/** How long each page may stay up when they take turns, in seconds; 0 is not taking turns. */
export const ROTATE_CHOICES = [0, 30, 60, 120, 300, 600] as const;

/** What a new office's screen has saved, the first up first. */
export const DEFAULT_PAGES: readonly { name: string; url: string }[] = [
  { name: 'spec-monitoring', url: 'http://127.0.0.1:3000/' },
  { name: 'Obed - Mocha', url: 'https://menu-picker-three.vercel.app/office/mocha' },
];

/**
 * Checks a page's address: an http or https page, with no name or password in it (those belong in
 * the snapshots' sign-in, which the office keeps to itself).
 */
export function checkScreenUrl(raw: unknown): { url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Type the page’s address' };
  if (s.length > 2048) return { error: 'That address is too long' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That isn't a web address. Type one that starts with http:// or https://" };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'The screen shows http and https pages only' };
  if (u.username || u.password) return { error: 'Leave the name and password out of the address: set them as the page’s sign-in instead' };
  u.hash = '';
  return { url: u.href };
}

/** The page's host, for its name where it has none: "127.0.0.1:3000". */
export function screenHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Whether `a.b.c.d` is in `base`/`bits`. */
function inV4(ip: number[], base: number[], bits: number): boolean {
  const n = (q: number[]) => ((q[0] << 24) | (q[1] << 16) | (q[2] << 8) | q[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n(ip) & mask) === (n(base) & mask);
}

/**
 * Whether a host is on the office's own network rather than out on the internet: loopback, a private
 * or Tailscale address, a .local or .internal name, a name with no dots, or one on a tailnet.
 */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.ts.net')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const ip = v4.slice(1).map(Number);
    return (
      [
        [[127, 0, 0, 0], 8],
        [[10, 0, 0, 0], 8],
        [[172, 16, 0, 0], 12],
        [[192, 168, 0, 0], 16],
        [[169, 254, 0, 0], 16],
        [[100, 64, 0, 0], 10],
      ] as [number[], number][]
    ).some(([base, bits]) => inV4(ip, base, bits));
  }
  if (h.includes(':')) return h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  return !h.includes('.');
}

/**
 * How a page's window shows it (see ScreenView): an http page on the office's network through the
 * office, an https page framed unless it said it won't be (`blocked`), anything else as its snapshot.
 */
export function screenView(url: string, blocked?: string): { view: ScreenView; why?: string } {
  const u = new URL(url);
  if (u.protocol === 'http:') return isLocalHost(u.hostname) ? { view: 'proxy' } : { view: 'shot', why: 'It’s a plain http page out on the internet, which a window in the office can’t show.' };
  return blocked ? { view: 'shot', why: blocked } : { view: 'frame' };
}
