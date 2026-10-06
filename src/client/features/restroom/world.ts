import * as THREE from 'three';
import { RESTROOM, STATIONS, WALL_HEIGHT } from '../../../shared/layout';
import { RESTROOM_DESK } from '../../../shared/restroom';
import { mesh, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { box, type Looks } from '../../world/office/materials';
import { pendant } from '../../world/office/props';
import type { Door } from '../../world/office/shell';
import { buildCubicle } from './cubicle';
import { attendantTable, sink } from './fittings';

// The restroom in the back office (RESTROOM in shared/layout.ts; its walls, floor and ceiling are the
// wing's, world/office/wing.ts): the wall to the room with its door and the WC sign, tiles, a lamp,
// the hajzel baba's table, the cubicle with the toilet, and the sink.

/** How high the tiles go up the walls. */
const TILES_UP = 1.5;

/** White tiles with grey grout, `n` to a side of the texture. */
function tileTexture(color: string, grout: string, n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = grout;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = color;
  const step = 128 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) g.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A `w` by `h` plane facing +z, its texture repeated every `size` meters. */
function tiled(w: number, h: number, size: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * w) / size, (uv.getY(k) * h) / size);
  return geo;
}

/**
 * The wall between the room and the restroom, where the old north wall was: painted like the room's
 * on both sides, with a doorway at RESTROOM.door, a door that swings in, and the WC sign over it.
 */
function frontWall(looks: Looks): { group: THREE.Group; colliders: Collider[]; door: Door } {
  const { door: d, minX, maxX, maxZ, wall: T } = RESTROOM;
  const group = new THREE.Group();
  const z = maxZ - T / 2;
  const left = d.x - d.width / 2;
  const right = d.x + d.width / 2;
  const piece = (x0: number, x1: number, y0: number, y1: number) => {
    const m = mesh(box(x1 - x0, y1 - y0, T), looks.wall, (x0 + x1) / 2, (y0 + y1) / 2, z);
    m.receiveShadow = true;
    m.userData.wall = true;
    group.add(m);
  };
  piece(minX, left, 0, WALL_HEIGHT);
  piece(right, maxX, 0, WALL_HEIGHT);
  piece(left, right, d.height, WALL_HEIGHT);
  for (const [x0, x1] of [
    [minX, left],
    [right, maxX],
  ]) {
    group.add(mesh(box(x1 - x0, 0.25, T + 0.04), looks.trim, (x0 + x1) / 2, 0.125, z, false));
  }
  // The frame round the doorway.
  const frame = toon('#fffaf3');
  const F = 0.07;
  for (const x of [left + F / 2, right - F / 2]) group.add(mesh(box(F, d.height, T + 0.04), frame, x, d.height / 2, z, false));
  group.add(mesh(box(d.width, F, T + 0.04), frame, d.x, d.height - F / 2, z, false));

  // The door: hinged on the west post at the restroom's side, it swings in.
  const leafW = d.width - 2 * F - 0.02;
  const hinge = new THREE.Group();
  hinge.position.set(left + F + 0.01, 0, maxZ - T + 0.04);
  hinge.add(mesh(box(leafW, d.height - F - 0.02, 0.05), toon('#e9f5f2'), leafW / 2, (d.height - F) / 2, 0));
  hinge.add(mesh(box(0.05, 0.05, 0.14), toon('#c9d1d9'), leafW - 0.12, 1.0, 0, false));
  group.add(hinge);
  const door: Door = { x: d.x, y: 0, z, open: 0, show: (k) => (hinge.rotation.y = 1.6 * k * k * (3 - 2 * k)) };

  // The sign over the doorway, facing the room.
  const sign = textPlane('🚻 WC', { bg: '#1d3557', color: '#ffffff', size: 64, border: '#ffffff' });
  sign.scale.multiplyScalar(0.6);
  sign.position.set(d.x, d.height + 0.4, maxZ + 0.012);
  group.add(sign);

  const colliders: Collider[] = [
    { minX, maxX: left, minZ: maxZ - T, maxZ, top: 99 },
    { minX: right, maxX, minZ: maxZ - T, maxZ, top: 99 },
    { minX: left, maxX: right, minZ: maxZ - T, maxZ, bottom: d.height, top: 99 },
  ];
  return { group, colliders, door };
}

