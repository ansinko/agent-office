import type { AppScreenState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The meeting room's screen: its pages and the one that's up, the same on every floor. */
    appScreen: AppScreenState;
  }
  interface Topics {
    appScreen: true;
  }
}

export const appScreen: Slice = {
  init(s) {
    s.appScreen = { pages: [], rotate: 0 };
  },
  on: {
    appScreen(s, m) {
      s.appScreen = m.state;
      return ['appScreen'];
    },
  },
  enter(s, v) {
    s.appScreen = v.appScreen;
    return ['appScreen'];
  },
};
