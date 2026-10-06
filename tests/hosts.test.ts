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
