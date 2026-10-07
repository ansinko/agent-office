import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { BoardState, Pull } from '../src/shared/protocol.js';
import type { BbRepo, Bkt } from '../src/server/hosts/bitbucket/bkt.js';
import { BITBUCKET_CAPS, BITBUCKET_METHODS, BitbucketPulls, listQuery } from '../src/server/hosts/bitbucket/pulls.js';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/bitbucket/${f}`, import.meta.url), 'utf8'));
const REPO: BbRepo = { dir: '/tmp/example-repo', ws: 'example-team', slug: 'example-repo' };
const BASE = '/repositories/example-team/example-repo';
const FULL = 'abc123def4567890abc123def4567890abc123de';

/** The open list's second page, the one its `next` points at. */
const PAGE2 = 'https://api.bitbucket.org/2.0/repositories/example-team/example-repo/pullrequests?pagelen=2&state=OPEN&page=2';
const page2 = () => {
  const p = structuredClone(fx('pullrequests-open.json').values[0]);
  return { values: [{ ...p, id: 9, title: 'Third open', source: { ...p.source, commit: { hash: '999999999999' } } }], page: 2 };
};

/** A runner that answers by path and records every argv; `fail` makes every call reject with it. */
function fakeBkt(answers: Record<string, unknown> = {}, fail?: string) {
  const calls: string[][] = [];
  const bkt: Bkt = async (args) => {
    calls.push(args);
    if (fail) throw new Error(fail);
    const path = args[1] ?? '';
    const param = (k: string) => args.find((a, i) => args[i - 1] === '-P' && a.startsWith(`${k}=`))?.slice(k.length + 1);
    if (path in answers) return JSON.stringify(answers[path]);
    if (path === `${BASE}/pullrequests`) {
      const state = param('state');
      if (state === 'OPEN') return JSON.stringify(fx('pullrequests-open.json'));
      if (state === 'MERGED') return JSON.stringify(fx('pullrequests-merged.json'));
      return JSON.stringify({ values: [] });
    }
    if (path === `${BASE}${PAGE2.split(BASE)[1]}`) return JSON.stringify(page2());
    if (path.endsWith('/statuses')) return JSON.stringify(fx('statuses.json'));
    if (path.endsWith('/diffstat')) return JSON.stringify(fx('diffstat.json'));
    if (path === `${BASE}/pullrequests/7`) return JSON.stringify(fx('pullrequest.json'));
    if (path === `${BASE}/pullrequests/7/comments`) return JSON.stringify(fx('comments.json'));
    if (path === '/user') return JSON.stringify({ nickname: 'office-bot', display_name: 'Office Bot' });
    throw new Error(`unexpected bkt ${args.join(' ')}`);
  };
  return { bkt, calls };
}

/** Git that knows one commit, abc123def456, and fails on any other. */
const fakeGit = async (args: string[]) => {
  if (args.join(' ') === 'rev-parse --verify abc123def456^{commit}') return `${FULL}\n`;
  throw new Error('fatal: Needed a single revision');
};

function board(bkt: Bkt) {
  const seen: BoardState<Pull>[] = [];
  const pulls = new BitbucketPulls(REPO, (s) => seen.push(s), bkt, fakeGit);
  return { pulls, seen };
}

const listCalls = (calls: string[][]) => calls.filter((c) => c[1]?.startsWith(`${BASE}/pullrequests`) && !/pullrequests\/\d/.test(c[1]));

test('the board lists open, merged and declined pull requests, with fields, 50 to a page, following next', async () => {
  const { bkt, calls } = fakeBkt();
  const { pulls } = board(bkt);
  await pulls.refresh();
  const lists = listCalls(calls);
  const first = (state: string) => lists.find((c) => c.includes(`state=${state}`) && c[1] === `${BASE}/pullrequests`);
  for (const state of ['OPEN', 'MERGED', 'DECLINED']) {
    const c = first(state)!;
    assert.deepEqual(c.slice(0, 6), ['api', `${BASE}/pullrequests`, '-P', `state=${state}`, '-P', 'pagelen=50']);
    assert.equal(c[6], '-P');
    assert.match(c[7], /^fields=/);
    for (const f of ['id', 'title', 'description', 'state', 'draft', 'created_on', 'updated_on', 'author', 'source.branch', 'source.commit', 'destination.branch', 'links.html', 'participants']) assert.ok(c[7].includes(f), f);
  }
  assert.deepEqual(lists.find((c) => c[1].includes('page=2')), ['api', `${BASE}/pullrequests?pagelen=2&state=OPEN&page=2`]);
  assert.equal(lists.length, 4);
  assert.deepEqual(pulls.pulls.items.map((p) => p.number), [7, 8, 9, 5, 4]);
});

test('next is not followed once the limit is reached', async () => {
  const { bkt, calls } = fakeBkt();
  const got = await listQuery('OPEN', 2)(bkt, REPO);
  assert.deepEqual(got.map((p: any) => p.id), [7, 8]);
  assert.equal(calls.length, 1);
  const more = await listQuery('OPEN', 3)(bkt, REPO);
  assert.deepEqual(more.map((p: any) => p.id), [7, 8, 9]);
});

test('board items read like the fixture, with the full hash where the checkout has it', async () => {
  const { bkt } = fakeBkt();
  const { pulls, seen } = board(bkt);
  await pulls.refresh();
  assert.deepEqual(seen.map((s) => s.loading), [true, false]);
  const [seven, eight] = pulls.pulls.items;
  assert.deepEqual(seven, {
    number: 7,
    title: 'Add the example widget',
    state: 'open',
    url: 'https://bitbucket.org/example-team/example-repo/pull-requests/7',
    author: 'Alex Example',
    labels: [],
    review: 'approved',
    headRefName: 'feature/example-widget',
    headRefOid: FULL,
    baseRefName: 'main',
    createdAt: '2026-01-02T09:00:00.000000+00:00',
    updatedAt: '2026-01-03T09:00:00.000000+00:00',
    additions: 40,
    deletions: 10,
    checks: 'pending',
    body: 'Example description for pull request 7.',
    closes: [],
  });
  assert.equal(eight.state, 'draft');
  assert.equal(eight.review, 'none');
  assert.equal(eight.headRefOid, undefined);
  const merged = pulls.pulls.items.find((p) => p.number === 5)!;
  assert.equal(merged.state, 'merged');
  assert.equal(merged.headRefOid, undefined);
  // Checks and lines are asked only of open pull requests.
  assert.equal(merged.checks, 'none');
  assert.equal(merged.additions, 0);
});

test('a description is cut to 4000 characters on the board', async () => {
  const open = fx('pullrequests-open.json');
  open.values = [{ ...open.values[0], description: 'x'.repeat(5000) }];
  delete open.next;
  const { bkt } = fakeBkt({});
  const wrapped: Bkt = (args, o) => (args[1] === `${BASE}/pullrequests` && args.includes('state=OPEN') ? Promise.resolve(JSON.stringify(open)) : bkt(args, o));
  const { pulls } = board(wrapped);
  await pulls.refresh();
  assert.equal(pulls.pulls.items[0].body.length, 4000);
});

test('a second refresh with the same source hashes asks no statuses or diffstat', async () => {
  const { bkt, calls } = fakeBkt();
  const { pulls } = board(bkt);
  await pulls.refresh();
  const asked = (cs: string[][]) => cs.filter((c) => /\/(statuses|diffstat)$/.test(c[1] ?? ''));
  assert.deepEqual(asked(calls).map((c) => c[1]).sort(), [7, 8, 9].flatMap((n) => [`${BASE}/pullrequests/${n}/diffstat`, `${BASE}/pullrequests/${n}/statuses`]).sort());
  const before = calls.length;
  await pulls.refresh();
  assert.equal(asked(calls.slice(before)).length, 0);
  assert.equal(pulls.pulls.items[0].additions, 40);
});

test("an error from bkt is the board's error, and it stops loading", async () => {
  const { bkt } = fakeBkt({}, "bkt isn't signed in to Bitbucket on the office's machine; run `bkt auth login --kind cloud` there");
  const { pulls, seen } = board(bkt);
  await pulls.refresh();
  assert.equal(pulls.pulls.error, "bkt isn't signed in to Bitbucket on the office's machine; run `bkt auth login --kind cloud` there");
  assert.equal(pulls.pulls.loading, false);
  assert.equal(seen.at(-1)?.loading, false);
});

test('the pull request window: reviews, comments, line comments, readiness, every commit, repo and viewer', async () => {
  const commits1 = { values: [{ hash: 'a' }, { hash: 'b' }], next: `https://api.bitbucket.org/2.0${BASE}/pullrequests/7/commits?page=2` };
  const commits2 = { values: [{ hash: 'c' }] };
  const { bkt, calls } = fakeBkt({ [`${BASE}/pullrequests/7/commits`]: commits1, [`${BASE}/pullrequests/7/commits?page=2`]: commits2 });
  const { pulls } = board(bkt);
  const d = await pulls.pullDetail(7);
  assert.equal(d.number, 7);
  assert.equal(d.state, 'open');
  assert.equal(d.review, 'changes');
  assert.equal(d.readiness, 'blocked');
  assert.equal(d.commits, 3);
  assert.equal(d.headRefName, 'feature/example-widget');
  assert.equal(d.baseRefName, 'main');
  assert.equal(d.body, 'Example description for pull request 7.');
  assert.deepEqual(d.reviews.map((r) => [r.author, r.review]), [['Robin Reviewer', 'approved'], ['Sam Sample', 'changes']]);
  assert.deepEqual(d.comments.map((c) => c.id), ['101']);
  assert.deepEqual(d.reviewComments.map((c) => [c.id, c.side, c.line, c.replyTo]), [[102, 'RIGHT', 12, undefined], [103, 'LEFT', 4, undefined], [104, 'RIGHT', 12, 102]]);
  assert.deepEqual(d.checks.map((c) => c.state), ['pass', 'pending']);
  assert.deepEqual(d.repo, { name: 'example-team/example-repo', methods: BITBUCKET_METHODS, reasons: [], caps: BITBUCKET_CAPS });
  assert.equal(d.viewer, 'office-bot');
  assert.deepEqual(calls.find((c) => c[1] === `${BASE}/pullrequests/7/comments`), ['api', `${BASE}/pullrequests/7/comments`, '-P', 'pagelen=100']);
  assert.equal((await pulls.pullDetail(7, 'someone')).viewer, 'someone');
});

