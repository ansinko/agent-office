// Pictures on a floor's walls.
import type { Floor } from '../../floor.js';
import type { DecorClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { isWallUrl } from '../../../shared/wall.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const decorView: ViewPieces['decor'] = (_ctx, floor) => floor?.decor.list() ?? [];
export const decorChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'decor', items: floor.decor.list() });

/** Why an uploaded picture can't hang: its file is gone (taken down meanwhile, say). */
function uploadMissing(ctx: Ctx, decor: unknown): string | undefined {
  const url = decor && typeof decor === 'object' ? (decor as { url?: unknown }).url : undefined;
  if (typeof url !== 'string' || !isWallUrl(url.trim()) || ctx.wall.has(url.trim())) return undefined;
  return "That picture isn't on the office anymore. Upload it again.";
}

export const decorHandlers = {
  'decor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const missing = uploadMissing(ctx, msg.decor);
    if (missing) return ctx.warn(c, missing);
    const d = floor.decor.add(msg.decor, who);
    if (typeof d === 'string') return ctx.warn(c, d);
    ctx.wall.hung(d.url);
    decorChanged(ctx, floor);
    ctx.toastFloor(floor, `🖼️ ${who} hung ${d.title ? `“${d.title}”` : 'a picture'}`);
  },
  'decor.update'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const id = str(msg.id, 32);
    const before = floor.decor.list().find((x) => x.id === id)?.url;
    const missing = uploadMissing(ctx, msg.decor);
    if (missing) return ctx.warn(c, missing);
    const d = floor.decor.update(id, msg.decor);
    if (typeof d === 'string') return ctx.warn(c, d);
    ctx.wall.hung(d.url);
    if (before && before !== d.url) ctx.wall.release(before);
    decorChanged(ctx, floor);
  },
  'decor.remove'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const d = floor.decor.remove(str(msg.id, 32));
    if (!d) return;
    ctx.wall.release(d.url);
    decorChanged(ctx, floor);
    ctx.toastFloor(floor, `${who} took down ${d.title ? `“${d.title}”` : 'a picture'}`);
  },
} satisfies HandlerMap<DecorClientMsg>;
