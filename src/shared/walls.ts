// The walls pictures hang on (see decor.ts): the main room's four, at the FLOOR bounds, and the
// restroom's four inside the back office (RESTROOM). Each wall belongs to a room, stands at a plane,
// faces into its room and says where along it and how high a picture fits (its zones).

import { FLOOR, LOFT, RESTROOM, WALL_HEIGHT } from './layout.js';
import { RESTROOM_WINDOW } from './restroom.js';

export type RoomId = 'room' | 'restroom';
export type WallId = 'north' | 'south' | 'east' | 'west' | 'wc-north' | 'wc-south' | 'wc-east' | 'wc-west';

/** A stretch of wall a picture can hang on: [u0, u1] along it, [y0, y1] up it. */
export interface Zone {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

export interface WallDef {
  room: RoomId;
  /** The axis u runs along: x for walls facing north or south, z for the ones facing east or west. */
  along: 'x' | 'z';
  /** Where the wall's face stands on the other axis (z for an `along: 'x'` wall, x otherwise). */
  plane: number;
  /** The way the face looks into its room, as a rotation around y (0 looks toward +z). */
  rotY: number;
  /** How far the wall runs along u. */
  min: number;
  max: number;
  /** Where pictures can hang; each one fits inside one zone. */
  zones: Zone[];
}

/** Underside of the loft's floor slab (see buildLoft in world/office/loft.ts). */
const LOFT_UNDERSIDE = LOFT.y - 0.25;

/** The restroom's floor plan: the room's side of it ends at the inside face of the wall to the room. */
export const RESTROOM_ROOM = { minX: RESTROOM.minX, maxX: RESTROOM.maxX, minZ: RESTROOM.minZ, maxZ: RESTROOM.maxZ - RESTROOM.wall } as const;

const R = RESTROOM_ROOM;
const H = WALL_HEIGHT;
const { cubicle, door, sink } = RESTROOM;
/** How far the cubicle's partitions stand off their line either side, and a little room over their tops. */
const PART = cubicle.wall / 2;
const OVER_PARTITION = cubicle.height + 0.05;
/** Above the toilet's cistern, inside the cubicle. */
const OVER_CISTERN = 0.95;
/** The sink, its mirror and the towel dispenser beside it, along the west wall (see sink() in features/restroom/fittings.ts). */
const SINK = { u0: sink.z - sink.width / 2 - 0.45, u1: sink.z + 0.42, top: 2.2 };
/** The window and its frame and sill on the east wall. */
const WINDOW = { u0: RESTROOM_WINDOW.u - RESTROOM_WINDOW.width / 2 - 0.12, u1: RESTROOM_WINDOW.u + RESTROOM_WINDOW.width / 2 + 0.12, y0: RESTROOM_WINDOW.y0 - 0.1, y1: RESTROOM_WINDOW.y1 + 0.08 };
/** The doorway in the wall to the room, with its frame. */
const DOOR = { u0: door.x - door.width / 2, u1: door.x + door.width / 2, top: door.height + 0.08 };

/**
 * Every wall. The loft fills the main room's south-east corner, so its south and east walls run on
 * under the loft's floor and again up inside it. In the restroom, the back wall goes on behind the
 * toilet inside the cubicle and over the partition's top, the side walls leave out the sink with its
 * mirror and the window, and the wall to the room leaves out the doorway.
 */
export const WALLS: Record<WallId, WallDef> = {
  north: { room: 'room', along: 'x', plane: FLOOR.minZ, rotY: 0, min: FLOOR.minX, max: FLOOR.maxX, zones: [{ u0: FLOOR.minX, u1: FLOOR.maxX, y0: 0, y1: H }] },
  south: {
    room: 'room',
    along: 'x',
    plane: FLOOR.maxZ,
    rotY: Math.PI,
    min: FLOOR.minX,
    max: FLOOR.maxX,
    zones: [
      { u0: FLOOR.minX, u1: FLOOR.maxX, y0: 0, y1: LOFT_UNDERSIDE },
      { u0: FLOOR.minX, u1: LOFT.minX, y0: 0, y1: H },
      { u0: LOFT.minX, u1: LOFT.maxX, y0: LOFT.y, y1: LOFT.y + LOFT.height },
    ],
  },
  west: { room: 'room', along: 'z', plane: FLOOR.minX, rotY: Math.PI / 2, min: FLOOR.minZ, max: FLOOR.maxZ, zones: [{ u0: FLOOR.minZ, u1: FLOOR.maxZ, y0: 0, y1: H }] },
  east: {
    room: 'room',
    along: 'z',
    plane: FLOOR.maxX,
    rotY: -Math.PI / 2,
    min: FLOOR.minZ,
    max: FLOOR.maxZ,
    zones: [
      { u0: FLOOR.minZ, u1: FLOOR.maxZ, y0: 0, y1: LOFT_UNDERSIDE },
      { u0: FLOOR.minZ, u1: LOFT.minZ, y0: 0, y1: H },
      { u0: LOFT.minZ, u1: LOFT.maxZ, y0: LOFT.y, y1: LOFT.y + LOFT.height },
    ],
  },
  'wc-north': {
    room: 'restroom',
    along: 'x',
    plane: R.minZ,
    rotY: 0,
    min: R.minX,
    max: R.maxX,
    zones: [
      { u0: R.minX, u1: cubicle.minX - PART, y0: 0, y1: H },
      { u0: cubicle.minX + PART, u1: R.maxX, y0: OVER_CISTERN, y1: H },
      { u0: R.minX, u1: R.maxX, y0: OVER_PARTITION, y1: H },
    ],
  },
  'wc-south': {
    room: 'restroom',
    along: 'x',
    plane: R.maxZ,
    rotY: Math.PI,
    min: R.minX,
    max: R.maxX,
    zones: [
      { u0: R.minX, u1: DOOR.u0, y0: 0, y1: H },
      { u0: DOOR.u1, u1: R.maxX, y0: 0, y1: H },
      { u0: R.minX, u1: R.maxX, y0: DOOR.top, y1: H },
    ],
  },
  'wc-west': {
    room: 'restroom',
    along: 'z',
    plane: R.minX,
    rotY: Math.PI / 2,
    min: R.minZ,
    max: R.maxZ,
    zones: [
      { u0: R.minZ, u1: SINK.u0, y0: 0, y1: H },
      { u0: SINK.u1, u1: R.maxZ, y0: 0, y1: H },
      { u0: R.minZ, u1: R.maxZ, y0: SINK.top, y1: H },
    ],
  },
  'wc-east': {
    room: 'restroom',
    along: 'z',
    plane: R.maxX,
    rotY: -Math.PI / 2,
    min: R.minZ,
    max: R.maxZ,
    zones: [
      { u0: R.minZ, u1: cubicle.maxZ - PART, y0: 0, y1: H },
      { u0: R.minZ, u1: WINDOW.u0, y0: OVER_PARTITION, y1: H },
      { u0: cubicle.maxZ + PART, u1: WINDOW.u0, y0: 0, y1: H },
      { u0: cubicle.maxZ + PART, u1: R.maxZ, y0: 0, y1: WINDOW.y0 },
      { u0: R.minZ, u1: R.maxZ, y0: WINDOW.y1, y1: H },
      { u0: WINDOW.u1, u1: R.maxZ, y0: 0, y1: H },
    ],
  },
};

export const WALL_IDS = Object.keys(WALLS) as WallId[];

/** The room (x, z) is in, or null outside both (in the doorway between them, say). */
export function roomAt(x: number, z: number): RoomId | null {
  if (x >= FLOOR.minX && x <= FLOOR.maxX && z >= FLOOR.minZ && z <= FLOOR.maxZ) return 'room';
  if (x >= R.minX && x <= R.maxX && z >= R.minZ && z <= R.maxZ) return 'restroom';
  return null;
}

/** How high the wall goes at u (inside the loft it goes past the ceiling downstairs). */
export function wallTop(wall: WallId, u: number): number {
  let top = 0;
  for (const z of WALLS[wall].zones) if (u >= z.u0 && u <= z.u1) top = Math.max(top, z.y1);
  return top;
}

/** The world point `out` meters in front of (u, y) on a wall, and the way the wall faces. */
export function wallPose(wall: WallId, u: number, y: number, out = 0): { x: number; y: number; z: number; rotY: number } {
  const w = WALLS[wall];
  // Out from the face, the way it looks.
  const nx = Math.round(Math.sin(w.rotY));
  const nz = Math.round(Math.cos(w.rotY));
  return w.along === 'x' ? { x: u, y, z: w.plane + nz * out, rotY: w.rotY } : { x: w.plane + nx * out, y, z: u, rotY: w.rotY };
}

/** Which of the main room's walls something facing `rotY` hangs on. */
export function wallFacing(rotY: number): WallId {
  const a = Math.atan2(Math.sin(rotY), Math.cos(rotY));
  if (Math.abs(a) < Math.PI / 4) return 'north';
  if (Math.abs(a) > (3 * Math.PI) / 4) return 'south';
  return a > 0 ? 'west' : 'east';
}

type Vec = { x: number; y: number; z: number };

/**
 * Where a ray first meets a wall of the room it starts in, within `maxDist` meters (the whole room by
 * default). From outside both rooms (the balcony, the street, the doorway) it meets none.
 */
export function aimAtWall(ray: { origin: Vec; direction: Vec }, maxDist = 60): { wall: WallId; u: number; y: number } | null {
  const o = ray.origin;
  const d = ray.direction;
  const room = o.y < 0 ? null : roomAt(o.x, o.z);
  if (!room) return null;
  // The loft's floor hides whatever is past it, from above or below.
  if (room === 'room' && d.y !== 0) {
    const t = (LOFT.y - 0.12 - o.y) / d.y;
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    if (t > 0 && x > LOFT.minX && x < LOFT.maxX && z > LOFT.minZ && z < LOFT.maxZ) maxDist = Math.min(maxDist, t);
  }
  let best: { wall: WallId; u: number; y: number } | null = null;
  let bestT = maxDist;
  for (const wall of WALL_IDS) {
    const w = WALLS[wall];
    if (w.room !== room) continue;
    // Only toward the face: its normal and the ray point opposite ways.
    const toward = w.along === 'x' ? d.z * Math.cos(w.rotY) : d.x * Math.sin(w.rotY);
    if (!(toward < -1e-9)) continue;
    const t = w.along === 'x' ? (w.plane - o.z) / d.z : (w.plane - o.x) / d.x;
    if (!(t > 0 && t < bestT)) continue;
    const y = o.y + d.y * t;
    const u = w.along === 'x' ? o.x + d.x * t : o.z + d.z * t;
    if (y < 0 || u < w.min || u > w.max || y > wallTop(wall, u)) continue;
    best = { wall, u, y };
    bestT = t;
  }
  return best;
}
