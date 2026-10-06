import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WALL_MAX_BYTES, WALL_TYPES, wallFile, wallUrl, type WallType } from '../shared/wall.js';
import { sniff } from './decor.js';

/** All the uploaded pictures together may take this much of the office's disk. */
export const WALL_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
/** An upload nobody has hung yet is kept this long, for whoever is still picking a spot for it. */
const PENDING_MS = 24 * 60 * 60_000;

export type WallSaved = { url: string } | { status: number; error: string };

/**
 * Pictures uploaded to hang on the walls, in the building's .agent-office/wall/. Each is named by a
 * hash of what's in it, so the same picture uploaded twice is one file, and a file is deleted once
 * no floor's walls show it anymore. `inUse` says which pictures the walls show right now.
 */
export class WallStore {
  readonly dir: string;
  /** Uploads not hung yet, by file name, with when they came. */
  private pending = new Map<string, number>();

  constructor(
    dataDir: string,
    private inUse: () => Set<string>,
  ) {
    this.dir = path.join(dataDir, 'wall');
  }

  /** Keeps an uploaded picture, after checking from its bytes that it's a kind that can hang. */
  save(body: Buffer): WallSaved {
    if (body.length === 0) return { status: 400, error: 'That file is empty' };
    if (body.length > WALL_MAX_BYTES) return { status: 413, error: `That picture is over ${WALL_MAX_BYTES / 1024 / 1024} MB. Try a smaller one.` };
    const type = sniff(body);
    if (!type || !(type in WALL_TYPES)) return { status: 415, error: 'Only PNG, JPEG, GIF, WebP and SVG pictures can hang on the wall' };
    const url = wallUrl(createHash('sha256').update(body).digest('hex'), WALL_TYPES[type as WallType]);
    const name = wallFile(url)!;
    const file = path.join(this.dir, name);
    try {
      if (this.has(url)) {
        const now = new Date();
        utimesSync(file, now, now);
      } else {
        if (this.totalBytes() + body.length > WALL_MAX_TOTAL_BYTES) return { status: 507, error: 'The office has no room for more pictures. Take some down first.' };
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeFileSync(file, body, { mode: 0o600 });
      }
    } catch {
      return { status: 500, error: "Couldn't save the picture on the office's machine" };
    }
    this.pending.set(name, Date.now());
    return { url };
  }

  /** An uploaded picture's bytes and type, for serving it. */
  read(url: string): { type: string; body: Buffer } | undefined {
    const name = wallFile(url);
    if (!name) return undefined;
    try {
      const body = readFileSync(path.join(this.dir, name));
      const type = Object.entries(WALL_TYPES).find(([, ext]) => name.endsWith(`.${ext}`))![0];
      return { type, body };
    } catch {
      return undefined;
    }
  }

  has(url: string): boolean {
    const name = wallFile(url);
    if (!name) return false;
    try {
      return statSync(path.join(this.dir, name)).isFile();
    } catch {
      return false;
    }
  }

  /** The picture went up on a wall: it's kept for as long as one shows it. */
  hung(url: string) {
    const name = wallFile(url);
    if (name) this.pending.delete(name);
  }

  /** A wall stopped showing `url`: its file goes, unless another picture shows it or it was just uploaded. */
  release(url: string) {
    const name = wallFile(url);
    if (!name || this.inUse().has(url)) return;
    const since = this.pending.get(name);
    if (since !== undefined && Date.now() - since < PENDING_MS) return;
    this.pending.delete(name);
    try {
      unlinkSync(path.join(this.dir, name));
    } catch {
      // already gone
    }
  }

  /** Deletes the uploads no wall shows that nobody has hung for a day (picked, then the dialog closed). */
  sweep() {
    const used = this.inUse();
    const cutoff = Date.now() - PENDING_MS;
    for (const name of this.files()) {
      if (used.has(`/api/wall/${name}`)) continue;
      try {
        const file = path.join(this.dir, name);
        if (statSync(file).mtimeMs < cutoff && !this.pending.has(name)) unlinkSync(file);
      } catch {
        // gone already, or not ours to touch
      }
    }
  }

  private files(): string[] {
    try {
      return readdirSync(this.dir).filter((n) => wallFile(`/api/wall/${n}`));
    } catch {
      return [];
    }
  }

  private totalBytes(): number {
    let total = 0;
    for (const name of this.files()) {
      try {
        total += statSync(path.join(this.dir, name)).size;
      } catch {
        // gone meanwhile
      }
    }
    return total;
  }
}
