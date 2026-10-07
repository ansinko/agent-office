import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionAvailable, type InteractionState } from '../src/client/interaction.js';
import { sittingKeys } from '../src/client/features/seating/use.js';
import type { Interactable } from '../src/client/world/types.js';

const state = (overrides: Partial<InteractionState> = {}): InteractionState => ({ room: false, note: null, carrying: false, ...overrides });
const toilet: Interactable = { kind: 'seat', seatId: 'toilet', x: 0, z: 0, radius: 1 };

test('sitting, the hint lists E, then the seat\'s extra key, then getting up', () => {
  assert.deepEqual(sittingKeys('Tell your idea', { key: 'B', label: 'Issues board' }), [
    ['E', 'Tell your idea'],
    ['B', 'Issues board'],
    ['W A S D', 'Get up'],
  ]);
  assert.deepEqual(sittingKeys('Order a drink'), [
    ['E', 'Order a drink'],
    ['W A S D', 'Get up'],
  ]);
  assert.deepEqual(sittingKeys(''), [['E', 'Get up']]);
});

test('a seat takes its extra key only while you sit on it, and no other key besides E', () => {
  assert.equal(interactionAvailable(toilet, 'B', state({ seatKey: 'B' })), true);
  assert.equal(interactionAvailable(toilet, 'B', state()), false);
  assert.equal(interactionAvailable(toilet, 'O', state({ seatKey: 'B' })), false);
  assert.equal(interactionAvailable(toilet, 'E', state()), true);
  assert.equal(interactionAvailable({ ...toilet, seatId: undefined }, 'B', state({ seatKey: 'B' })), false);
});
