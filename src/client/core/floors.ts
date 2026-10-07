/** The building's floors as the office and its parts see them: which are built, and their back offices. */
import { FLOOR, WING, inWing } from '../../shared/layout';
import type { FloorInfo } from '../../shared/protocol';
import { store } from '../state';

/** The floors of the building from the bottom up (not the ones still being cloned: nobody can go there yet). */
export function builtFloors(): FloorInfo[] {
  return store.floors.filter((f) => !f.cloning);
}

/** How far each floor's back office goes, for the building's outside: every one has its restroom. */
export function floorWings(floors: FloorInfo[]): number[] {
  return floors.map(() => WING.rows);
}

/**
 * Standing where a back office would be, further back than this floor's goes (`level` rows): a row
 * walled up round you, or a floor you switched to that isn't built out as far as the one you left.
 */
export function pastTheWing(p: { x: number; y: number; z: number }, level: number): boolean {
  return p.y > -1 && p.y < 3 && p.x > WING.minX - 0.3 && p.x < WING.maxX + 0.3 && p.z < FLOOR.minZ && !inWing(p.x, p.z, level);
}
