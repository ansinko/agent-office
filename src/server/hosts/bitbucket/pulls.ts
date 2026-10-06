// A floor's pull requests on Bitbucket, through bkt: the board and the PR window. The writes are in
// write.ts, which each write member hands its ctx.
import { execFile } from 'node:child_process';
import type { BoardRef, BoardState, Choice, Comment, HostCaps, Label, Pull, PullDetail, PullState, RepoInfo } from '../../../shared/protocol.js';
import type { CodeHost, HostAs } from '../types.js';
import { api, bktIn, repoFlags, type BbRepo, type Bkt } from './bkt.js';
import { author, checkOf, checksOf, commentsOf, pullReview, pullState, readiness, reviewsOf } from './map.js';
import { commentOn, declinePull, mergePull, openPull, ownPr, parsePrUrl, prRef, refuseLabels, reviewOn, writeBody, type WriteCtx } from './write.js';

/** How Bitbucket merges a pull request; the ids are what `bkt pr merge --strategy` takes. */
export const BITBUCKET_METHODS: Choice[] = [
  { id: 'merge_commit', label: 'Merge commit' },
  { id: 'squash', label: 'Squash' },
  { id: 'fast_forward', label: 'Fast forward' },
];

export const BITBUCKET_CAPS: HostCaps = { labels: false, autoMerge: false, lineComments: true, deleteBranch: true };

/** What the board reads of each pull request in a listing. */
const LIST_FIELDS = [
  'next',
  ...['id', 'title', 'description', 'state', 'draft', 'created_on', 'updated_on', 'author', 'source.branch.name', 'source.commit.hash', 'destination.branch.name', 'links.html.href', 'participants.role', 'participants.approved', 'participants.state', 'participants.user'].map((f) => `values.${f}`),
].join(',');

/** How many open pull requests have their statuses and diffstat asked at once. */
const AT_ONCE = 4;

/** `bkt api` takes a path; Bitbucket's `next` is a full URL. */
const pathOf = (next: string) => next.replace(/^https:\/\/api\.bitbucket\.org\/2\.0/, '');

/** Every value of a paged listing, following `next` until there are `limit` of them. */
async function pages(bkt: Bkt, path: string, params: string[], limit = Infinity): Promise<any[]> {
  const values: any[] = [];
  let args = ['api', path, ...params.flatMap((p) => ['-P', p])];
  for (;;) {
    const page = JSON.parse(await bkt(args));
    values.push(...(page.values ?? []));
    if (values.length >= limit || !page.next) return values.slice(0, limit);
    args = ['api', pathOf(String(page.next))];
  }
}

/** The pull requests in one state, newest first, up to `limit` of them. */
export function listQuery(state: string, limit: number): (bkt: Bkt, repo: BbRepo) => Promise<any[]> {
  return (bkt, repo) => pages(bkt, api(repo, '/pullrequests'), [`state=${state}`, 'pagelen=50', `fields=${LIST_FIELDS}`], limit);
}

const LISTS = [listQuery('OPEN', 150), listQuery('MERGED', 30), listQuery('DECLINED', 40)];

/** Runs `fn` on every item, `n` at a time. */
async function eachAtOnce<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

