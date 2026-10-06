// The Spotify app on the office's own machine, which the jukebox can drive for its admins. Shared by
// the server (server/spotify.ts runs it through AppleScript) and the jukebox's window.

export interface SpotifyState {
  playing: boolean;
  title?: string;
  artist?: string;
  /** The track's spotify: URI. */
  uri?: string;
}

const KINDS = ['track', 'album', 'playlist', 'artist', 'episode', 'show'] as const;
const ID = /^[A-Za-z0-9]{22}$/;

/**
 * The spotify: URI for a link out of Spotify's Share menu (https://open.spotify.com/track/…, with or
 * without an intl-xx part and a ?si= tail) or a URI pasted as it is. Only these shapes pass, since
 * the URI goes into an AppleScript.
 */
export function spotifyUri(raw: unknown): { uri: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a link from Spotify’s Share menu' };
  let parts: string[];
  if (s.startsWith('spotify:')) {
    parts = s.split(':').slice(1);
  } else {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return { error: 'That isn’t a Spotify link' };
    }
    if (u.hostname !== 'open.spotify.com') return { error: 'That isn’t a Spotify link' };
    parts = u.pathname.split('/').filter((p) => p && !p.startsWith('intl-'));
  }
  const [kind, id] = parts;
  if (parts.length !== 2 || !KINDS.includes(kind as (typeof KINDS)[number]) || !ID.test(id)) return { error: 'Spotify can’t play that link: paste one to a song, album, playlist, artist or podcast' };
  return { uri: `spotify:${kind}:${id}` };
}

