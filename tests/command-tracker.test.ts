import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { issueKey } from '../src/shared/protocol.js';
import { commandTracker } from '../src/server/hosts/command/index.js';
import { CommandTracker, boardOf, commandConfig, issuesOf } from '../src/server/hosts/command/tracker.js';

function folder(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-cmd-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A tracker.json whose command prints `issues`. */
function printing(dir: string, issues: unknown, extra: object = {}) {
  const script = path.join(dir, 'list.mjs');
  writeFileSync(script, `process.stdout.write(${JSON.stringify(JSON.stringify(issues))})`);
  writeFileSync(path.join(dir, 'tracker.json'), JSON.stringify({ name: 'Waves', command: [process.execPath, script], ...extra }));
}

test('issue keys take a tracker key that ends in letters, as a wave does', () => {
  for (const k of ['12', 'ERN-123', 'I16-W3B', 'REQUESTS-W2']) assert.equal(issueKey(k), k);
  for (const k of ['i16-w3b', '-W1', 'I16-', 'I16-W1 x', 'I16-W1/..', '0']) assert.equal(issueKey(k), undefined, k);
});

test('a floor without tracker.json keeps its host tracker', (t) => {
  const dir = folder(t);
  assert.equal(commandConfig(dir), undefined);
  assert.equal(commandTracker(dir, dir, () => {}), undefined);
});

test('a wrong tracker.json shows on the board instead of failing the floor', (t) => {
  const dir = folder(t);
  writeFileSync(path.join(dir, 'tracker.json'), JSON.stringify({ command: 'node list.mjs' }));
  const own = commandTracker(dir, dir, () => {})!;
  assert.match(own.tracker.issues.error ?? '', /tracker\.json is wrong: .*list of strings/);
});

test('what the command prints becomes the board, its junk dropped', () => {
  const items = issuesOf(
    JSON.stringify({
      issues: [
        { key: 'I16-W5', title: 'Čítací kontrakt', labels: ['ready', { name: 'reference-data', color: '#123456' }, { name: 'x', color: 'red' }], assignees: ['Andrej', 3], prompt: 'Take wave W5', url: 'javascript:alert(1)' },
        { key: 'I16-W5', title: 'twice' },
        { key: 'bad key', title: 'no' },
        { key: 'I16-W4', title: '' },
        { key: 'I16-W1', title: 'Kostra', state: 'closed', url: 'https://bitbucket.org/a/b/src/main/x.md' },
      ],
    }),
  );
  assert.deepEqual(
    items.map((i) => i.key),
    ['I16-W5', 'I16-W1'],
  );
  const [w5, w1] = items;
  assert.deepEqual(w5.labels, [
    { name: 'ready', color: '#8b949e' },
    { name: 'reference-data', color: '#123456' },
    { name: 'x', color: '#8b949e' },
  ]);
  assert.deepEqual(w5.assignees, ['Andrej']);
  assert.equal(w5.prompt, 'Take wave W5');
  assert.equal(w5.url, '');
  assert.equal(w5.state, 'open');
  assert.equal(w1.state, 'closed');
  assert.equal(w1.prompt, undefined);
  assert.throws(() => issuesOf('{"nope":1}'), /no list of issues/);
  const [long] = issuesOf(JSON.stringify([{ key: 'I16-W5', title: 'W5', body: 'x'.repeat(20_000) }]));
  assert.equal(long.body.length, 16_000);
});

test('the board lists what the command prints, and only lists', async (t) => {
  const dir = folder(t);
  printing(dir, [{ key: 'I16-W5', title: 'Čítací kontrakt', body: 'Tickets 09, 12' }]);
  const seen: unknown[] = [];
  const own = commandTracker(dir, dir, (s) => seen.push(s))!;
  assert.equal(own.name, 'Waves');
  await own.tracker.refresh();
  assert.equal(own.tracker.issues.error, undefined);
  assert.deepEqual(
    own.tracker.issues.items.map((i) => i.title),
    ['Čítací kontrakt'],
  );
  assert.ok(seen.length >= 2);
  const detail = await own.tracker.issueDetail('I16-W5');
  assert.equal(detail.readOnly, true);
  assert.equal(detail.body, 'Tickets 09, 12');
  assert.match((await own.tracker.comment({ kind: 'issue', key: 'I16-W5' }, 'hi')).error ?? '', /only lists/);
  assert.match((await own.tracker.close('I16-W5', {})) ?? '', /only lists/);
  assert.match((await own.tracker.setLabels('I16-W5', ['a'], [])).error ?? '', /only lists/);
});

test('a worker taking one marks it taken until the command lists it as taken', async (t) => {
  const dir = folder(t);
  printing(dir, [{ key: 'I16-W5', title: 'W5' }]);
  const tracker = commandTracker(dir, dir, () => {})!.tracker as CommandTracker;
  await tracker.refresh();
  assert.equal(await tracker.claim('I16-W5'), undefined);
  assert.equal(tracker.issues.items[0].taken, true);
  // The next look still has nobody on it: the office's note stands.
  await tracker.refresh();
  assert.equal(tracker.issues.items[0].taken, true);
  // Once the command shows who has it, its list is believed.
  printing(dir, [{ key: 'I16-W5', title: 'W5', assignees: ['feature/i-16-reference-data-w5-x'] }]);
  await tracker.refresh();
  assert.equal(tracker.issues.items[0].taken, undefined);
  printing(dir, [{ key: 'I16-W5', title: 'W5' }]);
  await tracker.refresh();
  assert.equal(tracker.issues.items[0].taken, undefined);
});

test('a command that fails says so on the board', async (t) => {
  const dir = folder(t);
  writeFileSync(path.join(dir, 'tracker.json'), JSON.stringify({ name: 'Waves', command: [process.execPath, '-e', 'console.error("spec repo missing"); process.exit(2)'] }));
  const own = commandTracker(dir, dir, () => {})!;
  await own.tracker.refresh();
  assert.match(own.tracker.issues.error ?? '', /Waves \(tracker\.json\) failed: spec repo missing/);
  writeFileSync(path.join(dir, 'tracker.json'), JSON.stringify({ name: 'Waves', command: ['/no/such/program'] }));
  const gone = commandTracker(dir, dir, () => {})!;
  await gone.tracker.refresh();
  assert.match(gone.tracker.issues.error ?? '', /\/no\/such\/program was not found/);
});

test('the command can lay the board out in columns of its own', async (t) => {
  const board = boardOf(
    JSON.stringify({
      columns: [{ key: 'waiting', title: '⏳ Waiting' }, { key: 'ready', title: '✅ Ready' }, { key: 'doing', title: '🚧 Doing', progress: true }, { key: 'ready', title: 'twice' }, { key: 'Bad Key', title: 'no' }, { key: 'x', title: '' }],
      issues: [{ key: 'I16-W5', title: 'W5', column: 'ready' }, { key: 'I16-W6', title: 'W6', column: 'NOPE' }],
    }),
  );
  assert.deepEqual(board.columns, [{ key: 'waiting', title: '⏳ Waiting' }, { key: 'ready', title: '✅ Ready' }, { key: 'doing', title: '🚧 Doing', progress: true }]);
  assert.deepEqual(
    board.items.map((i) => i.column),
    ['ready', undefined],
  );
  assert.deepEqual(boardOf('[]').columns, []);

  const dir = folder(t);
  printing(dir, { columns: [{ key: 'ready', title: 'Ready' }], issues: [{ key: 'I16-W5', title: 'W5', column: 'ready' }] });
  const tracker = commandTracker(dir, dir, () => {})!.tracker;
  await tracker.refresh();
  assert.deepEqual(tracker.issues.columns, [{ key: 'ready', title: 'Ready' }]);
  printing(dir, [{ key: 'I16-W5', title: 'W5' }]);
  await tracker.refresh();
  assert.equal(tracker.issues.columns, undefined);
});
