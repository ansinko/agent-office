// The floor's GitHub boards: refreshing them, and merging, commenting on, closing and labeling
// issues and pull requests, as whoever asks (see withGitHub).
import type { BoardRef, GitHubClientMsg } from '../../../shared/protocol.js';
import { GH_COMMENT_MAX, GH_LABEL_MAX, issueRef } from '../../../shared/protocol.js';
import { issueKey, num, str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const issuesView: ViewPieces['issues'] = (_ctx, floor) => floor?.github.issues ?? { items: [], fetchedAt: 0, loading: false };
export const pullsView: ViewPieces['pulls'] = (_ctx, floor) => floor?.github.pulls ?? { items: [], fetchedAt: 0, loading: false };

/** The issue (by key) or pull request (by number) a message names, if it names one properly. */
function refOf(msg: { kind?: unknown; key?: unknown; number?: unknown }): BoardRef | undefined {
  if (msg.kind === 'issue') {
    const key = issueKey(msg.key);
    return key === undefined ? undefined : { kind: 'issue', key };
  }
  const n = num(msg.number);
  return msg.kind === 'pull' && Number.isSafeInteger(n) && n > 0 ? { kind: 'pull', number: n } : undefined;
}

/** "PR #9" or "issue #12" (a tracker's "issue ERN-7"), for toasts. */
const named = (ref: BoardRef) => (ref.kind === 'pull' ? `PR #${ref.number}` : `issue ${issueRef(ref.key)}`);

export const githubHandlers = {
  'gh.refresh'(ctx, c) {
    void ctx.floorOf(c)?.github.refresh();
  },
  'gh.merge'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const method = (['squash', 'merge', 'rebase'] as const).find((m) => m === msg.method);
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !method) return;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.merge(n, method, msg.deleteBranch === true, msg.auto === true, as).then((error) => {
          ctx.sendTo(c, { t: 'gh.merged', number: n, error });
          if (error) return;
          ctx.toastFloor(floor, msg.auto ? `${who} set PR #${n} to merge once its checks pass` : `🎉 ${who} merged PR #${n}`);
          // An auto-merge rings once GitHub gets round to it and the boards see it merged.
          if (!msg.auto) floor.merged(n, who);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.merged', number: n, error }),
    );
  },
  'gh.comment'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const ref = refOf(msg);
    if (!floor || !ref) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    // Refused rather than cut short: a comment that silently lost its end would read as finished.
    const invalid = !body.trim() ? 'The comment is empty' : body.length > GH_COMMENT_MAX ? `GitHub takes comments of up to ${GH_COMMENT_MAX} characters` : '';
    if (invalid) {
      ctx.sendTo(c, { t: 'gh.commented', ...ref, error: invalid });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.comment(ref, body, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.commented', ...ref, ...r });
          if (r.comment) ctx.toastFloor(floor, `💬 ${who} commented on ${named(ref)}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.commented', ...ref, error }),
    );
  },
  'gh.close'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const ref = refOf(msg);
    if (!floor || !ref) return;
    const reason = msg.reason === 'not planned' ? 'not planned' : 'completed';
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.close(ref, { comment: str(msg.comment, 20000).trim() || undefined, reason, deleteBranch: msg.deleteBranch === true }, as).then((error) => {
          ctx.sendTo(c, { t: 'gh.closed', ...ref, error });
          if (error) return;
          if (ref.kind === 'pull') return ctx.toastFloor(floor, `${who} closed ${named(ref)} without merging`);
          // Nobody should be seated for an issue that's closed.
          const dropped = floor.queue.dropIssue(ref.key);
          ctx.toastFloor(floor, `${who} closed ${named(ref)}${reason === 'not planned' ? ' as not planned' : ''}${dropped ? ' and took it off the queue' : ''}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.closed', ...ref, error }),
    );
  },
  'gh.labels'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const ref = refOf(msg);
    if (!floor || !ref) return;
    const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((l) => str(l, GH_LABEL_MAX + 1)).filter((l) => l && l.length <= GH_LABEL_MAX))].slice(0, 100);
    const add = names(msg.add);
    const remove = names(msg.remove).filter((l) => !add.includes(l));
    if (!add.length && !remove.length) {
      ctx.sendTo(c, { t: 'gh.labeled', ...ref, error: 'No labels to change' });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.setLabels(ref, add, remove, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.labeled', ...ref, ...r });
          if (r.labels) ctx.toastFloor(floor, `🏷️ ${who} labeled ${named(ref)}: ${[...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join(' ')}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.labeled', ...ref, error }),
    );
  },
} satisfies HandlerMap<GitHubClientMsg>;
