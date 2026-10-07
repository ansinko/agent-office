import test from 'node:test';
import assert from 'node:assert/strict';
import { claude } from '../src/server/providers/claude.js';
import { restroomRefusal, type RestroomAct } from '../src/server/restroom.js';
import { READ_ONLY_STATIONS, stationBrief } from '../src/server/stations.js';
import { DESK_BY_ID, RESTROOM, SEATING_BY_ID, STATIONS, STATION_AGENT, seatPlace } from '../src/shared/layout.js';
import { PROMPTS } from '../src/shared/prompts.js';
import { RESTROOM_DESK, onToilet } from '../src/shared/restroom.js';

const ACTS: RestroomAct[] = ['prompt', 'terminal', 'kill'];
const floor = { id: 'f1', def: { repo: 'acme/app' } };
const onIt = { floor: 'f1', seat: 'toilet:0' };

test('the restroom has a toilet to sit on and the hajzel baba at her table', () => {
  const toilet = SEATING_BY_ID.get('toilet');
  assert.ok(toilet?.restroom, 'the toilet is a seat, flagged as the restroom’s');
  assert.ok(!toilet.roof);
  // In the cubicle, in the north-east corner of the restroom.
  const place = seatPlace(toilet, 0);
  assert.ok(place.x > RESTROOM.cubicle.minX && place.x < RESTROOM.maxX && place.z > RESTROOM.minZ && place.z < RESTROOM.cubicle.maxZ);
  const baba = STATIONS.find((d) => d.id === RESTROOM_DESK);
  assert.equal(baba?.station, 'restroom');
  assert.equal(DESK_BY_ID.get(RESTROOM_DESK), baba);
  assert.equal(STATION_AGENT.restroom.name, 'Hajzel baba');
  // At her table just inside the door.
  assert.ok(Math.abs(baba!.x - RESTROOM.door.x) < 2 && baba!.z < RESTROOM.maxZ && baba!.z > RESTROOM.maxZ - 1.5);
});

test('whoever sits on the toilet is on it; any other seat, or none, is not', () => {
  assert.equal(onToilet('toilet:0'), true);
  for (const seat of [undefined, '', 'toilet', 'toilet:1', 'couch:0', 'nope:0']) assert.equal(onToilet(seat), false, String(seat));
});

test('only whoever sits on the toilet prompts the hajzel baba, works her terminal or sends her home', () => {
  for (const act of ACTS) {
    assert.equal(restroomRefusal(onIt, floor, RESTROOM_DESK, act), undefined, act);
    for (const peer of [{ floor: 'f1' }, { floor: 'f1', seat: 'couch:0' }, { floor: 'f2', seat: 'toilet:0' }, { seat: 'toilet:0' }]) {
      assert.match(restroomRefusal(peer, floor, RESTROOM_DESK, act) ?? '', /toilet/, `${act} from ${JSON.stringify(peer)}`);
    }
    // Everyone else's workers are anyone's, as before.
    for (const desk of ['desk-1', 'station-queue', 'beanbag-1']) assert.equal(restroomRefusal({ floor: 'f1' }, floor, desk, act), undefined, `${act} at ${desk}`);
  }
});

test('on a floor with no GitHub repo, the idea has nowhere to go, and the rest still works', () => {
  const bare = { id: 'f1', def: {} };
  assert.equal(restroomRefusal(onIt, bare, RESTROOM_DESK, 'prompt'), 'Ideas have nowhere to go here: this floor has no GitHub repo.');
  assert.equal(restroomRefusal(onIt, bare, RESTROOM_DESK, 'terminal'), undefined);
  assert.equal(restroomRefusal(onIt, bare, RESTROOM_DESK, 'kill'), undefined);
});

test("the hajzel baba's brief names the repo, asks first, changes nothing and files issues labeled idea after a yes", () => {
  assert.equal(PROMPTS['station.restroom'].group, 'stations');
  assert.deepEqual(Object.keys(PROMPTS['station.restroom'].vars), ['repo']);
  const brief = stationBrief('restroom', undefined, 'acme/app');
  assert.match(brief, /Hajzel baba/);
  assert.doesNotMatch(brief, /\{\{/);
  assert.match(brief, /gh issue create --repo acme\/app --label idea/);
  assert.match(brief, /gh label create idea --repo acme\/app/);
  assert.match(brief, /Ask about it first/);
  assert.match(brief, /You change nothing/);
  assert.match(brief, /only after the person says yes/);
  assert.match(brief, /number and link/);
  assert.ok(brief.endsWith('The idea:'));
  assert.doesNotMatch(brief, /office-queue/);
});

test('the hajzel baba is launched without the file-editing tools, like the queue agent', () => {
  assert.deepEqual([...READ_ONLY_STATIONS].sort(), ['queue', 'restroom']);
  const launch = (station?: 'restroom' | 'issues') => claude.launch({ h: { info: {} } as never, args: [], station, cwd: '/tmp', setup: { settings: '/data/settings.json' }, prompt: 'an idea' }).args;
  const args = launch('restroom');
  const i = args.indexOf('--disallowedTools');
  assert.deepEqual(args.slice(i + 1, i + 4), ['Edit', 'Write', 'NotebookEdit']);
  assert.ok(i < args.indexOf('--'), 'the tools come before the prompt');
  assert.equal(launch('issues').includes('--disallowedTools'), false);
});
