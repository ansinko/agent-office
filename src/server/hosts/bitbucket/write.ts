// What the office writes to a Bitbucket floor's pull requests, through bkt: comments, merges,
// declines and new pull requests. BitbucketPulls (pulls.ts) hands each one its ctx.
import { readFile } from 'node:fs/promises';
import type { Comment, Label } from '../../../shared/protocol.js';
import type { HostAs } from '../types.js';
import { truncate } from '../../workers/util.js';
import { api, repoFlags, type BbRepo, type Bkt } from './bkt.js';
import { commentsOf } from './map.js';

/** The floor a write lands on, and how the board catches up after it. */
export interface WriteCtx {
  repo: BbRepo;
  bkt: Bkt;
  refresh: () => Promise<void>;
  findOpenPr: (branch: string) => Promise<{ number: number; url: string } | undefined>;
}

/** `bkt pr create` being run, alone or in a longer line: not one that only names it (a grep for it, a quoted string). */
const CREATES_PR = /(?:^|[\s;&|(])bkt\s+pr\s+create\b/;
const PR_URL = /https:\/\/bitbucket\.org\/([\w.-]+\/[\w.-]+)\/pull-requests\/(\d+)/g;

const asOpts = (as?: HostAs, timeout?: number) => ({ timeout, env: as?.env });

/** Posts `body` on pull request `n` and resolves to the comment as Bitbucket saved it. */
async function post(ctx: WriteCtx, n: number, body: string, as?: HostAs, timeout?: number): Promise<any> {
  // --text=…, so a body starting with "-" isn't read as a flag.
  const out = await ctx.bkt(['pr', 'comment', String(n), `--text=${body}`, ...repoFlags(ctx.repo), '--json'], asOpts(as, timeout));
  return JSON.parse(out);
}

/** Comments on a PR's conversation, as `as` or else the office. Returns the saved comment, or why it couldn't. */
export async function commentOn(ctx: WriteCtx, n: number, body: string, as?: HostAs): Promise<{ comment?: Comment; error?: string }> {
  let comment: Comment | undefined;
  try {
    comment = commentsOf([await post(ctx, n, body, as)]).comments[0];
  } catch (err) {
    return { error: (err as Error).message };
  }
  void ctx.refresh();
  return { comment };
}

/** Posts a review that only comments (the meeting room's review panel), its body read from a file. Resolves to its page. */
export async function reviewOn(ctx: WriteCtx, n: number, file: string, as?: HostAs): Promise<string> {
  const saved = await post(ctx, n, await readFile(file, 'utf8'), as, 60_000);
  void ctx.refresh();
  return String(saved?.links?.html?.href ?? '');
}

/** Merges a PR with a strategy id, closing its source branch or not. Returns an error. */
export async function mergePull(ctx: WriteCtx, n: number, method: string, deleteBranch: boolean, auto: boolean, as?: HostAs): Promise<string | undefined> {
  if (auto) return 'Bitbucket has no auto-merge';
  try {
    await ctx.bkt(['pr', 'merge', String(n), '--strategy', method, `--close-source=${deleteBranch}`, ...repoFlags(ctx.repo)], asOpts(as, 90_000));
  } catch (err) {
    return (err as Error).message;
  }
  void ctx.refresh();
  return undefined;
}

/** Declines a pull request, optionally saying why. Returns an error. */
export async function declinePull(ctx: WriteCtx, n: number, opts: { comment?: string; deleteBranch?: boolean }, as?: HostAs): Promise<string | undefined> {
  const args = ['pr', 'decline', String(n)];
  if (opts.comment) args.push(`--comment=${opts.comment}`);
  if (opts.deleteBranch) args.push('--delete-source');
  try {
    await ctx.bkt([...args, ...repoFlags(ctx.repo)], asOpts(as));
  } catch (err) {
    return (err as Error).message;
  }
  void ctx.refresh();
  return undefined;
}

export async function refuseLabels(): Promise<{ labels?: Label[]; error?: string }> {
  return { error: 'Bitbucket pull requests have no labels' };
}

/** `bkt pr create` for a pushed branch; resolves to the new pull request, or the branch's open one when bkt doesn't say. */
export async function openPull(
  ctx: WriteCtx,
  branch: string,
  base: string | undefined,
  title: string,
  body: string,
  as?: HostAs,
  timeout = 60_000,
): Promise<{ number: number; url: string }> {
  const args = ['pr', 'create', '--source', branch, ...(base ? ['--target', base] : []), `--title=${title}`, `--description=${body}`, ...repoFlags(ctx.repo), '--json'];
  const out = await ctx.bkt(args, asOpts(as, timeout));
  let made: any;
  try {
    made = JSON.parse(out);
  } catch {
    made = undefined;
  }
  const number = Number(made?.id);
  const pr = number
    ? { number, url: String(made?.links?.html?.href ?? `https://bitbucket.org/${ctx.repo.ws}/${ctx.repo.slug}/pull-requests/${number}`) }
    : await ctx.findOpenPr(branch);
  if (!pr) throw new Error(`bkt did not return a pull request (${truncate(out, 120)})`);
  void ctx.refresh();
  return pr;
}

/** Replaces the description of the pull request at `url`, which may sit in another repository (cross-repo related PRs). */
export async function writeBody(ctx: WriteCtx, url: string, body: string, as?: HostAs): Promise<void> {
  const pr = parsePrUrl(url);
  if (!pr) throw new Error(`${url} is not a Bitbucket pull request`);
  const [ws, slug] = pr.repo.split('/');
  await ctx.bkt(['api', api({ dir: ctx.repo.dir, ws, slug }, `/pullrequests/${pr.number}`), '-X', 'PUT', '-d', JSON.stringify({ description: body })], asOpts(as, 60_000));
}

/**
 * The pull request a worker opened itself, read off a shell command it ran and what that printed:
 * `bkt pr create` prints the new pull request's URL. The last one printed is it.
 */
export function ownPr(command: unknown, text: string): { repo: string; number: number; url: string } | undefined {
  if (typeof command !== 'string' || !CREATES_PR.test(command)) return undefined;
  const last = [...text.matchAll(PR_URL)].pop();
  return last && { repo: last[1], number: Number(last[2]), url: last[0] };
}

export function parsePrUrl(text: string): { repo: string; number: number } | undefined {
  const url = /^https?:\/\/bitbucket\.org\/([\w.-]+\/[\w.-]+)\/pull-requests\/(\d+)(?:[/?#].*)?$/i.exec(text);
  return url ? { repo: url[1], number: Number(url[2]) } : undefined;
}

/** Bitbucket links no short form of a pull request, so it is its URL. */
export function prRef(url: string): string {
  return url;
}
