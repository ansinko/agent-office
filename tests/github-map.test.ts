import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueState, pullReview, pullState, readiness, reviewOf } from '../src/server/hosts/github/map.js';

test('GitHub pull request states', () => {
  assert.equal(pullState('OPEN', false), 'open');
  assert.equal(pullState('OPEN', true), 'draft');
  assert.equal(pullState('MERGED', false), 'merged');
  assert.equal(pullState('CLOSED', true), 'closed');
});

test('GitHub review decisions', () => {
  assert.equal(pullReview('APPROVED'), 'approved');
  assert.equal(pullReview('CHANGES_REQUESTED'), 'changes');
  assert.equal(pullReview('REVIEW_REQUIRED'), 'pending');
  assert.equal(pullReview(''), 'none');
  assert.equal(reviewOf('COMMENTED'), undefined);
  assert.equal(reviewOf('APPROVED'), 'approved');
});

test('GitHub merge state becomes readiness', () => {
  assert.equal(readiness('MERGEABLE', 'CLEAN', 'approved'), 'clean');
  assert.equal(readiness('MERGEABLE', 'HAS_HOOKS', 'none'), 'clean');
  assert.equal(readiness('CONFLICTING', 'DIRTY', 'none'), 'conflict');
  assert.equal(readiness('MERGEABLE', 'DIRTY', 'none'), 'conflict');
  assert.equal(readiness('MERGEABLE', 'BEHIND', 'none'), 'behind');
  assert.equal(readiness('MERGEABLE', 'BLOCKED', 'changes'), 'blocked');
  assert.equal(readiness('MERGEABLE', 'UNSTABLE', 'none'), 'checks');
  assert.equal(readiness('UNKNOWN', 'UNKNOWN', 'none'), 'unknown');
  assert.equal(readiness('MERGEABLE', 'DRAFT', 'none'), 'blocked');
});

test('GitHub issue states', () => {
  assert.equal(issueState('OPEN'), 'open');
  assert.equal(issueState('CLOSED'), 'closed');
});
