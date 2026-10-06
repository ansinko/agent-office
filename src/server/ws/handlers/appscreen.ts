// The meeting room screen: which saved page is up, the list of them, their sign-ins and their turns.
import type { AppScreenClientMsg } from '../../../shared/protocol.js';
import { throttle } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const appScreenView: ViewPieces['appScreen'] = (ctx) => ctx.appScreen.state();

/** "1 min", "30 s": how long each page stays up. */
const every = (s: number) => (s % 60 ? `${s} s` : `${s / 60} min`);

export const appScreenHandlers = {
  'appScreen.show'(ctx, c, msg) {
    if (!throttle(c, 'appScreen.show', 500)) return;
    const id = str(msg.id, 32);
    if (ctx.appScreen.config.current?.id === id) return;
    const err = ctx.appScreen.show(id, c.peer.name);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(`🖥️ ${c.peer.name} put ${ctx.appScreen.config.current?.name} up on the meeting room screen`);
  },
  'appScreen.pages'(ctx, c, msg) {
    // The office fetches every saved page, and serves the ones on its own network, as an admin's shell could.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the screen’s pages');
    const err = ctx.appScreen.setPages(msg.pages, c.peer.name);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(`🖥️ ${c.peer.name} changed the meeting room screen’s pages`);
  },
  'appScreen.pin'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the screen’s pages');
    if (!throttle(c, 'appScreen.pin', 500)) return;
    const up = ctx.appScreen.config.current?.id;
    const err = ctx.appScreen.pin(str(msg.from, 32), str(msg.path, 2048), c.peer.name);
    if (err) return ctx.warn(c, err);
    if (ctx.appScreen.config.current?.id !== up) ctx.toastAll(`🖥️ ${c.peer.name} put ${ctx.appScreen.config.current?.name} up on the meeting room screen`);
  },
  'appScreen.login'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change how the screen signs in');
    const id = str(msg.id, 32);
    const err = ctx.appScreen.setLogin(id, msg.login);
    if (err) return ctx.warn(c, err);
    const name = ctx.appScreen.config.page(id)?.name;
    ctx.sendTo(c, { t: 'toast', text: msg.login ? `🖥️ ${name}’s snapshots sign in with that from the next one` : `🖥️ ${name}’s snapshots forgot their sign-in`, level: 'info' });
  },
  'appScreen.rotate'(ctx, c, msg) {
    if (msg.every === ctx.appScreen.config.rotate) return;
    const err = ctx.appScreen.setRotate(msg.every);
    if (err) return ctx.warn(c, err);
    ctx.toastAll(msg.every ? `🔁 ${c.peer.name} set the meeting room screen to change pages every ${every(msg.every)}` : `⏸️ ${c.peer.name} stopped the meeting room screen changing pages`);
  },
  'appScreen.refresh'(ctx, c) {
    if (!throttle(c, 'appScreen.refresh', 1000)) return;
    ctx.warn(c, ctx.appScreen.refresh());
  },
} satisfies HandlerMap<AppScreenClientMsg>;
