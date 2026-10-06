# Bitbucket Pull Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floor whose origin is on bitbucket.org gets the GitHub floor's pull request features through a `bkt`-backed `CodeHost`.

**Architecture:** `src/server/hosts/bitbucket/` holds a `bkt` runner, a mapper from Bitbucket values to the neutral board types, `BitbucketPulls` (board state and reads) and `write.ts` (writes as plain functions). `index.ts` makes the `HostAdapter`, registered as `HOSTS.bitbucket`. Every module takes the runner as a parameter, so tests pass a fake runner and assert the exact `bkt` argv.

**Tech Stack:** TypeScript, Node ≥ 20, `node:test` + `tsx`, the `bkt` CLI 0.32 (Bitbucket Cloud REST 2.0 through `bkt api`).

**Spec:** `docs/superpowers/specs/2026-10-06-bitbucket-pulls-design.md`

## Global Constraints

- Branch `feature/bitbucket-pulls` (based on `feature/host-seam`, PR #7). Each task works on its own branch from it, as the worker prompt says.
- Every `.ts` file under `src/` stays at or below 600 lines; nothing new goes into `CEILINGS` in `tests/size.test.ts`.
- No test calls the real `bkt` or the network. Fixtures use `example.com`, `example-team/example-repo`, and made-up names and ids.
- Every `bkt` call names the repository explicitly: `--workspace <ws> --repo <slug>` on subcommands, `/repositories/<ws>/<slug>/…` on `bkt api`.
- Text values go after `=` (`--text=…`, `--comment=…`, `--title=…`, `--description=…`) so a value starting with `-` is never read as a flag.
- GitHub floors behave exactly as before: `tests/prompts.test.ts`'s pinned GitHub text and every GitHub test stay green.
- Prefix node and npm with `NODE_OPTIONS=`. Before each commit run `npm run typecheck && npm test`. If only `tests/clone.test.ts` "a restart mid-clone…" fails under the full suite, rerun that file alone.
- Commit with the `commit` skill: one conventional subject line, no body, no trailer. Never push.

## Review Focus

1. **A pull request list longer than one page** (Bitbucket pages at 50): every page up to the limit lands on the board, and `next` is never followed past it. Tested in Task 2.
2. **A merged PR's 12-character hash that the checkout does not have** leaves `headRefOid` unset. The worker's worktree is then judged by git alone, and nothing throws. Tested in Task 2.
3. **`bkt` missing or signed out:** the board shows the readable error from `bkt.ts`. Stack traces and raw 401 JSON never reach the board. Tested in Task 1.
4. **A comment body or PR title starting with `-` or containing quotes** reaches `bkt` as one argv entry after `=`. Tested in Task 3.
5. **Auto-merge or labels asked of a Bitbucket floor** (an old client, a crafted message): the request is refused with the spec's text, and nothing runs. Tested in Task 3.

---

### Task 1: The `bkt` runner and the mapper

**Files:**
- Create: `src/server/hosts/bitbucket/bkt.ts`, `src/server/hosts/bitbucket/map.ts`
- Create: `tests/fixtures/bitbucket/pullrequests-open.json`, `pullrequests-merged.json`, `pullrequest.json`, `comments.json`, `statuses.json`, `diffstat.json`, `diffstat-conflict.json`
- Test: `tests/bitbucket-map.test.ts`

**Interfaces (produced):**

```ts
// bkt.ts
export interface BbRepo { dir: string; ws: string; slug: string }
/** Runs bkt with these args in `dir`; resolves to stdout. */
export type Bkt = (args: string[], opts?: { timeout?: number; env?: Record<string, string> }) => Promise<string>;
export function bktIn(dir: string): Bkt;                 // the real runner, execFile('bkt', …)
export function friendly(raw: string): string;           // the spec's error texts
export const api = (r: BbRepo, path: string) => `/repositories/${r.ws}/${r.slug}${path}`;
export const repoFlags = (r: BbRepo) => ['--workspace', r.ws, '--repo', r.slug];

// map.ts
export function pullState(state: string, draft: boolean): PullState;
export function pullReview(participants: any[] | null | undefined): PullReview;
export function checkOf(status: any): Check;             // {name, state, url}
export function checksOf(statuses: any[]): Pull['checks'];
export function readiness(diffstat: any[], checks: Check[], review: PullReview): Readiness;
export function reviewsOf(participants: any[] | null | undefined): Comment[];  // verdicts as reviews
export function commentsOf(raw: any[]): { comments: Comment[]; reviewComments: ReviewComment[] };
export function author(u: any): string;                  // nickname ?? display_name ?? ''
```

- [ ] **Step 1: Capture fixture shapes (read only).** Run these on beast:

```bash
ssh beast 'source ~/.config/bkt/env; cd ~/work/eranet3; ~/.local/bin/bkt api /repositories/eranetproject/eranet3/pullrequests -P state=OPEN -P pagelen=2'
```

Do the same for `state=MERGED`, and for `/pullrequests/<id>`, `/comments`, `/statuses` and `/diffstat` of one open pull request. Only GET requests. Keep the shapes and rewrite every value that names a person, workspace, repository, URL, uuid, account id or text to an `example` value. Write the results to `tests/fixtures/bitbucket/`. Make the following edits by hand:
- `pullrequests-open.json` gets a `next` link to a second page.
- `comments.json` gets one inline comment on the new side, one on the old side, one reply (`parent.id`) and one `deleted: true`.
- `diffstat-conflict.json` gets one entry with `"status": "merge conflict"`.

- [ ] **Step 2: Write the failing tests.** `tests/bitbucket-map.test.ts` covers every row of the spec's mapping table, plus these:
- `friendly` for ENOENT, a 401, a 403 scope message and a 404.
- `commentsOf` on `comments.json`: a deleted comment is dropped, an inline comment on the new side gives `side: 'RIGHT', line: inline.to`, and on the old side gives `side: 'LEFT', line: inline.from`, a reply gives `replyTo`.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkOf, checksOf, commentsOf, pullReview, pullState, readiness } from '../src/server/hosts/bitbucket/map.js';
import { friendly } from '../src/server/hosts/bitbucket/bkt.js';

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

