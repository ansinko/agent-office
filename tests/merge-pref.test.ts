import { test } from 'node:test';
import assert from 'node:assert/strict';

// prefs.ts reads what this browser stored; stand localStorage in before it loads.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

const { MERGE_KEY, mergePref } = await import('../src/client/ui/board-windows/prefs.js');

test('a stored squash preference still picks squash from a list of choices', () => {
  localStorage.setItem(MERGE_KEY, JSON.stringify({ method: 'squash', deleteBranch: false }));
  assert.equal(mergePref([{ id: 'merge', label: 'm' }, { id: 'squash', label: 's' }]), 'squash');
  assert.equal(mergePref([{ id: 'merge', label: 'm' }]), 'merge');
});
