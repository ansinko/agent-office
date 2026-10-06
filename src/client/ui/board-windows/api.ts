import type { BoardRef, Issue, Pull, ServerMsg } from '../../../shared/protocol';
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
export function refTo(kind: 'issue' | 'pull', it: Issue | Pull): BoardRef {
  return kind === 'issue' ? { kind, key: (it as Issue).key } : { kind, number: (it as Pull).number };
}

/** What an open dialog waits under: "issue:KEY" or "pull:N". */
export const waitKey = (ref: BoardRef): string => (ref.kind === 'issue' ? `issue:${ref.key}` : `pull:${ref.number}`);

export const mergeWaiters = new Map<number, (msg: Extract<ServerMsg, { t: 'board.merged' }>) => void>();
export const commentWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'board.commented' }>) => void>();
/** Open close dialogs, by waitKey. */
export const closeWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'board.closed' }>) => void>();
/** Open label pickers, by waitKey. */
export const labelWaiters = new Map<string, (msg: Extract<ServerMsg, { t: 'board.labeled' }>) => void>();

/** Main feeds server messages through here so an open merge, close or label dialog or comment box hears back. */
export function routePullMessage(msg: ServerMsg) {
  if (msg.t === 'board.merged') mergeWaiters.get(msg.number)?.(msg);
  if (msg.t === 'board.commented') commentWaiters.get(waitKey(msg))?.(msg);
  if (msg.t === 'board.closed') closeWaiters.get(waitKey(msg))?.(msg);
  if (msg.t === 'board.labeled') labelWaiters.get(waitKey(msg))?.(msg);
}
