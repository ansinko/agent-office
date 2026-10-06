import test from 'node:test';
import assert from 'node:assert/strict';
import { toiletTaken } from '../src/client/features/restroom/occupied.js';

// The occupied sign on the cubicle door (features/restroom): red while anyone on your floor sits on the
// toilet, you included, and green otherwise.

test('the toilet is free with nobody on it', () => {
  assert.equal(toiletTaken([{ id: 'a', floor: 'f1', seat: 'couch:0' }, { id: 'b', floor: 'f1' }], 'f1', 'me', undefined), false);
});

test('someone on the toilet on your floor takes it', () => {
  assert.equal(toiletTaken([{ id: 'a', floor: 'f1', seat: 'toilet:0' }], 'f1', 'me', undefined), true);
});

test('someone on the toilet on another floor leaves yours free', () => {
  assert.equal(toiletTaken([{ id: 'a', floor: 'f2', seat: 'toilet:0' }], 'f1', 'me', undefined), false);
});

test('your own seat counts as soon as you sit, whatever the office still has for you', () => {
  assert.equal(toiletTaken([{ id: 'me', floor: 'f1' }], 'f1', 'me', 'toilet:0'), true);
  assert.equal(toiletTaken([{ id: 'me', floor: 'f1', seat: 'toilet:0' }], 'f1', 'me', undefined), false);
});
