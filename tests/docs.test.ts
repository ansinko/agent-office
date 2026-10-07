import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Docs, docTitle } from '../src/server/docs.js';
import { globMatch, isDocPath, parseShelfConfig, resolveDocLink, type DocList } from '../src/shared/docs.js';

/** A folder with some Markdown in it, and whatever `git` makes of it. */
function fixture(t: { after(fn: () => void): void }, git: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'proj');
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  put('README.md', '# Agent Office\n\nHello.\n');
  put('docs/setup.markdown', '---\ntitle: "Getting set up"\n---\n\n# Not this one\n');
  put('docs/API.MD', 'Some intro\n\nThe API\n=======\n');
  put('src/index.ts', 'export {};\n');
  put('node_modules/dep/README.md', '# a dependency\n');
  put('.agent-office/meetings/notes.md', '# office notes\n');
  put('ignored/secret.md', '# ignored\n');
  put('pic.png', 'not really a png');
  writeFileSync(path.join(root, 'outside.md'), '# outside\n');
  if (git) {
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    put('.gitignore', 'node_modules\nignored\n.agent-office/\n');
    g('add', 'README.md', 'docs', 'src', '.gitignore');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    // New and not ignored: still the project's.
    put('NOTES.md', 'no heading here\n');
  }
  return { root, dir, docs: new Docs(dir) };
}

test('the shelf is every Markdown file git counts as the project, with its title', async (t) => {
  const { docs } = fixture(t, true);
  const { files, more } = listed(await docs.list());
  assert.equal(more, false);
  assert.deepEqual(
    files.map((f) => [f.path, f.title]),
    [
      ['docs/API.MD', 'The API'],
      ['docs/setup.markdown', 'Getting set up'],
      ['NOTES.md', undefined],
      ['README.md', 'Agent Office'],
    ],
  );
  assert.ok(files.every((f) => f.size > 0 && f.mtime > 0));
});

test('without git, the shelf walks the folder, skipping hidden and dependency folders', async (t) => {
  const { docs } = fixture(t, false);
  const { files } = listed(await docs.list());
  assert.deepEqual(files.map((f) => f.path).sort(), ['docs/API.MD', 'docs/setup.markdown', 'ignored/secret.md', 'README.md'].sort());
});

test('only Markdown inside the project can be read, not through .. or a link out of it', async (t) => {
  const { root, dir, docs } = fixture(t, true);
  const ok = await docs.read('docs/setup.markdown');
  assert.ok('text' in ok && ok.text.includes('Getting set up'));
  for (const bad of ['src/index.ts', '../outside.md', path.join(root, 'outside.md'), 'missing.md', 'docs']) {
    const r = await docs.read(bad);
    assert.ok('error' in r, bad);
  }
  symlinkSync(root, path.join(dir, 'up'), 'junction');
  const r = await docs.read('up/outside.md');
  assert.ok('error' in r && r.status === 404);
  // Pictures the docs show: only pictures, only from the project.
  const pic = await docs.picture('pic.png');
  assert.ok('body' in pic && pic.type === 'image/png');
  assert.ok('error' in (await docs.picture('README.md')));
  assert.ok('error' in (await docs.picture('up/outside.md')));
});

test('a doc is titled by its front matter, else its first heading, whatever the style', () => {
  assert.equal(docTitle('# Hello *world*\n'), 'Hello world');
  assert.equal(docTitle('<p align="center"><img src="x.png"></p>\n<h1 align="center">Office</h1>\n'), 'Office');
  assert.equal(docTitle('```\n# not a heading\n```\n## Real one ##\n'), 'Real one');
  assert.equal(docTitle('Setext\n---\n'), 'Setext');
  assert.equal(docTitle('- a list item\n---\n'), undefined);
  assert.equal(docTitle('## [Linked](http://x) `code`\n'), 'Linked code');
  assert.equal(docTitle('just words\n'), undefined);
});

test('links in a doc resolve to paths in the project, and nowhere else', () => {
  assert.deepEqual(resolveDocLink('docs/a.md', '../README.md#setup'), { path: 'README.md', hash: 'setup' });
  assert.deepEqual(resolveDocLink('docs/a.md', './b.md'), { path: 'docs/b.md', hash: '' });
  assert.deepEqual(resolveDocLink('docs/a.md', '#usage'), { path: 'docs/a.md', hash: 'usage' });
  assert.deepEqual(resolveDocLink('docs/a.md', '/src/x%20y.ts?plain=1'), { path: 'src/x y.ts', hash: '' });
  for (const href of ['https://example.com/a.md', '//cdn/x.png', 'mailto:a@b.c', '../../etc/passwd', '..', '%E0%A4%A']) assert.equal(resolveDocLink('docs/a.md', href), undefined, href);
  assert.ok(isDocPath('a/b.MD') && isDocPath('x.markdown'));
  assert.ok(!isDocPath('a.mdx') && !isDocPath('../a.md') && !isDocPath('a/./b.md') && !isDocPath('md'));
});

