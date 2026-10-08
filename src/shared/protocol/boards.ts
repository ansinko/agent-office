// The floor's boards: issues, pull requests, and what the office does to them.

/** A GitHub label; `color` is a CSS color ("#d73a4a"). */
export interface Label {
  name: string;
  color: string;
  /** What it's for, in the repo's list of labels (the label picker's /api/board/labels). */
  description?: string;
}

/** A pull request's state; a draft is open but not ready for review. */
export type PullState = 'open' | 'draft' | 'merged' | 'closed';
/** Where its reviews leave a pull request: approved, changes requested, an approving review required, or nothing asked. */
export type PullReview = 'approved' | 'changes' | 'pending' | 'none';
/** Whether an open pull request can merge: conflicts with its base, a base it is behind, a rule or review in the way, checks still running, or not worked out yet. */
export type Readiness = 'clean' | 'conflict' | 'behind' | 'blocked' | 'checks' | 'unknown';
export type IssueState = 'open' | 'closed';

export interface Issue {
  /** What the tracker calls it: GitHub's issue number ("12"), or a key like "ERN-123". */
  key: string;
  /** How it's shown: "#12" on GitHub. */
  ref: string;
  title: string;
  state: IssueState;
  url: string;
  author: string;
  labels: Label[];
  assignees: string[];
  /** A worker in the office just took it, so it's In progress on the board before GitHub lists its assignee. */
  taken?: boolean;
  createdAt: string;
  updatedAt: string;
  body: string;
  comments: number;
  /** The task a worker gets for it, when the tracker says what that is (a command tracker's own prompt). */
  prompt?: string;
}

export interface Pull {
  number: number;
  title: string;
  state: PullState;
  url: string;
  author: string;
  labels: Label[];
  review: PullReview;
  headRefName: string;
  /** The commit its branch is at on GitHub (for a merged PR, the last one merged). */
  headRefOid?: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  checks: 'pass' | 'fail' | 'pending' | 'none';
  body: string;
  /** Keys of the issues it closes ("closes #12" in its description), as GitHub links them. */
  closes: string[];
}

export interface BoardState<T> {
  items: T[];
  error?: string;
  fetchedAt: number;
  loading: boolean;
}

/** One of the ways the host offers to do something, and the words its button shows. */
export interface Choice {
  id: string;
  label: string;
}

/** What the host can do beyond commenting, merging and closing; the windows hide what it can't. */
export interface HostCaps {
  labels: boolean;
  autoMerge: boolean;
  lineComments: boolean;
  deleteBranch: boolean;
}

/** The repository's full name, how it lets pull requests merge, why its issues close, and what it can do. */
export interface RepoInfo {
  name: string;
  methods: Choice[];
  reasons: Choice[];
  caps: HostCaps;
  /** With a pull request's detail: the host's merge line for it, by mergeKey(method, deleteBranch), which the merge dialog hands a worker. */
  mergeCommands?: Record<string, string>;
}

/** RepoInfo.mergeCommands' key for a merge method, keeping or deleting the branch. */
export const mergeKey = (method: string, deleteBranch: boolean) => `${method}${deleteBranch ? ':delete' : ''}`;

/** A comment on an issue or on a PR's conversation, or a submitted review. */
export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** Reviews only: what it decided; a review that only comments has none. */
  review?: PullReview;
}

/** A comment on a line of a PR's diff. */
export interface ReviewComment {
  id: number;
  /** The first comment of the thread this one answers. */
  replyTo?: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  path: string;
  /** The line it's on now, or null when the code under it changed since (outdated). */
  line: number | null;
  /** LEFT is the old file's line numbers, RIGHT the new file's. */
  side: 'LEFT' | 'RIGHT';
}

export interface Check {
  name: string;
  state: 'pass' | 'fail' | 'pending' | 'skip';
  url?: string;
}

/** Everything the PR window shows beyond the board card: GET /api/board/pull?number=N */
export interface PullDetail {
  number: number;
  body: string;
  state: PullState;
  review: PullReview;
  headRefName: string;
  baseRefName: string;
  readiness: Readiness;
  commits: number;
  comments: Comment[];
  reviews: Comment[];
  reviewComments: ReviewComment[];
  checks: Check[];
  repo: RepoInfo;
  /** Who gh is signed in as on the server, and so who comments from the office appear from ('' if unknown). */
  viewer: string;
}

/** GET /api/board/issue?key=K */
export interface IssueDetail {
  key: string;
  state: IssueState;
  body: string;
  comments: Comment[];
  /** See PullDetail.viewer. */
  viewer: string;
  /** Why the tracker lets an issue close. */
  reasons: Choice[];
  caps: Pick<HostCaps, 'labels'>;
  /** The tracker only lists it: nobody comments on it, closes it or labels it from the office. */
  readOnly?: boolean;
}

/** GitHub turns away comments longer than this. */
export const COMMENT_MAX = 65536;
/** Longer than any label name: GitHub stops at 50 characters, and JS counts an emoji as two. */
export const LABEL_MAX = 100;

/** An issue's key from what was sent: a GitHub issue number (12, "12", "#12") or a tracker key like ERN-123 or I16-W3B. */
export const issueKey = (v: unknown): string | undefined => {
  const s = typeof v === 'number' && Number.isInteger(v) && v > 0 ? String(v) : typeof v === 'string' ? v.trim().replace(/^#/, '') : '';
  return /^(?:[1-9]\d{0,9}|[A-Z][A-Z0-9_]{0,19}-[A-Z0-9]{1,12})$/.test(s) ? s : undefined;
};

/** How an issue is named in a sentence: #12 for a GitHub issue, a tracker's key (ERN-123) as it is. */
export const issueRef = (key: string): string => (/^\d+$/.test(key) ? `#${key}` : key);

/** An issue by its key, or a pull request by its number: what the office comments on, closes and labels. */
export type BoardRef = { kind: 'issue'; key: string } | { kind: 'pull'; number: number };

export type BoardClientMsg =
  | { t: 'board.refresh' }
  /** Merge a pull request; the answer comes back as board.merged. */
  | { t: 'board.merge'; number: number; method: string; deleteBranch: boolean; auto?: boolean }
  /** Comment on an issue or a PR's conversation, as the server's gh account; answered with board.commented. */
  | ({ t: 'board.comment'; body: string } & BoardRef)
  /** Close an issue, or a pull request without merging it; the answer comes back as board.closed. */
  | ({ t: 'board.close'; comment?: string; reason?: string; deleteBranch?: boolean } & BoardRef)
  /** Put labels on an issue or PR and take others off, as the server's gh account; answered with board.labeled. */
  | ({ t: 'board.labels'; add: string[]; remove: string[] } & BoardRef);

export type BoardServerMsg =
  | { t: 'board.issues'; state: BoardState<Issue> }
  | { t: 'board.pulls'; state: BoardState<Pull> }
  /** Sent to whoever asked for the merge. */
  | { t: 'board.merged'; number: number; error?: string }
  /** Sent to whoever commented: the comment as GitHub saved it, or why it wasn't. */
  | ({ t: 'board.commented'; comment?: Comment; error?: string } & BoardRef)
  /** Sent to whoever asked to close it. */
  | ({ t: 'board.closed'; error?: string } & BoardRef)
  /** Sent to whoever changed them: the labels it has now, or why they didn't change. */
  | ({ t: 'board.labeled'; labels?: Label[]; error?: string } & BoardRef);
