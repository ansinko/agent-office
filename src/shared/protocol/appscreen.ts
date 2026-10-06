// The screen on the meeting room's wall: the office's showcase, a web page everyone sees the same,
// picked from a list of saved ones (or taking turns with them), live.

/**
 * How a page's window shows it: through the office (an app on the office's own network, over http,
 * which an https office can't frame directly), framed as it is, or as its snapshot with a link to
 * open it in a tab of its own (a site that won't be framed).
 */
export type ScreenView = 'proxy' | 'frame' | 'shot';

/** One of the screen's saved pages. Never the sign-in its snapshots use: only which kind there is. */
export interface ScreenPage {
  id: string;
  name: string;
  url: string;
  /** How the snapshots sign in to it, if they do: a cookie, or a name and password typed into its sign-in form. */
  login?: 'cookie' | 'form';
  /** Its latest snapshot, at /api/app-screen/shot?page=<id>: when it was taken. */
  shotAt?: number;
  /** Why the last snapshot of it didn't happen, until one does. */
  error?: string;
  view: ScreenView;
  /** Why it's shown as a snapshot ('shot'): it won't be framed, say. */
  why?: string;
}

/** The screen: the same for everyone, on every floor. */
export interface AppScreenState {
  pages: ScreenPage[];
  /** The page on the screen now; unset while there are none. */
  current?: string;
  /** Who put it up, and when ('the rotation' when it took its turn). */
  by?: string;
  at?: number;
  /** Seconds each page stays up before the next takes its turn; 0 keeps the one that's up. */
  rotate: number;
  /** The port the office serves 'proxy' pages on, on its own host (see server/appscreen/proxy.ts). */
  proxyPort?: number;
  /** Why it doesn't, when it should (the port is taken, say). */
  proxyError?: string;
}

/** How a page's snapshots sign in to it (admins only). Neither field: no sign-in. */
export interface AppScreenLogin {
  /** A Cookie header ("name=value; other=value") copied from a browser that's signed in. */
  cookie?: string;
  /** Or a name and password, typed into the first sign-in form the page shows. */
  user?: string;
  password?: string;
}

/** A saved page as a browser sends it: a new one has no id yet. */
export interface ScreenPageInput {
  id?: string;
  name: string;
  url: string;
}

export type AppScreenClientMsg =
  /** Put one of the saved pages up on the screen. */
  | { t: 'appScreen.show'; id: string }
  /** The saved pages, all of them, in order (admins only): one left out is deleted. */
  | { t: 'appScreen.pages'; pages: ScreenPageInput[] }
  /** How a page's snapshots sign in (admins only); null forgets it. */
  | { t: 'appScreen.login'; id: string; login: AppScreenLogin | null }
  /** Let the pages take turns, `every` seconds each (one of ROTATE_CHOICES); 0 stops it. */
  | { t: 'appScreen.rotate'; every: number }
  /** Snapshot the page that's up now, instead of waiting for the next one. */
  | { t: 'appScreen.refresh' };

export type AppScreenServerMsg = { t: 'appScreen'; state: AppScreenState };
