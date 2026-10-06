// A floor's pull requests on GitHub, through the gh CLI: the board, the PR window, and the pull
// requests workers open.
import type { BoardRef, Choice, Comment, Label, Pull, PullDetail, RepoInfo, ReviewComment, BoardState, PullState } from '../../../shared/protocol.js';
import type { CodeHost, HostAs } from '../types.js';
import { truncate } from '../../workers/util.js';
import { GITHUB_CAPS, GITHUB_METHODS, GITHUB_REASONS, pullReview, pullState, readiness } from './map.js';
import { checkOf, checksOf, commentsOf, gh, labels, postComment, putLabels, Relabels } from './gh.js';

/** How long the repo's list of labels is kept before the label picker asks GitHub again. */
const LABELS_MS = 60_000;
/** `gh pr create` being run, alone or in a longer line: not one that only names it (a grep for it, a quoted string). */
const CREATES_PR = /(?:^|[\s;&|(])gh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/** What `gh repo view` says each merge method needs switched on. */
const ALLOWED: Record<string, string> = { squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' };

/** The merge methods a repository allows, from `gh repo view`; all of them when it says none. */
export function mergeMethods(r: Record<string, unknown>): Choice[] {
  const methods = GITHUB_METHODS.filter((m) => r[ALLOWED[m.id]]);
  return methods.length ? methods : GITHUB_METHODS;
}

export class GitHubPulls implements CodeHost {
  pulls: BoardState<Pull> = { items: [], fetchedAt: 0, loading: false };
  private repo?: Promise<RepoInfo>;
  private login?: Promise<string>;
  private labelList?: { at: number; list: Promise<Label[]> };
  /** Labels just changed from the office, by PR number. */
  private relabeled = new Relabels();

  constructor(
    private dir: string,
    private onPulls: (s: BoardState<Pull>) => void,
  ) {}

  stop() {}

  /** The repository's full name, how it lets PRs merge, and what GitHub can do. Asked once (again after a failure). */
  repoInfo(): Promise<RepoInfo> {
    this.repo ??= gh(['repo', 'view', '--json', 'nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'], this.dir).then((out) => {
      const r = JSON.parse(out);
      return { name: String(r.nameWithOwner), methods: mergeMethods(r), reasons: GITHUB_REASONS, caps: GITHUB_CAPS };
    });
    this.repo.catch(() => (this.repo = undefined));
    return this.repo;
  }

  /** Who the office's own gh is signed in as, which is who it comments as for everyone without their own. Asked once; '' when gh can't say. */
  viewer(): Promise<string> {
    this.login ??= gh(['api', 'user', '--jq', '.login'], this.dir).then((out) => out.trim());
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  /**
   * A PR's description, conversation, line comments, checks and whether it can merge. `me` is the
   * GitHub login of whoever asked, when they're signed in to their own; else it's the office's.
   */
  async pullDetail(n: number, me?: string): Promise<PullDetail> {
    const fields = 'number,body,state,isDraft,reviewDecision,headRefName,baseRefName,mergeable,mergeStateStatus,commits,comments,reviews,statusCheckRollup';
    const jq = '.[] | {id, in_reply_to_id, path, line, side, body, user: .user.login, created_at, html_url}';
    const [view, lines, repo, viewer] = await Promise.all([
      gh(['pr', 'view', String(n), '--json', fields], this.dir),
      gh(['api', `repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`, '--paginate', '--jq', jq], this.dir),
      this.repoInfo(),
      me ?? this.viewer(),
    ]);
    const p = JSON.parse(view);
    const review = pullReview(p.reviewDecision ?? '');
    const reviewComments: ReviewComment[] = lines
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .map((c: any) => ({
        id: c.id,
        replyTo: c.in_reply_to_id ?? undefined,
        author: c.user ?? 'ghost',
        body: String(c.body ?? ''),
        createdAt: c.created_at,
        url: c.html_url,
        path: c.path,
        line: c.line ?? null,
        side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      }));
    return {
      number: p.number,
      body: String(p.body ?? ''),
      state: pullState(p.state, !!p.isDraft),
      review,
      headRefName: p.headRefName,
      baseRefName: p.baseRefName,
      readiness: readiness(p.mergeable ?? 'UNKNOWN', p.mergeStateStatus ?? 'UNKNOWN', review),
      commits: (p.commits ?? []).length,
      comments: commentsOf(p.comments),
      // A line comment also makes an empty COMMENTED review; the comment itself is shown instead.
      reviews: commentsOf((p.reviews ?? []).filter((r: any) => String(r.body ?? '').trim() || r.state !== 'COMMENTED')),
      reviewComments,
      checks: (p.statusCheckRollup ?? []).map(checkOf),
      repo,
      viewer,
    };
  }

  /** The PR's unified diff, as `git diff` prints it. */
  pullDiff(n: number): Promise<string> {
    return gh(['pr', 'diff', String(n), '--color', 'never'], this.dir, 60_000);
  }

  async findPull(n: number): Promise<{ url: string; state: PullState }> {
    const raw = JSON.parse(await gh(['pr', 'view', String(n), '--json', 'url,state'], this.dir)) as { url: string; state: string };
    return { url: raw.url, state: pullState(raw.state, false) };
  }

  /** Comments on a PR's conversation, as `as` or else the office. Returns the comment as GitHub saved it, or why it couldn't. */
  async comment(ref: BoardRef & { kind: 'pull' }, body: string, as?: HostAs): Promise<{ comment?: Comment; error?: string }> {
    let comment: Comment;
    try {
      comment = await postComment(this.dir, String(ref.number), body, as?.env);
    } catch (err) {
      return { error: (err as Error).message };
    }
    // A PR's card shows when it was last updated.
    void this.refresh();
    return { comment };
  }

  /**
   * Posts a review on a pull request that only comments (the meeting room's review panel), its body
   * read from a file. Resolves to the review's URL.
   */
  async review(n: number, file: string, as?: HostAs): Promise<string> {
    // -F reads @file's contents as the value; {owner}/{repo} are filled in from the checkout's remote.
    const url = (await gh(['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${n}/reviews`, '-F', `body=@${file}`, '-f', 'event=COMMENT', '--jq', '.html_url'], this.dir, 60_000, as?.env)).trim();
    void this.refresh();
    return url;
  }

  /** Merges a PR, or with `auto` has GitHub merge it once its requirements pass. Returns an error. */
  async merge(n: number, method: string, deleteBranch: boolean, auto: boolean, as?: HostAs): Promise<string | undefined> {
    try {
      const repo = await this.repoInfo();
      // --repo keeps gh out of the office's own checkout: without it, --delete-branch also deletes
      // the local branch and switches the project folder over to the base branch.
      const args = ['pr', 'merge', String(n), `--${method}`, '--repo', repo.name];
      if (deleteBranch) args.push('--delete-branch');
      if (auto) args.push('--auto');
      await gh(args, this.dir, 90_000, as?.env);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refresh();
    return undefined;
  }

  /** Closes a pull request without merging it, optionally saying why. Returns an error. */
  async close(n: number, opts: { comment?: string; deleteBranch?: boolean }, as?: HostAs): Promise<string | undefined> {
    try {
      const repo = await this.repoInfo();
      // --repo for the same reason as merge: --delete-branch must leave the office's checkout alone.
      const args = ['pr', 'close', String(n), '--repo', repo.name];
      // --flag=value, so a comment starting with "-" isn't read as a flag.
      if (opts.comment) args.push(`--comment=${opts.comment}`);
      if (opts.deleteBranch) args.push('--delete-branch');
      await gh(args, this.dir, undefined, as?.env);
    } catch (err) {
      return (err as Error).message;
    }
    // A refresh already in flight was asked before it closed and can still list it as open, so look again shortly after.
    void this.refresh().then(() => {
      if (this.pulls.items.some((p) => p.number === n && (p.state === 'open' || p.state === 'draft'))) setTimeout(() => void this.refresh(), 3000);
    });
    return undefined;
  }

  /** Every label the repository has, for the label picker. Asked again after a minute (or a failure). */
  repoLabels(): Promise<Label[]> {
    if (!this.labelList || Date.now() - this.labelList.at > LABELS_MS) {
      const list = gh(['api', 'repos/{owner}/{repo}/labels?per_page=100', '--paginate', '--jq', '.[] | {name, color, description}'], this.dir).then((out) =>
        out
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l))
          .map((l: any) => ({ name: String(l.name), color: `#${l.color ?? '888888'}`, description: l.description || undefined })),
      );
      this.labelList = { at: Date.now(), list };
      list.catch(() => this.labelList?.list === list && (this.labelList = undefined));
    }
    return this.labelList.list;
  }

  /** Puts labels on a PR and takes others off, as `as` or else the office. Returns the labels it has now, or why they didn't change. */
  async setLabels(n: number, add: string[], remove: string[], as?: HostAs): Promise<{ labels?: Label[]; error?: string }> {
    let now: Label[];
    try {
      now = await putLabels(this.dir, String(n), add, remove, as?.env);
    } catch (err) {
      // Some may have changed before it failed.
      void this.refresh();
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look at GitHub (see Relabels).
    const at = Date.now();
    this.relabeled.set(String(n), now, at);
    this.pulls = { ...this.pulls, items: this.relabeled.over(this.pulls.items, (p) => String(p.number), at) };
    this.onPulls(this.pulls);
    void this.refresh();
    return { labels: now };
  }

  async findOpenPr(branch: string, cwd: string): Promise<{ number: number; url: string } | undefined> {
    const out = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,url'], cwd);
    const found = (JSON.parse(out || '[]') as { number: number; url: string }[])[0];
    return found ? { number: found.number, url: found.url } : undefined;
  }

  /** `gh pr create` for a pushed branch; resolves to the new pull request. */
  async createPr(branch: string, base: string | undefined, title: string, body: string, cwd: string, as?: HostAs, timeout = 60_000): Promise<{ number: number; url: string }> {
    const out = await gh(['pr', 'create', '--head', branch, ...(base ? ['--base', base] : []), '--title', title, '--body', body], cwd, timeout, as?.env);
    const url = out.trim().split('\n').pop() ?? '';
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
    if (!number) throw new Error(`gh did not return a pull request URL (${truncate(out, 120)})`);
    return { number, url };
  }

  /**
   * The pull request a worker opened itself, read off a shell command it ran and what that printed:
   * `gh pr create` prints the new pull request's URL, or the one its branch already had. The last one
   * printed is it.
   */
  ownPr(command: unknown, output: string): { repo: string; number: number; url: string } | undefined {
    if (typeof command !== 'string' || !CREATES_PR.test(command)) return undefined;
    const last = [...output.matchAll(PR_URL)].pop();
    return last && { repo: last[1], number: Number(last[2]), url: last[0] };
  }

  parsePrUrl(text: string): { repo: string; number: number } | undefined {
    const url = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(text);
    return url ? { repo: url[1], number: Number(url[2]) } : undefined;
  }

  /** owner/name#12 for a pull request on GitHub (which links it with its title), else its URL. */
  prRef(url: string): string {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
    return m ? `${m[1]}#${m[2]}` : url;
  }

  pullBody(url: string, cwd: string, as?: HostAs): Promise<string> {
    return gh(['pr', 'view', url, '--json', 'body', '--jq', '.body'], cwd, 30_000, as?.env);
  }

  async setPullBody(url: string, body: string, cwd: string, as?: HostAs): Promise<void> {
    await gh(['pr', 'edit', url, '--body', body], cwd, 60_000, as?.env);
  }

  async refresh() {
    if (this.pulls.loading) return;
    this.pulls = { ...this.pulls, loading: true };
    this.onPulls(this.pulls);
    const asked = Date.now();
    try {
      const fields = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,headRefOid,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';
      const [open, merged, closed] = await Promise.all([
        gh(['pr', 'list', '--state', 'open', '--limit', '150', '--json', fields], this.dir),
        gh(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', fields], this.dir),
        gh(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', fields], this.dir),
      ]);
      // `--state closed` includes merged PRs; keep only the ones closed without merging.
      const seen = new Set<number>();
      const all = [...JSON.parse(open), ...JSON.parse(merged), ...JSON.parse(closed)].filter((p: any) => !seen.has(p.number) && seen.add(p.number));
      const fetched: Pull[] = all.map((p: any) => ({
        number: p.number,
        title: p.title,
        state: pullState(p.state, !!p.isDraft),
        url: p.url,
        author: p.author?.login ?? '',
        labels: labels(p.labels),
        review: pullReview(p.reviewDecision ?? ''),
        headRefName: p.headRefName,
        headRefOid: typeof p.headRefOid === 'string' ? p.headRefOid : undefined,
        baseRefName: p.baseRefName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        additions: p.additions ?? 0,
        deletions: p.deletions ?? 0,
        checks: checksOf(p.statusCheckRollup),
        body: String(p.body ?? '').slice(0, 4000),
        closes: (p.closingIssuesReferences ?? [])
          .map((r: any) => Number(r.number))
          .filter((n: number) => Number.isInteger(n) && n > 0)
          .map(String),
      }));
      const items = this.relabeled.over(fetched, (p) => String(p.number), asked);
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
