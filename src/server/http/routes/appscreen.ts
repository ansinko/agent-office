// A meeting room screen page's latest snapshot (see server/appscreen).
import { send } from '../util.js';
import type { Route } from '../router.js';

export const appScreenRoutes = {
  shot: {
    method: 'GET',
    path: '/api/app-screen/shot',
    auth: 'session',
    handle(ctx, { res, url }) {
      const shot = ctx.appScreen.shot(url.searchParams.get('page') ?? '');
      if (!shot) return send(res, 404, { error: 'No snapshot yet' });
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': String(shot.length),
        // Asked for with when it was taken (&at=), so one address is always the same picture.
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      });
      res.end(shot);
    },
  },
} satisfies Record<string, Route>;
