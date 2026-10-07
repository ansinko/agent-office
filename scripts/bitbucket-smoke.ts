// A read-only run of the Bitbucket adapter against a real checkout: the board, one PR's detail, its
// diff and the viewer. It prints counts, states and field names; no titles, bodies or people.
// Usage: npx tsx scripts/bitbucket-smoke.ts <checkout>
import { originRemote } from '../src/server/building.js';
import { api, bktIn, type BbRepo } from '../src/server/hosts/bitbucket/bkt.js';
import { BitbucketPulls, listQuery } from '../src/server/hosts/bitbucket/pulls.js';
import type { BoardState, Pull } from '../src/shared/protocol.js';

const dir = process.argv[2];
const remote = dir ? originRemote(dir) : undefined;
if (remote?.kind !== 'bitbucket') {
  console.error('usage: bitbucket-smoke.ts <checkout with a bitbucket.org origin>');
  process.exit(2);
}
const [ws, slug] = remote.repo.split('/');
const repo: BbRepo = { dir, ws, slug };
const bkt = bktIn(dir, ws);

const tally = (xs: unknown[]) => Object.entries(xs.reduce<Record<string, number>>((t, x) => ((t[String(x)] = (t[String(x)] ?? 0) + 1), t), {})).map(([k, n]) => `${k}=${n}`).join(' ') || '(none)';
const keys = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o).sort().join(',') : String(o));

let board: BoardState<Pull> = { items: [], fetchedAt: 0, loading: false };
const pulls = new BitbucketPulls(repo, (s) => (board = s));
await pulls.refresh();
if (board.error) throw new Error(`board: ${board.error}`);
const items = board.items;
console.log(`board: ${items.length} pull requests; state ${tally(items.map((p) => p.state))}`);
console.log(`  review ${tally(items.map((p) => p.review))}`);
const open = items.filter((p) => p.state === 'open' || p.state === 'draft');
console.log(`  open checks ${tally(open.map((p) => p.checks))}; open with +/- lines ${open.filter((p) => p.additions + p.deletions > 0).length}/${open.length}`);
console.log(`  headRefOid full ${items.filter((p) => p.headRefOid).length}/${items.length}; author set ${items.filter((p) => p.author).length}/${items.length}; url set ${items.filter((p) => /^https:\/\/bitbucket\.org\/.+\/pull-requests\/\d+$/.test(p.url)).length}/${items.length}`);

// The raw shapes the mapper reads, by field name and enum value, to compare with the fixtures.
const raw = JSON.parse(await bkt(['api', api(repo, '/pullrequests'), '-P', 'state=OPEN', '-P', 'pagelen=5']));
const first = raw.values?.[0];
console.log(`raw list page: ${keys(raw)}; next is an api.bitbucket.org/2.0 URL: ${/^https:\/\/api\.bitbucket\.org\/2\.0\//.test(String(raw.next ?? ''))}`);
if (first) {
  console.log(`  pull request: ${keys(first)}`);
  console.log(`  author: ${keys(first.author)}; source: ${keys(first.source)}; source.commit.hash length ${String(first.source?.commit?.hash ?? '').length}`);
  console.log(`  participants ${first.participants?.length ?? 0}: ${keys(first.participants?.[0])}; role ${tally((first.participants ?? []).map((p: any) => p.role))}; state ${tally((first.participants ?? []).map((p: any) => p.state))}`);
}

// Past one page of 50: `next` comes back as a URL whose query bkt api has to carry.
const long = await listQuery('MERGED', 60)(bkt, repo);
console.log(`merged up to 60: ${long.length}, distinct ${new Set(long.map((p) => p.id)).size}, with participants field ${long.filter((p) => 'participants' in p).length}`);

