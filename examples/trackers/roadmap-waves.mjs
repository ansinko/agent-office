#!/usr/bin/env node
// A command tracker (see docs/configuration.md, "The issues board from a command of your own") for a
// project that plans its work as waves in roadmaps: the issues board shows where each wave that isn't
// done yet stands, worked out from git in the code repository and its specification repository.
//
// Roadmaps are the newest docs/plans/<module>/YYYY-MM-DD-roadmap.md of each module on the code
// repository's origin/main, plus the waves only an unmerged branch whose name says roadmap adds. Each has a table between <!-- waves:start --> and <!-- waves:end --> with the columns
// Wave, Depends on, Tickets, REQ, Scope and Description. A wave lands in the first column that fits:
//
//   (left off)   done: its branch origin/feature/*<module>-<wave>-* is merged into origin/main (or, for
//                a wave named W<n> with no such branch, every ticket has <module>/test-cases/<NN>-*)
//   In progress  that branch exists and isn't merged
//   Waiting      its questions wait on the analyst: an unmerged origin/plan/*<module>-<wave>-* in the
//                spec repository (or one only in the spec checkout, not pushed yet), or a
//                questions/v*-otazky-implementacny-plan-<wave>.md on its main that isn't premietnute yet
//   Ready        its questions are premietnute on the spec repository's main
//   Not started  no questions yet (prepare-wave hasn't run), a wave it depends on isn't done, or its
//                roadmap isn't on main
//
// A module's questions about the roadmap itself (v*-otazky-implementacna-roadmapa.md, on main or an
// unmerged plan branch) are a card of their own while they wait.
//
// Usage: node roadmap-waves.mjs [--code <dir>] [--spec <dir>] [--modules reference-data,I-08] [--mine [--me <email>]] [--no-fetch]
// --code defaults to the current directory (the floor's checkout), --spec to a sibling
// eranet3-specification or specification folder. Every module is shown unless --modules (slugs or
// service codes) or --mine narrow it; --mine adds the modules your own commits on unmerged branches
// touch. It only reads: git fetch updates the remote-tracking branches, nothing else.
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
const me = option('--me');
const wanted = (option('--modules') ?? '').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);