test('bookshelf.json globs: ** crosses folders, * stays in one, a bare name matches at any depth', () => {
  assert.ok(globMatch('docs/plans/**', 'docs/plans/a/b.md'));
  assert.ok(globMatch('docs/plans/', 'docs/plans/x.md'));
  assert.ok(globMatch('**/test-cases/**', 'platform/svc/test-cases/01/a.md'));
  assert.ok(globMatch('**/test-cases/**', 'test-cases/a.md'));
  assert.ok(globMatch('CHANGELOG.md', 'pkg/CHANGELOG.md'));
  assert.ok(globMatch('docs/*.md', 'docs/a.md'));
  assert.ok(!globMatch('docs/*.md', 'docs/sub/a.md'));
  assert.ok(!globMatch('docs/plans/**', 'docs/plans.md'));
  assert.ok(!globMatch('a+b.md', 'aab.md'));
  assert.deepEqual(parseShelfConfig('{"start":"./docs/README.md","hide":["docs/plans/**", 3, ""]}'), { start: 'docs/README.md', hide: ['docs/plans/**'] });
  assert.deepEqual(parseShelfConfig('{"start":"../x.md"}'), { start: undefined, hide: [] });
  assert.deepEqual(parseShelfConfig('not json'), { start: undefined, hide: [] });
  assert.deepEqual(parseShelfConfig(undefined), { start: undefined, hide: [] });
});

/** A project cloned from an origin whose main has moved on since: the checkout is on a branch of its own. */
function cloned(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-docs-branch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' });
  const put = (dir: string, file: string, text: string | Buffer) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  mkdirSync(seed);
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(seed, 'init', '-q', '-b', 'main');
  put(seed, 'README.md', '# Project\n');
  put(seed, 'docs/README.md', '# Start here\n');
  put(seed, 'docs/plans/w1.md', '# Wave one\n');
  put(seed, 'docs/pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'docs');
  sh(seed, 'remote', 'add', 'origin', origin);
  sh(seed, 'push', '-q', 'origin', 'main');
  const dir = path.join(root, 'proj');
  sh(root, 'clone', '-q', origin, dir);
  sh(dir, 'checkout', '-q', '-b', 'feature/x');
  // The floor's own layout of the shelf: the office's data, never the project's.
  put(dir, '.agent-office/bookshelf.json', '{"start":"docs/README.md","hide":["docs/plans/**"]}');
  put(dir, 'docs/feature.md', '# Only on the feature branch\n');
  // Merged on origin after the clone: only a fetch brings it.
  put(seed, 'docs/merged.md', '# Merged since\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'more docs');
  sh(seed, 'push', '-q', 'origin', 'main');
  return { dir, docs: new Docs(dir) };
}

function listed(r: DocList | { error: string }): DocList {
  assert.ok(!('error' in r), 'error' in r ? r.error : '');
  return r as DocList;
}

test("the shelf reads origin's main as git has it, fetched, whatever the checkout is on", async (t) => {
  const { docs } = cloned(t);
  const here = listed(await docs.list());
  assert.deepEqual(here.sources, [
    { ref: '', label: 'This checkout · feature/x' },
    { ref: 'origin/main', label: 'main on origin' },
  ]);
  assert.ok(here.files.some((f) => f.path === 'docs/feature.md'));
  assert.equal(here.start, 'docs/README.md');
  assert.equal(here.files.find((f) => f.path === 'docs/plans/w1.md')?.hidden, true);
  assert.ok(!here.files.some((f) => f.path === 'docs/merged.md'));

  const main = listed(await docs.list('origin/main'));
  assert.equal(main.source, 'origin/main');
  assert.deepEqual(
    main.files.map((f) => [f.path, f.title, f.hidden ?? false]),
    [
      ['docs/merged.md', 'Merged since', false],
      ['docs/plans/w1.md', 'Wave one', true],
      ['docs/README.md', 'Start here', false],
      ['README.md', 'Project', false],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  assert.equal(main.start, 'docs/README.md');
  assert.ok(main.files.every((f) => f.size > 0 && f.mtime > 0));

  const doc = await docs.read('docs/merged.md', 'origin/main');
  assert.ok('text' in doc && doc.text === '# Merged since\n');
  assert.ok('error' in (await docs.read('docs/feature.md', 'origin/main')));
  const pic = await docs.picture('docs/pic.png', 'origin/main');
  assert.ok('body' in pic && pic.body.length === 4);
  assert.ok('error' in (await docs.picture('../outside.png', 'origin/main')));
});

test('the shelf reads only from the sources it offers, never a ref a request names', async (t) => {
  const { docs } = cloned(t);
  for (const ref of ['feature/x', 'origin/feature/x', 'HEAD~1', '--output=/tmp/x', 'main']) {
    const r = await docs.list(ref);
    assert.ok('error' in r && r.status === 404, ref);
    assert.ok('error' in (await docs.read('README.md', ref)), ref);
    assert.ok('error' in (await docs.picture('docs/pic.png', ref)), ref);
  }
});
