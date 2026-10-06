import * as THREE from 'three';
import { RESTROOM } from '../../../shared/layout';
import { mesh, roundedBox, textPlane, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import { box } from '../../world/office/materials';
import { seatable } from '../../world/office/seats';
import type { Door } from '../../world/office/shell';

// The cubicle in the restroom's north-east corner (RESTROOM.cubicle): two partitions on little feet,
// a door in the south one with an occupied/free sign on it, and the toilet against the back wall.

const PANEL = '#7fb7be';
const CHROME = '#c9d1d9';
const PORCELAIN = '#fbfbf8';
/** How far up off the floor the partitions and the door start. */
const GAP = 0.12;

export interface Cubicle {
  group: THREE.Group;
  /** The partitions, the toilet, and the door while it's locked shut. */
  colliders: Collider[];
  interactables: Interactable[];
  door: Door;
  /** The door's collider: in `colliders` only while someone sits on the toilet. */
  shut: Collider;
  /** Red and locked while someone sits on the toilet, green and swinging open for anyone otherwise. */
  setOccupied(on: boolean): void;
}

/** The sign on the door: a lamp and a word, red and OCCUPIED or green and FREE. */
function occupiedSign(): { group: THREE.Group; set(on: boolean): void } {
  const group = new THREE.Group();
  group.add(mesh(roundedBox(0.34, 0.12, 0.02, 0.02), toon('#2b2d42'), 0, 0, 0, false));
  const light = toonUnique('#2ec27e');
  light.emissive = new THREE.Color('#2ec27e');
  light.emissiveIntensity = 0.7;
  const dot = mesh(new THREE.CircleGeometry(0.035, 16), light, -0.11, 0, 0.012, false);
  group.add(dot);
  const words = { on: textPlane('OCCUPIED', { bg: '#2b2d42', color: '#ff6b6b', size: 40 }), off: textPlane('FREE', { bg: '#2b2d42', color: '#7cf29a', size: 40 }) };
  for (const w of [words.on, words.off]) {
    w.scale.multiplyScalar(0.28);
    w.position.set(0.045, 0, 0.012);
    group.add(w);
  }
  const set = (on: boolean) => {
    const c = on ? '#ef233c' : '#2ec27e';
    light.color.set(c);
    light.emissive.set(c);
    words.on.visible = on;
    words.off.visible = !on;
  };
  set(false);
  return { group, set };
}

/** The toilet, facing +z: a pedestal and bowl, the seat ring with its lid up, and the cistern behind. */
function toilet(): THREE.Group {
  const g = new THREE.Group();
  const white = toon(PORCELAIN);
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.3, 16), white, 0, 0.15, 0.06));
  const bowl = mesh(new THREE.SphereGeometry(0.21, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white, 0, 0.4, 0.1);
  bowl.scale.set(1, 0.55, 1.2);
  g.add(bowl);
  const seat = mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 22), toon('#f1efe9'), 0, 0.41, 0.11, false);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1, 1.2, 1);
  g.add(seat);
  g.add(mesh(new THREE.CircleGeometry(0.15, 18).rotateX(-Math.PI / 2), toon('#9ad1d4'), 0, 0.39, 0.11, false));
  const lid = mesh(roundedBox(0.36, 0.42, 0.03, 0.06), toon('#f1efe9'), 0, 0.64, -0.12, false);
  lid.rotation.x = -0.12;
  g.add(lid);
  g.add(mesh(roundedBox(0.44, 0.38, 0.18, 0.04), white, 0, 0.66, -0.22));
  g.add(mesh(roundedBox(0.47, 0.04, 0.2, 0.02), white, 0, 0.86, -0.22, false));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), toon(CHROME), 0, 0.885, -0.22, false));
  // A roll of paper on the wall beside it.
  const roll = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 14).rotateZ(Math.PI / 2), toon('#ffffff'), 0.42, 0.7, -0.3, false);
  g.add(roll);
  g.add(mesh(box(0.14, 0.02, 0.06), toon(CHROME), 0.42, 0.77, -0.35, false));
  return g;
}