function fail(why) {
  process.stderr.write(`${why}\n`);
  process.exit(1);
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const lines = (s) => (s ? s.split('\n') : []);

// --show <ref>:<path> prints one of a card's files from the spec repository: the tracker's "show".
if (argv.includes('--show')) {
  const id = option('--show') ?? '';
  const m = /^((?:origin\/)?[\w./-]+):(modules\/[^\0\s]+\.md)$/.exec(id);
  if (!m || m[1].startsWith('-') || m[2].split('/').includes('..')) fail(`Not a file of this tracker: ${id}`);
  process.stdout.write(git(spec, 'show', `${m[1]}:${m[2]}`));
  process.exit(0);
}

if (!argv.includes('--no-fetch')) for (const dir of [code, spec]) git(dir, 'fetch', '--prune', '--quiet', 'origin');

const codeFiles = lines(git(code, 'ls-tree', '-r', '--name-only', 'origin/main'));
const specFiles = lines(git(spec, 'ls-tree', '-r', '--name-only', 'origin/main'));
const refs = (dir, prefix, merged) => lines(git(dir, 'for-each-ref', `--${merged ? '' : 'no-'}merged`, 'origin/main', '--format=%(refname:short)', `refs/remotes/origin/${prefix}`)).filter((r) => r !== 'origin/HEAD' && r !== 'origin');
const featuresMerged = refs(code, 'feature/', true);
const featuresOpen = refs(code, 'feature/', false);
/** Plan branches only in the spec checkout: prepare-wave ran there, and no branch on origin has them. */
const unpushed = new Set(
  lines(git(spec, 'for-each-ref', '--no-merged', 'origin/main', '--format=%(refname:short)', 'refs/heads/plan/')).filter((b) => !git(spec, 'branch', '-r', '--contains', b)),
);
const plansOpen = [...refs(spec, 'plan/', false), ...unpushed];
/** The spec repository's other unmerged branches, such as spec/<module>, where plan branches are merged before main. */
const specOpen = refs(spec, '', false).filter((b) => !b.startsWith('origin/plan/'));
const unmergedCode = refs(code, '', false);

/**
 * With --mine, the modules your own commits on unmerged branches touch: code branches (docs/plans/<m>/,
 * services/<m>/, modules/<m>/) and spec plan branches (modules/<category>/<m>/). Your commits are
 * the ones with your email (--me, else the code repository's user.email).
 */
const mine = argv.includes('--mine') ? mineFrom(me ?? git(code, 'config', 'user.email')) : undefined;

function mineFrom(email) {
  const found = new Set();
  const touched = (dir, branch, pattern) => {
    if (!lines(git(dir, 'log', '--format=%ae', `origin/main..${branch}`)).some((a) => a.toLowerCase() === email.toLowerCase())) return;
    for (const f of lines(git(dir, 'diff', '--name-only', `origin/main...${branch}`))) {
      const m = pattern.exec(f);
      if (m) found.add(m[1]);
    }
  };
  for (const b of unmergedCode) touched(code, b, /^(?:docs\/plans|platform\/backend\/src\/services|modules)\/([^/]+)\//);
  for (const b of [...plansOpen, ...specOpen]) touched(spec, b, /^modules\/[^/]+\/([^/]+)\//);
  return found;
}

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

/** The page of a file at branch `ref` of the repository at `dir`, on its host. */
const pagesOf = (dir) => {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(git(dir, 'remote', 'get-url', 'origin'));
  if (!m) return () => '';
  const base = `https://${m[1]}/${m[2]}`;
  return (file, ref) => (m[1] === 'bitbucket.org' ? `${base}/src/${ref}/${file}` : `${base}/blob/${ref}/${file}`);
};
const pageOf = pagesOf(code);
const specPageOf = pagesOf(spec);

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

/** A roadmap file at `ref`: its heading and waves, or undefined without a waves table. */
function readRoadmap(file, ref) {
  const text = git(code, 'show', `${ref}:${file}`);
  const table = /<!-- waves:start -->([\s\S]*?)<!-- waves:end -->/.exec(text);
  return table && { file, ref, heading: /^# (.*)$/m.exec(text)?.[1], waves: wavesOf(table[1]).map((w) => ({ ...w, ref, file, text: sectionOf(text, w.id) })) };
}

/**
 * Every module's roadmap: main's waves, and the waves only an unmerged branch about a roadmap has
 * (newest commit first). A module with no roadmap on main takes its heading from such a branch.
 */
function roadmaps() {
  const byDir = new Map();
  const add = (dir, r) => r && byDir.set(dir, [...(byDir.get(dir) ?? []), r]);
  for (const { dir, file, ref } of newestOn('origin/main', codeFiles)) add(dir, readRoadmap(file, ref));
  const branches = unmergedCode.filter((b) => /roadmap/i.test(b)).sort((a, b) => git(code, 'log', '-1', '--format=%ct', b).localeCompare(git(code, 'log', '-1', '--format=%ct', a)));
  for (const branch of branches) for (const { dir, file, ref } of newestOn(branch, lines(git(code, 'ls-tree', '-r', '--name-only', branch, 'docs/plans/')))) add(dir, readRoadmap(file, ref));
  const out = [];
  for (const [dir, versions] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    const [base] = versions;
    const heading = base.heading ?? dir;
    const service = /\bI-(\d+)\b/.exec(heading)?.[1];
    const slug = /`([a-z0-9-]+)`/.exec(heading)?.[1] ?? dir;
    const name = service ? `I-${service}` : slug;
    if (!chosen({ dir, slug, name })) continue;
    const prefix = service ? `I${service}` : slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20);
    const waves = [];
    for (const v of versions) for (const w of v.waves) if (!waves.some((x) => x.id === w.id)) waves.push(w);
    out.push({ file: base.file, ref: base.ref, slug, name, prefix, waves });
  }
  return out;
}

/** Whether the board shows a module: named in --modules, or, with --mine, one you have unmerged work in. */
function chosen(m) {
  if (!wanted.length && !mine) return true;
  return wanted.includes(m.slug) || wanted.includes(m.name.toLowerCase()) || !!mine?.has(m.dir) || !!mine?.has(m.slug);
}

/** The roadmap's own section about a wave (### W5 — …), up to the next heading of its level or above. */
function sectionOf(text, id) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^###\\s+${id}\\s+[—–-]`, 'i').test(l));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

/** A spec file's frontmatter fields and the text after it. */
function specDoc(file) {
  const text = git(spec, 'show', `origin/main:${file}`);
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const fields = Object.fromEntries(lines(m?.[1] ?? '').map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2]]));
  return { fields, rest: m ? m[2] : text };
}

