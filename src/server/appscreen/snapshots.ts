/** How often the screen is snapshotted while someone is in the office to see it. */
export const SHOT_EVERY_MS = 20_000;
/** The least time between two snapshots, however they're asked for. */
export const SHOT_GAP_MS = 5_000;
/** How long nobody has to be about before the headless browser is closed, to give its memory back. */
export const BROWSER_IDLE_MS = 120_000;

/** A snapshot, and why the page won't be framed if it said so; or why there's no snapshot. */
export type ShotResult = { body: Buffer; blocked?: string } | { error: string };

export interface SnapshotDeps {
  /** The page on the screen; '' for none. */
  url(): string;
  /** Whether anyone is on a floor where the screen is, to see it. */
  active(): boolean;
  /** Takes a snapshot of `url`. */
  capture(url: string): Promise<ShotResult>;
  /** A snapshot of the page on the screen now came out (or didn't). */
  done(result: ShotResult, at: number): void;
  /** Nobody's been about for a while: let the browser go. */
  idle(): void;
  now?(): number;
}

/**
 * When the screen is snapshotted: every SHOT_EVERY_MS while someone is on a floor to see it, one
 * at a time, never closer than SHOT_GAP_MS apart (asking for one included), and not at all while
 * nobody is. `tick` is called every second or so.
 */
export class Snapshots {
  /** When the last snapshot was started (-Infinity: never), and when the next one is due. */
  private lastAt = -Infinity;
  private dueAt = 0;
  private busy = false;
  private seenAt: number;
  private browserOpen = false;
  private readonly now: () => number;

  constructor(private readonly deps: SnapshotDeps) {
    this.now = deps.now ?? Date.now;
    this.seenAt = this.now();
  }

  /** Whether a snapshot is being taken right now. */
  get taking(): boolean {
    return this.busy;
  }

  tick(): void {
    const now = this.now();
    if (!this.deps.url() || !this.deps.active()) {
      if (this.browserOpen && !this.busy && now - this.seenAt >= BROWSER_IDLE_MS) {
        this.browserOpen = false;
        this.deps.idle();
      }
      return;
    }
    this.seenAt = now;
    if (now >= this.dueAt) this.take(now);
  }

  /** Someone asked for a snapshot now; a string says why there won't be one. */
  refresh(): string | undefined {
    const now = this.now();
    if (!this.deps.url()) return 'There’s no page on the screen';
    if (this.busy) return 'A snapshot is being taken already';
    const wait = this.lastAt + SHOT_GAP_MS - now;
    if (wait > 0) return `Wait ${Math.ceil(wait / 1000)} s for the next snapshot`;
    this.take(now);
  }

  /** Another page went up: the next tick snapshots the new one as soon as the gap allows. */
  reset(): void {
    this.dueAt = 0;
  }

  private take(now: number) {
    if (this.busy || now - this.lastAt < SHOT_GAP_MS) return;
    const url = this.deps.url();
    this.busy = true;
    this.browserOpen = true;
    this.lastAt = now;
    this.dueAt = now + SHOT_EVERY_MS;
    void this.deps
      .capture(url)
      .catch((err: Error): ShotResult => ({ error: err.message || 'The snapshot failed' }))
      .then((result) => {
        this.busy = false;
        // A page taken down while its snapshot was being taken isn't the screen's any more.
        if (this.deps.url() === url) this.deps.done(result, this.now());
      });
  }
}
