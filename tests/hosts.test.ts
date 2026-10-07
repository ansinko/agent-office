import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepo, parseRemote } from '../src/shared/hosts.js';

test('a GitHub remote in every form git writes it', () => {
  for (const url of ['git@github.com:acme/site.git', 'https://github.com/acme/site', 'https://github.com/acme/site.git', 'ssh://git@github.com/acme/site.git', 'https://user@github.com/acme/site.git']) {
    assert.deepEqual(parseRemote(url), { kind: 'github', repo: 'acme/site', url: 'https://github.com/acme/site' }, url);
  }
});

test('a Bitbucket remote in every form git writes it', () => {
  for (const url of ['git@bitbucket.org:team/app.git', 'https://bitbucket.org/team/app', 'https://andy@bitbucket.org/team/app.git', 'ssh://git@bitbucket.org/team/app.git']) {
    assert.deepEqual(parseRemote(url), { kind: 'bitbucket', repo: 'team/app', url: 'https://bitbucket.org/team/app' }, url);
  }
});

test('other hosts, paths and junk are not a remote the office knows', () => {
  for (const v of ['git@gitlab.com:a/b.git', '/srv/repos/b.git', 'acme/site', '', 42, undefined, 'https://github.com/acme']) assert.equal(parseRemote(v), undefined, String(v));
});

test('normalizeRepo still takes owner/name and GitHub URLs only', () => {
  assert.equal(normalizeRepo('acme/site'), 'acme/site');
  assert.equal(normalizeRepo('https://github.com/acme/site/issues/12'), 'acme/site');
  assert.equal(normalizeRepo('git@bitbucket.org:team/app.git'), undefined);
});

import { execFileSync } from 'node:child_process';
import { HOSTS, adapterFor, hostFor } from '../src/server/hosts/registry.js';
import { noHost } from '../src/server/hosts/none.js';
import { JIRA_PENDING } from '../src/server/hosts/bitbucket/index.js';
import { originRemote } from '../src/server/building.js';

test('GitHub and Bitbucket each have an adapter', () => {
  assert.equal(HOSTS.github?.name, 'GitHub');
  assert.equal(HOSTS.bitbucket?.name, 'Bitbucket');
});

test('a floor with no remote gets boards that say why, and calls nothing', async () => {
  const none = noHost(undefined);
  assert.match(none.pulls.pulls.error ?? '', /no remote/);
  assert.match(none.issues.issues.error ?? '', /no remote/);
  await none.pulls.refresh();
  await none.issues.refresh();
  await assert.rejects(none.pulls.pullDetail(1), /no remote/);
  await assert.rejects(none.issues.issueDetail('1'), /no remote/);
  // What answers with an error answers with this one, so nothing waiting on it is left with a rejection.
  assert.match((await none.pulls.merge(1, 'squash', false, false)) ?? '', /no remote/);
  assert.match((await none.issues.claim('1')) ?? '', /no remote/);
  assert.match((await none.pulls.comment({ kind: 'pull', number: 1 }, 'hi')).error ?? '', /no remote/);
  assert.equal(none.pulls.ownPr('gh pr create --fill', 'https://github.com/acme/site/pull/12'), undefined);
});

test('a floor on Bitbucket reads its pull requests through bkt, and its issue board waits for Jira', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-bb-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:example-team/example-repo.git'], { cwd: dir });

  const adapter = adapterFor(originRemote(dir))!;
  assert.equal(adapter.kind, 'bitbucket');
  const host = adapter.pulls(dir, () => {});
  assert.equal((await host.repoInfo()).name, 'example-team/example-repo');
  assert.equal((await hostFor(dir).repoInfo()).name, 'example-team/example-repo');

  const tracker = adapter.issues(dir, () => {}, host);
  assert.equal(tracker.issues.error, JIRA_PENDING);
  await tracker.refresh();
  assert.equal(await tracker.claim('ERN-1'), JIRA_PENDING);
  assert.equal((await tracker.comment({ kind: 'issue', key: 'ERN-1' }, 'hi')).error, JIRA_PENDING);
  await assert.rejects(tracker.issueDetail('ERN-1'), new RegExp(JIRA_PENDING));
});

test("the Bitbucket adapter's merge line names the strategy and the repository", () => {
  const { cli } = HOSTS.bitbucket!;
  assert.equal(cli.merge(5, 'squash', false, 'example-team/example-repo'), 'bkt pr merge 5 --strategy squash --close-source=false --workspace example-team --repo example-repo');
  assert.equal(cli.merge(5, 'merge_commit', true, 'example-team/example-repo'), 'bkt pr merge 5 --strategy merge_commit --workspace example-team --repo example-repo');
  assert.equal(cli.viewPull, 'bkt pr view {{number}}');
});

test('the GitHub adapter reads its own pull request URL off gh pr create', () => {
  const host = HOSTS.github!.pulls('/tmp', () => {});
  assert.deepEqual(host.ownPr('gh pr create --fill', 'https://github.com/acme/site/pull/12\n'), { repo: 'acme/site', number: 12, url: 'https://github.com/acme/site/pull/12' });
  assert.equal(host.ownPr('grep "gh pr create"', 'https://github.com/acme/site/pull/12'), undefined);
});

test('the GitHub adapter reads a pull request URL someone pasted, and names one as GitHub links it', () => {
  const host = HOSTS.github!.pulls('/tmp', () => {});
  assert.deepEqual(host.parsePrUrl('https://github.com/acme/app/pull/12/files'), { repo: 'acme/app', number: 12 });
  assert.equal(host.parsePrUrl('https://github.com/acme/app/issues/12'), undefined);
  assert.equal(host.parsePrUrl('https://bitbucket.org/team/app/pull-requests/3'), undefined);
  assert.equal(host.prRef('https://github.com/acme/app/pull/12'), 'acme/app#12');
  assert.equal(host.prRef('https://bitbucket.org/team/app/pull-requests/3'), 'https://bitbucket.org/team/app/pull-requests/3');
});

