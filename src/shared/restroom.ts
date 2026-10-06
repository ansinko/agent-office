// The restroom (RESTROOM in layout.ts): who may talk to the hajzel baba at her table there. The server
// holds everyone else to it (server/restroom.ts), and the page asks it before offering her.

import { SEATING_BY_ID, seatAt } from './layout.js';

/** The hajzel baba's place (see STATIONS). */
export const RESTROOM_DESK = 'station-restroom';

/** Whether a peer's `seat` (a SeatPlace key, like "toilet:0") is the restroom's toilet. */
export function onToilet(seat: string | undefined): boolean {
  const place = seat ? seatAt(seat) : undefined;
  return !!place && !!SEATING_BY_ID.get(place.seatId)?.restroom;
}
