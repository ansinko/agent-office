import type { SpotifyState } from '../../../shared/spotify';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** What the office machine's Spotify app is playing; null when it isn't yours to play, undefined until asked. */
    spotify: SpotifyState | null | undefined;
  }
  interface Topics {
    spotify: true;
  }
}

export const spotify: Slice = {
  init(s) {
    s.spotify = undefined;
  },
  on: {
    welcome(s) {
      s.spotify = undefined; // another office, or the same one restarted, may say otherwise
    },
    spotify(s, m) {
      s.spotify = m.state;
      return ['spotify'];
    },
  },
};
