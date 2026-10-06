// Bitbucket's states, participants, pipeline statuses and comments, in the office's own words.
import type { Check, Comment, Pull, PullReview, PullState, Readiness, ReviewComment } from '../../../shared/protocol.js';

export function pullState(state: string, draft: boolean): PullState {
  const s = state.toUpperCase();
  if (s === 'MERGED') return 'merged';
  if (s === 'DECLINED' || s === 'SUPERSEDED') return 'closed';
  return draft ? 'draft' : 'open';
}

/** How a user is named on the board. */
export function author(u: any): string {
  return String(u?.nickname ?? u?.display_name ?? '');
}

/** One participant's verdict; one who only takes part has none. */
function verdict(p: any): PullReview | undefined {
  if (p?.state === 'changes_requested') return 'changes';
  if (p?.approved || p?.state === 'approved') return 'approved';
  return undefined;
}

/** Bitbucket lets anyone approve, so an approval from a participant counts as one from a reviewer. */
export function pullReview(participants: any[] | null | undefined): PullReview {
  const ps = participants ?? [];
  const verdicts = ps.map(verdict);
  if (verdicts.includes('changes')) return 'changes';
  if (verdicts.includes('approved')) return 'approved';
  return ps.some((p) => p?.role === 'REVIEWER') ? 'pending' : 'none';
}

const CHECK_STATES: Record<string, Check['state']> = { SUCCESSFUL: 'pass', FAILED: 'fail', INPROGRESS: 'pending', STOPPED: 'skip' };

/** One commit status, usually a Pipelines run. */
export function checkOf(status: any): Check {
  return {
    name: String(status?.name ?? status?.key ?? 'check'),
    state: CHECK_STATES[String(status?.state ?? '').toUpperCase()] ?? 'pending',
    url: status?.url ?? undefined,
  };
}

export function checksOf(statuses: any[]): Pull['checks'] {
  if (!statuses?.length) return 'none';
  const states = statuses.map((s) => checkOf(s).state);
  if (states.includes('fail')) return 'fail';
  return states.includes('pending') ? 'pending' : 'pass';
}

export function readiness(diffstat: any[], checks: Check[], review: PullReview): Readiness {
  if ((diffstat ?? []).some((d) => d?.status === 'merge conflict')) return 'conflict';
  if (checks.some((c) => c.state === 'fail')) return 'checks';
  return review === 'changes' ? 'blocked' : 'clean';
}

/** Participants who approved or asked for changes, as reviews with no text. */
export function reviewsOf(participants: any[] | null | undefined): Comment[] {
  return (participants ?? []).flatMap((p) => {
    const review = verdict(p);
    if (!review) return [];
    return [{ id: `review:${p.user?.uuid ?? author(p.user)}`, author: author(p.user), body: '', createdAt: p.participated_on ?? '', review }];
  });
}

/**
 * A pull request's comments: those on the conversation, and those on a line of the diff. A reply
 * answers the first comment of its thread and sits on that comment's line.
 */
export function commentsOf(raw: any[]): { comments: Comment[]; reviewComments: ReviewComment[] } {
  const live = (raw ?? []).filter((c) => !c?.deleted);
  const byId = new Map<number, any>(live.map((c) => [c.id, c]));
  const rootOf = (c: any) => {
    const seen = new Set<number>();
    while (c.parent?.id != null && byId.has(c.parent.id) && !seen.has(c.id)) {
      seen.add(c.id);
      c = byId.get(c.parent.id);
    }
    return c;
  };
  const comments: Comment[] = [];
  const reviewComments: ReviewComment[] = [];
  for (const c of live) {
    const root = rootOf(c);
    const inline = c.inline ?? root.inline;
    const base = { author: author(c.user), body: String(c.content?.raw ?? ''), createdAt: c.created_on ?? '', url: c.links?.html?.href ?? '' };
    if (!inline) {
      comments.push({ id: String(c.id), ...base });
      continue;
    }
    const right = inline.to != null;
    reviewComments.push({
      id: c.id,
      replyTo: root === c ? undefined : root.id,
      ...base,
      path: String(inline.path ?? ''),
      line: (right ? inline.to : inline.from) ?? null,
      side: right ? 'RIGHT' : 'LEFT',
    });
  }
  return { comments, reviewComments };
}
