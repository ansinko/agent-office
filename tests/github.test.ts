import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Claims, MergeWatch } from '../src/server/hosts/watch.js';
import { GitHubPulls, mergeMethods } from '../src/server/hosts/github/pulls.js';
import { friendlyGhError } from '../src/server/hosts/github/gh.js';
import type { BoardState, Issue, Pull } from '../src/shared/protocol.js';

const pull = (number: number, state: Pull['state']): Pull => ({
  number, title: `PR ${number}`, state, url: '', author: '', labels: [], review: 'none',
  headRefName: `b${number}`, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0,
  checks: 'none', body: '', closes: [],
});
const numbers = (ps: Pull[]) => ps.map((p) => p.number);

test('a pull request that was open at the last look and is merged now rings once', () => {
  const w = new MergeWatch();
  assert.deepEqual(numbers(w.look([pull(1, 'open'), pull(2, 'merged'), pull(3, 'open')])), [], 'nothing rings on the first look');
  assert.deepEqual(numbers(w.look([pull(1, 'merged'), pull(2, 'merged'), pull(3, 'closed')])), [1]);
  assert.deepEqual(numbers(w.look([pull(1, 'merged'), pull(2, 'merged')])), []);
});

test('a merge from the PR window rings right away, and not again when GitHub catches up', () => {
  const w = new MergeWatch();
  w.look([pull(5, 'open'), pull(6, 'open')]);
  assert.equal(w.ring(5), true);
  assert.equal(w.ring(5), false);
  // A look that started before the merge still says open; the next one says merged.
  assert.deepEqual(numbers(w.look([pull(5, 'open'), pull(6, 'open')])), []);
  assert.deepEqual(numbers(w.look([pull(5, 'merged'), pull(6, 'merged')])), [6]);
});

const issue = (number: number, assignees: string[] = []): Issue => ({
  key: String(number), ref: `#${number}`, title: `Issue ${number}`, state: 'open', url: '', author: '', labels: [], assignees, createdAt: '', updatedAt: '', body: '', comments: 0,
});
const taken = (is: Issue[]) => is.filter((i) => i.taken).map((i) => Number(i.key));

test('an issue a worker took is marked at once, before GitHub has answered', () => {
  const c = new Claims();
  c.take('7');
  assert.deepEqual(taken(c.mark([issue(6), issue(7)])), [7]);
  // A list that comes back while GitHub is still assigning it doesn't have its assignee yet.
  assert.deepEqual(taken(c.mark([issue(6), issue(7)], 1000)), [7]);
});

test('it stays marked over a list asked for before it was assigned, until one asked for after', () => {
  const c = new Claims();
  const answered = c.take('7');
  answered(true, 2000);
  assert.deepEqual(taken(c.mark([issue(7)], 1500)), [7], 'asked before GitHub had it assigned');
  assert.equal(c.has('7'), true);
  const fresh = c.mark([issue(7, ['octocat'])], 2500);
  assert.deepEqual(taken(fresh), [], 'GitHub lists its assignee now, which is what keeps it In progress');
  assert.deepEqual(fresh[0].assignees, ['octocat']);
  assert.equal(c.has('7'), false);
});

test("an issue GitHub wouldn't assign goes back to where it was", () => {
  const c = new Claims();
  const answered = c.take('7');
  const shown = c.mark([issue(7)]);
  assert.deepEqual(taken(shown), [7]);
  answered(false);
  const back = c.mark(shown);
  assert.deepEqual(taken(back), []);
  assert.equal('taken' in back[0], false);
});

test('handed over twice, the first answer failing leaves the second one standing', () => {
  const c = new Claims();
  const first = c.take('7');
  const second = c.take('7');
  first(false);
  assert.deepEqual(taken(c.mark([issue(7)])), [7]);
  second(true, 3000);
  assert.deepEqual(taken(c.mark([issue(7, ['octocat'])], 3500)), []);
});

test('claims are kept by issue key', () => {
  const c = new Claims();
  const answered = c.take('ERN-7');
  assert.equal(c.has('ERN-7'), true);
  answered(false);
  assert.equal(c.has('ERN-7'), false);
});

test('merge methods are the ones the repository allows, in GitHub order', () => {
  assert.deepEqual(mergeMethods({ squashMergeAllowed: true, mergeCommitAllowed: false, rebaseMergeAllowed: true }).map((m) => m.id), ['squash', 'rebase']);
  assert.deepEqual(mergeMethods({}).map((m) => m.id), ['squash', 'merge', 'rebase']);
});

test('gh JSON field errors keep the field that failed', () => {
  assert.equal(
    friendlyGhError('Unknown JSON field: "headRefOid"\nAvailable fields:\n  title\n  updatedAt\n  url'),
    'Unknown JSON field: "headRefOid"',
  );
});

test('pull request listing works when older gh versions reject optional fields', async () => {
  const unsupported = new Set(['url', 'headRefOid', 'updatedAt', 'statusCheckRollup', 'closingIssuesReferences']);
  const calls: string[] = [];
  const runner = async (args: string[]) => {
    if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'acme/app', squashMergeAllowed: true, mergeCommitAllowed: false, rebaseMergeAllowed: false });
    assert.deepEqual(args.slice(0, 2), ['pr', 'list']);
    const fields = String(args.at(-1)).split(',');
    calls.push(fields.join(','));
    const bad = fields.find((f) => unsupported.has(f));
    if (bad) throw new Error(`Unknown JSON field: "${bad}"`);
    if (args[args.indexOf('--state') + 1] !== 'open') return '[]';
    return JSON.stringify([
      {
        number: 7,
        title: 'Fix login',
        state: 'OPEN',
        isDraft: false,
        author: { login: 'ada' },
        labels: [{ name: 'bug', color: 'd73a4a' }],
        reviewDecision: '',
        headRefName: 'fix-login',
        baseRefName: 'main',
        createdAt: '2026-01-01T00:00:00Z',
        additions: 4,
        deletions: 2,
        body: 'Closes #1',
      },
    ]);
  };
  let pulls: BoardState<Pull> | undefined;
  const github = new GitHubPulls('/repo', (state) => (pulls = state), runner);

  await github.refresh();

  assert.equal(pulls?.error, undefined);
  assert.equal(pulls?.items.length, 1);
  assert.equal(pulls?.items[0].url, 'https://github.com/acme/app/pull/7');
  assert.equal(pulls?.items[0].updatedAt, '2026-01-01T00:00:00Z');
  assert.equal(pulls?.items[0].checks, 'none');
  assert.ok(calls.some((fields) => !fields.includes('url') && !fields.includes('updatedAt')));
});