/** What a wave's tickets say, and their test scenarios, as Markdown for its card. */
/** One of a card's files: the spec file `file` at branch `ref`, to read in the issue window. */
const fileAt = (title, file, ref = 'origin/main') => ({ id: `${ref}:${file}`, title, ...(ref.startsWith('origin/') ? { url: specPageOf(file, short(ref)) } : {}) });

/** A wave's questions, then each ticket and its test scenarios, as files of its card. */
function filesOf(module, wave, questions) {
  const files = questions.map((q) => fileAt(`Otázky · ${path.basename(q.file)} (${q.stav})`, q.file, q.branch));
  for (const nn of wave.tickets) {
    const ticket = ticketFile(module, nn);
    if (!ticket) continue;
    files.push(fileAt(`Tiket ${nn} · ${path.basename(ticket)}`, ticket));
    const scenarios = scenariosFile(ticket);
    if (scenarios) files.push(fileAt(`Test scenáre ${nn} · ${path.basename(scenarios)}`, scenarios));
  }
  return files;
}

const ticketFile = (module, nn) => specFiles.find((f) => new RegExp(`^modules/[^/]+/${module.slug}/tickets/${nn}-[^/]+/${nn}-[^/]+\\.md$`).test(f));
const scenariosFile = (ticket) => specFiles.find((f) => f.startsWith(`${path.dirname(ticket)}/test-scenarios/`) && f.endsWith('.md'));

