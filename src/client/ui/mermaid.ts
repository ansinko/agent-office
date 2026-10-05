import type { Mermaid } from 'mermaid';

// ```mermaid blocks in a project's Markdown, drawn as the diagrams GitHub shows. Mermaid is big, so
// it's only fetched the first time a doc has one. Its strict mode escapes labels and drops click
// handlers, since anyone who can commit to the project writes these.

let loading: Promise<Mermaid> | null = null;
let drawn = 0;

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
    return mermaid;
  });
  return loading;
}

/** A click flips a wide diagram, shrunk to fit the page, to its own size to scroll along, and back. */
function fullSize(fig: HTMLElement) {
  const svg = fig.querySelector('svg');
  const natural = svg?.style.maxWidth;
  if (!svg || !natural) return;
  fig.title = 'Click for full size';
  fig.addEventListener('click', () => {
    const full = fig.classList.toggle('full');
    svg.style.maxWidth = full ? 'none' : natural;
    svg.style.width = full ? natural : '';
    fig.title = full ? 'Click to fit the page' : 'Click for full size';
  });
}

/** Turns the ```mermaid code blocks in `root` into diagrams. One that won't parse stays as its code. */
export async function drawDiagrams(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  if (!blocks.length) return;
  let mermaid: Mermaid;
  try {
    mermaid = await load();
  } catch {
    loading = null;
    return;
  }
  for (const code of blocks) {
    const pre = code.parentElement!;
    const id = `mermaid-${++drawn}`;
    try {
      const { svg } = await mermaid.render(id, code.textContent ?? '');
      const fig = document.createElement('div');
      fig.className = 'mermaid-diagram';
      fig.innerHTML = svg;
      fullSize(fig);
      pre.replaceWith(fig);
    } catch (err) {
      // Mermaid leaves its scratch element behind in <body> when a diagram fails.
      document.getElementById(`d${id}`)?.remove();
      pre.title = `This diagram couldn't be drawn: ${(err as Error).message}`;
      pre.classList.add('mermaid-failed');
    }
  }
}
