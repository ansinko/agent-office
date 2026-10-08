#!/usr/bin/env node
// A command tracker (see docs/configuration.md, "The issues board from a command of your own") for a
// project that plans its work as waves in roadmaps: every wave becomes a card on the issues board,
// with the state worked out from git in the code repository and its specification repository.
//
// It reads, from origin/main of the code repository, the newest docs/plans/<module>/YYYY-MM-DD-roadmap.md
// of each module, and in it the table between <!-- waves:start --> and <!-- waves:end --> with the
// columns Wave, Depends on, Tickets, REQ, Scope and Description. A wave's state is the first that holds:
//
//   done         its branch origin/feature/*<module>-<wave>-* is merged into origin/main (or, for a
//                wave named W<n> with no such branch, every ticket has <module>/test-cases/<NN>-* on main)
//   in-progress  that branch exists and isn't merged
//   blocked      a wave it depends on isn't done
//   questions    the spec repository has an unmerged origin/plan/*<module>-<wave>-* branch, or a
//                modules/*/<module>/questions/v*-otazky-implementacny-plan-<wave>.md on main whose
//                frontmatter stav is neither zodpovedane nor premietnute
//   ready        none of these: a developer can take it
//
// Usage: node roadmap-waves.mjs [--code <dir>] [--spec <dir>] [--no-fetch] [--include questions,blocked]
// --code defaults to the current directory (the floor's checkout), --spec to a sibling
// eranet3-specification or specification folder. Ready, in-progress and done waves are listed;
// --include adds the others. It only reads: git fetch updates the remote-tracking branches, nothing else.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const code = path.resolve(option('--code') ?? process.cwd());
const spec = path.resolve(option('--spec') ?? ['eranet3-specification', 'specification'].map((d) => path.join(code, '..', d)).find((d) => existsSync(d)) ?? fail('No --spec given, and no specification folder next to the code'));
const shown = new Set(['ready', 'in-progress', 'done', ...(option('--include') ?? '').split(',').filter(Boolean)]);

function fail(why) {
  process.stderr.write(`${why}\n`);
  process.exit(1);
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();
const lines = (s) => (s ? s.split('\n') : []);

if (!flag('--no-fetch')) for (const dir of [code, spec]) git(dir, 'fetch', '--prune', '--quiet', 'origin');

const codeFiles = lines(git(code, 'ls-tree', '-r', '--name-only', 'origin/main'));
const specFiles = lines(git(spec, 'ls-tree', '-r', '--name-only', 'origin/main'));
const branches = (dir, prefix) => lines(git(dir, 'for-each-ref', '--format=%(refname:short)', `refs/remotes/origin/${prefix}/`));
const merged = (dir, prefix) => new Set(lines(git(dir, 'for-each-ref', '--merged', 'origin/main', '--format=%(refname:short)', `refs/remotes/origin/${prefix}/`)));
const features = branches(code, 'feature');
const featuresMerged = merged(code, 'feature');
const plans = branches(spec, 'plan');
const plansMerged = merged(spec, 'plan');

/** The page of a file on main, on the code repository's host. */
const pageOf = (() => {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(git(code, 'remote', 'get-url', 'origin'));
  if (!m) return () => '';
  const base = `https://${m[1]}/${m[2]}`;
  return (file) => (m[1] === 'bitbucket.org' ? `${base}/src/main/${file}` : `${base}/blob/main/${file}`);
})();

/** The newest roadmap of each module that has a waves table. */
function roadmaps() {
  const newest = new Map();
  for (const f of codeFiles) {
    const m = /^docs\/plans\/([^/]+)\/(\d{4}-\d{2}-\d{2})-roadmap\.md$/.exec(f);
    if (m && (!newest.has(m[1]) || newest.get(m[1]) < f)) newest.set(m[1], f);
  }
  const out = [];
  for (const [dir, file] of [...newest].sort()) {
    const text = git(code, 'show', `origin/main:${file}`);
    const table = /<!-- waves:start -->([\s\S]*?)<!-- waves:end -->/.exec(text);
    if (!table) continue;
    const heading = /^# (.*)$/m.exec(text)?.[1] ?? dir;
    const service = /\bI-(\d+)\b/.exec(heading)?.[1];
    const slug = /`([a-z0-9-]+)`/.exec(heading)?.[1] ?? dir;
    out.push({ file, slug, name: service ? `I-${service}` : slug, prefix: service ? `I${service}` : slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20), waves: wavesOf(table[1]) });
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
  return body.map((r) => ({ id: col(r, 'Wave'), deps: list(col(r, 'Depends on')), tickets: list(col(r, 'Tickets')), req: col(r, 'REQ'), scope: col(r, 'Scope'), description: col(r, 'Description') }));
}

/** stav: from a Markdown file's frontmatter on the spec repository's main. */
function stavOf(file) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(git(spec, 'show', `origin/main:${file}`))?.[1] ?? '';
  return /^stav:\s*(\S+)/m.exec(fm)?.[1] ?? '';
}

