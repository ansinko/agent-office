import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { author, checkOf, checksOf, commentsOf, pullReview, pullState, readiness, reviewsOf } from '../src/server/hosts/bitbucket/map.js';
import { api, friendly, repoFlags } from '../src/server/hosts/bitbucket/bkt.js';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/bitbucket/${f}`, import.meta.url), 'utf8'));
const reviewer = (approved: boolean, state: string | null = null) => ({ role: 'REVIEWER', approved, state, user: { nickname: 'r' } });

test('Bitbucket states', () => {
  assert.equal(pullState('OPEN', false), 'open');
  assert.equal(pullState('OPEN', true), 'draft');
  assert.equal(pullState('MERGED', false), 'merged');
  assert.equal(pullState('DECLINED', false), 'closed');
  assert.equal(pullState('SUPERSEDED', false), 'closed');
});

test('a review is changes when anyone asks for them, else approved, else pending, else none', () => {
  assert.equal(pullReview([reviewer(true), reviewer(false, 'changes_requested')]), 'changes');
  assert.equal(pullReview([reviewer(true), reviewer(false)]), 'approved');
  assert.equal(pullReview([reviewer(false)]), 'pending');
  assert.equal(pullReview([{ role: 'PARTICIPANT', approved: false, state: null }]), 'none');
  assert.equal(pullReview(null), 'none');
});

test('an approval from a participant who is not a listed reviewer still approves', () => {
  assert.equal(pullReview(fx('pullrequests-merged.json').values[0].participants), 'approved');
  assert.equal(pullReview([{ role: 'PARTICIPANT', approved: true, state: 'approved' }]), 'approved');
});

test('the fixtures read as the board would show them', () => {
  const [open, draft] = fx('pullrequests-open.json').values;
  assert.equal(pullState(open.state, open.draft), 'open');
  assert.equal(pullReview(open.participants), 'approved');
  assert.equal(pullState(draft.state, draft.draft), 'draft');
  assert.equal(pullReview(draft.participants), 'none');
  assert.equal(pullReview(fx('pullrequest.json').participants), 'changes');
  assert.equal(author(open.author), 'Alex Example');
});

test('a user is named by nickname, else display name, else nothing', () => {
  assert.equal(author({ nickname: 'nick', display_name: 'Display' }), 'nick');
  assert.equal(author({ display_name: 'Display' }), 'Display');
  assert.equal(author(null), '');
});

test('pipeline statuses become checks', () => {
  assert.equal(checkOf({ state: 'SUCCESSFUL', name: 'n', url: 'u' }).state, 'pass');
  assert.equal(checkOf({ state: 'FAILED', name: 'n' }).state, 'fail');
  assert.equal(checkOf({ state: 'INPROGRESS', name: 'n' }).state, 'pending');
  assert.equal(checkOf({ state: 'STOPPED', name: 'n' }).state, 'skip');
  assert.equal(checksOf([]), 'none');
  assert.equal(checksOf([{ state: 'SUCCESSFUL' }, { state: 'INPROGRESS' }]), 'pending');
  assert.equal(checksOf([{ state: 'SUCCESSFUL' }, { state: 'FAILED' }]), 'fail');
  assert.equal(checksOf([{ state: 'SUCCESSFUL' }, { state: 'STOPPED' }]), 'pass');
  assert.deepEqual(checkOf(fx('statuses.json').values[0]), {
    name: 'Pipeline - build',
    state: 'pass',
    url: 'https://bitbucket.org/example-team/example-repo/pipelines/results/1',
  });
  assert.equal(checksOf(fx('statuses.json').values), 'pending');
});

test('readiness: conflict, then failed checks, then changes requested, else clean', () => {
  const fail = [checkOf({ state: 'FAILED', name: 'n' })];
  assert.equal(readiness(fx('diffstat-conflict.json').values, [], 'none'), 'conflict');
  assert.equal(readiness(fx('diffstat.json').values, fail, 'changes'), 'checks');
  assert.equal(readiness(fx('diffstat.json').values, [], 'changes'), 'blocked');
  assert.equal(readiness(fx('diffstat.json').values, [], 'approved'), 'clean');
});

test('participants with a verdict become reviews', () => {
  const reviews = reviewsOf(fx('pullrequest.json').participants);
  assert.deepEqual(
    reviews.map((r) => [r.author, r.review, r.createdAt]),
    [
      ['Robin Reviewer', 'approved', '2026-01-03T08:00:00.000000+00:00'],
      ['Sam Sample', 'changes', '2026-01-03T08:30:00.000000+00:00'],
    ],
  );
  assert.equal(new Set(reviews.map((r) => r.id)).size, 2);
  assert.deepEqual(reviewsOf(undefined), []);
});

test('comments split into the conversation and line comments', () => {
  const { comments, reviewComments } = commentsOf(fx('comments.json').values);
  assert.deepEqual(comments, [
    {
      id: '101',
      author: 'Sam Sample',
      body: 'Looks fine overall, one question below.',
      createdAt: '2026-01-03T08:00:00.000000+00:00',
      url: 'https://bitbucket.org/example-team/example-repo/pull-requests/7/_/diff#comment-101',
    },
  ]);
  const byId = new Map(reviewComments.map((c) => [c.id, c]));
  assert.deepEqual([...byId.keys()], [102, 103, 104], 'the deleted comment is dropped');
  assert.deepEqual(byId.get(102), {
    id: 102,
    replyTo: undefined,
    author: 'Robin Reviewer',
    body: 'This name reads oddly.',
    createdAt: '2026-01-03T08:10:00.000000+00:00',
    url: 'https://bitbucket.org/example-team/example-repo/pull-requests/7/_/diff#comment-102',
    path: 'src/widget.ts',
    line: 12,
    side: 'RIGHT',
  });
  assert.equal(byId.get(103)!.side, 'LEFT');
  assert.equal(byId.get(103)!.line, 4);
  assert.equal(byId.get(104)!.replyTo, 102);
});

test('a reply in a deeper thread answers its first comment, and takes its line when it has none', () => {
  const at = '2026-01-01T00:00:00Z';
  const raw = [
    { id: 1, user: { nickname: 'a' }, content: { raw: 'root' }, created_on: at, inline: { path: 'a.ts', from: null, to: 3 } },
    { id: 2, user: { nickname: 'b' }, content: { raw: 'reply' }, created_on: at, parent: { id: 1 } },
    { id: 3, user: { nickname: 'a' }, content: { raw: 'reply to reply' }, created_on: at, parent: { id: 2 } },
  ];
  const { comments, reviewComments } = commentsOf(raw);
  assert.deepEqual(comments, []);
  assert.deepEqual(
    reviewComments.map((c) => [c.id, c.replyTo, c.path, c.line, c.side]),
    [
      [1, undefined, 'a.ts', 3, 'RIGHT'],
      [2, 1, 'a.ts', 3, 'RIGHT'],
      [3, 1, 'a.ts', 3, 'RIGHT'],
    ],
  );
});

test('bkt errors a person can act on', () => {
  assert.match(friendly('401 Unauthorized'), /bkt isn't signed in to Bitbucket/);
  assert.match(friendly('No hosts configured. Run `bkt auth login` to add one.'), /bkt auth login --kind cloud/);
  assert.match(friendly('403 Forbidden: Your credentials lack one or more required privilege scopes.'), /lacks a scope/);
  assert.match(friendly('403 Forbidden: Your credentials lack one or more required privilege scopes.'), /required privilege scopes/);
  assert.match(friendly('404 Not Found'), /can't find this repository on Bitbucket/);
  assert.equal(friendly('something else broke'), 'something else broke');
});

test('every call names the repository', () => {
  const r = { dir: '/tmp/x', ws: 'example-team', slug: 'example-repo' };
  assert.equal(api(r, '/pullrequests'), '/repositories/example-team/example-repo/pullrequests');
  assert.deepEqual(repoFlags(r), ['--workspace', 'example-team', '--repo', 'example-repo']);
});