/** The cubicle, built where RESTROOM.cubicle puts it, with the toilet seatable as `toilet`. */
export function buildCubicle(): Cubicle {
  const { cubicle, toilet: seat } = RESTROOM;
  const { minZ, maxX } = RESTROOM;
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const panel = toon(PANEL);
  const chrome = toon(CHROME);
  const H = cubicle.height;
  const W = cubicle.wall;
  const doorL = cubicle.door.x - cubicle.door.width / 2;
  const doorR = cubicle.door.x + cubicle.door.width / 2;

  // A partition from (x0, z0) to (x1, z1) along one axis, on feet, with a capping rail on top.
  const partition = (x0: number, z0: number, x1: number, z1: number) => {
    const alongX = z0 === z1;
    const len = alongX ? x1 - x0 : z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    group.add(mesh(alongX ? box(len, H - GAP, W) : box(W, H - GAP, len), panel, cx, GAP + (H - GAP) / 2, cz));
    group.add(mesh(alongX ? box(len, 0.03, W + 0.03) : box(W + 0.03, 0.03, len), chrome, cx, H, cz, false));
    for (const t of [0.15, len - 0.15]) {
      const fx = alongX ? x0 + t : cx;
      const fz = alongX ? cz : z0 + t;
      group.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, GAP, 8), chrome, fx, GAP / 2, fz, false));
    }
    colliders.push({ minX: Math.min(x0, x1) - W / 2, maxX: Math.max(x0, x1) + W / 2, minZ: Math.min(z0, z1) - W / 2, maxZ: Math.max(z0, z1) + W / 2, top: H });
  };
  partition(cubicle.minX, minZ, cubicle.minX, cubicle.maxZ);
  partition(cubicle.minX, cubicle.maxZ, doorL, cubicle.maxZ);
  partition(doorR, cubicle.maxZ, maxX, cubicle.maxZ);
  // The door frame's top rail, over the doorway.
  group.add(mesh(box(doorR - doorL, 0.06, W + 0.03), chrome, cubicle.door.x, H - 0.03, cubicle.maxZ, false));

  // The door, hinged on its east post, opening out into the restroom; the sign on its outer face.
  const leafW = doorR - doorL - 0.03;
  const leafH = H - GAP - 0.1;
  const hinge = new THREE.Group();
  hinge.position.set(doorR - 0.015, GAP, cubicle.maxZ);
  const leaf = mesh(box(leafW, leafH, W * 0.6), toon('#5fa8b0'), -leafW / 2, leafH / 2, 0);
  hinge.add(leaf);
  hinge.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), chrome, -leafW + 0.08, 1.0 - GAP, W / 2 + 0.02, false));
  const sign = occupiedSign();
  sign.group.position.set(-leafW + 0.27, 1.05 - GAP, W * 0.3 + 0.006);
  hinge.add(sign.group);
  group.add(hinge);
  const door: Door = { x: cubicle.door.x, y: 0, z: cubicle.maxZ + 0.5, open: 0, show: (k) => (hinge.rotation.y = 1.5 * k * k * (3 - 2 * k)) };
  const shut: Collider = { minX: doorL, maxX: doorR, minZ: cubicle.maxZ - W / 2, maxZ: cubicle.maxZ + W / 2, top: H };

  // The toilet against the back wall, facing the door, and the cistern's collider behind where you sit.
  const bowl = toilet();
  bowl.position.set(seat.x, 0, seat.z);
  group.add(bowl);
  colliders.push({ minX: seat.x - 0.25, maxX: seat.x + 0.25, minZ: minZ, maxZ: seat.z - 0.1, top: 0.88 });
  seatable(bowl, 'toilet', 1.2, interactables);

  return {
    group,
    colliders,
    interactables,
    door,
    shut,
    setOccupied(on) {
      sign.set(on);
      door.locked = on;
    },
  };
}