function ticketsOf(module, wave) {
  const out = [];
  for (const nn of wave.tickets) {
    const ticket = ticketFile(module, nn);
    if (!ticket) {
      out.push(`#### Tiket ${nn}`, '', '_V spec main nie je._', '');
      continue;
    }
    const { fields, rest } = specDoc(ticket);
    const title = /^# (.*)$/m.exec(rest)?.[1] ?? `${nn} — ${fields.nazov ?? ''}`;
    const what = rest.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? '';
    out.push(`#### [${title}](${specPageOf(ticket, 'main')})`, '', `stav \`${fields.stav ?? '?'}\` · blokovaný kým ${fields.blokovany_kym ?? '-'} · nedoriešené ${fields.nedoriesene ?? '-'}`, '', what.length > 900 ? `${what.slice(0, 900)}…` : what, '');
    const scenarios = scenariosFile(ticket);
    if (scenarios) {
      const doc = specDoc(scenarios);
      const count = (level) => (doc.rest.match(new RegExp(`^#+ TS-${nn}-${level}-`, 'gm')) ?? []).length;
      out.push(`Test scenáre: [${path.basename(scenarios)}](${specPageOf(scenarios, 'main')}) · stav \`${doc.fields.stav ?? '?'}\` · unit ${count('U')} · integračné ${count('I')} · e2e ${count('E')}`, '');
    } else out.push('Test scenáre: _zatiaľ nie sú_', '');
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
const questionsOnMain = (module, suffix) => specFiles.filter((f) => questionsOnMain.test(module, suffix, f));
questionsOnMain.test = (module, suffix, f) => {
  const m = /^modules\/[^/]+\/([^/]+)\/questions\/(v[^/]*)\.md$/.exec(f);
  return m?.[1] === module.slug && m[2].endsWith(suffix);
};

/** How far a questions file has got, so the furthest copy of it on any branch wins. */
const STAGE = ['na-zodpovedanie', 'čiastočne-zodpovedané', 'zodpovedane', 'premietnute'];

/**
 * Every questions file an unmerged spec branch changes, at the stage its furthest branch has it
 * (`branch`), or main's when no branch changes it (`branch` undefined).
 */
const allQuestions = (() => {
  const best = new Map();
  for (const branch of [...plansOpen, ...specOpen]) {
    for (const file of lines(git(spec, 'diff', '--name-only', `origin/main...${branch}`)).filter((f) => /\/questions\/v[^/]*\.md$/.test(f))) {
      if (!specFiles.includes(file) && !git(spec, 'ls-tree', '--name-only', branch, file)) continue;
      const stav = stavOf(file, branch);
      const had = best.get(file);
      if (!had || STAGE.indexOf(stav) > STAGE.indexOf(had.stav)) best.set(file, { file, stav, branch });
    }
  }
  return best;
})();

/** The module's questions files whose name ends in `<suffix>.md`: their furthest copy on a branch, else main's. */
function questionsOf(module, suffix) {
  const files = new Set([...questionsOnMain(module, suffix), ...[...allQuestions.keys()].filter((f) => questionsOnMain.test(module, suffix, f))]);
  return [...files].map((file) => allQuestions.get(file) ?? { file, stav: stavOf(file) });
}

const ownBranch = (module, wave) => (b) => b.includes(`${module.slug}-${wave.id.toLowerCase()}-`);

/** A module's test cases on main: the folder may be named for the service, a prefix of its slug (identity). */
const testedIn = (module, nn) => codeFiles.some((f) => {
  const m = /(?:^|\/)([^/]+)\/test-cases\/(\d{2})-/.exec(f);
  return m?.[2] === nn && module.slug.startsWith(m[1]);
});

/**
 * Done: its branch is merged; or, named W<n> with no branch, all its tickets have test cases; or a
 * wave that depends on it has started, which prepare-wave only lets happen once it was merged.
 */
function done(module, wave, seen = new Set()) {
  if (seen.has(wave.id)) return false;
  seen.add(wave.id);
  const mine = ownBranch(module, wave);
  if (featuresMerged.some(mine)) return true;
  if (featuresOpen.some(mine)) return false;
  if (/^W\d+$/i.test(wave.id) && wave.tickets.length > 0 && wave.tickets.every((nn) => testedIn(module, nn))) return true;
  return module.waves.some((w) => w.deps.includes(wave.id) && (featuresOpen.some(ownBranch(module, w)) || done(module, w, seen)));
}

const distinct = (labels) => [...new Map(labels.map((l) => [l.name, l])).values()];

/** Where a wave that isn't done stands: its column, why, and what it waits on. */
function placeOf(module, wave) {
  if (done(module, wave)) return undefined;
  const mine = ownBranch(module, wave);
  const branch = featuresOpen.find(mine);
  if (branch) return { column: 'progress', branch, labels: [] };
  const plan = plansOpen.find(mine);
  const questions = questionsOf(module, `-otazky-implementacny-plan-${wave.id.toLowerCase()}`);
  const unanswered = questions.filter((q) => q.stav !== 'premietnute');
  const unmerged = [...new Set(questions.filter((q) => q.branch).map((q) => short(q.branch)))];
  const blockers = wave.deps.filter((d) => {
    const dep = module.waves.find((x) => x.id === d);
    return !dep || !done(module, dep);
  });
  const after = blockers.length ? [{ name: `po ${blockers.join(', ')}`, color: '#6e7781' }] : [];
  const local = plan && unpushed.has(plan) ? [{ name: 'otázky nepushnuté', color: '#bc4c00' }] : [];
  if (plan || unanswered.length) return { column: 'waiting', plan, questions, labels: [...local, ...distinct(unanswered.map((q) => stavLabel(q.stav))), ...after] };
  if (unmerged.length) return { column: 'waiting', questions, labels: [{ name: `premietnuté v ${unmerged.join(', ')}, čaká na merge`, color: '#9a6700' }, ...after] };
  if (wave.ref !== 'origin/main') return { column: 'not-started', questions, labels: [{ name: 'roadmap nie je v main', color: '#bc4c00' }] };
  if (questions.length) return { column: 'ready', questions, labels: [stavLabel('premietnute'), ...after] };
  if (blockers.length) return { column: 'not-started', labels: [{ name: `blokovaná: ${blockers.join(', ')}`, color: '#cf222e' }] };
  return { column: 'not-started', labels: [{ name: 'bez prepare-wave', color: '#9a6700' }], prepare: true };
}

const short = (ref) => ref.replace(/^origin\//, '');
/** Where a questions file stands, if not on main. */
const where = (q) => (!q.branch ? '' : unpushed.has(q.branch) ? ` na lokálnej \`${q.branch}\` (nepushnutá)` : ` na \`${short(q.branch)}\``);
const issues = [];

for (const module of roadmaps()) {
  const moduleLabel = { name: module.name, color: '#57606a' };
  const roadmapAt = git(code, 'log', '-1', '--format=%cI', module.ref, '--', module.file);
  const url = pageOf(module.file, short(module.ref));

  // The module's questions that belong to no wave (its roadmap, its specification), while they wait.
  const waveQs = /-otazky-implementacny-plan-w\d+[a-z]?$/;
  const moduleQs = [...questionsOf(module, '-otazky-implementacna-roadmapa'), ...questionsOf(module, '').filter((q) => q.branch && !waveQs.test(q.file.replace(/\.md$/, '')))]
    .filter((q, i, all) => (q.stav !== 'premietnute' || q.branch) && all.findIndex((x) => x.file === q.file) === i);
  if (moduleQs.length) {
    issues.push({
      key: `${module.prefix}-OTAZKY`,
      ref: `${module.name} otázky`,
      title: `${module.name}: otázky mimo vĺn čakajú (${moduleQs.length})`,
      url,
      author: module.slug,
      column: 'waiting',
      labels: [moduleLabel, ...distinct(moduleQs.map((q) => (q.stav === 'premietnute' ? { name: 'premietnuté, čaká na merge', color: '#9a6700' } : stavLabel(q.stav))))],
      createdAt: roadmapAt,
      updatedAt: roadmapAt,
      files: moduleQs.map((q) => fileAt(`Otázky · ${path.basename(q.file)} (${q.stav})`, q.file, q.branch)),
      body: [`**${module.name}** · otázky k roadmapu a špecifikácii, ktoré nepatria žiadnej vlne`, '', ...moduleQs.map((q) => `- [${path.basename(q.file)}](${specPageOf(q.file, q.branch ? short(q.branch) : 'main')}) (${q.stav})${where(q)}`)].join('\n'),
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
        ? `Take wave ${wave.id} of the module \`${module.slug}\` (roadmap \`${wave.file}\`, tickets ${tickets}): load the implement-feature skill and start with its Phase 0.`
        : place.column === 'progress'
          ? `Carry on with wave ${wave.id} of the module \`${module.slug}\` on branch \`${short(place.branch)}\`: load the implement-feature skill and pick up where the branch left off.`
          : place.prepare
            ? `/prepare-wave ${module.slug} ${wave.id}`
            : undefined;
    issues.push({
      key: `${module.prefix}-${wave.id.toUpperCase()}`,
      ref: `${module.name} ${wave.id}`,
      title: `${module.name} ${wave.id}: ${wave.description}`,
      url: pageOf(wave.file, short(wave.ref)),
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
        `- Roadmap: \`${wave.file}\`${wave.ref === 'origin/main' ? '' : ` na \`${short(wave.ref)}\``}`,
        ...(place.branch ? [`- Branch: \`${short(place.branch)}\``] : []),
        ...(place.plan ? [`- Questions on: \`${short(place.plan)}\` (spec)`] : []),
        ...(place.questions ?? []).map((q) => `- Questions: [${path.basename(q.file)}](${specPageOf(q.file, q.branch ? short(q.branch) : 'main')}) (${q.stav})${where(q)}`),
        ...(wave.text ? ['', '### Z roadmapu', '', wave.text.length > 5000 ? `${wave.text.slice(0, 5000)}…` : wave.text] : []),
        ...(wave.tickets.length ? ['', '### Tikety', '', ...ticketsOf(module, wave)] : []),
      ].join('\n'),
      ...(prompt ? { prompt } : {}),
      files: filesOf(module, wave, place.questions ?? []),
    });
  }
}

process.stdout.write(JSON.stringify({ columns: COLUMNS, issues }, null, 2));
