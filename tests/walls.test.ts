import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_BORDER, clampToWall, sanitizePlacement } from '../src/shared/decor.js';
import { FLOOR, RESTROOM } from '../src/shared/layout.js';
import { RESTROOM_WINDOW } from '../src/shared/restroom.js';
import { RESTROOM_ROOM, WALLS, WALL_IDS, aimAtWall, roomAt, wallPose, type WallId } from '../src/shared/walls.js';

const WC: WallId[] = ['wc-north', 'wc-south', 'wc-east', 'wc-west'];
const ray = (o: [number, number, number], d: [number, number, number]) => {
  const n = Math.hypot(...d);
  return { origin: { x: o[0], y: o[1], z: o[2] }, direction: { x: d[0] / n, y: d[1] / n, z: d[2] / n } };
};
/** The frame of a w×h picture at `at`, along u and up. */
const frame = (at: { u: number; y: number }, w: number, h: number) => ({ u0: at.u - w / 2 - FRAME_BORDER, u1: at.u + w / 2 + FRAME_BORDER, y0: at.y - h / 2 - FRAME_BORDER, y1: at.y + h / 2 + FRAME_BORDER });
const clear = (f: { u0: number; u1: number; y0: number; y1: number }, r: { u0: number; u1: number; y0: number; y1: number }) => f.u1 <= r.u0 || f.u0 >= r.u1 || f.y1 <= r.y0 || f.y0 >= r.y1;

test("the main room's walls stand where they always did", () => {
  assert.deepEqual(wallPose('north', 2, 1.5), { x: 2, y: 1.5, z: FLOOR.minZ, rotY: 0 });
  assert.deepEqual(wallPose('south', 2, 1.5, 0.1), { x: 2, y: 1.5, z: FLOOR.maxZ - 0.1, rotY: Math.PI });
  assert.deepEqual(wallPose('west', 3, 1.5, 0.1), { x: FLOOR.minX + 0.1, y: 1.5, z: 3, rotY: Math.PI / 2 });
  assert.deepEqual(wallPose('east', 3, 1.5, 0.1), { x: FLOOR.maxX - 0.1, y: 1.5, z: 3, rotY: -Math.PI / 2 });
  // A picture already up on the north wall where the restroom's door now is keeps its place.
  const old = { url: 'https://example.com/a.png', wall: 'north', u: RESTROOM.door.x, y: 1.2, w: 1, h: 0.8, frame: 0 };
  assert.deepEqual(sanitizePlacement(old), old);
});

test('every wall gives back the spot it was aimed at, the restroom\'s too', () => {
  for (const wall of WALL_IDS) {
    const w = WALLS[wall];
    // The middle of its first zone, a little way up.
    const z = w.zones[0];
    const u = (z.u0 + z.u1) / 2;
    const y = Math.min(z.y1 - 0.2, z.y0 + 1.5);
    const p = wallPose(wall, u, y, 0.5);
    const back = wallPose(wall, u, y, 0);
    const hit = aimAtWall(ray([p.x, p.y, p.z], [back.x - p.x, 0, back.z - p.z]));
    assert.ok(hit, wall);
    assert.equal(hit.wall, wall);
    assert.ok(Math.abs(hit.u - u) < 1e-9 && Math.abs(hit.y - y) < 1e-9, wall);
  }
});

test('the restroom hangs pictures and its walls are accepted from a client', () => {
  for (const wall of WC) {
    const z = WALLS[wall].zones[0];
    const p = sanitizePlacement({ url: 'https://example.com/a.png', wall, u: (z.u0 + z.u1) / 2, y: 3, w: 0.5, h: 0.5, frame: 1 });
    assert.equal(typeof p, 'object', wall);
    assert.equal((p as { wall: string }).wall, wall);
  }
  assert.equal(sanitizePlacement({ url: 'https://example.com/a.png', wall: 'wc-ceiling', u: 0, y: 1, w: 1, h: 1, frame: 0 }), 'Pick a wall to hang it on');
});

