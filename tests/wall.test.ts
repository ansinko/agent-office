import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkImageUrl, sanitizePlacement } from '../src/shared/decor.js';
import { WALL_MAX_BYTES, checkUpload, isWallUrl, wallFile } from '../src/shared/wall.js';
import { ImageProxy } from '../src/server/decor.js';
import { WallStore } from '../src/server/wall.js';

/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const HASH = 'a'.repeat(64);

function dataDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-wall-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const placement = (url: string) => ({ url, wall: 'north', u: 0, y: 1.5, w: 1, h: 1, frame: 0 });

test('an uploaded picture hangs from its address on the office, and links still hang as before', () => {
  assert.deepEqual(checkImageUrl(`/api/wall/${HASH}.png`), { url: `/api/wall/${HASH}.png` });
  assert.deepEqual(checkImageUrl(`  /api/wall/${HASH}.svg `), { url: `/api/wall/${HASH}.svg` });
  assert.deepEqual(checkImageUrl('http://100.102.179.53:4601/img/cat.png'), { url: 'http://100.102.179.53:4601/img/cat.png' });
  assert.deepEqual(checkImageUrl('https://example.com/a b.png'), { url: 'https://example.com/a%20b.png' });
  for (const bad of [
    '/api/wall/abc.png',
    `/api/wall/${HASH}.exe`,
    `/api/wall/${HASH}.PNG`,
    `/api/wall/${HASH}.png?x=1`,
    `/api/wall/../${HASH}.png`,
    `/api/image?url=/api/wall/${HASH}.png`,
    '/etc/passwd',
    '//evil.example/x.png',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ]) {
    assert.ok('error' in checkImageUrl(bad), bad);
  }
});

test('a placement keeps an uploaded picture, and turns away a path that only looks like one', () => {
  const p = sanitizePlacement(placement(`/api/wall/${HASH}.webp`));
  assert.equal(typeof p === 'string' ? p : p.url, `/api/wall/${HASH}.webp`);
  const link = sanitizePlacement(placement('http://100.102.179.53:4601/img/cat.png'));
  assert.equal(typeof link === 'string' ? link : link.url, 'http://100.102.179.53:4601/img/cat.png');
  assert.equal(typeof sanitizePlacement(placement(`/api/wall/${HASH}.html`)), 'string');
  assert.equal(typeof sanitizePlacement(placement('/api/whoami')), 'string');
});

test('the browser is told before uploading what the office would turn away', () => {
  assert.equal(checkUpload('image/png', 1000), undefined);
  assert.equal(checkUpload('image/svg+xml', 1000), undefined);
  assert.match(checkUpload('image/bmp', 1000) ?? '', /PNG, JPEG, GIF, WebP and SVG/);
  assert.match(checkUpload('application/pdf', 1000) ?? '', /PNG, JPEG/);
  assert.match(checkUpload('image/jpeg', WALL_MAX_BYTES + 1) ?? '', /over 15 MB/);
  assert.equal(checkUpload('image/jpeg', 0), 'That file is empty');
  assert.equal(wallFile(`/api/wall/${HASH}.jpg`), `${HASH}.jpg`);
  assert.equal(wallFile('/api/wall/x.jpg'), undefined);
});

test('an upload is kept under a hash of its bytes, and only if they are a picture', (t) => {
  const dir = dataDir(t);
  const wall = new WallStore(dir, () => new Set());
  const saved = wall.save(PNG);
  assert.deepEqual(saved, { url: `/api/wall/${sha(PNG)}.png` });
  assert.ok(existsSync(path.join(dir, 'wall', `${sha(PNG)}.png`)));
  // The same picture again is the same file.
  assert.deepEqual(wall.save(Buffer.from(PNG)), saved);
  assert.equal(readdirSync(path.join(dir, 'wall')).length, 1);
  const read = wall.read((saved as { url: string }).url);
  assert.equal(read?.type, 'image/png');
  assert.deepEqual(read?.body, PNG);

  const svg = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  assert.deepEqual(wall.save(svg), { url: `/api/wall/${sha(svg)}.svg` });
  assert.equal(wall.read(`/api/wall/${sha(svg)}.svg`)?.type, 'image/svg+xml');

  // Whatever the browser called it, the bytes decide.
  assert.equal((wall.save(Buffer.from('<html><script>alert(1)</script></html>')) as { status: number }).status, 415);
  assert.equal((wall.save(Buffer.from('BM fake bitmap')) as { status: number }).status, 415);
  assert.equal((wall.save(Buffer.alloc(0)) as { status: number }).status, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(WALL_MAX_BYTES)]);
  assert.equal((wall.save(big) as { status: number }).status, 413);
  assert.equal(wall.read(`/api/wall/${HASH}.png`), undefined);
  assert.equal(wall.read('/api/wall/../../config.json'), undefined);
});

test("a picture's file goes once no wall shows it, and not while one still does", (t) => {
  const dir = dataDir(t);
  const used = new Set<string>();
  const wall = new WallStore(dir, () => used);
  const { url } = wall.save(PNG) as { url: string };
  const file = path.join(dir, 'wall', wallFile(url)!);

  // Uploaded but not hung yet: someone is still picking a spot for it.
  wall.release(url);
  assert.ok(existsSync(file));

  wall.hung(url);
  used.add(url);
  wall.release(url);
  assert.ok(existsSync(file), 'another picture still shows it');

  used.delete(url);
  wall.release(url);
  assert.ok(!existsSync(file));
  assert.ok(!wall.has(url));
  // Links aren't files of the office's.
  wall.release('https://example.com/cat.png');
});

test('the uploads nobody hung are swept after a day, the hung ones stay', (t) => {
  const dir = dataDir(t);
  const used = new Set<string>();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const first = new WallStore(dir, () => used);
  const hung = (first.save(PNG) as { url: string }).url;
  const left = (first.save(svg) as { url: string }).url;
  used.add(hung);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  for (const url of [hung, left]) utimesSync(path.join(dir, 'wall', wallFile(url)!), old, old);

  // The office starts again.
  new WallStore(dir, () => used).sweep();
  assert.ok(existsSync(path.join(dir, 'wall', wallFile(hung)!)));
  assert.ok(!existsSync(path.join(dir, 'wall', wallFile(left)!)));
});

test("the image proxy leaves uploaded pictures to the office's own route", async () => {
  const r = await new ImageProxy().get(`/api/wall/${HASH}.png`);
  assert.deepEqual(r, { status: 400, error: 'That picture is on the office already' });
  assert.ok(isWallUrl(`/api/wall/${HASH}.gif`));
});
