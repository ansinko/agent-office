import type { Issue, IssueFile } from '../../../shared/protocol';
import { h } from '../dom';
import { markdownFile } from '../markdown';
import { getText } from './api';
import { errorBox, spinnerRow } from './pieces';

// ---- An issue's files ------------------------------------------------------------------------------
// A tracker can hand an issue files that go with it (a command tracker's questions, tickets and
// scenarios). The issue window swaps its conversation for their list, and for one of them rendered.

/** A file's frontmatter as a YAML block at its top, so the fields read as fields rather than a rule and a paragraph. */
export function withFrontmatter(src: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  return m ? `\`\`\`yaml\n${m[1]}\n\`\`\`\n\n${src.slice(m[0].length)}` : src;
}

/**
 * The 📄 Files… button for the issue window's footer, and what it shows in `conv` in place of `card`
 * (the conversation) until ↩ takes it back. It hides itself for an issue with no files.
 */
export function issueFiles(get: () => Issue, conv: HTMLElement, card: HTMLElement) {
  let generation = 0;
  const back = () => h('button.btn', { type: 'button', onclick: () => ((generation++, conv.replaceChildren(card)), conv.scrollTo(0, 0)) }, '↩ Back to the card');
  const show = (...children: (Node | string)[]) => {
    conv.replaceChildren(h('div.gh-col', {}, ...children));
    conv.scrollTo(0, 0);
  };
  const list = () => {
    generation++;
    const it = get();
    show(
      h('div.gh-file-bar', {}, h('b.grow', {}, `📄 Files for ${it.ref}`), back()),
      ...(it.files ?? []).map((f) => h('button.btn.gh-file', { type: 'button', onclick: () => open(f) }, f.title)),
    );
  };
  const open = (f: IssueFile) => {
    const g = ++generation;
    const bar = h('div.gh-file-bar', {}, h('b.grow', {}, f.title), f.url ? h('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗') : null, h('button.btn', { type: 'button', onclick: list }, '📄 Files'), back());
    const body = h('div', {}, spinnerRow('Loading…'));
    show(bar, body);
    getText(`/api/board/issue/file?key=${encodeURIComponent(get().key)}&id=${encodeURIComponent(f.id)}`)
      .then((text) => g === generation && body.replaceChildren(markdownFile(withFrontmatter(text))))
      .catch((err) => g === generation && body.replaceChildren(errorBox((err as Error).message, () => open(f))));
  };
  const button = h('button.btn', { type: 'button', title: 'Read the files that go with it: questions, tickets, scenarios', onclick: list }, '📄 Files…');
  return {
    button,
    /** Shows the button only while the issue has files. */
    refresh: () => button.classList.toggle('hidden', !get().files?.length),
  };
}
