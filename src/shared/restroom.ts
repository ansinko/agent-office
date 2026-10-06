// The restroom (RESTROOM in layout.ts): who may talk to the hajzel baba at her table there. The server
// holds everyone else to it (server/restroom.ts), and the page asks it before offering her.

import { SEATING_BY_ID, seatAt } from './layout.js';
import type { WorkerStatus } from './protocol.js';

/** The hajzel baba's place (see STATIONS). */
export const RESTROOM_DESK = 'station-restroom';

/** Whether a peer's `seat` (a SeatPlace key, like "toilet:0") is the restroom's toilet. */
export function onToilet(seat: string | undefined): boolean {
  const place = seat ? seatAt(seat) : undefined;
  return !!place && !!SEATING_BY_ID.get(place.seatId)?.restroom;
}

/** The hajzel baba is hired and her process is up (or asleep since a restart): getting off the toilet ends her brainstorm. */
export function brainstorming(status: WorkerStatus | undefined): boolean {
  return !!status && status !== 'exited';
}

/** What E does on the toilet: says the floor has no repo for ideas, asks for one, or opens her terminal. */
export type ToiletUse = 'no-repo' | 'ask' | 'terminal';

/** What E on the toilet does, on a floor with GitHub repository `repo` (if any), with her worker's `status` (if hired). */
export function toiletUse(repo: string | undefined, status: WorkerStatus | undefined): ToiletUse {
  if (!repo) return 'no-repo';
  return brainstorming(status) ? 'terminal' : 'ask';
}