test('pictures in the restroom keep off the door, the mirror, the window and the toilet', () => {
  const d = RESTROOM.door;
  const door = { u0: d.x - d.width / 2, u1: d.x + d.width / 2, y0: 0, y1: d.height };
  const atDoor = clampToWall('wc-south', d.x, 1.2, 0.6, 0.6)!;
  assert.ok(clear(frame(atDoor, 0.6, 0.6), door), 'door');

  const s = RESTROOM.sink;
  const mirror = { u0: s.z - s.width / 2 - 0.05, u1: s.z + s.width / 2 + 0.05, y0: 0, y1: s.height + 0.45 + 0.8 };
  const atMirror = clampToWall('wc-west', s.z, 1.7, 0.5, 0.5)!;
  assert.ok(clear(frame(atMirror, 0.5, 0.5), mirror), 'mirror');

  const win = { u0: RESTROOM_WINDOW.u - RESTROOM_WINDOW.width / 2, u1: RESTROOM_WINDOW.u + RESTROOM_WINDOW.width / 2, y0: RESTROOM_WINDOW.y0, y1: RESTROOM_WINDOW.y1 };
  const atWindow = clampToWall('wc-east', RESTROOM_WINDOW.u, 2.4, 0.5, 0.5)!;
  assert.ok(clear(frame(atWindow, 0.5, 0.5), win), 'window');

  // Behind the toilet inside the cubicle: over the cistern, and still inside the cubicle.
  const t = RESTROOM.toilet;
  const atToilet = clampToWall('wc-north', t.x, 0.6, 0.5, 0.5)!;
  assert.equal(atToilet.u, t.x);
  assert.ok(frame(atToilet, 0.5, 0.5).y0 >= 0.9, 'cistern');
  assert.ok(frame(atToilet, 0.5, 0.5).y1 <= RESTROOM.cubicle.height, 'under the partition top');
});

test('aiming from inside the restroom meets its walls, and from the room never does', () => {
  const mid: [number, number, number] = [(RESTROOM_ROOM.minX + RESTROOM.cubicle.minX) / 2, 1.6, (RESTROOM_ROOM.minZ + RESTROOM_ROOM.maxZ) / 2];
  assert.equal(roomAt(mid[0], mid[2]), 'restroom');
  assert.equal(aimAtWall(ray(mid, [0, 0.3, -1]))?.wall, 'wc-north');
  assert.equal(aimAtWall(ray(mid, [0, 0.3, 1]))?.wall, 'wc-south');
  assert.equal(aimAtWall(ray(mid, [-1, 0.3, 0]))?.wall, 'wc-west');
  // From inside the cubicle, at the back wall over the toilet.
  const seat: [number, number, number] = [RESTROOM.toilet.x, 1.2, RESTROOM.toilet.z + 0.6];
  assert.equal(aimAtWall(ray(seat, [0, 0.4, -1]))?.wall, 'wc-north');
  assert.equal(aimAtWall(ray(seat, [1, 0.2, 0]))?.wall, 'wc-east');

  let inside = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const fromRoom: [number, number, number] = [FLOOR.minX + rnd() * (FLOOR.maxX - FLOOR.minX), 0.2 + rnd() * 5, FLOOR.minZ + rnd() * (FLOOR.maxZ - FLOOR.minZ)];
    const d: [number, number, number] = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    const hit = aimAtWall(ray(fromRoom, d));
    assert.ok(!hit || !WC.includes(hit.wall), `room ray ${i} hit ${hit?.wall}`);
    const fromWc: [number, number, number] = [RESTROOM_ROOM.minX + rnd() * (RESTROOM_ROOM.maxX - RESTROOM_ROOM.minX), 0.2 + rnd() * 5, RESTROOM_ROOM.minZ + rnd() * (RESTROOM_ROOM.maxZ - RESTROOM_ROOM.minZ)];
    const back = aimAtWall(ray(fromWc, d));
    assert.ok(!back || WC.includes(back.wall), `restroom ray ${i} hit ${back?.wall}`);
    if (back) inside++;
  }
  // Most of them meet a wall rather than the floor or the ceiling.
  assert.ok(inside > 1000, `${inside}`);

  // In the doorway between them, and out on the street, it meets none.
  assert.equal(aimAtWall(ray([RESTROOM.door.x, 1.6, RESTROOM.maxZ - RESTROOM.wall / 2], [0, 0, -1])), null);
  assert.equal(aimAtWall(ray([0, -3, 0], [0, 0, -1])), null);
});
