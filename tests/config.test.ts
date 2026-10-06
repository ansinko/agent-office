import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';

/** loadConfig with a throwaway --home, turning process.exit into a throw so a bad flag can be tested. */
function load(t: { after(fn: () => void): void }, ...argv: string[]) {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-office-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const exit = process.exit;
  const error = console.error;
  const previousArgs = process.env.AGENT_OFFICE_AGENT_ARGS;
  const errors: string[] = [];
  process.exit = ((code?: number) => {
    throw new Error(`exit ${code}: ${errors.join('\n')}`);
  }) as typeof process.exit;
  console.error = (...args: unknown[]) => void errors.push(args.join(' '));
  delete process.env.AGENT_OFFICE_AGENT_ARGS;
  try {
    return loadConfig(['--home', home, '--password', 'x', ...argv]);
  } finally {
    process.exit = exit;
    console.error = error;
    if (previousArgs !== undefined) process.env.AGENT_OFFICE_AGENT_ARGS = previousArgs;
  }
}

test('--agent-args takes flags as its value, as the help shows', (t) => {
  assert.deepEqual(load(t, '--agent-args', '--model opus').agentArgs, ['--model', 'opus']);
  // ...and the flag after it is parsed as a flag again.
  assert.equal(load(t, '--agent-args', '--model opus', '--port', '4999').port, 4999);
});

test('--agent-args with nothing after it still needs a value', (t) => {
  assert.throws(() => load(t, '--agent-args'), /exit 2: agent-office: --agent-args needs a value/);
});

test('other flags still treat a leading -- as a missing value', (t) => {
  assert.throws(() => load(t, '--agent', '--agent-args', 'x'), /exit 2: agent-office: --agent needs a value/);
});

test('the office listens on loopback unless --host says otherwise', (t) => {
  assert.equal(load(t).host, '127.0.0.1');
  assert.equal(load(t, '--host', '0.0.0.0').host, '0.0.0.0');
});

test('--no-open leaves the browser alone', (t) => {
  assert.equal(load(t).open, true);
  assert.equal(load(t, '--no-open').open, false);
});

test('TURN servers come from --turn and from AGENT_OFFICE_TURN', (t) => {
  const previous = process.env.AGENT_OFFICE_TURN;
  process.env.AGENT_OFFICE_TURN = ' turn:office:p%40ss@office.example.com:3478  turn:office:p%40ss@office.example.com:3478?transport=tcp ';
  t.after(() => (previous === undefined ? delete process.env.AGENT_OFFICE_TURN : (process.env.AGENT_OFFICE_TURN = previous)));
  const { iceServers } = load(t, '--turn', 'turns:relay.example.com:5349');
  assert.deepEqual(iceServers.slice(1), [
    { urls: 'turn:office.example.com:3478', username: 'office', credential: 'p@ss' },
    { urls: 'turn:office.example.com:3478?transport=tcp', username: 'office', credential: 'p@ss' },
    { urls: 'turns:relay.example.com:5349' },
  ]);
});

test("the meeting room screen's apps are served on the office's port + 10 unless told otherwise, never on the office's own", (t) => {
  assert.equal(load(t, '--port', '4700').meetingScreenPort, 4710);
  assert.equal(load(t, '--port', '4700', '--meeting-screen-port', '4800').meetingScreenPort, 4800);
  assert.throws(() => load(t, '--port', '4700', '--meeting-screen-port', '4700'), /exit 2: .*--meeting-screen-port/);
  assert.throws(() => load(t, '--meeting-screen-port', 'x'), /exit 2: .*--meeting-screen-port/);
  assert.equal(load(t, '--meeting-screen-url', 'http://127.0.0.1:3000').meetingScreenUrl, 'http://127.0.0.1:3000');
});
