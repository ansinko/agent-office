# Bitbucket pull requests through bkt

Date: 2026-10-06. Status: approved design, sub-project 2 of 4. Builds on the host
seam (`docs/superpowers/specs/2026-10-06-host-seam-design.md`, PR #7).

## Goal

A floor whose origin is on bitbucket.org gets the same pull request features as a
GitHub floor: the pull requests board, the pull request window (conversation,
line comments, diff, checks, merge, decline), pull requests opened by workers
from their desks or by themselves, the gong when one merges, and leave-on-merge.
The office reads and writes as the `bkt` login on its own machine.

## Out of scope

Issues (Jira is sub-project 3; until then a Bitbucket floor's issue board says
"Issues for this project come from Jira, which the office doesn't read yet"),
personal sign-ins (sub-project 4), adding or cloning a Bitbucket floor from the
elevator, Bitbucket Data Center.

## Adapter

`src/server/hosts/bitbucket/`, registered as `HOSTS.bitbucket`.

- `bkt.ts` runs `bkt` with `execFile`, the same shape as `gh()`: 32 MB buffer,
  30 s default timeout, optional env for a later personal sign-in. Every call
  names the repository explicitly (`--workspace <ws> --repo <slug>` for
  subcommands, `/repositories/<ws>/<slug>/…` for `bkt api`), taken from
  `parseRemote`. Errors read:
  - `ENOENT`: "Bitbucket CLI (bkt) is not installed on the server"
  - no login, 401: "bkt isn't signed in to Bitbucket on the office's machine; run `bkt auth login --kind cloud` there"
  - 403 scope: "The office's Bitbucket token lacks a scope this needs: <bkt's text>"
  - 404: "bkt can't find this repository on Bitbucket (check the remote and access)"
- `map.ts` turns Bitbucket values into the neutral ones:

  | Bitbucket | Office |
  |---|---|
  | `OPEN`, `draft: false` / `true` | `open` / `draft` |
  | `MERGED` | `merged` |
  | `DECLINED`, `SUPERSEDED` | `closed` |
  | a participant with `state: changes_requested` | review `changes` |
  | else a reviewer with `approved: true` | review `approved` |
  | else any reviewer | review `pending` |
  | no reviewers | review `none` |
  | status `SUCCESSFUL` / `FAILED` / `INPROGRESS` / `STOPPED` | check `pass` / `fail` / `pending` / `skip` |
  | diffstat entry with `status: merge conflict` | readiness `conflict` |
  | else a failed check | readiness `checks` |
  | else review `changes` | readiness `blocked` |
  | else | readiness `clean` |

- `pulls.ts` (`BitbucketPulls implements CodeHost`) holds the board state and
  the reads; `write.ts` holds the writes as functions `pulls.ts` calls.

## Reads

- The list is `bkt api /repositories/<ws>/<slug>/pullrequests` with
  `state=OPEN` (up to 150), `MERGED` (30) and `DECLINED` (40), each with a
  `fields=` list and `pagelen=50`, following `next` until the limit. Fields:
  id, title, description, state, draft, created_on, updated_on, author,
  source branch and commit, destination branch, links.html, participants
  (role, approved, state, user).
- Checks and +/- lines are asked only for open pull requests: `…/statuses`
  and `…/diffstat`, cached by source commit hash, four at a time.
- `headRefOid` is the full hash. Bitbucket gives 12 characters; the adapter
  expands it with `git rev-parse --verify <hash>^{commit}` in the floor's
  checkout and leaves it unset when that fails. Leave-on-merge needs the full
  hash (`worktrees.ts` `inspect`).
- `closes` is empty: Jira links come in sub-project 3.
- `pullDetail` reads the pull request, `…/comments?pagelen=100` (all pages),
  `…/statuses`, `…/diffstat` and `…/commits` (count). A comment with `inline`
  becomes a `ReviewComment` (`path`, `line` from `inline.to`, `side` RIGHT, or
  `inline.from` and LEFT); `parent.id` is `replyTo`; deleted comments are
  dropped. Participants with a verdict become `reviews`.
- `pullDiff` is `bkt pr diff <n>`.
- `viewer` is `bkt api /user`, its `nickname` (else `display_name`).
- `repoInfo` gives `name` `<ws>/<slug>`, methods Merge commit
  (`merge_commit`), Squash (`squash`), Fast forward (`fast_forward`), no
  reasons, and caps `{ labels: false, autoMerge: false, lineComments: true,
  deleteBranch: true }`. `repoLabels` resolves to `[]`.

## Writes

- `comment`: `bkt pr comment <n> --text=<body>`, then the comment as Bitbucket
  saved it (`--json`).
- `review` (the meeting room's review panel): the file's text as one comment.
- `merge`: `bkt pr merge <n> --strategy <id> --close-source=<deleteBranch>`.
  `auto` is refused with "Bitbucket has no auto-merge".
- `close`: `bkt pr decline <n> [--comment=<text>] [--delete-source]`.
- `setLabels`: refused, "Bitbucket pull requests have no labels".
- `findOpenPr(branch)`: `…/pullrequests` with
  `q=source.branch.name="<branch>" AND state="OPEN"`.
- `createPr`: `bkt pr create --source <branch> [--target <base>] --title=…
  --description=… --json`; the number and URL come from its JSON, else from
  `findOpenPr`.
- `ownPr(command, text)`: the command runs `bkt pr create`, and the last
  `https://bitbucket.org/<ws>/<slug>/pull-requests/<n>` printed is it.
- `parsePrUrl` reads the same URL form. `prRef` returns the URL.
- `pullBody` / `setPullBody`: `bkt api …/pullrequests/<n>` with
  `fields=description`, and `-X PUT` with `{"description": …}`.

## Commands for prompts

`viewPull` `bkt pr view {{number}}`, `diffPull` `bkt pr diff {{number}}`,
`checkout` `bkt pr checkout {{number}}`, `checks`
`bkt pr checks {{number}} --wait`, `lineComments` `bkt pr comments {{number}}`,
`createPr` `bkt pr create`, `pullCommands`
`bkt pr view, bkt pr diff, bkt pr checks`, `cliName` `bkt`, `merge`
`bkt pr merge <n> --strategy <id>[ --close-source=false] --workspace <ws> --repo <slug>`.
`viewIssue` and `listIssues` are empty until sub-project 3; the issue board on
a Bitbucket floor has no cards to use them on.

## Issue board

The adapter's `issues()` returns a tracker built by a new `emptyTracker(error)`
in `hosts/none.ts`, with the Jira message above.

## Testing

- Fixtures in `tests/fixtures/bitbucket/` are shaped like eranet3's real
  responses with every name, URL and id rewritten to `example.com` /
  `example-team/example-repo`.
- `map.ts` against every row of the table above.
- `BitbucketPulls` and `write.ts` with an injected runner: the exact `bkt`
  argv of every call, the list built from fixtures, pagination, the check
  cache, the hash expansion.
- `ownPr`, `parsePrUrl`, `findOpenPr`'s query.
- The registry gives Bitbucket an adapter; a Bitbucket floor's issue board
  carries the Jira message.
- A read-only smoke run on beast against eranet3: list, detail, diff, viewer.
  No comment, merge, decline or create against a real repository.
