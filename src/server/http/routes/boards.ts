// The issue and pull request windows: a PR or issue in full, its diff, and the repo's labels.
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { issueKey } from '../../office/input.js';
import { mergeKey } from '../../../shared/protocol.js';

export const boardRoutes = {
  windows: {
    method: 'GET',
    prefix: '/api/board/',
    auth: 'session',
    async handle(ctx, { res, url, path: p, session }) {
      const floor = floorParam(ctx, url);
      // What the issue and PR windows show beyond the board cards (see hosts/): an issue by its key, a PR by its number.
      const n = Number(url.searchParams.get('number'));
      const key = issueKey(url.searchParams.get('key'));
      const issuePath = p === '/api/board/issue' || p === '/api/board/issue/file';
      if (issuePath && key === undefined) return send(res, 400, { error: 'Bad key' });
      // The repo's labels (for the label picker) are the one thing not about a single issue or PR.
      if (p !== '/api/board/labels' && !issuePath && (!Number.isSafeInteger(n) || n <= 0)) return send(res, 400, { error: 'Bad number' });
      if (!floor) return send(res, 404, { error: 'No such floor' });
      try {
        // "You" on comments is your own GitHub login once you've signed in to it.
        const me = session.account ? ctx.signins.githubLogin(session.account.id) : undefined;
        if (p === '/api/board/pull') {
          const d = await floor.host.pullDetail(n, me);
          // The merge line a worker is handed, for every method, keeping or deleting the branch.
          const cli = floor.adapter?.cli;
          const mergeCommands = cli && Object.fromEntries(d.repo.methods.flatMap((m) => [false, true].map((del) => [mergeKey(m.id, del), cli.merge(n, m.id, del, d.repo.name)])));
          return send(res, 200, mergeCommands ? { ...d, repo: { ...d.repo, mergeCommands } } : d);
        }
        if (p === '/api/board/issue' && key !== undefined) return send(res, 200, await floor.tracker.issueDetail(key, me));
        if (p === '/api/board/issue/file' && key !== undefined) {
          const id = url.searchParams.get('id') ?? '';
          if (!floor.tracker.file) return send(res, 404, { error: "This floor's issues have no files" });
          const text = await floor.tracker.file(key, id);
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(text);
          return;
        }
        if (p === '/api/board/labels') return send(res, 200, await floor.tracker.repoLabels());
        if (p === '/api/board/pull/diff') {
          const diff = await floor.host.pullDiff(n);
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(diff);
          return;
        }
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