test('pipeline statuses become checks', () => {
  assert.equal(checkOf({ state: 'SUCCESSFUL', name: 'n', url: 'u' }).state, 'pass');
  assert.equal(checkOf({ state: 'FAILED', name: 'n' }).state, 'fail');
  assert.equal(checkOf({ state: 'INPROGRESS', name: 'n' }).state, 'pending');
  assert.equal(checkOf({ state: 'STOPPED', name: 'n' }).state, 'skip');
  assert.equal(checksOf([]), 'none');
  assert.equal(checksOf([{ state: 'SUCCESSFUL' }, { state: 'INPROGRESS' }]), 'pending');
  assert.equal(checksOf([{ state: 'SUCCESSFUL' }, { state: 'FAILED' }]), 'fail');
});

test('readiness: conflict, then failed checks, then changes requested, else clean', () => {
  const fail = [checkOf({ state: 'FAILED', name: 'n' })];
  assert.equal(readiness(fx('diffstat-conflict.json').values, [], 'none'), 'conflict');
  assert.equal(readiness(fx('diffstat.json').values, fail, 'changes'), 'checks');
  assert.equal(readiness(fx('diffstat.json').values, [], 'changes'), 'blocked');
  assert.equal(readiness(fx('diffstat.json').values, [], 'approved'), 'clean');
});

