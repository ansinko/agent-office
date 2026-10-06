// Pictures uploaded to hang on the walls (see wall.ts): taking one from the hang dialog, and serving it.
import { WALL_MAX_BYTES } from '../../../shared/wall.js';
import { readBytes, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

export const wallRoutes = {
  upload: {
    method: 'POST',
    path: '/api/wall',
    auth: 'session',
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const tooBig = `That picture is over ${WALL_MAX_BYTES / 1024 / 1024} MB. Try a smaller one.`;
      if (Number(req.headers['content-length']) > WALL_MAX_BYTES) return send(res, 413, { error: tooBig });
      let body: Buffer;
      try {
        body = await readBytes(req, WALL_MAX_BYTES);
      } catch (err) {
        return (err as Error).message === 'too large' ? send(res, 413, { error: tooBig }) : send(res, 400, { error: 'Bad request' });
      }
      const r = ctx.wall.save(body);
      return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
    },
  },
  file: {
    method: 'GET',
    prefix: '/api/wall/',
    auth: 'session',
    handle(ctx, { res, path: p }) {
      const f = ctx.wall.read(p);
      if (!f) return send(res, 404, { error: 'No such picture' });
      res.writeHead(200, {
        'content-type': f.type,
        'content-length': String(f.body.length),
        // Named by what's in it, so it never changes.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        // Opened on its own (an SVG, say), it still can't run anything on the office's origin.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      });
      res.end(f.body);
    },
  },
} satisfies Record<string, Route>;