test('the merge methods and what Bitbucket can do', async () => {
  assert.deepEqual(BITBUCKET_METHODS.map((m) => m.id), ['merge_commit', 'squash', 'fast_forward']);
  assert.deepEqual(BITBUCKET_CAPS, { labels: false, autoMerge: false, lineComments: true, deleteBranch: true });
  const { bkt } = fakeBkt();
  assert.deepEqual(await board(bkt).pulls.repoLabels(), []);
});

test("the viewer is bkt's nickname, else its display name, else ''", async () => {
  const { bkt, calls } = fakeBkt({ '/user': { display_name: 'Office Bot' } });
  assert.equal(await board(bkt).pulls.viewer(), 'Office Bot');
  assert.deepEqual(calls[0], ['api', '/user']);
  assert.equal(await board(fakeBkt({}, 'boom').bkt).pulls.viewer(), '');
});

test('findPull, findOpenPr, pullDiff and pullBody name the repository', async () => {
  const { bkt, calls } = fakeBkt({
    [`${BASE}/pullrequests/12`]: { state: 'DECLINED', draft: false, links: { html: { href: 'https://bitbucket.org/example-team/example-repo/pull-requests/12' } } },
    [`${BASE}/pullrequests`]: { values: [{ id: 14, links: { html: { href: 'https://bitbucket.org/example-team/example-repo/pull-requests/14' } } }] },
    '/repositories/other-team/other-repo/pullrequests/3': { description: 'Related.' },
  });
  const { pulls } = board(bkt);
  assert.deepEqual(await pulls.findPull(12), { url: 'https://bitbucket.org/example-team/example-repo/pull-requests/12', state: 'closed' });
  assert.deepEqual(calls.at(-1), ['api', `${BASE}/pullrequests/12`, '-P', 'fields=links.html.href,state,draft']);

  assert.deepEqual(await pulls.findOpenPr('feature/x', REPO.dir), { number: 14, url: 'https://bitbucket.org/example-team/example-repo/pull-requests/14' });
  assert.deepEqual(calls.at(-1), ['api', `${BASE}/pullrequests`, '-P', 'q=source.branch.name="feature/x" AND state="OPEN"', '-P', 'pagelen=1']);

  assert.equal(await pulls.pullBody('https://bitbucket.org/other-team/other-repo/pull-requests/3/overview', REPO.dir), 'Related.');
  assert.deepEqual(calls.at(-1), ['api', '/repositories/other-team/other-repo/pullrequests/3', '-P', 'fields=description']);

  const diffCalls: string[][] = [];
  const diffBkt: Bkt = async (args) => (diffCalls.push(args), 'diff --git a/x b/x\n');
  assert.equal(await board(diffBkt).pulls.pullDiff(7), 'diff --git a/x b/x\n');
  assert.deepEqual(diffCalls[0], ['pr', 'diff', '7', '--workspace', 'example-team', '--repo', 'example-repo']);
});

test('findOpenPr finds nothing when Bitbucket lists none', async () => {
  const { bkt } = fakeBkt({ [`${BASE}/pullrequests`]: { values: [] } });
  assert.equal(await board(bkt).pulls.findOpenPr('feature/none', REPO.dir), undefined);
});
