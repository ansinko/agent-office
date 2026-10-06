# Host seam: GitHub behind a CodeHost and a Tracker

Date: 2026-10-06. Status: approved design, sub-project 1 of 4.

## Goal

The office reaches pull requests and issues through two interfaces, with
GitHub as their only implementation. Behavior stays exactly as it is today.
This prepares the three sub-projects that follow:

1. **Host seam** (this spec).
2. **Bitbucket pull requests** through the `bkt` CLI, detected from the floor's
   git remote.
3. **Jira issues** through the Jira Cloud REST API, configured per floor
   (site and project key).
4. **Atlassian sign-in**: one personal email and API token for Bitbucket and
   Jira, with the office's own token as fallback.

Each sub-project gets its own spec, plan and pull request.

## Out of scope

Any Bitbucket or Jira code, per-floor settings, and the GitHub-only paths
that stay as they are: adding a floor by `gh repo view` and `gh repo clone`,
the repository picker, and team invites by GitHub username. A floor whose
checkout already sits on disk opens whatever its remote is.

## Server

A new module `src/server/hosts/`:

- `types.ts` defines the two interfaces.
  - `CodeHost`: `listPulls()`, `pullDetail()`, `pullDiff()`, `comment()`,
    `review()`, `merge(number, method, opts)`, `close()`, `setLabels()`,
    `findOpenPr(branch)`, `createPr()`, `parsePrUrl(text)`, `repoInfo()`.
  - `Tracker`: `listIssues()`, `issueDetail()`, `comment()`, `close(reason)`,
    `setLabels()`, `claim()`.
  - Both carry `caps` (labels, auto-merge, line comments, delete-branch) so
    the client hides what a provider lacks, and `cli`, the command lines the
    agent prompts quote (`viewPull`, `diffPull`, `checkout`, `merge`,
    `viewIssue`, `createPr`).
- `detect.ts` reads a git remote URL (SSH or HTTPS) and returns
  `{kind: 'github' | 'bitbucket', repo: 'owner/name', url}`. It replaces
  `normalizeRepo` in `shared/floors.ts` and both `originRepo` helpers
  (`building.ts`, `workers/worktree.ts`). In this sub-project a Bitbucket
  remote is detected but gets no host, and its boards report that.
- `registry.ts` maps each host kind to its adapter, the same pattern as the
  agent `PROVIDERS`, so the typecheck fails when a kind lacks one.
- `github/` holds today's `github.ts`, split into `pulls.ts` (`CodeHost`)
  and `issues.ts` (`Tracker`) plus the shared `gh()` runner and parsers. The
  `gh` invocations stay byte for byte the same.
- `MergeWatch` and `Claims` move to `hosts/` unchanged.

`Floor` holds `host` and `tracker` in place of `github`. These consumers call
the interfaces: `workers/pr.ts`, `leave-on-merge.ts`, `queue.ts`,
`meetings.ts`, `changes.ts`, `office-workers.ts`, `hooks/office-workers.ts`,
`office/gates.ts`, `ws/handlers/workers.ts`, `ws/handlers/changes.ts`.

`workers/pr.ts` stops matching `gh pr create` and `github.com/…/pull/N`
itself and asks `host.parsePrUrl()`. `meetings.ts` builds its brief lines from
`host.cli` and `tracker.cli`. `withGitHub` and `ghAs` become `withHost` and
`hostAs`; both still resolve the GitHub sign-in until sub-project 4.

`signins.ts` sits at its size ceiling and is not touched beyond renamed
imports.

## Protocol

`shared/protocol/github.ts` is replaced by `shared/protocol/boards.ts`:

- Types: `Pull`, `Issue`, `Label`, `Check`, `Comment`, `ReviewComment`,
  `PullDetail`, `IssueDetail`, `BoardState<T>`, `RepoInfo`.
- Pull requests keep `number`. An issue has `key: string` and `ref` for
  display: GitHub gives `"12"` and `#12`, Jira will give `"ERN-123"` twice.
- `key: string` replaces the numeric issue everywhere it travels: the queue,
  meetings, carried issues, presence, `worker.spawn` and `worker.prompt`, the
  `issueNumber` validator (renamed `issueKey`), `office-queue --issue`, and
  `Pull.closes`.
- States are neutral and lower case. The adapter maps GitHub's values once.

  | Field | Values |
  |---|---|
  | `Pull.state` | `open`, `draft`, `merged`, `closed` |
  | `Pull.review` | `approved`, `changes`, `pending`, `none` |
  | `PullDetail.readiness` | `clean`, `conflict`, `behind`, `blocked`, `checks`, `unknown` |
  | `Issue.state` | `open`, `closed` |

  `readiness` replaces `mergeable` and `mergeStateStatus`.
- Merge methods and close reasons are lists of `{id, label}` in `RepoInfo`
  and the tracker's info. GitHub supplies `squash`, `merge`, `rebase` and
  `completed`, `not planned`.
- Messages `gh.*` become `board.*`; routes `/api/gh/*` become
  `/api/board/*`. Client and server ship together, `lite.ts` included, so no
  alias is kept.
- `FloorInfo` gains `host: {kind, name, repo, url} | null` and
  `tracker: {kind, name} | null`. The client takes the display name from it
  for "Open on …", "Refresh from …" and the load errors.

## Persisted data

`queue.json` and any saved carried issue holding a numeric issue load
through `String()`. Nothing else on disk names an issue.

## Client

- `ui/github/` moves to `ui/boards/`.
- `merge.ts`, `close.ts` and `prefs.ts` read methods and reasons from the
  lists. The stored merge preference keeps working because GitHub's ids are
  unchanged.
- `labels.ts`, line comments, auto-merge and delete-branch hide according to
  `caps`.
- `markdown.ts` links `#N` through `host.url`, and `@user` only on GitHub.
- `mergeCommand` moves to the server as `cli.merge`.
- `boards.ts`, `features/boards/world.ts`, `shared/status.ts` and
  `worker-badges.ts` compare the neutral states.

## Prompts

`shared/prompts.ts` templates use `{{viewPull}}`, `{{diffPull}}`,
`{{checkout}}`, `{{merge}}`, `{{viewIssue}}` and `{{createPr}}`, filled from
the floor's `cli`. With GitHub the rendered text is identical to today's, and
`tests/prompts.test.ts` pins that.

## Errors

A floor without a recognised host shows the boards with one message: "This
project's remote is on <host>, which the office cannot read yet" or "This
project has no remote". The GitHub error texts stay as they are.

## Testing

- Every existing test passes with the renamed types and shapes.
- New: `detect.ts` against GitHub and Bitbucket remotes in SSH, HTTPS and
  `ssh://` form, with and without `.git`.
- New: a `queue.json` with numeric issues loads into string keys.
- New: the GitHub adapter maps each GitHub state, review decision and merge
  state onto the neutral values.
- `tests/size.test.ts` stays green; no file is added to `CEILINGS`.
- `npm run typecheck`, `npm test`, `npm run build`, and headless screenshots
  of both boards and the pull request window before and after, which match.
