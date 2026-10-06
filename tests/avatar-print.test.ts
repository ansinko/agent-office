import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINT_MAX, cleanPrint, sameLook, sanitizeLook } from '../src/shared/avatar.js';

const base = { skin: 1, hair: 2, style: 3 };

test('a shirt print is one tidy line, at most PRINT_MAX long', () => {
  assert.equal(cleanPrint('  eranet  '), 'eranet');
  assert.equal(cleanPrint('era\nnet'), 'era net');
  assert.equal(cleanPrint('x'.repeat(40)).length, PRINT_MAX);
  assert.equal(cleanPrint('🚀'.repeat(20)), '🚀'.repeat(PRINT_MAX));
  assert.equal(cleanPrint(42), '');
});

test('a look keeps its print, and losing it means a plain shirt, not the old print', () => {
  assert.deepEqual(sanitizeLook({ ...base, print: 'eranet' }, base), { ...base, print: 'eranet' });
  assert.deepEqual(sanitizeLook(base, { ...base, print: 'eranet' }), base);
  assert.deepEqual(sanitizeLook({ ...base, print: '   ' }, base), base);
});

test('two looks differ when only their prints do', () => {
  assert.equal(sameLook(base, { ...base, print: 'eranet' }), false);
  assert.equal(sameLook({ ...base, print: 'eranet' }, { ...base, print: 'eranet' }), true);
  assert.equal(sameLook(base, { ...base }), true);
});