// The first open PR, and the board's PR with the most comments, to see comments and verdicts live.
const counts = (
  await Promise.all(['OPEN', 'MERGED', 'DECLINED'].map(async (st) => JSON.parse(await bkt(['api', api(repo, '/pullrequests'), '-P', `state=${st}`, '-P', 'pagelen=50', '-P', 'fields=values.id,values.comment_count'])).values ?? []))
).flat();
const talked = counts.sort((a: any, b: any) => b.comment_count - a.comment_count)[0];
const shown = items.find((p) => p.number === talked?.id);
if (talked) {
  const cs = JSON.parse(await bkt(['api', api(repo, `/pullrequests/${talked.id}/comments`), '-P', 'pagelen=100'])).values ?? [];
  const one = JSON.parse(await bkt(['api', api(repo, `/pullrequests/${talked.id}`)]));
  console.log(`most talked PR: ${talked.comment_count} comments; page ${cs.length}: ${keys(cs[0])}`);
  console.log(`  inline ${cs.filter((c: any) => c.inline).length} (${keys(cs.find((c: any) => c.inline)?.inline)}); to set ${cs.filter((c: any) => c.inline?.to != null).length}, only from ${cs.filter((c: any) => c.inline && c.inline.to == null && c.inline.from != null).length}; parent ${cs.filter((c: any) => c.parent).length} (${keys(cs.find((c: any) => c.parent)?.parent)}); deleted ${cs.filter((c: any) => c.deleted).length}`);
  console.log(`  participants ${one.participants?.length ?? 0}: ${keys(one.participants?.[0])}; role ${tally((one.participants ?? []).map((p: any) => p.role))}; state ${tally((one.participants ?? []).map((p: any) => p.state))}; approved ${tally((one.participants ?? []).map((p: any) => p.approved))}`);
  const d = await pulls.pullDetail(talked.id);
  console.log(`  detail: review ${d.review} (board ${shown?.review ?? 'not on board'}), comments ${d.comments.length}, line comments ${d.reviewComments.length} (side ${tally(d.reviewComments.map((c) => c.side))}, line set ${d.reviewComments.filter((c) => c.line != null).length}, path set ${d.reviewComments.filter((c) => c.path).length}, replies ${d.reviewComments.filter((c) => c.replyTo != null).length}), reviews ${tally(d.reviews.map((r) => r.review))}`);
}

const pick = open[0];
if (!pick) {
  console.log('no open pull request: detail and diff skipped');
} else {
  const at = (path: string) => api(repo, `/pullrequests/${pick.number}${path}`);
  const [statuses, diffstat, comments] = await Promise.all(['/statuses', '/diffstat', '/comments?pagelen=100'].map(async (p) => JSON.parse(await bkt(['api', at(p)])).values ?? []));
  console.log(`raw first open: statuses ${statuses.length} state ${tally(statuses.map((s: any) => s.state))}; diffstat ${diffstat.length} status ${tally(diffstat.map((d: any) => d.status))}`);
  console.log(`  comments ${comments.length}: ${keys(comments[0])}; inline ${comments.filter((c: any) => c.inline).length} (${keys(comments.find((c: any) => c.inline)?.inline)}); replies ${comments.filter((c: any) => c.parent).length}; deleted ${comments.filter((c: any) => c.deleted).length}`);

  const d = await pulls.pullDetail(pick.number);
  console.log(`detail: state ${d.state}, review ${d.review} (board ${pick.review}), readiness ${d.readiness}, commits ${d.commits}, body ${d.body.length} chars`);
  console.log(`  comments ${d.comments.length}, line comments ${d.reviewComments.length} (side ${tally(d.reviewComments.map((c) => c.side))}, replies ${d.reviewComments.filter((c) => c.replyTo != null).length}), reviews ${tally(d.reviews.map((r) => r.review))}`);
  console.log(`  checks ${d.checks.length}: ${tally(d.checks.map((c) => c.state))}; methods ${d.repo.methods.map((m) => m.id).join(',')}; viewer set ${!!d.viewer}`);

  const diff = await pulls.pullDiff(pick.number);
  console.log(`diff: ${diff.split('\n').length} lines, ${(diff.match(/^diff --git /gm) ?? []).length} files`);
}

const found = pick && (await pulls.findOpenPr(pick.headRefName, dir));
console.log(`findOpenPr of the first open PR's branch: ${found ? (found.number === pick.number ? 'same number' : 'DIFFERENT number') : pick ? 'NOT FOUND' : 'skipped'}`);

const me = await pulls.viewer();
console.log(`viewer: ${me ? `set (${me.length} chars)` : 'EMPTY'}`);
