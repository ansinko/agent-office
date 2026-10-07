// The floor's boards: refreshing them, and merging, commenting on, closing and labeling issues (on
// its tracker) and pull requests (on its host), as whoever asks (see withHost).
import type { BoardRef, BoardClientMsg } from '../../../shared/protocol.js';
import { COMMENT_MAX, LABEL_MAX, issueRef } from '../../../shared/protocol.js';
import { issueKey, num, str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const issuesView: ViewPieces['issues'] = (_ctx, floor) => floor?.tracker.issues ?? { items: [], fetchedAt: 0, loading: false };
export const pullsView: ViewPieces['pulls'] = (_ctx, floor) => floor?.host.pulls ?? { items: [], fetchedAt: 0, loading: false };

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

export const boardHandlers = {
  'board.refresh'(ctx, c) {
    void ctx.floorOf(c)?.refreshBoards();
  },
  'board.merge'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const method = str(msg.method, 40);
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !method) return;
    const failed = (error: string) => ctx.sendTo(c, { t: 'board.merged', number: n, error });
    void floor.host.repoInfo().then((repo) => {
      if (!repo.methods.some((m) => m.id === method)) return;
      ctx.withHost(
        c,
        (as) =>
          void floor.host.merge(n, method, msg.deleteBranch === true, msg.auto === true, as).then((error) => {
            ctx.sendTo(c, { t: 'board.merged', number: n, error });
            if (error) return;
            ctx.toastFloor(floor, msg.auto ? `${who} set PR #${n} to merge once its checks pass` : `🎉 ${who} merged PR #${n}`);
            // An auto-merge rings once GitHub gets round to it and the boards see it merged.
            if (!msg.auto) floor.merged(n, who);
          }),
        failed,
      );
    }, (err: Error) => failed(err.message));
  },
  'board.comment'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const ref = refOf(msg);
    if (!floor || !ref) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    // Refused rather than cut short: a comment that silently lost its end would read as finished.
    const invalid = !body.trim() ? 'The comment is empty' : body.length > COMMENT_MAX ? `GitHub takes comments of up to ${COMMENT_MAX} characters` : '';
    if (invalid) {
      ctx.sendTo(c, { t: 'board.commented', ...ref, error: invalid });
      return;
    }
    ctx.withHost(
      c,
      (as) =>
        void (ref.kind === 'issue' ? floor.tracker.comment(ref, body, as) : floor.host.comment(ref, body, as)).then((r) => {
          ctx.sendTo(c, { t: 'board.commented', ...ref, ...r });
          if (r.comment) ctx.toastFloor(floor, `💬 ${who} commented on ${named(ref)}`);
        }),
      (error) => ctx.sendTo(c, { t: 'board.commented', ...ref, error }),
    );
  },
  'board.close'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const ref = refOf(msg);
    if (!floor || !ref) return;
    const failed = (error: string) => ctx.sendTo(c, { t: 'board.closed', ...ref, error });
    // An issue's reasons come from its tracker; a pull request's close needs the host's repository info anyway.
    const listed = ref.kind === 'issue' ? floor.tracker.reasons() : floor.host.repoInfo().then((r) => r.reasons);
    void listed.then((reasons) => {
      // An issue closes for a reason the tracker lists, its first when none was picked.
      const reason = reasons.find((r) => r.id === msg.reason)?.id ?? reasons[0]?.id;
      const comment = str(msg.comment, 20000).trim() || undefined;
      ctx.withHost(
        c,
        (as) =>
          void (ref.kind === 'issue' ? floor.tracker.close(ref.key, { comment, reason }, as) : floor.host.close(ref.number, { comment, deleteBranch: msg.deleteBranch === true }, as)).then((error) => {
            ctx.sendTo(c, { t: 'board.closed', ...ref, error });
            if (error) return;
            if (ref.kind === 'pull') return ctx.toastFloor(floor, `${who} closed ${named(ref)} without merging`);
            // Nobody should be seated for an issue that's closed.
            const dropped = floor.queue.dropIssue(ref.key);
            ctx.toastFloor(floor, `${who} closed ${named(ref)}${reason === 'not planned' ? ' as not planned' : ''}${dropped ? ' and took it off the queue' : ''}`);
          }),
        failed,
      );
    }, (err: Error) => failed(err.message));
  },
  'board.labels'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const ref = refOf(msg);
    if (!floor || !ref) return;
    const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((l) => str(l, LABEL_MAX + 1)).filter((l) => l && l.length <= LABEL_MAX))].slice(0, 100);
    const add = names(msg.add);
    const remove = names(msg.remove).filter((l) => !add.includes(l));
    if (!add.length && !remove.length) {
      ctx.sendTo(c, { t: 'board.labeled', ...ref, error: 'No labels to change' });
      return;
    }
    ctx.withHost(
      c,
      (as) =>
        void (ref.kind === 'issue' ? floor.tracker.setLabels(ref.key, add, remove, as) : floor.host.setLabels(ref.number, add, remove, as)).then((r) => {
          ctx.sendTo(c, { t: 'board.labeled', ...ref, ...r });
          if (r.labels) ctx.toastFloor(floor, `🏷️ ${who} labeled ${named(ref)}: ${[...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join(' ')}`);
        }),
      (error) => ctx.sendTo(c, { t: 'board.labeled', ...ref, error }),
    );
  },
} satisfies HandlerMap<BoardClientMsg>;
