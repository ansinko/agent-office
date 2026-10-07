// What the office's own agents are told when they're hired: the agents standing by the Issues board,
// the PR board and the task queue, and the hajzel baba in the restroom (STATIONS in shared/layout.ts).
// Whoever walks up (or sits on the toilet) types them a request; the first one follows this brief in
// the same prompt. The briefs themselves are prompts the office can rewrite in ⚙️ Settings
// (shared/prompts.ts).

import type { StationKind } from '../shared/layout.js';
import { officePrompt, type PromptSource } from './prompts.js';

/** The brief for `kind`, with `repo` (owner/name of the floor's repository) filled in where it asks for it. */
export function stationBrief(kind: StationKind, prompts?: PromptSource, repo?: string): string {
  return officePrompt(prompts, `station.${kind}`, { repo });
}

/** Claude Code tools the queue agent and the hajzel baba are launched without, so they can't edit the checkout even by mistake. */
export const QUEUE_AGENT_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** The stations whose agent only reads the checkout: launched without QUEUE_AGENT_DISALLOWED_TOOLS. */
export const READ_ONLY_STATIONS: ReadonlySet<StationKind> = new Set(['queue', 'restroom']);
