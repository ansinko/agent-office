// The boards of a floor whose code is on a host the office cannot read yet, or that has no remote:
// both say why, and nothing on them calls out anywhere.
import { HOST_NAMES, type Remote } from '../../shared/hosts.js';
import type { CodeHost, Tracker } from './types.js';

/** Why there is nothing on the boards. */
function why(remote: Remote | undefined): string {
  return remote ? `This project's remote is on ${HOST_NAMES[remote.kind]}, which the office cannot read yet` : 'This project has no remote. Push it to GitHub (git remote add origin <url>) to fill the boards.';
}

/**
 * A code host and a tracker that only say why they're empty. What answers with an error answers
 * with this one; what answers with something to show is refused with it.
 */
export function noHost(remote: Remote | undefined): { pulls: CodeHost; issues: Tracker } {
  const error = why(remote);
  const refuse = () => Promise.reject(new Error(error));
  const pulls: CodeHost = {
    pulls: { items: [], error, fetchedAt: 0, loading: false },
    refresh: async () => {},
    stop() {},
    repoInfo: refuse,
    viewer: async () => '',
    pullDetail: refuse,
    pullDiff: refuse,
    findPull: refuse,
    comment: async () => ({ error }),
    review: refuse,
    merge: async () => error,
    close: async () => error,
    repoLabels: refuse,
    setLabels: async () => ({ error }),
    findOpenPr: refuse,
    createPr: refuse,
    ownPr: () => undefined,
    parsePrUrl: () => undefined,
    prRef: (url) => url,
    pullBody: refuse,
    setPullBody: refuse,
  };
  return { pulls, issues: emptyTracker(error) };
}

/** A tracker with no issues that says why, answering and refusing as noHost's do. */
export function emptyTracker(error: string): Tracker {
  const refuse = () => Promise.reject(new Error(error));
  return {
    issues: { items: [], error, fetchedAt: 0, loading: false },
    refresh: async () => {},
    stop() {},
    reasons: refuse,
    issueDetail: refuse,
    comment: async () => ({ error }),
    close: async () => error,
    repoLabels: refuse,
    setLabels: async () => ({ error }),
    claim: async () => error,
  };
}
