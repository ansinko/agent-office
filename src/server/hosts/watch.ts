// What a floor keeps track of on its boards, whatever the host: pull requests merging, and issues
// workers have just taken.
import type { GhIssue, GhPull } from '../../shared/protocol.js';

/**
 * Spots pull requests that merged between two looks at the list, so the gong rings however they
 * merged: from the PR window, by a worker's own merge command, by auto-merge, or on the host itself.
 */
export class MergeWatch {
  /** Open at the last look; unset until the first, so starting the office up rings for nothing. */
  private open?: Set<number>;
  /** Rang for already (merged from the PR window), so the next look doesn't ring them again. */
  private rang = new Set<number>();

  /** The gong rings for `n`: false if it already has. */
  ring(n: number): boolean {
    if (this.rang.has(n)) return false;
    this.rang.add(n);
    return true;
  }

  /** A fresh list from the host: the pull requests that merged since the last look and haven't rung yet. */
  look(pulls: GhPull[]): GhPull[] {
    const open = this.open;
    const merged = open ? pulls.filter((p) => p.state === 'merged' && open.has(p.number) && !this.rang.has(p.number)) : [];
    // Once the host says it merged, it never shows as open again to ring twice.
    for (const p of pulls) if (p.state === 'merged') this.rang.delete(p.number);
    this.open = new Set(pulls.filter((p) => p.state === 'open' || p.state === 'draft').map((p) => p.number));
    return merged;
  }
}

/**
 * The issues workers just took. Assigning one on the tracker and listing the issues again takes
 * seconds, so each is marked `taken` on the board from the moment it's handed over until a list has
 * its assignee.
 */
export class Claims {
  /** By issue key: when the tracker had it assigned (Infinity until it answers). */
  private claimed = new Map<string, { at: number }>();

  /** A worker took issue `n`. Call what it returns once the tracker has answered, with whether it's assigned now. */
  take(n: string): (assigned: boolean, now?: number) => void {
    const claim = { at: Infinity };
    this.claimed.set(n, claim);
    return (assigned, now = Date.now()) => {
      if (assigned) claim.at = now;
      // Unless someone handed it over again meanwhile, and the tracker hasn't answered them yet.
      else if (this.claimed.get(n) === claim) this.claimed.delete(n);
    };
  }

  has(n: string): boolean {
    return this.claimed.has(n);
  }

  /**
   * `items` with the taken ones marked. A list asked for (`asked`) before an issue was assigned doesn't
   * have its assignee yet, so it stays marked over it; one asked for after is believed, and the claim forgotten.
   */
  mark(items: GhIssue[], asked = 0): GhIssue[] {
    for (const [n, claim] of this.claimed) if (claim.at < asked) this.claimed.delete(n);
    return items.map(({ taken, ...it }) => (this.claimed.has(it.key) ? { ...it, taken: true } : it));
  }
}
