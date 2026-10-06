// GitHub's states, review decisions and merge states, in the office's own words.
import type { IssueState, PullReview, PullState, Readiness } from '../../../shared/protocol.js';

export function pullState(state: string, isDraft: boolean): PullState {
  const s = state.toUpperCase();
  if (s === 'MERGED') return 'merged';
  if (s === 'CLOSED') return 'closed';
  return isDraft ? 'draft' : 'open';
}

export function pullReview(decision: string): PullReview {
  return ({ APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'pending' } as Record<string, PullReview>)[decision] ?? 'none';
}

/** A single review's verdict; a review that only comments has none. */
export function reviewOf(state: string): PullReview | undefined {
  return ({ APPROVED: 'approved', CHANGES_REQUESTED: 'changes' } as Record<string, PullReview>)[state];
}

export function readiness(mergeable: string, mergeState: string, review: PullReview): Readiness {
  if (mergeable === 'CONFLICTING' || mergeState === 'DIRTY') return 'conflict';
  if (mergeState === 'BEHIND') return 'behind';
  if (mergeState === 'BLOCKED' || mergeState === 'DRAFT') return 'blocked';
  if (mergeState === 'UNSTABLE') return 'checks';
  if (mergeable === 'UNKNOWN') return 'unknown';
  if (mergeState === 'CLEAN' || mergeState === 'HAS_HOOKS') return 'clean';
  return review === 'changes' ? 'blocked' : 'unknown';
}

export function issueState(state: string): IssueState {
  return state.toUpperCase() === 'OPEN' ? 'open' : 'closed';
}
