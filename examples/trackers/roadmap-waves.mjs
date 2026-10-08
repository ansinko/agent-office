#!/usr/bin/env node
// A command tracker (see docs/configuration.md, "The issues board from a command of your own") for a
// project that plans its work as waves in roadmaps: the issues board shows where each wave that isn't
// done yet stands, worked out from git in the code repository and its specification repository.
//
// Roadmaps are the newest docs/plans/<module>/YYYY-MM-DD-roadmap.md of each module on the code
// repository's origin/main, or, for a module with none there yet, on an unmerged branch whose name
// says roadmap. Each has a table between <!-- waves:start --> and <!-- waves:end --> with the columns
// Wave, Depends on, Tickets, REQ, Scope and Description. A wave lands in the first column that fits:
//
//   (left off)   done: its branch origin/feature/*<module>-<wave>-* is merged into origin/main (or, for
//                a wave named W<n> with no such branch, every ticket has <module>/test-cases/<NN>-*)
//   In progress  that branch exists and isn't merged
//   Waiting      its questions wait on the analyst: an unmerged origin/plan/*<module>-<wave>-* in the
//                spec repository, or a questions/v*-otazky-implementacny-plan-<wave>.md on its main
//                that isn't premietnute yet
//   Ready        its questions are premietnute on the spec repository's main
//   Not started  no questions yet (prepare-wave hasn't run), a wave it depends on isn't done, or its
//                roadmap isn't on main
//
// A module's questions about the roadmap itself (v*-otazky-implementacna-roadmapa.md, on main or an
// unmerged plan branch) are a card of their own while they wait.
//
// Usage: node roadmap-waves.mjs [--code <dir>] [--spec <dir>] [--modules reference-data,I-08] [--no-fetch]
// --code defaults to the current directory (the floor's checkout), --spec to a sibling
// eranet3-specification or specification folder, and --modules (slugs or service codes) to every
// module. It only reads: git fetch updates the remote-tracking branches, nothing else.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const code = path.resolve(option('--code') ?? process.cwd());
const spec = path.resolve(option('--spec') ?? ['eranet3-specification', 'specification'].map((d) => path.join(code, '..', d)).find((d) => existsSync(d)) ?? fail('No --spec given, and no specification folder next to the code'));
const wanted = (option('--modules') ?? '').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);