function stateOf(module, wave, memo) {
  const key = wave.id;
  if (memo.has(key)) return memo.get(key);
  memo.set(key, { state: 'blocked' });
  const w = wave.id.toLowerCase();
  const own = (name, prefix) => name.startsWith(`origin/${prefix}/`) && name.includes(`${module.slug}-${w}-`);
  const branch = features.find((b) => own(b, 'feature') && featuresMerged.has(b)) ?? features.find((b) => own(b, 'feature'));
  const questions = specFiles.filter((f) => {
    const m = /^modules\/[^/]+\/([^/]+)\/questions\/v[^/]*-otazky-implementacny-plan-([^/]+)\.md$/.exec(f);
    return m?.[1] === module.slug && m[2] === w;
  });
  const open = questions.filter((f) => !['zodpovedane', 'premietnute'].includes(stavOf(f)));
  const plan = plans.find((b) => own(b, 'plan') && !plansMerged.has(b));
  const tested = (nn) => codeFiles.some((f) => f.includes(`${module.slug}/test-cases/${nn}-`));
  let result;
  if (branch && featuresMerged.has(branch)) result = { state: 'done', branch };
  else if (branch) result = { state: 'in-progress', branch };
  else if (/^W\d+$/i.test(wave.id) && wave.tickets.length && wave.tickets.every(tested)) result = { state: 'done' };
  else if (wave.deps.some((d) => stateOf(module, module.waves.find((x) => x.id === d) ?? { id: d, deps: [], tickets: [] }, memo).state !== 'done')) result = { state: 'blocked' };
  else if (plan || open.length) result = { state: 'questions', plan, questions: open };
  else result = { state: 'ready', answered: questions.length > 0, questions };
  memo.set(key, result);
  return result;
}

const COLORS = { ready: '#2da44e', 'in-progress': '#bf8700', done: '#8250df', blocked: '#cf222e', questions: '#0969da' };

const issues = [];
for (const module of roadmaps()) {
  const memo = new Map();
  for (const wave of module.waves) {
    if (!wave.id) continue;
    const s = stateOf(module, wave, memo);
    if (!shown.has(s.state)) continue;
    const tip = s.branch && git(code, 'log', '-1', '--format=%an%x09%cI', s.branch).split('\t');
    const updated = tip?.[1] ?? git(code, 'log', '-1', '--format=%cI', 'origin/main', '--', module.file);
    const labels = [{ name: s.state, color: COLORS[s.state] }, { name: module.slug, color: '#6e7781' }];
    if (s.state === 'ready') labels.push(s.answered ? { name: 'otázky premietnuté', color: '#1a7f37' } : { name: 'bez prepare-wave', color: '#9a6700' });
    if (wave.scope) labels.push({ name: wave.scope, color: '#57606a' });
    const body = [
      `**${module.name} ${wave.id}** · ${wave.description}`,
      '',
      `- Tickets: ${wave.tickets.join(', ') || '-'}`,
      `- Depends on: ${wave.deps.join(', ') || '-'}`,
      `- Scope: ${wave.scope || '-'}`,
      `- REQ: ${wave.req || '-'}`,
      `- Roadmap: \`${module.file}\``,
      ...(s.branch ? [`- Branch: \`${s.branch.replace(/^origin\//, '')}\``] : []),
      ...(s.plan ? [`- Questions waiting on: \`${s.plan.replace(/^origin\//, '')}\` (spec)`] : []),
      ...(s.questions ?? []).map((f) => `- Questions: \`${f}\` (${stavOf(f)})`),
    ].join('\n');
    issues.push({
      key: `${module.prefix}-${wave.id.toUpperCase()}`,
      ref: `${module.name} ${wave.id}`,
      title: `${module.name} ${wave.id}: ${wave.description}`,
      state: s.state === 'done' ? 'closed' : 'open',
      url: pageOf(module.file),
      author: module.slug,
      labels,
      assignees: s.state === 'in-progress' && tip ? [tip[0]] : [],
      createdAt: updated,
      updatedAt: updated,
      body,
      prompt: `Take wave ${wave.id} of the module \`${module.slug}\` (roadmap \`${module.file}\`, tickets ${wave.tickets.join(', ') || '-'}): load the implement-feature skill and start with its Phase 0.`,
    });
  }
}

process.stdout.write(JSON.stringify({ issues }, null, 2));
