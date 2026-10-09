// The GitHub CLI and what it prints: the pieces GitHub's pull requests and issues share.
import { execFile } from 'node:child_process';
import type { Check, Comment, Label, Pull } from '../../../shared/protocol.js';
import { reviewOf } from './map.js';

/** Turns gh's stderr into something a person standing at the board can act on. */
export function friendlyGhError(raw: string): string {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const text = lines.join(' ');
  const first = lines[0] ?? raw.trim();
  if (/^Unknown JSON field:/i.test(first)) return first;
  if (/no git remotes found|none of the git remotes/i.test(text)) return 'This project has no GitHub remote yet. Push it to GitHub (git remote add origin <url>) to fill the boards.';
  if (/not a git repository/i.test(text)) return "This folder isn't a git repository";
  if (/auth login|not logged in|authentication/i.test(text)) return "gh isn't signed in to GitHub on the office's machine — run `gh auth login` there";
  if (/could not resolve to a repository|not found/i.test(text)) return "gh can't find this repository on GitHub (check the remote and access)";
  return lines.slice(-2).join(' ') || raw;
}

export type GhRunner = (args: string[], cwd: string, timeout?: number, env?: Record<string, string>) => Promise<string>;

/** Runs gh as the office, or with `env` as someone signed in to their own GitHub (see signins.ts). */
export function gh(args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout, env }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim();
        const signedOut = env && /auth login|not logged in|authentication/i.test(msg);
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'GitHub CLI (gh) is not installed on the server' : signedOut ? 'Your GitHub sign-in stopped working — sign in again (☰ → 🔐 Your sign-ins)' : friendlyGhError(msg)));
      } else resolve(stdout);
    });
  });
}

export function labels(raw: any[]): Label[] {
  return (raw ?? []).map((l) => ({ name: String(l.name), color: `#${l.color ?? '888888'}` }));
}

export function checksOf(rollup: any[]): Pull['checks'] {
  if (!rollup?.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
    const status = String(c.status ?? '').toUpperCase();
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(concl)) return 'fail';
    if (status && status !== 'COMPLETED') pending = true;
    if (concl === 'PENDING' || concl === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

const FAILED = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];

/** One entry of statusCheckRollup: a CheckRun (Actions) or a StatusContext (other CI). */
export function checkOf(c: any): Check {
  const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
  const status = String(c.status ?? '').toUpperCase();
  let state: Check['state'] = 'pass';
  if (FAILED.includes(concl)) state = 'fail';
  else if ((status && status !== 'COMPLETED') || !concl || concl === 'PENDING' || concl === 'EXPECTED') state = 'pending';
  else if (['SKIPPED', 'NEUTRAL', 'STALE'].includes(concl)) state = 'skip';
  const name = String(c.name ?? c.context ?? 'check');
  return { name: c.workflowName ? `${c.workflowName} / ${name}` : name, state, url: c.detailsUrl ?? c.targetUrl ?? undefined };
}

export function commentsOf(raw: any[]): Comment[] {
  return (raw ?? []).map((c: any) => ({
    id: String(c.id),
    author: c.author?.login ?? 'ghost',
    body: String(c.body ?? ''),
    createdAt: c.createdAt ?? c.submittedAt ?? '',
    url: c.url,
    review: reviewOf(c.state),
  }));
}

/**
 * Comments on issue or pull request `n` (to GitHub a PR is an issue too), as `env` or else the
 * office. Resolves to the comment as GitHub saved it.
 */
export async function postComment(dir: string, n: string, body: string, env?: Record<string, string>): Promise<Comment> {
  // -f sends the body as a plain string: no @file reading, no {owner} filling in.
  const jq = '{id: .node_id, author: {login: .user.login}, body, createdAt: .created_at, url: .html_url}';
  const out = await gh(['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${n}/comments`, '-f', `body=${body}`, '--jq', jq], dir, undefined, env);
  return commentsOf([JSON.parse(out)])[0];
}

/**
 * Puts labels on issue or pull request `n` and takes others off (to GitHub a PR is an issue too), as
 * `env` or else the office. Resolves to the labels it has now.
 */
export async function putLabels(dir: string, n: string, add: string[], remove: string[], env?: Record<string, string>): Promise<Label[]> {
  const path = `repos/{owner}/{repo}/issues/${n}/labels`;
  const jq = '[.[] | {name, color}]';
  let now: Label[] | undefined;
  // -f labels[]=… sends a JSON array of plain strings: no @file reading, no {owner} filling in.
  if (add.length) now = labels(JSON.parse(await gh(['api', '--method', 'POST', path, ...add.flatMap((l) => ['-f', `labels[]=${l}`]), '--jq', jq], dir, undefined, env)));
  for (const l of remove) {
    try {
      now = labels(JSON.parse(await gh(['api', '--method', 'DELETE', `${path}/${encodeURIComponent(l)}`, '--jq', jq], dir, undefined, env)));
    } catch (err) {
      // Someone took it off already, which is what was asked for.
      if (!/label does not exist/i.test((err as Error).message)) throw err;
    }
  }
  return now ?? labels(JSON.parse(await gh(['api', `${path}?per_page=100`, '--jq', jq], dir)));
}

/**
 * Labels just changed from the office, by issue key or PR number, and when. A list asked for before
 * a change still has the old labels, so the new ones are kept over it; a list asked for after the
 * change is believed, and the change forgotten.
 */
export class Relabels {
  private changed = new Map<string, { labels: Label[]; at: number }>();

  set(n: string, labels: Label[], at: number) {
    this.changed.set(n, { labels, at });
  }

  over<T extends { labels: Label[] }>(items: T[], idOf: (it: T) => string, asked: number): T[] {
    return items.map((it) => {
      const n = idOf(it);
      const r = this.changed.get(n);
      if (!r) return it;
      if (r.at < asked) {
        this.changed.delete(n);
        return it;
      }
      return { ...it, labels: r.labels };
    });
  }
}