/** git in the floor's checkout; resolves to stdout. */
export function gitIn(dir: string): (args: string[]) => Promise<string> {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('git', args, { cwd: dir, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
}

/** What the board shows of an open pull request's commit: its checks and lines changed. */
interface Stats {
  checks: Pull['checks'];
  additions: number;
  deletions: number;
}

export class BitbucketPulls implements CodeHost {
  pulls: BoardState<Pull> = { items: [], fetchedAt: 0, loading: false };
  private login?: Promise<string>;
  /** Checks and lines of open pull requests, by source commit hash: a commit's never change. */
  private stats = new Map<string, Stats>();
  /** Full hashes of the 12-character ones Bitbucket gives, once the checkout has them. */
  private full = new Map<string, string>();

  constructor(
    private repo: BbRepo,
    private onPulls: (s: BoardState<Pull>) => void,
    private bkt: Bkt = bktIn(repo.dir),
    private git: (args: string[]) => Promise<string> = gitIn(repo.dir),
  ) {}

  stop() {}

  private get ctx(): WriteCtx {
    return { repo: this.repo, bkt: this.bkt, refresh: () => this.refresh(), findOpenPr: (branch) => this.findOpenPr(branch, this.repo.dir) };
  }

  async repoInfo(): Promise<RepoInfo> {
    return { name: `${this.repo.ws}/${this.repo.slug}`, methods: BITBUCKET_METHODS, reasons: [], caps: BITBUCKET_CAPS };
  }

  /** Who the office's bkt is signed in as. Asked once (again after a failure); '' when bkt can't say. */
  viewer(): Promise<string> {
    this.login ??= this.bkt(['api', '/user']).then((out) => author(JSON.parse(out)));
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  /** A PR's description, conversation, line comments, checks and whether it can merge. `me` is whoever asked, when signed in to their own. */
  async pullDetail(n: number, me?: string): Promise<PullDetail> {
    const at = (path: string) => api(this.repo, `/pullrequests/${n}${path}`);
    const [p, comments, statuses, diffstat, commits, repo, viewer] = await Promise.all([
      this.bkt(['api', at('')]).then((out) => JSON.parse(out)),
      pages(this.bkt, at('/comments'), ['pagelen=100']),
      pages(this.bkt, at('/statuses'), []),
      pages(this.bkt, at('/diffstat'), []),
      pages(this.bkt, at('/commits'), []),
      this.repoInfo(),
      me ?? this.viewer(),
    ]);
    const review = pullReview(p.participants);
    const checks = statuses.map(checkOf);
    return {
      number: Number(p.id),
      body: String(p.description ?? ''),
      state: pullState(String(p.state ?? ''), !!p.draft),
      review,
      headRefName: String(p.source?.branch?.name ?? ''),
      baseRefName: String(p.destination?.branch?.name ?? ''),
      readiness: readiness(diffstat, checks, review),
      commits: commits.length,
      ...commentsOf(comments),
      reviews: reviewsOf(p.participants),
      checks,
      repo,
      viewer,
    };
  }

  /** The PR's unified diff, as `git diff` prints it. */
  pullDiff(n: number): Promise<string> {
    return this.bkt(['pr', 'diff', String(n), ...repoFlags(this.repo)], { timeout: 60_000 });
  }

  async findPull(n: number): Promise<{ url: string; state: PullState }> {
    const p = JSON.parse(await this.bkt(['api', api(this.repo, `/pullrequests/${n}`), '-P', 'fields=links.html.href,state,draft']));
    return { url: String(p.links?.html?.href ?? ''), state: pullState(String(p.state ?? ''), !!p.draft) };
  }

  async findOpenPr(branch: string, _cwd: string): Promise<{ number: number; url: string } | undefined> {
    const q = `source.branch.name="${branch.replace(/"/g, '\\"')}" AND state="OPEN"`;
    const found = JSON.parse(await this.bkt(['api', api(this.repo, '/pullrequests'), '-P', `q=${q}`, '-P', 'pagelen=1'])).values?.[0];
    return found ? { number: Number(found.id), url: String(found.links?.html?.href ?? '') } : undefined;
  }

  async repoLabels(): Promise<Label[]> {
    return [];
  }

  /** A PR's description by URL; it may sit in another repository (cross-repo related PRs). */
  async pullBody(url: string, _cwd: string, as?: HostAs): Promise<string> {
    const pr = parsePrUrl(url);
    if (!pr) throw new Error(`${url} is not a Bitbucket pull request`);
    const [ws, slug] = pr.repo.split('/');
    const out = await this.bkt(['api', api({ dir: this.repo.dir, ws, slug }, `/pullrequests/${pr.number}`), '-P', 'fields=description'], { env: as?.env });
    return String(JSON.parse(out).description ?? '');
  }

  comment(ref: BoardRef & { kind: 'pull' }, body: string, as?: HostAs): Promise<{ comment?: Comment; error?: string }> {
    return commentOn(this.ctx, ref.number, body, as);
  }

  review(n: number, file: string, as?: HostAs): Promise<string> {
    return reviewOn(this.ctx, n, file, as);
  }

  merge(n: number, method: string, deleteBranch: boolean, auto: boolean, as?: HostAs): Promise<string | undefined> {
    return mergePull(this.ctx, n, method, deleteBranch, auto, as);
  }

  close(n: number, opts: { comment?: string; deleteBranch?: boolean }, as?: HostAs): Promise<string | undefined> {
    return declinePull(this.ctx, n, opts, as);
  }

  setLabels(): Promise<{ labels?: Label[]; error?: string }> {
    return refuseLabels();
  }

  createPr(branch: string, base: string | undefined, title: string, body: string, _cwd: string, as?: HostAs, timeout?: number): Promise<{ number: number; url: string }> {
    return openPull(this.ctx, branch, base, title, body, as, timeout);
  }

  setPullBody(url: string, body: string, _cwd: string, as?: HostAs): Promise<void> {
    return writeBody(this.ctx, url, body, as);
  }

  ownPr(command: unknown, text: string) {
    return ownPr(command, text);
  }

  parsePrUrl(text: string) {
    return parsePrUrl(text);
  }

  prRef(url: string): string {
    return prRef(url);
  }

  /** Checks and lines changed of each open pull request's commit, asked only for commits not seen before. */
  private async statsOf(open: any[]): Promise<Map<string, Stats>> {
    const now = new Map<string, Stats>();
    const asks: { n: number; hash: string }[] = [];
    for (const p of open) {
      const hash = String(p.source?.commit?.hash ?? '');
      const known = this.stats.get(hash);
      if (known) now.set(hash, known);
      else asks.push({ n: Number(p.id), hash });
    }
    await eachAtOnce(asks, AT_ONCE, async ({ n, hash }) => {
      const at = (path: string) => api(this.repo, `/pullrequests/${n}${path}`);
      const [statuses, diffstat] = await Promise.all([pages(this.bkt, at('/statuses'), []), pages(this.bkt, at('/diffstat'), [])]);
      now.set(hash, {
        checks: checksOf(statuses),
        additions: diffstat.reduce((s, d) => s + (Number(d?.lines_added) || 0), 0),
        deletions: diffstat.reduce((s, d) => s + (Number(d?.lines_removed) || 0), 0),
      });
    });
    this.stats = now;
    return now;
  }

  /** The full hash of a 12-character one, when the checkout has that commit. */
  private async expand(hash: string): Promise<string | undefined> {
    if (!hash) return undefined;
    const known = this.full.get(hash);
    if (known) return known;
    const full = await this.git(['rev-parse', '--verify', `${hash}^{commit}`]).then((out) => out.trim(), () => '');
    if (!/^[0-9a-f]{40,64}$/.test(full)) return undefined;
    this.full.set(hash, full);
    return full;
  }

  async refresh() {
    if (this.pulls.loading) return;
    this.pulls = { ...this.pulls, loading: true };
    this.onPulls(this.pulls);
    try {
      const [open, merged, declined] = await Promise.all(LISTS.map((list) => list(this.bkt, this.repo)));
      const stats = await this.statsOf(open);
      const seen = new Set<number>();
      const all = [...open, ...merged, ...declined].filter((p) => !seen.has(p.id) && seen.add(p.id));
      const oids = new Map<string, string | undefined>();
      await eachAtOnce([...new Set(all.map((p) => String(p.source?.commit?.hash ?? '')))], AT_ONCE, async (h) => void oids.set(h, await this.expand(h)));
      const items: Pull[] = all.map((p) => {
        const hash = String(p.source?.commit?.hash ?? '');
        const s = stats.get(hash);
        return {
          number: Number(p.id),
          title: String(p.title ?? ''),
          state: pullState(String(p.state ?? ''), !!p.draft),
          url: String(p.links?.html?.href ?? ''),
          author: author(p.author),
          labels: [],
          review: pullReview(p.participants),
          headRefName: String(p.source?.branch?.name ?? ''),
          headRefOid: oids.get(hash),
          baseRefName: String(p.destination?.branch?.name ?? ''),
          createdAt: String(p.created_on ?? ''),
          updatedAt: String(p.updated_on ?? ''),
          additions: s?.additions ?? 0,
          deletions: s?.deletions ?? 0,
          checks: s?.checks ?? 'none',
          body: String(p.description ?? '').slice(0, 4000),
          closes: [],
        };
      });
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
