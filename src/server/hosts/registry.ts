// Every kind of host the office detects, and the adapter that reads it.
import type { HostKind, Remote } from '../../shared/hosts.js';
import { originRemote } from '../building.js';
import { bitbucket } from './bitbucket/index.js';
import { github } from './github/index.js';
import { noHost } from './none.js';
import type { CodeHost, HostAdapter } from './types.js';

/** One adapter per host kind; null for a kind the office detects but cannot read yet. */
export const HOSTS: Record<HostKind, HostAdapter | null> = {
  github,
  bitbucket,
};

/**
 * The adapter for a project with this origin. With no origin it's GitHub's, whose gh says the
 * project has no GitHub remote yet; a kind the office cannot read yet has none.
 */
export function adapterFor(remote: Remote | undefined): HostAdapter | null {
  return remote ? HOSTS[remote.kind] : HOSTS.github;
}

/** The code host of the project at `dir`, read off its origin: for code that has the folder and not the floor. It has no board. */
export function hostFor(dir: string): CodeHost {
  const remote = originRemote(dir);
  const adapter = adapterFor(remote);
  return adapter ? adapter.pulls(dir, () => {}, remote) : noHost(remote).pulls;
}
