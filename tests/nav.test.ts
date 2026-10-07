import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY, BALCONY_DOOR, ELEVATOR, ELEVATOR_FRONT, EXIT_DOOR, EXIT_STAIRS, FLOOR, MEETING_ROOM, MEETING_SEATS, PARACHUTE, RESTROOM, ROAD, SEATING_BY_ID, SEATS, STATIONS, WING, seatPlace, wingMinZ, type DeskDef } from '../src/shared/layout.js';
import { route, walkable, wayHome, wayIn, wayToBalcony, type Pt } from '../src/shared/nav.js';

/** Every place a worker can be on an office floor, with its back office (see WING). */
const everywhere = (): [DeskDef, number][] => [...SEATS, ...STATIONS, ...MEETING_SEATS].map((d): [DeskDef, number] => [d, WING.rows]);

test('a worker sent home walks round the furniture, out the exit door and off along the sidewalk', () => {
  for (const [seat, wing] of everywhere()) {
    const way = wayHome(seat, wing);
    // It hops down right beside where it sat.
    assert.ok(Math.hypot(way[0][0] - seat.x, way[0][1] - seat.z) < 1.2, `${seat.id} hops down beside its seat`);
    const out = way.findIndex(([x]) => x < FLOOR.minX);
    assert.ok(out > 1, `${seat.id} leaves by the exit`);
    // From the aisle to the door, every step is on open floor.
    for (let i = 2; i < out; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        assert.ok(walkable(x, z, wing), `${seat.id} (built out ${wing}) walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    // Through the doorway, not the wall beside it.
    for (const [, z] of [way[out - 1], way[out]]) assert.ok(Math.abs(z - EXIT_DOOR.u) < EXIT_DOOR.width / 2 - 0.2, `${seat.id} goes through the door`);
    // Down the steps outside, then away along the sidewalk.
    assert.ok(way.slice(out).every(([x, z]) => x < EXIT_STAIRS.minX + 1 || z > ROAD.minZ - 2.1), `${seat.id} stays off the building`);
    const [ex, ez] = way[way.length - 1];
    assert.ok(ez > ROAD.minZ - 2 && ez < ROAD.minZ && ex < EXIT_STAIRS.minX - 10, `${seat.id} ends up down the sidewalk`);
  }
});

/** Every step from a to b is on open floor. */
function clear(a: Pt, b: Pt, what: string) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2);
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n;
    const z = a[1] + ((b[1] - a[1]) * k) / n;
    assert.ok(walkable(x, z), `${what} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
}

test('a worker called to a meeting walks from the elevator, in through the meeting room door, to beside its chair', () => {
  for (const seat of MEETING_SEATS) {
    const way = wayIn(seat);
    const [x0, z0] = way[0];
    assert.ok(Math.abs(x0 - ELEVATOR.x) < 0.6 && z0 > ELEVATOR_FRONT && z0 < ELEVATOR_FRONT + 1.2, `${seat.id} steps out of the elevator`);
    // It ends beside its chair, and gets there on open floor.
    const [ex, ez] = way[way.length - 1];
    assert.ok(Math.hypot(ex - seat.x, ez - seat.z) < 1.3, `${seat.id} ends beside its chair`);
    for (let i = 1; i < way.length - 1; i++) clear(way[i - 1], way[i], seat.id);
    // Into the room through its doorway, not the glass.
    const crossing = way.findIndex(([, z], i) => i > 0 && way[i - 1][1] < MEETING_ROOM.minZ && z >= MEETING_ROOM.minZ);
    assert.ok(crossing > 0, `${seat.id} goes into the room`);
    const [[ax, az], [bx, bz]] = [way[crossing - 1], way[crossing]];
    const x = ax + ((bx - ax) * (MEETING_ROOM.minZ - az)) / (bz - az);
    assert.ok(x > MEETING_ROOM.door.x0 && x < MEETING_ROOM.door.x1, `${seat.id} goes in by the door (x ${x.toFixed(2)})`);
  }
});

test('upstairs, with no exit door, a worker sent home walks out onto the balcony to the railing', () => {
  for (const [seat, wing] of everywhere()) {
    const way = wayToBalcony(seat, wing);
    assert.ok(Math.hypot(way[0][0] - seat.x, way[0][1] - seat.z) < 1.2, `${seat.id} hops down beside its seat`);
    const out = way.findIndex(([, z]) => z > FLOOR.maxZ);
    assert.ok(out > 1, `${seat.id} goes out onto the balcony`);
    for (let i = 2; i < out; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        assert.ok(walkable(x, z, wing), `${seat.id} (built out ${wing}) walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    // Through the balcony doors, then straight across to the railing.
    for (const [x] of way.slice(out - 1)) assert.ok(Math.abs(x - BALCONY_DOOR.u) < BALCONY_DOOR.width / 2 - 0.3, `${seat.id} goes through the balcony doors`);
    const [jx, jz] = way[way.length - 1];
    assert.deepEqual([jx, jz], [PARACHUTE.jump.x, PARACHUTE.jump.z]);
    assert.ok(jz < BALCONY.maxZ && jz > BALCONY.maxZ - 0.6, `${seat.id} ends up at the railing`);
  }
});

test('the back office is floor on an office floor, as far as its back wall', () => {
  const inside: Pt = [(WING.minX + WING.maxX) / 2 + 1.7, FLOOR.minZ - 1];
  assert.equal(walkable(inside[0], inside[1], 0), false, 'with no back office, behind the north wall there is nothing');
  assert.ok(walkable(inside[0], inside[1], WING.rows), 'its row is open floor');
  assert.equal(walkable(inside[0], wingMinZ(WING.rows) - 0.5, WING.rows), false, 'past its back wall is not');
  // Nowhere else through the north wall.
  assert.equal(walkable(0, FLOOR.minZ - 1, WING.rows), false);
});

test("the restroom's fittings are in the way, and its door is the way in", () => {
  const { door, table, cubicle, toilet, sink } = RESTROOM;
  const wall = RESTROOM.maxZ - RESTROOM.wall / 2;
  const blocked: [string, number, number][] = [
    ['the wall beside the door', door.x + door.width / 2 + 0.5, wall],
    ["the hajzel baba's table", table.x, table.z],
    ['her chair', table.x + table.chair, table.z],
    ["the cubicle's side wall", cubicle.minX, (RESTROOM.minZ + cubicle.maxZ) / 2],
    ["the cubicle's front beside its door", cubicle.minX + 0.2, cubicle.maxZ],
    ['the toilet', toilet.x, toilet.z],
    ['the sink', sink.x, sink.z],
  ];
  for (const [what, x, z] of blocked) assert.equal(walkable(x, z, WING.rows), false, what);
  assert.ok(walkable(door.x, wall, WING.rows), 'the doorway');
  assert.ok(walkable(cubicle.door.x, cubicle.maxZ, WING.rows), "the cubicle's doorway");
});

test('the toilet can be walked up to from the room, in by the door and the cubicle door', () => {
  const place = seatPlace(SEATING_BY_ID.get('toilet')!, 0);
  const front: Pt = [place.x + Math.sin(place.rotY) * place.out, place.z + Math.cos(place.rotY) * place.out];
  const way = route([0, 0], front, WING.rows);
  const [ex, ez] = way[way.length - 1];
  assert.ok(Math.hypot(ex - front[0], ez - front[1]) < 0.6, 'the route gets in front of the toilet');
  for (let i = 1; i < way.length; i++) {
    const [x0, z0] = way[i - 1];
    const [x1, z1] = way[i];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
    for (let k = 0; k <= n; k++) assert.ok(walkable(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n, WING.rows), `step ${i} walks into something`);
  }
  // Where it crosses the restroom's wall and the cubicle's, it's through their doors.
  const crossing = (z: number) => {
    const i = way.findIndex(([, wz], j) => j > 0 && way[j - 1][1] > z && wz <= z);
    const [[ax, az], [bx, bz]] = [way[i - 1], way[i]];
    return ax + ((bx - ax) * (z - az)) / (bz - az);
  };
  assert.ok(Math.abs(crossing(RESTROOM.maxZ) - RESTROOM.door.x) < RESTROOM.door.width / 2, 'in by the restroom door');
  assert.ok(Math.abs(crossing(RESTROOM.cubicle.maxZ) - RESTROOM.cubicle.door.x) < RESTROOM.cubicle.door.width / 2, 'in by the cubicle door');
});