function fail(why) {
  process.stderr.write(`${why}\n`);
  process.exit(1);
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();
const lines = (s) => (s ? s.split('\n') : []);

if (!argv.includes('--no-fetch')) for (const dir of [code, spec]) git(dir, 'fetch', '--prune', '--quiet', 'origin');

const codeFiles = lines(git(code, 'ls-tree', '-r', '--name-only', 'origin/main'));
const specFiles = lines(git(spec, 'ls-tree', '-r', '--name-only', 'origin/main'));
const refs = (dir, prefix, merged) => lines(git(dir, 'for-each-ref', `--${merged ? '' : 'no-'}merged`, 'origin/main', '--format=%(refname:short)', `refs/remotes/origin/${prefix}`)).filter((r) => r !== 'origin/HEAD' && r !== 'origin');
const featuresMerged = refs(code, 'feature/', true);
const featuresOpen = refs(code, 'feature/', false);
const plansOpen = refs(spec, 'plan/', false);

const COLUMNS = [
  { key: 'not-started', title: '⏸️ Not started' },
  { key: 'waiting', title: '⏳ Waiting on answers' },
  { key: 'ready', title: '✅ Ready' },
  { key: 'progress', title: '🚧 In progress', progress: true },
];

/** What a questions file's frontmatter stav says, as a label. */
const STAV = {
  'na-zodpovedanie': { name: 'na zodpovedanie', color: '#cf222e' },
  'čiastočne-zodpovedané': { name: 'čiastočne zodpovedané', color: '#bc4c00' },
  zodpovedane: { name: 'čaká na premietnutie', color: '#9a6700' },
  premietnute: { name: 'otázky premietnuté', color: '#1a7f37' },
};
const stavLabel = (stav) => STAV[stav] ?? { name: stav || 'bez stavu', color: '#6e7781' };

/** The page of a file at branch `ref`, on the code repository's host. */
const pageOf = (() => {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(git(code, 'remote', 'get-url', 'origin'));
  if (!m) return () => '';
  const base = `https://${m[1]}/${m[2]}`;
  return (file, ref) => (m[1] === 'bitbucket.org' ? `${base}/src/${ref}/${file}` : `${base}/blob/${ref}/${file}`);
})();

const ROADMAP = /^docs\/plans\/([^/]+)\/(\d{4}-\d{2}-\d{2})-roadmap\.md$/;

/** The newest roadmap file of each module among `files` at `ref`. */
function newestOn(ref, files) {
  const newest = new Map();
  for (const f of files) {
    const m = ROADMAP.exec(f);
    if (m && (!newest.has(m[1]) || newest.get(m[1]) < f)) newest.set(m[1], f);
  }
  return [...newest].map(([dir, file]) => ({ dir, file, ref }));
}

/** Every module's roadmap: main's, else the newest on an unmerged branch about a roadmap. */
function roadmaps() {
  const found = new Map(newestOn('origin/main', codeFiles).map((r) => [r.dir, r]));
  for (const branch of refs(code, '', false).filter((b) => /roadmap/i.test(b))) {
    for (const r of newestOn(branch, lines(git(code, 'ls-tree', '-r', '--name-only', branch, 'docs/plans/')))) {
      const had = found.get(r.dir);
      if (!had || (had.ref !== 'origin/main' && had.file < r.file)) found.set(r.dir, r);
    }
  }
  const out = [];
  for (const { dir, file, ref } of [...found.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
    const text = git(code, 'show', `${ref}:${file}`);
    const table = /<!-- waves:start -->([\s\S]*?)<!-- waves:end -->/.exec(text);
    if (!table) continue;
    const heading = /^# (.*)$/m.exec(text)?.[1] ?? dir;
    const service = /\bI-(\d+)\b/.exec(heading)?.[1];
    const slug = /`([a-z0-9-]+)`/.exec(heading)?.[1] ?? dir;
    const name = service ? `I-${service}` : slug;
    if (wanted.length && !wanted.includes(slug) && !wanted.includes(name.toLowerCase())) continue;
    const prefix = service ? `I${service}` : slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20);
    out.push({ file, ref, slug, name, prefix, waves: wavesOf(table[1]) });
  }
  return out;
}

function wavesOf(table) {
  const rows = table
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !/^\|[\s|:-]+\|$/.test(l))
    .map((l) => l.slice(1, -1).split('|').map((c) => c.trim()));
  const [head, ...body] = rows;
  if (!head) return [];
  const col = (row, name) => row[head.findIndex((h) => h.toLowerCase() === name.toLowerCase())] ?? '';
  const list = (v) => (v && v !== '-' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
  return body.map((r) => ({ id: col(r, 'Wave'), deps: list(col(r, 'Depends on')), tickets: list(col(r, 'Tickets')), req: col(r, 'REQ'), scope: col(r, 'Scope'), description: col(r, 'Description') })).filter((w) => w.id);
}

/** stav: from a Markdown file's frontmatter at `ref` of the spec repository. */
function stavOf(file, ref = 'origin/main') {
  const fm = /^---\n([\s\S]*?)\n---/.exec(git(spec, 'show', `${ref}:${file}`))?.[1] ?? '';
  return /^stav:\s*(\S+)/m.exec(fm)?.[1] ?? '';
}

/** The module's questions files on the spec repository's main whose name ends in `<suffix>.md`. */
const questionsOnMain = (module, suffix) =>
  specFiles.filter((f) => {
    const m = /^modules\/[^/]+\/([^/]+)\/questions\/(v[^/]*)\.md$/.exec(f);
    return m?.[1] === module.slug && m[2].endsWith(suffix);
  });

/** The questions files an unmerged plan branch brings, with their stav there. */
function planQuestions(branch) {
  return lines(git(spec, 'diff', '--name-only', `origin/main...${branch}`))
    .filter((f) => /\/questions\/v[^/]*\.md$/.test(f))
    .map((f) => ({ file: f, stav: stavOf(f, branch) }));
}

const ownBranch = (module, wave) => (b) => b.includes(`${module.slug}-${wave.id.toLowerCase()}-`);

function done(module, wave) {
  const mine = ownBranch(module, wave);
  const tested = (nn) => codeFiles.some((f) => f.includes(`${module.slug}/test-cases/${nn}-`));
  return featuresMerged.some(mine) || (!featuresOpen.some(mine) && /^W\d+$/i.test(wave.id) && wave.tickets.length > 0 && wave.tickets.every(tested));
}

const distinct = (labels) => [...new Map(labels.map((l) => [l.name, l])).values()];

/** Where a wave that isn't done stands: its column, why, and what it waits on. */
function placeOf(module, wave) {
  if (done(module, wave)) return undefined;
  const mine = ownBranch(module, wave);
  const branch = featuresOpen.find(mine);
  if (branch) return { column: 'progress', branch, labels: [] };
  const plan = plansOpen.find(mine);
  const onMain = questionsOnMain(module, `-otazky-implementacny-plan-${wave.id.toLowerCase()}`).map((file) => ({ file, stav: stavOf(file) }));
  const questions = [...(plan ? planQuestions(plan) : []), ...onMain];
  const unanswered = questions.filter((q) => q.stav !== 'premietnute');
  const blockers = wave.deps.filter((d) => {
    const dep = module.waves.find((x) => x.id === d);
    return !dep || !done(module, dep);
  });
  const after = blockers.length ? [{ name: `po ${blockers.join(', ')}`, color: '#6e7781' }] : [];
  if (plan || unanswered.length) return { column: 'waiting', plan, questions, labels: [...distinct(unanswered.map((q) => stavLabel(q.stav))), ...after] };
  if (module.ref !== 'origin/main') return { column: 'not-started', questions, labels: [{ name: 'roadmap nie je v main', color: '#bc4c00' }] };
  if (questions.length) return { column: 'ready', questions, labels: [stavLabel('premietnute'), ...after] };
  if (blockers.length) return { column: 'not-started', labels: [{ name: `blokovaná: ${blockers.join(', ')}`, color: '#cf222e' }] };
  return { column: 'not-started', labels: [{ name: 'bez prepare-wave', color: '#9a6700' }], prepare: true };
}

const short = (ref) => ref.replace(/^origin\//, '');
const issues = [];

for (const module of roadmaps()) {
  const moduleLabel = { name: module.name, color: '#57606a' };
  const roadmapAt = git(code, 'log', '-1', '--format=%cI', module.ref, '--', module.file);
  const url = pageOf(module.file, short(module.ref));

  // The module's questions about its roadmap, while they wait.
  const roadmapQs = [
    ...plansOpen.filter((b) => b.includes(module.slug)).flatMap((b) => planQuestions(b).filter((q) => /-otazky-implementacna-roadmapa\.md$/.test(q.file)).map((q) => ({ ...q, plan: b }))),
    ...questionsOnMain(module, '-otazky-implementacna-roadmapa').map((file) => ({ file, stav: stavOf(file) })),
  ].filter((q) => q.stav !== 'premietnute');
  if (roadmapQs.length) {
    issues.push({
      key: `${module.prefix}-ROADMAP`,
      ref: `${module.name} roadmap`,
      title: `${module.name} roadmap: otázky k roadmapu čakajú`,
      url,
      author: module.slug,
      column: 'waiting',
      labels: [moduleLabel, ...distinct(roadmapQs.map((q) => stavLabel(q.stav)))],
      createdAt: roadmapAt,
      updatedAt: roadmapAt,
      body: [`**${module.name}** · otázky k roadmapu \`${module.file}\``, '', ...roadmapQs.map((q) => `- \`${q.file}\` (${q.stav})${q.plan ? ` na \`${short(q.plan)}\`` : ''}`)].join('\n'),
    });
  }

  for (const wave of module.waves) {
    const place = placeOf(module, wave);
    if (!place) continue;
    const tip = place.branch && git(code, 'log', '-1', '--format=%an%x09%cI', place.branch).split('\t');
    const updated = tip?.[1] ?? (place.plan && git(spec, 'log', '-1', '--format=%cI', place.plan)) ?? roadmapAt;
    const tickets = wave.tickets.join(', ') || '-';
    const prompt =
      place.column === 'ready'
        ? `Take wave ${wave.id} of the module \`${module.slug}\` (roadmap \`${module.file}\`, tickets ${tickets}): load the implement-feature skill and start with its Phase 0.`
        : place.column === 'progress'
          ? `Carry on with wave ${wave.id} of the module \`${module.slug}\` on branch \`${short(place.branch)}\`: load the implement-feature skill and pick up where the branch left off.`
          : place.prepare
            ? `/prepare-wave ${module.slug} ${wave.id}`
            : undefined;
    issues.push({
      key: `${module.prefix}-${wave.id.toUpperCase()}`,
      ref: `${module.name} ${wave.id}`,
      title: `${module.name} ${wave.id}: ${wave.description}`,
      url,
      author: module.slug,
      column: place.column,
      labels: [moduleLabel, ...place.labels, ...(wave.scope ? [{ name: wave.scope, color: '#8c959f' }] : [])],
      assignees: tip ? [tip[0]] : [],
      createdAt: updated,
      updatedAt: updated,
      body: [
        `**${module.name} ${wave.id}** · ${wave.description}`,
        '',
        `- Tickets: ${tickets}`,
        `- Depends on: ${wave.deps.join(', ') || '-'}`,
        `- Scope: ${wave.scope || '-'}`,
        `- REQ: ${wave.req || '-'}`,
        `- Roadmap: \`${module.file}\`${module.ref === 'origin/main' ? '' : ` na \`${short(module.ref)}\``}`,
        ...(place.branch ? [`- Branch: \`${short(place.branch)}\``] : []),
        ...(place.plan ? [`- Questions on: \`${short(place.plan)}\` (spec)`] : []),
        ...(place.questions ?? []).map((q) => `- Questions: \`${q.file}\` (${q.stav})`),
      ].join('\n'),
      ...(prompt ? { prompt } : {}),
    });
  }
}

process.stdout.write(JSON.stringify({ columns: COLUMNS, issues }, null, 2));
