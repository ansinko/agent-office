// The office machine's Spotify app, played from the jukebox's window by an admin.
import { spotifyUri } from '../../../shared/spotify.js';
import type { SpotifyClientMsg } from '../../../shared/protocol.js';
import type { SpotifyCommand } from '../../spotify.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { jukeboxChanged } from './jukebox.js';
import type { HandlerMap } from './types.js';

/** It plays from this machine's speakers on its owner's account, so it's the admins' alone. */
const yours = (ctx: Ctx, c: Client) => ctx.spotify.available && ctx.meOf(c.accountId).admin;

function run(ctx: Ctx, c: Client, cmd: SpotifyCommand) {
  if (!yours(ctx, c)) return ctx.sendTo(c, { t: 'spotify', state: null });
  void ctx.spotify.command(cmd).then((r) => ('error' in r ? ctx.warn(c, r.error) : ctx.sendTo(c, { t: 'spotify', state: r.state })));
}

export const spotifyHandlers = {
  'spotify.get'(ctx, c) {
    if (!yours(ctx, c)) return ctx.sendTo(c, { t: 'spotify', state: null });
    void ctx.spotify.state().then((state) => ctx.sendTo(c, { t: 'spotify', state }));
  },
  'spotify.play'(ctx, c, msg) {
    let uri: string | undefined;
    if (msg.url !== undefined && msg.url !== '') {
      const u = spotifyUri(msg.url);
      if ('error' in u) return ctx.warn(c, u.error);
      uri = u.uri;
    }
    // Two songs at once is noise: the jukebox goes quiet for Spotify.
    const floor = ctx.floorOf(c);
    if (yours(ctx, c) && floor?.jukebox.stop(c.peer.name)) {
      jukeboxChanged(ctx, floor);
      ctx.toastFloor(floor, `🔇 ${c.peer.name} turned the jukebox off for Spotify`);
    }
    run(ctx, c, { do: 'play', uri });
  },
  'spotify.pause'(ctx, c) {
    run(ctx, c, { do: 'pause' });
  },
  'spotify.next'(ctx, c) {
    run(ctx, c, { do: 'next' });
  },
  'spotify.prev'(ctx, c) {
    run(ctx, c, { do: 'prev' });
  },
} satisfies HandlerMap<SpotifyClientMsg>;
