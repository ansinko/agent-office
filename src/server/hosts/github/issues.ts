// A floor's issues on GitHub, through the gh CLI: the board, the issue window, and workers taking them.
import type { BoardRef, Choice, Comment, Issue, IssueDetail, Label, BoardState } from '../../../shared/protocol.js';
import type { CodeHost, HostAs, Tracker } from '../types.js';
import { Claims } from '../watch.js';
import { GITHUB_CAPS, GITHUB_REASONS, issueState } from './map.js';
import { commentsOf, gh, labels, postComment, putLabels, Relabels } from './gh.js';

export class GitHubIssues implements Tracker {
  issues: BoardState<Issue> = { items: [], fetchedAt: 0, loading: false };
  /** Labels just changed from the office, by issue key. */
  private relabeled = new Relabels();
  private claims = new Claims();
  /** The look at the issues that's under way, if one is. */
  private listing?: Promise<void>;

  constructor(
    private dir: string,
    private onIssues: (s: BoardState<Issue>) => void,
    /** The floor's pull requests on GitHub: one repository, so one look at its name, login and labels. */
    private host: CodeHost,
  ) {}

  stop() {}

  /** Asked of the repository, as merging is: a close goes to it by name. */
  async reasons(): Promise<Choice[]> {
    return (await this.host.repoInfo()).reasons;
  }

  async issueDetail(key: string, me?: string): Promise<IssueDetail> {
    const [view, viewer] = await Promise.all([gh(['issue', 'view', key, '--json', 'number,state,body,comments'], this.dir), me ?? this.host.viewer()]);
    const i = JSON.parse(view);
    return { key: String(i.number), state: issueState(i.state), body: String(i.body ?? ''), comments: commentsOf(i.comments), viewer, reasons: GITHUB_REASONS, caps: { labels: GITHUB_CAPS.labels } };
  }

  /** Comments on an issue, as `as` or else the office. Returns the comment as GitHub saved it, or why it couldn't. */
  async comment(ref: BoardRef & { kind: 'issue' }, body: string, as?: HostAs): Promise<{ comment?: Comment; error?: string }> {
    let comment: Comment;
    try {
      comment = await postComment(this.dir, ref.key, body, as?.env);
    } catch (err) {
      return { error: (err as Error).message };
    }
    // The issue board counts comments.
    void this.refresh();
    return { comment };
  }

  /** Closes an issue, optionally saying why. Returns an error. */
  async close(key: string, opts: { comment?: string; reason?: string }, as?: HostAs): Promise<string | undefined> {
    try {
      const repo = await this.host.repoInfo();
      const args = ['issue', 'close', key, '--repo', repo.name];
      // --flag=value, so a comment starting with "-" isn't read as a flag.
      if (opts.comment) args.push(`--comment=${opts.comment}`);
      if (opts.reason) args.push(`--reason=${opts.reason}`);
      await gh(args, this.dir, undefined, as?.env);
    } catch (err) {
      return (err as Error).message;
    }
    // A refresh already in flight was asked before it closed and can still list it as open, so look again shortly after.
    void this.refresh().then(() => {
      if (this.issues.items.some((i) => i.key === key && i.state === 'open')) setTimeout(() => void this.refresh(), 3000);
    });
    return undefined;
  }

  /** The repository's labels, from the same list the pull requests' picker uses. */
  repoLabels(): Promise<Label[]> {
    return this.host.repoLabels();
  }

  /** Puts labels on an issue and takes others off, as `as` or else the office. Returns the labels it has now, or why they didn't change. */
  async setLabels(key: string, add: string[], remove: string[], as?: HostAs): Promise<{ labels?: Label[]; error?: string }> {
    let now: Label[];
    try {
      now = await putLabels(this.dir, key, add, remove, as?.env);
    } catch (err) {
      // Some may have changed before it failed.
      void this.refresh();
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look at GitHub (see Relabels).
    const at = Date.now();
    this.relabeled.set(key, now, at);
    this.issues = { ...this.issues, items: this.relabeled.over(this.issues.items, (i) => i.key, at) };
    this.onIssues(this.issues);
    void this.refresh();
    return { labels: now };
  }

  /**
   * A worker took the issue: it moves to In progress on the board at once, and is assigned on GitHub
   * to `as` (else the office's own gh), which is what keeps it there. Returns an error when GitHub
   * wouldn't assign it, and the card goes back to where it was.
   */
  async claim(issue: string, as?: HostAs): Promise<string | undefined> {
    const answered = this.claims.take(issue);
    this.showClaims();
    try {
      await gh(['issue', 'edit', issue, '--add-assignee', '@me'], this.dir, undefined, as?.env);
    } catch (err) {
      answered(false);
      this.showClaims();
      return (err as Error).message;
    }
    answered(true);
    // For its assignee's name. A look already under way was asked before it was assigned, so look again after it.
    void this.refresh().then(() => (this.claims.has(issue) ? this.refresh() : undefined));
    return undefined;
  }

  /** Puts the issues workers have taken (or no longer have) on the board, ahead of the next look at GitHub. */
  private showClaims() {
    this.issues = { ...this.issues, items: this.claims.mark(this.issues.items) };
    this.onIssues(this.issues);
  }

  /** Asks GitHub for the issues. With a look already under way it's that one, which may have been asked before whatever just changed. */
  refresh(): Promise<void> {
    this.listing ??= this.listIssues().finally(() => (this.listing = undefined));
    return this.listing;
  }

  private async listIssues() {
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    const asked = Date.now();
    try {
      // Open and closed separately, so old open issues are never crowded out by recent closed ones.
      const fields = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';
      const [open, closed] = await Promise.all([
        gh(['issue', 'list', '--state', 'open', '--limit', '300', '--json', fields], this.dir),
        gh(['issue', 'list', '--state', 'closed', '--limit', '40', '--json', fields], this.dir),
      ]);
      const fetched: Issue[] = [...JSON.parse(open), ...JSON.parse(closed)].map((i: any) => ({
        key: String(i.number),
        ref: `#${i.number}`,
        title: i.title,
        state: issueState(i.state),
        url: i.url,
        author: i.author?.login ?? '',
        labels: labels(i.labels),
        assignees: (i.assignees ?? []).map((a: any) => a.login),
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        body: String(i.body ?? '').slice(0, 4000),
        comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments ?? 0),
      }));
      const items = this.claims.mark(this.relabeled.over(fetched, (i) => i.key, asked), asked);
      this.issues = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.issues = { ...this.issues, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onIssues(this.issues);
  }
}
