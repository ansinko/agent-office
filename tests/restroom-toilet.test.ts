import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../src/client/player/index.js';
import { readHireRequest } from '../src/server/office-workers.js';
import { workerRestroomRefusal } from '../src/server/restroom.js';
import { FLOOR, SEATING_BY_ID, SLAB, seatPlace } from '../src/shared/layout.js';
import type { WorkerStatus } from '../src/shared/protocol.js';
import { RESTROOM_DESK, brainstorming, toiletUse } from '../src/shared/restroom.js';

const RUNNING: WorkerStatus[] = ['starting', 'idle', 'working', 'needs_input', 'done', 'offline'];

test('E on the toilet: no repo says so, a running hajzel baba opens her terminal, otherwise she is asked', () => {
  assert.equal(toiletUse(undefined, undefined), 'no-repo');
  assert.equal(toiletUse(undefined, 'working'), 'no-repo');
  assert.equal(toiletUse('acme/app', undefined), 'ask');
  assert.equal(toiletUse('acme/app', 'exited'), 'ask');
  for (const s of RUNNING) assert.equal(toiletUse('acme/app', s), 'terminal', s);
});

test('getting off the toilet asks first while she is hired and not exited', () => {
  assert.equal(brainstorming(undefined), false);
  assert.equal(brainstorming('exited'), false);
  for (const s of RUNNING) assert.equal(brainstorming(s), true, s);
});

test('workers reach every desk through office-workers but the hajzel baba', () => {
  const why = workerRestroomRefusal(RESTROOM_DESK);
  assert.match(why ?? '', /sits on the toilet/);
  assert.equal(workerRestroomRefusal('desk-1'), undefined);
  assert.equal(workerRestroomRefusal('station-issues'), undefined);
  assert.equal(readHireRequest({ prompt: 'an idea', desk: RESTROOM_DESK }, ['claude']), why);
});

/** A player on the office floor, with its keys, as tests/player.test.ts makes one. */
function controller(t: TestContext) {
  const win = new EventTarget();
  for (const [name, value] of [['window', win], ['document', new EventTarget()]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, [{ ...FLOOR, bottom: -SLAB, top: 0 }]);
  function press(code: string) {
    player.clearKeys();
    const event = new Event('keydown');
    Object.defineProperty(event, 'code', { value: code });
    win.dispatchEvent(event);
  }
  return { player, press };
}

test('walking off a seat waits for mayGetUp, and goes once it says yes', (t) => {
  const { player, press } = controller(t);
  let asked = 0;
  let may = false;
  let gotUp = 0;
  player.mayGetUp = () => (asked++, may);
  player.onStand = () => gotUp++;
  player.sit(seatPlace(SEATING_BY_ID.get('toilet')!, 0));
  press('KeyW');
  player.update(1 / 60);
  assert.ok(player.seat, 'still sitting');
  assert.equal(asked, 1);
  assert.equal(gotUp, 0);
  may = true;
  player.update(1 / 60);
  assert.equal(player.seat, null);
  assert.equal(gotUp, 1);
});
