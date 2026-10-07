import { onToilet } from '../../../shared/restroom';

/** Someone in the office as the occupied sign sees them: who, which floor, and what they sit on. */
export interface Sitter {
  id: string;
  floor?: string | null;
  seat?: string;
}

/**
 * Whether the toilet on `floor` is taken: by you (`mine`, your own seat, which the page knows before
 * the office echoes it back) or by anyone else on that floor.
 */
export function toiletTaken(peers: Iterable<Sitter>, floor: string | null, you: string | null, mine: string | undefined): boolean {
  if (onToilet(mine)) return true;
  for (const p of peers) if (p.id !== you && (p.floor ?? null) === floor && onToilet(p.seat)) return true;
  return false;
}
