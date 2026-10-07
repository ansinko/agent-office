import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextFor, type Bkt } from '../src/server/hosts/bitbucket/bkt.js';

/** A bkt that answers `context list` and `auth status` from these, and records every call. */
function fake(list: object, auth: object = { hosts: [{ key: 'api.bitbucket.org', kind: 'cloud' }] }) {
  const calls: string[][] = [];
  const run: Bkt = async (args) => {
    calls.push(args);
    if (args[0] === 'context' && args[1] === 'list') return JSON.stringify(list);
    if (args[0] === 'auth') return JSON.stringify(auth);
    return '';
  };
  return { run, calls };
}

test('a login given by env needs no context and asks bkt nothing', async () => {
  const { run, calls } = fake({});
  assert.deepEqual(await contextFor(run, 'example-team', { BKT_HOST: 'api.bitbucket.org' }), []);
  assert.deepEqual(calls, []);
});

test('an existing office context for the workspace is used as it is', async () => {
  const { run, calls } = fake({ active_context: 'mine', contexts: [{ name: 'office-example-team' }] });
  assert.deepEqual(await contextFor(run, 'example-team', {}), ['-c', 'office-example-team']);
  assert.deepEqual(calls, [['context', 'list', '--json']]);
});

test("a missing one is made on the logged-in cloud host, and the person's active context is put back", async () => {
  const { run, calls } = fake({ active_context: 'mine', contexts: [{ name: 'mine' }] });
  assert.deepEqual(await contextFor(run, 'example-team', {}), ['-c', 'office-example-team']);
  assert.deepEqual(calls.slice(2), [
    ['context', 'create', 'office-example-team', '--host', 'api.bitbucket.org', '--workspace', 'example-team'],
    ['context', 'use', 'mine'],
  ]);
});

test('with no context active before, nothing is put back', async () => {
  const { run, calls } = fake({ active_context: '', contexts: null });
  await contextFor(run, 'example-team', {});
  assert.equal(calls.some((c) => c[1] === 'use'), false);
});

test('with no cloud login, it says to log in', async () => {
  const { run } = fake({ contexts: null }, { hosts: [] });
  await assert.rejects(contextFor(run, 'example-team', {}), /bkt auth login --kind cloud/);
});
