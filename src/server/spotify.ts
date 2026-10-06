import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SpotifyState } from '../shared/spotify.js';

/** Runs an AppleScript and resolves with what it printed. */
export type RunScript = (script: string) => Promise<string>;

const osascript: RunScript = (script) =>
  new Promise((resolve, reject) =>
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()))),
  );

// The fields come back on one line, split by tabs. "is running" keeps a look from opening the app.
const STATE = `if application "Spotify" is not running then return "stopped"
tell application "Spotify"
  set s to player state as string
  if s is "stopped" then return s
  set t to current track
  return s & tab & (name of t) & tab & (artist of t) & tab & (spotify url of t)
end tell`;

export function parseState(out: string): SpotifyState {
  const [state, title, artist, uri] = out.split('\t');
  if (state === 'stopped' || !title) return { playing: false };
  return { playing: state === 'playing', title, ...(artist ? { artist } : {}), ...(uri ? { uri } : {}) };
}

/** What the jukebox can ask of the app. A uri for `play` has passed spotifyUri. */
export type SpotifyCommand = { do: 'play'; uri?: string } | { do: 'pause' } | { do: 'next' } | { do: 'prev' };

function script(c: SpotifyCommand): string {
  switch (c.do) {
    case 'play':
      return c.uri ? `tell application "Spotify" to play track "${c.uri}"` : 'tell application "Spotify" to play';
    case 'pause':
      return 'tell application "Spotify" to pause';
    case 'next':
      return 'tell application "Spotify" to next track';
    case 'prev':
      return 'tell application "Spotify" to previous track';
  }
}

/**
 * The Spotify app on the machine the office runs on, played through AppleScript. It plays from that
 * machine's speakers, on whatever account the app is signed in to, so only a Mac with the app has it.
 */
export class Spotify {
  readonly available: boolean;

  constructor(
    private run: RunScript = osascript,
    available = process.platform === 'darwin' && ['/Applications', path.join(homedir(), 'Applications')].some((d) => existsSync(path.join(d, 'Spotify.app'))),
    /** How long the app takes to load a new track before it reports it. */
    private settleMs = 400,
  ) {
    this.available = available;
  }

  async state(): Promise<SpotifyState> {
    try {
      return parseState(await this.run(STATE));
    } catch {
      return { playing: false };
    }
  }

  /** Does `c` and says what's on after it, or why it couldn't. */
  async command(c: SpotifyCommand): Promise<{ state: SpotifyState } | { error: string }> {
    try {
      await this.run(script(c));
    } catch (e) {
      return { error: `Spotify didn’t do it: ${(e as Error).message}` };
    }
    await new Promise((r) => setTimeout(r, this.settleMs));
    return { state: await this.state() };
  }
}