test("the GitHub adapter's merge line reads as the merge dialog's did", () => {
  const { cli } = HOSTS.github!;
  assert.equal(cli.merge(12, 'squash', true, 'acme/site'), 'gh pr merge 12 --squash --delete-branch --repo acme/site');
  assert.equal(cli.merge(12, 'rebase', false, 'acme/site'), 'gh pr merge 12 --rebase --repo acme/site');
  assert.equal(cli.viewIssue, 'gh issue view {{number}} --comments');
});

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A gh that logs each command line to $GH_LOG and answers as GitHub would after --jq. */
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(a) + '\\n');
const say = (v) => { process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v)); process.exit(0); };
if (a[0] === 'repo' && a[1] === 'view') say({ nameWithOwner: 'acme/site', squashMergeAllowed: true });
if (a[0] === 'issue' && a[1] === 'view') say({ number: 12, state: 'OPEN', body: 'b', comments: [] });
if (a[0] === 'pr' && a[1] === 'view') say({ url: 'https://github.com/acme/site/pull/9', state: 'MERGED' });
if (a[0] === 'issue' && a[1] === 'list') say([]);
if (a[0] === 'pr' && a[1] === 'list') say([]);
if (a[0] === 'api' && a[3].endsWith('/comments')) say({ id: 'C1', author: { login: 'me' }, body: 'hi', createdAt: 't', url: 'u' });
if (a[0] === 'api' && a[3].includes('/labels')) say([{ name: 'bug', color: 'd73a4a' }]);
say('');
`;

test('the GitHub adapter runs the gh commands the office ran before hosts', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-hosts-'));
  writeFileSync(path.join(dir, 'gh'), FAKE_GH);
  chmodSync(path.join(dir, 'gh'), 0o755);
  const log = path.join(dir, 'gh.log');
  const saved = { PATH: process.env.PATH, GH_LOG: process.env.GH_LOG };
  process.env.PATH = `${dir}:${process.env.PATH}`;
  process.env.GH_LOG = log;
  t.after(() => Object.assign(process.env, saved));
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
  const last = (verb: string) => calls().filter((c) => c.slice(0, 2).join(' ') === verb).pop();

  const host = HOSTS.github!.pulls(dir, () => {});
  const tracker = HOSTS.github!.issues(dir, () => {}, host);
  // The issue window takes its state from here: an open issue reads as open.
  assert.equal((await tracker.issueDetail('12', 'me')).state, 'open');
  assert.deepEqual(await host.findPull(9), { url: 'https://github.com/acme/site/pull/9', state: 'merged' });
  assert.deepEqual(last('pr view'), ['pr', 'view', '9', '--json', 'url,state']);

  assert.equal(await tracker.close('12', { comment: 'done', reason: 'not planned' }), undefined);
  assert.deepEqual(last('issue close'), ['issue', 'close', '12', '--repo', 'acme/site', '--comment=done', '--reason=not planned']);
  assert.equal(await host.close(9, { comment: 'no', deleteBranch: true }), undefined);
  assert.deepEqual(last('pr close'), ['pr', 'close', '9', '--repo', 'acme/site', '--comment=no', '--delete-branch']);
  assert.equal(await host.merge(9, 'squash', true, true), undefined);
  assert.deepEqual(last('pr merge'), ['pr', 'merge', '9', '--squash', '--repo', 'acme/site', '--delete-branch', '--auto']);
  assert.equal(await tracker.claim('12'), undefined);
  assert.deepEqual(last('issue edit'), ['issue', 'edit', '12', '--add-assignee', '@me']);

  const jq = '{id: .node_id, author: {login: .user.login}, body, createdAt: .created_at, url: .html_url}';
  assert.equal((await tracker.comment({ kind: 'issue', key: '12' }, 'hi')).comment?.id, 'C1');
  assert.deepEqual(last('api --method'), ['api', '--method', 'POST', 'repos/{owner}/{repo}/issues/12/comments', '-f', 'body=hi', '--jq', jq]);
  assert.equal((await host.comment({ kind: 'pull', number: 9 }, 'yo')).comment?.id, 'C1');
  assert.deepEqual(last('api --method'), ['api', '--method', 'POST', 'repos/{owner}/{repo}/issues/9/comments', '-f', 'body=yo', '--jq', jq]);

  assert.deepEqual((await tracker.setLabels('12', ['bug'], [])).labels, [{ name: 'bug', color: '#d73a4a' }]);
  assert.deepEqual(last('api --method'), ['api', '--method', 'POST', 'repos/{owner}/{repo}/issues/12/labels', '-f', 'labels[]=bug', '--jq', '[.[] | {name, color}]']);
  assert.deepEqual((await host.setLabels(9, [], ['wip'])).labels, [{ name: 'bug', color: '#d73a4a' }]);
  assert.deepEqual(last('api --method'), ['api', '--method', 'DELETE', 'repos/{owner}/{repo}/issues/9/labels/wip', '--jq', '[.[] | {name, color}]']);
  assert.equal(tracker.issues.error, undefined);
  assert.deepEqual(await tracker.reasons(), (await host.repoInfo()).reasons);
  assert.equal(calls().filter((c) => c[0] === 'repo').length, 1, 'the repository is asked about once for both boards');
});
