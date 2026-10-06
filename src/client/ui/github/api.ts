import type { BoardRef, GhIssue, GhPull, ServerMsg } from '../../../shared/protocol';
import { store } from '../../state';

// Talking to the office about GitHub: the reads (over HTTP, for the floor you're on), and the
// answers to what the dialogs asked for over the socket (merged, commented, closed, labeled).

/** The board windows ask about the floor you're on. */
function onFloor(url: string): string {
  return store.floor ? `${url}${url.includes('?') ? '&' : '?'}floor=${encodeURIComponent(store.floor)}` : url;
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export async function getText(url: string): Promise<string> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.text();
}

/** The issue or PR `it` is, to name it to the office. */
export function refTo(kind: 'issue' | 'pull', it: GhIssue | GhPull): BoardRef {
  return kind === 'issue' ? { kind, key: (it as GhIssue).key } : { kind, number: (it as GhPull).number };
}

/** What an open dialog waits under: "issue:KEY" or "pull:N". */
export const waitKey = (ref: BoardRef): string => (ref.kind === 'issue' ? `issue:${ref.key}` : `pull:${ref.number}`);

export const mergeWaiters = new Map<number, (msg: Extract<ServerMsg, { t: 'gh.merged' }>) => void>();
export const commentWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.commented' }>) => void>();
/** Open close dialogs, by waitKey. */
export const closeWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.closed' }>) => void>();
/** Open label pickers, by waitKey. */
export const labelWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'gh.labeled' }>) => void>();

/** Main feeds server messages through here so an open merge, close or label dialog or comment box hears back. */
export function routePullMessage(msg: ServerMsg) {
  if (msg.t === 'gh.merged') mergeWaiters.get(msg.number)?.(msg);
  if (msg.t === 'gh.commented') commentWaiters.get(waitKey(msg))?.(msg);
  if (msg.t === 'gh.closed') closeWaiters.get(waitKey(msg))?.(msg);
  if (msg.t === 'gh.labeled') labelWaiters.get(waitKey(msg))?.(msg);
}
