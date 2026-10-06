// The issue and pull request windows: a PR or issue in full, its diff, and the repo's labels.
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { issueKey } from '../../office/input.js';

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
      if (p === '/api/board/issue' && key === undefined) return send(res, 400, { error: 'Bad key' });
      // The repo's labels (for the label picker) are the one thing not about a single issue or PR.
      if (p !== '/api/board/labels' && p !== '/api/board/issue' && (!Number.isSafeInteger(n) || n <= 0)) return send(res, 400, { error: 'Bad number' });
      if (!floor) return send(res, 404, { error: 'No such floor' });
      try {
        // "You" on comments is your own GitHub login once you've signed in to it.
        const me = session.account ? ctx.signins.githubLogin(session.account.id) : undefined;
        if (p === '/api/board/pull') return send(res, 200, await floor.host.pullDetail(n, me));
        if (p === '/api/board/issue' && key !== undefined) return send(res, 200, await floor.tracker.issueDetail(key, me));
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
