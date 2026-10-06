// Pictures uploaded from someone's own computer or phone to hang on the walls. The office keeps each
// one in .agent-office/wall/, named by a hash of what's in it, and serves it from its own origin at
// /api/wall/<hash>.<ext> (see server/wall.ts), so a hung picture needs no other site.

/** The biggest picture that can be uploaded: a phone photo or a screenshot of a big screen fits. */
export const WALL_MAX_BYTES = 15 * 1024 * 1024;

/** The kinds of image that can be uploaded, and the ending each one's file gets. */
export const WALL_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
} as const;

export type WallType = keyof typeof WALL_TYPES;
export type WallExt = (typeof WALL_TYPES)[WallType];

const WALL_URL = /^\/api\/wall\/([0-9a-f]{64})\.(png|jpg|gif|webp|svg)$/;

/** The address an uploaded picture is served at. */
export function wallUrl(hash: string, ext: WallExt): string {
  return `/api/wall/${hash}.${ext}`;
}

/** The file name of an uploaded picture (`<hash>.<ext>`) when `url` is one, else undefined. */
export function wallFile(url: string): string | undefined {
  const m = WALL_URL.exec(url);
  return m ? `${m[1]}.${m[2]}` : undefined;
}

export const isWallUrl = (url: string): boolean => WALL_URL.test(url);

/** Why a file can't be uploaded, before sending it, from what the browser says it is. */
export function checkUpload(type: string, size: number): string | undefined {
  if (!(type in WALL_TYPES)) return 'Only PNG, JPEG, GIF, WebP and SVG pictures can hang on the wall';
  if (size > WALL_MAX_BYTES) return `That picture is over ${WALL_MAX_BYTES / 1024 / 1024} MB. Try a smaller one.`;
  if (size === 0) return 'That file is empty';
  return undefined;
}