/** Tiles up the restroom's walls and across its floor. */
function tiling(): THREE.Group {
  const { minX, maxX, minZ, maxZ, wall: T, door: d } = RESTROOM;
  const group = new THREE.Group();
  const wallMat = toon('#ffffff');
  wallMat.map = tileTexture('#e6f4f1', '#b9c9c6', 4);
  const floorMat = toon('#ffffff');
  floorMat.map = tileTexture('#dfe6ea', '#9aa7ae', 2);
  floorMat.polygonOffset = true;
  floorMat.polygonOffsetFactor = -1;
  const inner = maxZ - T;
  const y0 = 0.25;
  const h = TILES_UP - y0;
  const y = y0 + h / 2;
  const e = 0.006;
  const add = (geo: THREE.BufferGeometry, x: number, z: number) => group.add(mesh(geo, wallMat, x, y, z, false));
  add(tiled(inner - minZ, h, 0.6).rotateY(Math.PI / 2), minX + e, (minZ + inner) / 2);
  add(tiled(inner - minZ, h, 0.6).rotateY(-Math.PI / 2), maxX - e, (minZ + inner) / 2);
  add(tiled(maxX - minX, h, 0.6), (minX + maxX) / 2, minZ + e);
  for (const [x0, x1] of [
    [minX, d.x - d.width / 2],
    [d.x + d.width / 2, maxX],
  ]) {
    add(tiled(x1 - x0, h, 0.6).rotateY(Math.PI), (x0 + x1) / 2, inner - e);
  }
  const floor = mesh(tiled(maxX - minX, inner - minZ, 0.8).rotateX(-Math.PI / 2), floorMat, (minX + maxX) / 2, 0.004, (minZ + inner) / 2, false);
  floor.receiveShadow = true;
  group.add(floor);
  return group;
}

/** The restroom as features/restroom/index.ts reaches it. */
export interface Restroom {
  /** Someone sits on the toilet: the cubicle's sign goes red and its door stays shut. */
  setOccupied(on: boolean): void;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The restroom in the back office. */
    restroom: Restroom;
  }
}

/** The restroom, built into the back office; put away with it where there's none (the wing's level 0). */
export const restroom: Fixture<'restroom'> = (site) => {
  const wing = site.get('wing');
  const night = site.get('night');
  const root = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];

  const front = frontWall(site.looks);
  root.add(front.group, tiling());
  colliders.push(...front.colliders);
  site.doors.push(front.door);

  const def = STATIONS.find((s) => s.id === RESTROOM_DESK)!;
  const table = attendantTable(def);
  root.add(table.view.group);
  colliders.push(...table.colliders);
  site.desks.set(def.id, table.view);

  const cubicle = buildCubicle();
  root.add(cubicle.group);
  colliders.push(...cubicle.colliders);
  interactables.push(...cubicle.interactables);
  site.doors.push(cubicle.door);

  const basin = sink();
  root.add(basin.group);
  colliders.push(basin.collider);

  // A lamp over the middle, and its glow at night.
  const lampY = 3.3;
  const lamp = pendant(WALL_HEIGHT - lampY);
  const lampX = (RESTROOM.minX + RESTROOM.cubicle.minX) / 2 + 0.3;
  const lampZ = (RESTROOM.minZ + RESTROOM.maxZ) / 2;
  lamp.position.set(lampX, lampY, lampZ);
  root.add(lamp);
  night.halos.push({ at: new THREE.Vector3(lampX, lampY - 0.12, lampZ), size: 1.1, color: '#ffe08a' });

  // Put away with the back office, and out again when it's built.
  let shown = false;
  let occupied = false;
  const show = (on: boolean) => {
    shown = root.visible = on;
    for (const it of interactables) it.off = !on;
    for (const c of occupied ? [...colliders, cubicle.shut] : colliders) {
      const i = site.colliders.indexOf(c);
      if (on && i < 0) site.colliders.push(c);
      else if (!on && i >= 0) site.colliders.splice(i, 1);
    }
  };
  show(true);
  const setOccupied = (on: boolean) => {
    if (on === occupied) return;
    occupied = on;
    cubicle.setOccupied(on);
    const i = site.colliders.indexOf(cubicle.shut);
    if (on && shown && i < 0) site.colliders.push(cubicle.shut);
    else if (!on && i >= 0) site.colliders.splice(i, 1);
  };

  return {
    group: root,
    interactables,
    handle: { restroom: { setOccupied } },
    update: () => {
      if (wing.level > 0 !== shown) show(wing.level > 0);
    },
  };
};
