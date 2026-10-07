import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commentOn, declinePull, mergePull, openPull, ownPr, parsePrUrl, prRef, refuseLabels, reviewOn, writeBody } from '../src/server/hosts/bitbucket/write.js';
import type { BbRepo, Bkt } from '../src/server/hosts/bitbucket/bkt.js';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/bitbucket/${f}`, import.meta.url), 'utf8'));
const repo: BbRepo = { dir: '/tmp/example-repo', ws: 'example-team', slug: 'example-repo' };
const FLAGS = ['--workspace', 'example-team', '--repo', 'example-repo'];

/** A fake bkt that records every call and answers with `reply`, and a ctx that counts refreshes. */
function fake(reply: (args: string[]) => string | Error = () => '') {
  const calls: { args: string[]; opts?: Parameters<Bkt>[1] }[] = [];
  const bkt: Bkt = async (args, opts) => {
    calls.push({ args, opts });
    const out = reply(args);
    if (out instanceof Error) throw out;
    return out;
  };
  const ctx = {
    repo,
    bkt,
    refreshes: 0,
    found: undefined as { number: number; url: string } | undefined,
    async refresh() {
      ctx.refreshes++;
    },
    async findOpenPr(_branch: string) {
      return ctx.found;
    },
  };
  return { calls, ctx };
}

test('a comment goes to bkt as one --text= entry and comes back as Bitbucket saved it', async () => {
  const saved = fx('comments.json').values[0];
  const { calls, ctx } = fake(() => JSON.stringify(saved));
  const res = await commentOn(ctx, 7, '-rf "quoted"', { key: 'sam', env: { BKT_TOKEN: 't' } });
  assert.deepEqual(calls[0].args, ['pr', 'comment', '7', '--text=-rf "quoted"', ...FLAGS, '--json']);
  assert.deepEqual(calls[0].opts?.env, { BKT_TOKEN: 't' });
  assert.equal(res.comment?.id, '101');
  assert.equal(res.comment?.body, saved.content.raw);
  assert.equal(ctx.refreshes, 1);
});

test('a comment bkt refuses comes back as its error, and nothing refreshes', async () => {
  const { ctx } = fake(() => new Error('bkt isn\'t signed in to Bitbucket'));
  assert.deepEqual(await commentOn(ctx, 7, 'hi'), { error: 'bkt isn\'t signed in to Bitbucket' });
  assert.equal(ctx.refreshes, 0);
});

test('a review is the file\'s text as one comment, and resolves to its page', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'bb-review-')), 'review.md');
  writeFileSync(file, '- first line\n"second"');
  const saved = fx('comments.json').values[0];
  const { calls, ctx } = fake(() => JSON.stringify(saved));
  assert.equal(await reviewOn(ctx, 7, file), saved.links.html.href);
  assert.deepEqual(calls[0].args, ['pr', 'comment', '7', '--text=- first line\n"second"', ...FLAGS, '--json']);
  assert.equal(ctx.refreshes, 1);
});

test('a merge names the strategy and whether the source branch closes', async () => {
  const { calls, ctx } = fake();
  assert.equal(await mergePull(ctx, 7, 'squash', false, false), undefined);
  assert.deepEqual(calls[0].args, ['pr', 'merge', '7', '--strategy', 'squash', '--close-source=false', ...FLAGS]);
  assert.equal(calls[0].opts?.timeout, 90_000);
  await mergePull(ctx, 8, 'merge_commit', true, false);
  assert.deepEqual(calls[1].args, ['pr', 'merge', '8', '--strategy', 'merge_commit', '--close-source=true', ...FLAGS]);
  assert.equal(ctx.refreshes, 2);
});

test('a failed merge returns bkt\'s error', async () => {
  const { ctx } = fake(() => new Error('merge blocked'));
  assert.equal(await mergePull(ctx, 7, 'squash', true, false), 'merge blocked');
  assert.equal(ctx.refreshes, 0);
});

test('auto-merge and labels are refused, and bkt never runs', async () => {
  const { calls, ctx } = fake();
  assert.equal(await mergePull(ctx, 7, 'squash', true, true), 'Bitbucket has no auto-merge');
  assert.deepEqual(await refuseLabels(), { error: 'Bitbucket pull requests have no labels' });
  assert.equal(calls.length, 0);
  assert.equal(ctx.refreshes, 0);
});

test('a decline carries its comment after = and deletes the source only when asked', async () => {
  const { calls, ctx } = fake();
  assert.equal(await declinePull(ctx, 7, { comment: '--not "ready"', deleteBranch: true }), undefined);
  assert.deepEqual(calls[0].args, ['pr', 'decline', '7', '--comment=--not "ready"', '--delete-source', ...FLAGS]);
  await declinePull(ctx, 8, {});
  assert.deepEqual(calls[1].args, ['pr', 'decline', '8', ...FLAGS]);
  assert.equal(ctx.refreshes, 2);
});

test('a new pull request names its branches, carries title and description after =, and reads its number from the JSON', async () => {
  const created = fx('pullrequest.json');
  const { calls, ctx } = fake(() => JSON.stringify(created));
  const pr = await openPull(ctx, 'feature/x', 'main', '-rf "quoted"', 'Body\n-- with dashes');
  assert.deepEqual(calls[0].args, ['pr', 'create', '--source', 'feature/x', '--target', 'main', '--title=-rf "quoted"', '--description=Body\n-- with dashes', ...FLAGS, '--json']);
  assert.equal(calls[0].opts?.timeout, 60_000);
  assert.deepEqual(pr, { number: 7, url: 'https://bitbucket.org/example-team/example-repo/pull-requests/7' });
  await openPull(ctx, 'feature/y', undefined, 't', 'b', undefined, 5000);
  assert.deepEqual(calls[1].args.slice(0, 4), ['pr', 'create', '--source', 'feature/y']);
  assert.ok(!calls[1].args.includes('--target'));
  assert.equal(calls[1].opts?.timeout, 5000);
});

test('a new pull request bkt prints no id for is the branch\'s open one', async () => {
  const { ctx } = fake(() => 'Created pull request\n');
  ctx.found = { number: 9, url: 'https://bitbucket.org/example-team/example-repo/pull-requests/9' };
  assert.deepEqual(await openPull(ctx, 'feature/x', undefined, 't', 'b'), ctx.found);
  ctx.found = undefined;
  await assert.rejects(openPull(ctx, 'feature/x', undefined, 't', 'b'), /bkt did not return a pull request \(Created pull request/);
});

test('a description is replaced with a PUT on the repository the URL names', async () => {
  const { calls, ctx } = fake(() => '{}');
  await writeBody(ctx, 'https://bitbucket.org/other-team/other-repo/pull-requests/3', 'New "body"');
  assert.deepEqual(calls[0].args, ['api', '/repositories/other-team/other-repo/pullrequests/3', '-X', 'PUT', '-d', '{"description":"New \\"body\\""}']);
  await assert.rejects(writeBody(ctx, 'https://github.com/o/r/pull/3', 'x'), /not a Bitbucket pull request/);
});

test('a worker\'s own pull request is the last Bitbucket URL that bkt pr create printed', () => {
  const out = 'https://bitbucket.org/example-team/example-repo/pull-requests/11\nCreated https://bitbucket.org/example-team/example-repo/pull-requests/12\n';
  assert.deepEqual(ownPr('bkt pr create --title x', out), {
    repo: 'example-team/example-repo',
    number: 12,
    url: 'https://bitbucket.org/example-team/example-repo/pull-requests/12',
  });
  assert.equal(ownPr('git push && bkt pr create', out)?.number, 12);
  assert.equal(ownPr('grep "bkt pr create" notes.md', out), undefined);
  assert.equal(ownPr('gh pr create --fill', 'https://github.com/example/repo/pull/12'), undefined);
  assert.equal(ownPr({ cmd: 'bkt pr create' }, out), undefined);
});

test('a pasted pull request page reads as its repository and number', () => {
  assert.deepEqual(parsePrUrl('https://bitbucket.org/example-team/example-repo/pull-requests/7/overview'), { repo: 'example-team/example-repo', number: 7 });
  assert.deepEqual(parsePrUrl('https://bitbucket.org/example-team/example-repo/pull-requests/7'), { repo: 'example-team/example-repo', number: 7 });
  assert.equal(parsePrUrl('https://github.com/example/repo/pull/7'), undefined);
  assert.equal(parsePrUrl('see https://bitbucket.org/example-team/example-repo/pull-requests/7'), undefined);
});

test('a pull request is referred to by its URL', () => {
  const url = 'https://bitbucket.org/example-team/example-repo/pull-requests/7';
  assert.equal(prRef(url), url);
});