test('bkt errors a person can act on', () => {
  assert.match(friendly('401 Unauthorized'), /bkt isn't signed in to Bitbucket/);
  assert.match(friendly('No hosts configured. Run `bkt auth login` to add one.'), /bkt auth login --kind cloud/);
  assert.match(friendly('403 Forbidden: Your credentials lack one or more required privilege scopes.'), /lacks a scope/);
  assert.match(friendly('404 Not Found'), /can't find this repository on Bitbucket/);
});
```

Add the `commentsOf` assertions on `fx('comments.json').values` as described above.

- [ ] **Step 3: Run them and see them fail.** `NODE_OPTIONS= node --import tsx --test tests/bitbucket-map.test.ts`

- [ ] **Step 4: Implement `bkt.ts` and `map.ts`.** `bktIn(dir)` mirrors `gh()` in `src/server/hosts/github/gh.ts`:
- `execFile('bkt', args, { cwd: dir, maxBuffer: 32 MB, timeout: opts.timeout ?? 30_000, env: opts.env })`
- stderr's last two lines go through `friendly`
- ENOENT gives "Bitbucket CLI (bkt) is not installed on the server"

`friendly` matches `/401|unauthorized|no hosts configured|auth login/i`, `/403|scope/i` and `/404|not found/i` in that order and returns the spec's texts. Anything else comes back as it is. The mapper follows the spec's table.

- [ ] **Step 5: Run the tests, typecheck, run the full suite, then commit.**

```bash
git add src/server/hosts/bitbucket tests/bitbucket-map.test.ts tests/fixtures/bitbucket
git commit -m "feat(hosts): bkt runs for the office and Bitbucket's states read in the board's words"
```

---

### Task 2: Reading pull requests (`BitbucketPulls`)

Starts after Task 1. Runs alongside Task 3.

**Files:**
- Create: `src/server/hosts/bitbucket/pulls.ts`
- Test: `tests/bitbucket-pulls.test.ts`

**Interfaces:**
- Consumes: `Bkt`, `BbRepo`, `api`, `repoFlags`, and the `map.ts` functions from Task 1.
- Produces: `class BitbucketPulls`, with `constructor(repo: BbRepo, onPulls: (s: BoardState<Pull>) => void, bkt: Bkt = bktIn(repo.dir), git: (args: string[]) => Promise<string> = gitIn(repo.dir))`. It implements the read members of `CodeHost`:
  - `pulls`, `refresh`, `stop`
  - `repoInfo`, `viewer`
  - `pullDetail`, `pullDiff`, `findPull`
  - `repoLabels` (resolves to `[]`)
  - `findOpenPr`
  - `pullBody`

  It also exports `BITBUCKET_METHODS`, `BITBUCKET_CAPS` and `listQuery(state, limit)`.

  The write members (`comment`, `review`, `merge`, `close`, `setLabels`, `createPr`, `setPullBody`, `ownPr`, `parsePrUrl`, `prRef`) are declared in this task as one-line delegations to `write.ts` names that Task 3 exports:
  - `commentOn(ctx, n, body, as?)`
  - `reviewOn(ctx, n, file, as?)`
  - `mergePull(ctx, n, method, deleteBranch, auto, as?)`
  - `declinePull(ctx, n, opts, as?)`
  - `refuseLabels()`
  - `openPull(ctx, branch, base, title, body, as?, timeout?)`
  - `writeBody(ctx, url, body, as?)`
  - `ownPr(command, text)`
  - `parsePrUrl(text)`
  - `prRef(url)`

  `ctx` is `{ repo: BbRepo; bkt: Bkt; refresh: () => Promise<void>; findOpenPr: (branch: string) => Promise<{ number: number; url: string } | undefined> }`. If Task 3 has not landed yet, create `write.ts` with those exported signatures, each throwing `new Error('not yet')`, so the typecheck passes. Task 3 replaces the file.

Behavior, as in the spec's Reads section:
- **`refresh`:**
  - Three `bkt api` listings, run in parallel: `OPEN`/150, `MERGED`/30, `DECLINED`/40. Each uses `pagelen=50` and `fields=` and follows `next` until the limit.
  - It keeps the `loading` guard and the `relabeled`-free state handling of `GitHubPulls.refresh`.
  - For open pull requests only, it asks `/statuses` and `/diffstat`, four at a time, and caches them by source hash.
  - It expands each hash with `git rev-parse --verify <hash>^{commit}`. When that fails, `headRefOid` is unset.
  - `closes: []`.
  - `body` is the description cut to 4000 characters.
- **`findPull(n)`:** reads `/pullrequests/<n>` with `fields=links.html.href,state,draft`.
- **`findOpenPr(branch)`:** reads `/pullrequests` with `q=source.branch.name="<branch>" AND state="OPEN"` and `pagelen=1`.

- [ ] **Step 1: Write the failing tests.** The fake runner answers by path and records every argv. Fake git resolves `abc123def456` to a 40-character hash and fails anything else. The tests:
  - The exact argv of the three list calls: `['api', '/repositories/example-team/example-repo/pullrequests', '-P', 'state=OPEN', '-P', 'pagelen=50', '-P', 'fields=…']`, plus the page-2 call taken from `next`.
  - `next` is not followed once the limit is reached: with the limit at 2 and two items on page 1, there is no page-2 call.
  - The board items match the fixture: state, review, author, branches, `checks`, additions and deletions from diffstat (`lines_added`/`lines_removed`), and `headRefOid` 40 characters long, or unset for an unknown hash.
  - A second `refresh` with the same source hashes makes no `/statuses` or `/diffstat` calls.
  - An error from the runner gives `pulls.error` equal to the runner's message, and `loading: false`.
  - `pullDetail`: reviews, comments split into `comments` and `reviewComments`, `readiness`, `commits` counted over all pages, `repo` and `viewer`.
  - `findOpenPr`'s exact `q`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, typecheck, run the full suite, then commit.**

```bash
git commit -m "feat(hosts): a Bitbucket floor's pull requests board reads through bkt"
```

---

### Task 3: Writing to pull requests (`write.ts`)

Starts after Task 1. Runs alongside Task 2.

**Files:**
- Create: `src/server/hosts/bitbucket/write.ts`
- Test: `tests/bitbucket-write.test.ts`

**Interfaces (produced):** the `write.ts` names and the `ctx` shape listed in Task 2, as plain exported functions. `ownPr`, `parsePrUrl` and `prRef` are pure.

Behavior, as in the spec's Writes section. Each write calls `ctx.refresh()` after it succeeds, as `GitHubPulls` does. Each one returns an error string or `{ error }` in the same shape as the GitHub method it stands in for.
- **`commentOn`:** `['pr', 'comment', String(n), `--text=${body}`, ...repoFlags, '--json']`. It returns the saved comment, mapped through `commentsOf`.
- **`reviewOn`:** reads the file and posts it as one comment. It resolves to the comment's `links.html.href`.
- **`mergePull`:** `['pr', 'merge', String(n), '--strategy', method, `--close-source=${deleteBranch}`, ...repoFlags]` with a 90 s timeout. When `auto` is set, it returns "Bitbucket has no auto-merge" and runs nothing.
- **`declinePull`:** `['pr', 'decline', String(n), ...(comment ? [`--comment=${comment}`] : []), ...(deleteBranch ? ['--delete-source'] : []), ...repoFlags]`.
- **`refuseLabels`:** resolves to `{ error: 'Bitbucket pull requests have no labels' }`.
- **`openPull`:** `['pr', 'create', '--source', branch, ...(base ? ['--target', base] : []), `--title=${title}`, `--description=${body}`, ...repoFlags, '--json']`. It reads `id` and `links.html.href` from the JSON, and falls back to `ctx.findOpenPr(branch)` when the output has no number. If both fail, it throws "bkt did not return a pull request (…first 120 chars…)".
- **`writeBody`:** `['api', api(repo, `/pullrequests/${n}`), '-X', 'PUT', '-d', JSON.stringify({ description: body })]`, where `n` comes from `parsePrUrl(url)`.
- **`ownPr`:** `CREATES_PR = /(?:^|[\s;&|(])bkt\s+pr\s+create\b/` and `PR_URL = /https:\/\/bitbucket\.org\/([\w.-]+\/[\w.-]+)\/pull-requests\/(\d+)/g`. The last URL printed is the one.

- [ ] **Step 1: Write the failing tests.**
  - The exact argv for each write, using a fake runner.
  - A title of `-rf "quoted"` arrives as the single argv entry `--title=-rf "quoted"`.
  - Auto-merge and labels refuse without calling the runner.
  - `openPull` falls back to `findOpenPr` when `bkt` prints no JSON id.
  - `ownPr` cases:

    | Command | Output | Result |
    |---|---|---|
    | `bkt pr create --title x` | `…/pull-requests/12` | PR 12 |
    | `grep "bkt pr create"` | any | `undefined` |
    | a `gh pr create` | a github.com URL | `undefined` |

  - `parsePrUrl` reads `https://bitbucket.org/example-team/example-repo/pull-requests/7/overview`.
  - `prRef` returns the URL unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, typecheck, run the full suite, then commit.**

```bash
git commit -m "feat(hosts): comments, merges, declines and new pull requests go to Bitbucket through bkt"
```

---

### Task 4: The Bitbucket adapter on a floor

Starts after Tasks 2 and 3 are merged.

**Files:**
- Create: `src/server/hosts/bitbucket/index.ts`
- Modify: `src/shared/hosts.ts` (add `BITBUCKET_COMMANDS`), `src/server/hosts/registry.ts` (`bitbucket` gets the adapter), `src/server/hosts/none.ts` (export `emptyTracker(error)`; `noHost` uses it)
- Test: `tests/hosts.test.ts`, `tests/prompts.test.ts`

**Interfaces:**

```ts
// src/shared/hosts.ts
export const BITBUCKET_COMMANDS: HostCommands = {
  viewPull: 'bkt pr view {{number}}',
  diffPull: 'bkt pr diff {{number}}',
  checkout: 'bkt pr checkout {{number}}',
  checks: 'bkt pr checks {{number}} --wait',
  lineComments: 'bkt pr comments {{number}}',
  createPr: 'bkt pr create',
  viewIssue: '',
  listIssues: '',
  pullCommands: 'bkt pr view, bkt pr diff, bkt pr checks',
  cliName: 'bkt',
};

// src/server/hosts/bitbucket/index.ts
export const JIRA_PENDING = "Issues for this project come from Jira, which the office doesn't read yet";
export const bitbucket: HostAdapter = {
  kind: 'bitbucket',
  name: 'Bitbucket',
  cli: {
    ...BITBUCKET_COMMANDS,
    merge: (n, method, deleteBranch, repo) => {
      const [ws, slug] = repo.split('/');
      return `bkt pr merge ${n} --strategy ${method}${deleteBranch ? '' : ' --close-source=false'} --workspace ${ws} --repo ${slug}`;
    },
  },
  pulls: (dir, onPulls) => new BitbucketPulls(repoOf(dir), onPulls),
  issues: () => emptyTracker(JIRA_PENDING),
};
```

`repoOf(dir)` reads `originRemote(dir)` and splits `repo` into `ws` and `slug`. The adapter is only chosen for a Bitbucket remote, so a missing remote here is a bug: throw.

`HostAdapter.pulls` takes `dir` only. If the floor already holds the parsed remote, pass it in rather than reading git twice. The seam's `Floor` holds `remote`, so widen `pulls(dir, onPulls, remote?)` if that reads cleaner, and update GitHub's adapter to ignore it.

- [ ] **Step 1: Write the failing tests.**
  - `HOSTS.bitbucket?.name === 'Bitbucket'`.
  - `HOSTS.bitbucket!.issues(...)` has `issues.error === JIRA_PENDING`, and its `claim` and `comment` return that error.
  - `cli.merge(5, 'squash', false, 'example-team/example-repo')` gives the exact string above.
  - In `tests/prompts.test.ts`, `pull.review` and `pull.fixMerge` rendered with `HOSTS.bitbucket!.cli` and the name `'Bitbucket'` contain `bkt pr view 12` and `bkt pr diff 12`, and none of them contains `gh `.
  - A floor test, following the pattern `tests/hosts.test.ts` already uses for a floor on a Bitbucket remote:
    - before this task, the board carried "cannot read yet"
    - now the floor's `adapter.kind` is `'bitbucket'`
    - its tracker carries `JIRA_PENDING`
- [ ] **Step 2: Run them and see them fail. Then implement.**
- [ ] **Step 3: Run the tests, typecheck, build and the full suite. The GitHub prompt pins must pass unchanged. Then commit.**

```bash
git commit -m "feat(hosts): a floor on Bitbucket reads its pull requests through bkt, and its issue board waits for Jira"
```

---

### Task 5: Live smoke run on beast, and docs

Starts after Task 4 is merged.

**Files:**
- Create: `scripts/bitbucket-smoke.ts` (not shipped in the build, not imported by `src/`)
- Modify: `README.md` and `docs/features.md`. Wherever they say the boards need `gh`, add that a floor on bitbucket.org reads its pull requests through `bkt`, logged in on the office's machine with `bkt auth login --kind cloud`, and that its issue board waits for Jira. Modify `docs/configuration.md` if it lists required CLIs.

- [ ] **Step 1: Write the smoke script.** It takes a checkout path and calls, through the real `bktIn`:
  - `new BitbucketPulls(repoOf(dir), print).refresh()`
  - `pullDetail` of the first open pull request
  - `pullDiff` of the same pull request, printing its line count
  - `viewer()`

  It prints counts and states, never bodies. It calls no write.
- [ ] **Step 2: Run it on beast.** Do not touch beast's office or its clone at `~/tools/agent-office`.

```bash
rsync -a --exclude node_modules --exclude dist ./ beast:/tmp/bb-smoke/
ssh beast 'source ~/.config/bkt/env; cd /tmp/bb-smoke && eval "$(mise activate bash)"; npm ci --silent && npx tsx scripts/bitbucket-smoke.ts ~/work/eranet3'
ssh beast 'rm -rf /tmp/bb-smoke'
```

  Expected: a list of PRs with states, the first open PR's detail with checks and readiness, a diff line count, and a viewer name. Fix any mismatch between the fixtures and the live shapes in `map.ts` and `pulls.ts`, and add the live shape as a fixture case. Paste the printed summary into your final reply.
- [ ] **Step 3: Update the docs, run typecheck, test and build, then commit.**

```bash
git commit -m "docs(hosts): a floor on bitbucket.org reads its pull requests through bkt"
```
