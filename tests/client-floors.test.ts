import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, WING, wingMinZ } from '../src/shared/layout.js';
import type { FloorInfo } from '../src/shared/protocol.js';
import { builtFloors, floorWings, pastTheWing } from '../src/client/core/floors.js';
import { store } from '../src/client/state/index.js';

const floor = (id: string, extra: Partial<FloorInfo> = {}) => ({ id, name: id, waiting: 0, people: 0, palette: 0, ...extra }) as FloorInfo;

test('the built floors leave out the ones still being cloned', () => {
  store.floors = [floor('a'), floor('b', { cloning: true }), floor('c')];
  assert.deepEqual(
    builtFloors().map((f) => f.id),
    ['a', 'c'],
  );
});

test("every floor has its back office, the restroom, one row deep", () => {
  assert.equal(WING.rows, 1);
  assert.deepEqual(floorWings([floor('a'), floor('b'), floor('c')]), [1, 1, 1]);
});

test("past the wing: standing where the back office would be, further back than this floor's goes", () => {
  const x = (WING.minX + WING.maxX) / 2;
  const deep = wingMinZ(WING.rows) + 0.5;
  assert.equal(pastTheWing({ x, y: 0, z: deep }, 0), true);
  assert.equal(pastTheWing({ x, y: 0, z: deep }, WING.rows), false);
  // In the room itself, down in the garage or up on the roof, it's not the back office.
  assert.equal(pastTheWing({ x, y: 0, z: FLOOR.minZ + 1 }, 0), false);
  assert.equal(pastTheWing({ x, y: -3, z: deep }, 0), false);
  assert.equal(pastTheWing({ x, y: 5, z: deep }, 0), false);
  assert.equal(pastTheWing({ x: WING.minX - 1, y: 0, z: deep }, 0), false);
});
