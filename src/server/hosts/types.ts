// What a floor asks of where its code and its issues live: a CodeHost for pull requests, a Tracker
// for issues, and the adapter that makes both for one kind of host (see registry.ts).
import type {
  BoardRef,
  BoardState,
  Choice,
  Comment,
  Issue,
  IssueDetail,
  Label,
  Pull,
  PullDetail,
  PullState,
  RepoInfo,
} from '../../shared/protocol.js';
import type { HostCommands, HostKind } from '../../shared/hosts.js';
import type { GhAs } from '../signins.js';

/** Who a write runs as: someone's own sign-in, by its env. Undefined means the office's own. */
export type HostAs = GhAs;

/** The command lines agent prompts quote, and the merge line the merge dialog hands a worker. */
export interface HostCli extends HostCommands {
  /** The merge dialog's command for a method id, with or without deleting the branch, on `repo`. */
  merge(number: number, method: string, deleteBranch: boolean, repo: string): string;
}

export interface CodeHost {
  readonly pulls: BoardState<Pull>;
  refresh(): Promise<void>;
  stop(): void;
  repoInfo(): Promise<RepoInfo>;
  /** Who the office's own sign-in is, which is who it comments as for everyone without their own; '' when the host can't say. */
  viewer(): Promise<string>;
  pullDetail(n: number, me?: string): Promise<PullDetail>;
  pullDiff(n: number): Promise<string>;
  /** Pull request `n`'s page and state, asked of the host: for one that isn't on the board. */
  findPull(n: number): Promise<{ url: string; state: PullState }>;
  comment(ref: BoardRef & { kind: 'pull' }, body: string, as?: HostAs): Promise<{ comment?: Comment; error?: string }>;
  review(n: number, file: string, as?: HostAs): Promise<string>;
  merge(n: number, method: string, deleteBranch: boolean, auto: boolean, as?: HostAs): Promise<string | undefined>;
  close(n: number, opts: { comment?: string; deleteBranch?: boolean }, as?: HostAs): Promise<string | undefined>;
  repoLabels(): Promise<Label[]>;
  setLabels(n: number, add: string[], remove: string[], as?: HostAs): Promise<{ labels?: Label[]; error?: string }>;
  findOpenPr(branch: string, cwd: string): Promise<{ number: number; url: string } | undefined>;
  createPr(branch: string, base: string | undefined, title: string, body: string, cwd: string, as?: HostAs, timeout?: number): Promise<{ number: number; url: string }>;
  /** A pull request this host would print in `text` after `command` (a worker's own PR), if it is one. */
  ownPr(command: unknown, text: string): { repo: string; number: number; url: string } | undefined;
  /** A pull request's page on this host, as someone pasted it: whose repository and which number. */
  parsePrUrl(text: string): { repo: string; number: number } | undefined;
  /** owner/name#12 where the host links that form, else the URL. */
  prRef(url: string): string;
  /** Read a PR's description by URL, and replace it (cross-repo related PRs). */
  pullBody(url: string, cwd: string, as?: HostAs): Promise<string>;
  setPullBody(url: string, body: string, cwd: string, as?: HostAs): Promise<void>;
}

export interface Tracker {
  readonly issues: BoardState<Issue>;
  refresh(): Promise<void>;
  stop(): void;
  /** Why an issue may close, the first being what it closes as when nobody picks. */
  reasons(): Promise<Choice[]>;
  issueDetail(key: string, me?: string): Promise<IssueDetail>;
  comment(ref: BoardRef & { kind: 'issue' }, body: string, as?: HostAs): Promise<{ comment?: Comment; error?: string }>;
  close(key: string, opts: { comment?: string; reason?: string }, as?: HostAs): Promise<string | undefined>;
  repoLabels(): Promise<Label[]>;
  setLabels(key: string, add: string[], remove: string[], as?: HostAs): Promise<{ labels?: Label[]; error?: string }>;
  claim(key: string, as?: HostAs): Promise<string | undefined>;
}

export interface HostAdapter {
  kind: HostKind;
  /** Shown in the client: "GitHub". */
  name: string;
  cli: HostCli;
  pulls(dir: string, onPulls: (s: BoardState<Pull>) => void): CodeHost;
  /** The floor's issues; `host` is its code host, whose repository info, login and labels a tracker on the same host shares. */
  issues(dir: string, onIssues: (s: BoardState<Issue>) => void, host: CodeHost): Tracker;
}
