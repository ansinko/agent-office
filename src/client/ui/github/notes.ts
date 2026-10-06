import type { GhIssue, GhPull } from '../../../shared/protocol';

// ---- How a card names an issue or PR, and keeps its look ----------------------------------------

/** "#12": an issue's ref, or a PR's number. */
export const refText = (it: GhIssue | GhPull): string => ('ref' in it ? it.ref : `#${it.number}`);

/** What a note is pinned for: an issue's key, or a PR's number as a string. */
export const noteKey = (it: GhIssue | GhPull): string => ('key' in it ? it.key : String(it.number));

/** A number to pick an issue card's tilt and color by, the same on every render. A GitHub issue's is its number. */
export function keySeed(key: string): number {
  if (/^\d+$/.test(key)) return Number(key);
  let n = 0;
  for (const ch of key) n = (n * 31 + ch.charCodeAt(0)) % 1_000_003;
  return n;
}

/** keySeed for an issue, a PR's number for a PR. */
export const noteSeed = (it: GhIssue | GhPull): number => ('key' in it ? keySeed(it.key) : it.number);
