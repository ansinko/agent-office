import type { Choice } from '../../../shared/protocol';

// What the windows remember in this browser: how you last merged, the Files tab's layout, which tab
// you were on, and the comment you were writing.

export function pref<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage blocked
  }
}

export const MERGE_KEY = 'agent-office.merge';
export const FILES_KEY = 'agent-office.pr-files';
export const TAB_KEY = 'agent-office.pr-tab';
/** Followed by the issue or PR's URL: the comment you were writing there. */
export const DRAFT_KEY = 'agent-office.comment:';

interface MergePref {
  method?: string;
  deleteBranch?: boolean;
}

/** The merge method you last picked when the repository offers it, else its first; before its list loads, the last you picked. */
export function mergePref(methods: Choice[]): string {
  const { method } = pref<MergePref>(MERGE_KEY, {});
  if (!methods.length) return method ?? 'squash';
  return methods.some((m) => m.id === method) ? method! : methods[0].id;
}

/** Whether you last left "delete the branch" ticked when merging. */
export const deleteBranchPref = () => pref<MergePref>(MERGE_KEY, {}).deleteBranch ?? true;
