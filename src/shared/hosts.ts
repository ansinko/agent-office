// Where a project's code is hosted, read off its git remote. Pure: the client and the server both use it.

export type HostKind = 'github' | 'bitbucket';

/** What each host is called where a person reads it. */
export const HOST_NAMES: Record<HostKind, string> = { github: 'GitHub', bitbucket: 'Bitbucket' };

/**
 * The command lines agent prompts quote, as templates over a prompt's own {{placeholders}}: what an
 * agent runs to read pull requests and issues on the floor's host.
 */
export interface HostCommands {
  viewPull: string;
  diffPull: string;
  checkout: string;
  checks: string;
  lineComments: string;
  createPr: string;
  viewIssue: string;
  listIssues: string;
  /** The pull request commands a board agent reads with, without a number. */
  pullCommands: string;
  /** The CLI's own name. */
  cliName: string;
}

/** GitHub's, through the gh CLI. The client quotes these for a floor whose host sends none. */
export const GITHUB_COMMANDS: HostCommands = {
  viewPull: 'gh pr view {{number}}',
  diffPull: 'gh pr diff {{number}}',
  checkout: 'gh pr checkout {{number}}',
  checks: 'gh pr checks {{number}} --watch',
  lineComments: 'gh api repos/{{repo}}/pulls/{{number}}/comments',
  createPr: 'gh pr create',
  viewIssue: 'gh issue view {{number}} --comments',
  listIssues: 'gh issue list',
  pullCommands: 'gh pr view, gh pr diff, gh pr checks',
  cliName: 'gh',
};

/** Bitbucket's, through the bkt CLI. Its issues are on Jira, which has no commands here yet. */
export const BITBUCKET_COMMANDS: HostCommands = {
  viewPull: 'bkt pr view {{number}}',
  diffPull: 'bkt pr diff {{number}}',
  checkout: 'bkt pr checkout {{number}}',
  checks: 'bkt pr checks {{number}} --wait',
  lineComments: 'bkt pr comments {{number}}',
  createPr: 'bkt pr create',
  viewIssue: '',
  listIssues: '',
  pullCommands: 'bkt pr view, bkt pr diff, bkt pr checks',
  cliName: 'bkt',
};

/** Just the command lines of `cli`, which may carry more (the server's merge line). */
export function commandsOf(cli: HostCommands): HostCommands {
  const { viewPull, diffPull, checkout, checks, lineComments, createPr, viewIssue, listIssues, pullCommands, cliName } = cli;
  return { viewPull, diffPull, checkout, checks, lineComments, createPr, viewIssue, listIssues, pullCommands, cliName };
}

/** The hosts the office knows, by the domain their remotes name. */
const DOMAINS: Record<string, HostKind> = { 'github.com': 'github', 'bitbucket.org': 'bitbucket' };

export interface Remote {
  kind: HostKind;
  /** owner/name (a Bitbucket workspace/repo-slug). */
  repo: string;
  /** The repository's page. */
  url: string;
}

const OWNER = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?$/;
const NAME = /^[a-zA-Z0-9_.-]{1,100}$/;

function ownerName(path: string): string | undefined {
  const parts = path.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '').split('/');
  // A URL may go on past the repository (…/owner/repo/issues/12).
  if (parts.length < 2) return undefined;
  const [owner, repo] = parts;
  if (!OWNER.test(owner) || !NAME.test(repo) || repo === '.' || repo === '..') return undefined;
  return `${owner}/${repo}`;
}

/** A remote URL (https, ssh:// or scp-style git@host:path) on a host the office knows. */
export function parseRemote(value: unknown): Remote | undefined {
  if (typeof value !== 'string' || value.length > 300) return undefined;
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[/:](.+)$/i.exec(value.trim());
  const kind = m && DOMAINS[m[1].toLowerCase()];
  const repo = kind ? ownerName(m[2]) : undefined;
  return kind && repo ? { kind, repo, url: `https://${m[1].toLowerCase()}/${repo}` } : undefined;
}

/**
 * `owner/repo` from what someone typed or pasted: owner/repo or a github.com URL. Undefined for
 * anything else, so it can never become a CLI option, a path or another host.
 */
export function normalizeRepo(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 200) return undefined;
  const s = value.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) {
    const r = ownerName(s);
    // GitHub owners have no underscores.
    return r && !r.split('/')[0].includes('_') ? r : undefined;
  }
  const r = parseRemote(s);
  return r?.kind === 'github' ? r.repo : undefined;
}
