// The floor's own issue tracker, when its .agent-office/tracker.json names one: it takes the place of
// its host's issues.
import type { BoardState, Issue } from '../../../shared/protocol.js';
import { emptyTracker } from '../none.js';
import type { Tracker } from '../types.js';
import { CommandTracker, commandConfig } from './tracker.js';

/** The floor's command tracker and what it's called, or undefined when it has no tracker.json. */
export function commandTracker(dir: string, dataDir: string, onIssues: (s: BoardState<Issue>) => void): { tracker: Tracker; name: string } | undefined {
  let config;
  try {
    config = commandConfig(dataDir);
  } catch (err) {
    return { tracker: emptyTracker(`The floor's tracker.json is wrong: ${(err as Error).message}`), name: 'tracker.json' };
  }
  return config && { tracker: new CommandTracker(dir, config, onIssues), name: config.name };
}
