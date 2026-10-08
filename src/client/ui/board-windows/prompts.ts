import type { AgentEffort, AgentProvider, Issue, Pull } from '../../../shared/protocol';
import { store } from '../../state';
import { repoUrlOf } from '../markdown';
import type { MeetingPreset } from '../meeting';
import { officePrompt } from '../prompts';

// ---- Prompts for workers ------------------------------------------------------------------------

export interface BoardActions {
  /** Start a worker on a ready-made prompt (shown for editing first). With `issue` (its key), the worker takes that issue, which moves to In progress. */
  assign(prompt: string, title: string, issue?: string): void;
  /** Your own prompt about an issue or PR; `context` goes first so the worker knows which. */
  ask(context: string, title: string): void;
  /** Walks you to the desk a pull request came from. */
  goToDesk(deskId: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: string, provider?: AgentProvider, model?: string, effort?: AgentEffort): void;
  /** Take the issue's card off the board, to carry to a desk or the queue (not on the 2D view, where there's nobody to carry it). */
  pickUp?(issue: Issue): void;
  /** Call a meeting about it: the meeting room's form, filled in. */
  meeting(preset: MeetingPreset): void;
}

/** The task a worker gets for an issue, from the board, a carried card or the queue: the tracker's own, else the 'issue.work' prompt. */
export function issuePrompt(it: Pick<Issue, 'key' | 'title'> & { url?: string; prompt?: string }): string {
  return it.prompt ?? store.issues.items.find((i) => i.key === it.key)?.prompt ?? officePrompt('issue.work', issueVars(it));
}

/** What an issue's prompts fill in ({{number}} is its key). A carried card has no URL, but the board usually knows it. */
export function issueVars(it: Pick<Issue, 'key' | 'title'> & { url?: string }) {
  return { number: it.key, title: it.title, url: it.url ?? store.issues.items.find((i) => i.key === it.key)?.url ?? '' };
}

/** owner/repo from a PR or issue URL. */
function nameWithOwner(url: string): string {
  return repoUrlOf(url).replace(/^https?:\/\/[^/]+\//, '');
}

/** What a pull request's prompts fill in. */
export function pullVars(it: Pull) {
  return { number: it.number, title: it.title, url: it.url, branch: it.headRefName, base: it.baseRefName };
}

export function reviewPrompt(it: Pull) {
  return officePrompt('pull.review', pullVars(it));
}

/** `merge` is the host's merge line for the method picked, from the PR's detail (RepoInfo.mergeCommands). */
function mergeVars(it: Pull, merge: string) {
  return { ...pullVars(it), repo: nameWithOwner(it.url), merge };
}

export function fixAndMergePrompt(it: Pull, merge: string) {
  return officePrompt('pull.fixMerge', mergeVars(it, merge));
}

export function fixConflictsPrompt(it: Pull, merge: string) {
  return officePrompt('pull.fixConflicts', mergeVars(it, merge));
}

export function pullContext(it: Pull) {
  return officePrompt('pull.ask', pullVars(it));
}

export function issueContext(it: Issue) {
  return officePrompt('issue.ask', issueVars(it));
}
