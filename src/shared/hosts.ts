// Where a project's code is hosted, read off its git remote. Pure: the client and the server both use it.

export type HostKind = 'github' | 'bitbucket';

/** What each host is called where a person reads it. */
export const HOST_NAMES: Record<HostKind, string> = { github: 'GitHub', bitbucket: 'Bitbucket' };

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
