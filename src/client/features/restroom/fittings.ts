import * as THREE from 'three';
import { RESTROOM, type DeskDef } from '../../../shared/layout';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, DeskView } from '../../world/types';
import { PALETTE, box } from '../../world/office/materials';

// What stands in the restroom besides the cubicle: the hajzel baba's table by the door, with her chair
// and the saucer for tips, and the sink with a mirror over it on the west wall.

const BRASS = '#e9b949';
const COPPER = '#c4733d';
const NICKEL = '#cfd6dc';

/** A wooden chair with a slatted back, facing +z. */
function woodenChair(): THREE.Group {
  const g = new THREE.Group();
  const wood = toon('#a86b45');
  g.add(mesh(roundedBox(0.42, 0.05, 0.4, 0.03), wood, 0, 0.44, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(mesh(box(0.04, 0.44, 0.04), wood, sx * 0.17, 0.22, sz * 0.16));
    g.add(mesh(box(0.04, 0.42, 0.04), wood, sx * 0.17, 0.67, -0.18));
  }
  for (const y of [0.62, 0.78]) g.add(mesh(box(0.36, 0.06, 0.03), wood, 0, y, -0.18, false));
  return g;
}

/** The saucer for tips, with a few coins in it and one gone astray beside it. */
function saucer(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.025, 20), toon('#ffffff'), 0, 0.0125, 0, false));
  const ring = mesh(new THREE.TorusGeometry(0.085, 0.008, 6, 20), toon('#5fa8b0'), 0, 0.024, 0, false);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (const [x, z, c, tilt] of [
    [-0.03, 0.02, BRASS, 0.1],
    [0.025, -0.015, COPPER, -0.15],
    [0.01, 0.035, BRASS, 0.2],
    [-0.015, -0.03, NICKEL, 0],
    [0.15, 0.06, COPPER, 0],
  ] as const) {
    const coin = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 12), toon(c), x, x > 0.1 ? 0.003 : 0.03, z, false);
    coin.rotation.x = tilt;
    g.add(coin);
  }
  return g;
}

/**
 * The hajzel baba's place (station-restroom): her little table by the door with the saucer and a stack
 * of paper on it, and her chair `RESTROOM.table.chair` along the way she faces (`def.rotY`). She waits in
 * `vacancy` before she's hired, and sits in `seatAnchor` once she is, the same way.
 */
export function attendantTable(def: DeskDef): { view: DeskView; colliders: Collider[] } {
  const { width, depth, height, chair: back } = RESTROOM.table;
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  // Built facing +z (her side), so along x here is the table's depth.
  const wood = toon(PALETTE.wood);
  group.add(mesh(roundedBox(depth, 0.05, width, 0.03), toon(PALETTE.desk), 0, height - 0.025, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(mesh(box(0.05, height - 0.05, 0.05), wood, sx * (depth / 2 - 0.06), (height - 0.05) / 2, sz * (width / 2 - 0.06)));
  // A cloth runner down the middle, the saucer on the door's side, and spare rolls on hers.
  group.add(mesh(box(depth * 0.9, 0.004, width * 0.5), toon('#f4a7b9'), 0, height + 0.002, 0, false));
  const tips = saucer();
  tips.position.set(-0.18, height, -0.08);
  group.add(tips);
  const card = textPlane('Tips 🙏', { bg: '#fffaf3', size: 40 });
  card.scale.multiplyScalar(0.22);
  card.position.set(0.04, height + 0.06, -0.2);
  card.rotation.y = Math.PI;
  group.add(card);
  const paper = toon('#ffffff');
  for (const [x, y] of [
    [0.16, 0],
    [0.27, 0],
    [0.215, 0.1],
  ]) {
    group.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 14), paper, x, height + 0.05 + y, 0.08, false));
  }

  const chair = woodenChair();
  chair.position.set(0, 0, back);
  chair.rotation.y = Math.PI;
  group.add(chair);

  // No laptop: she keeps her terminal a key press away, like the board agents.
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, height, 0);
  laptopAnchor.visible = false;
  group.add(laptopAnchor);
  // On the chair, facing the table and the door past it.
  const seat = new THREE.Object3D();
  seat.position.set(0, 0.36, back);
  seat.rotation.y = Math.PI;
  seat.scale.setScalar(0.82);
  const seatAnchor = seat.clone();
  group.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(seat);
  group.add(vacancy);
  // Up on the table, facing the door.
  const stage = new THREE.Object3D();
  stage.position.set(0, height, 0);
  stage.rotation.y = Math.PI;
  group.add(stage);

  const t = RESTROOM.table;
  const colliders: Collider[] = [
    { minX: t.x - t.width / 2, maxX: t.x + t.width / 2, minZ: t.z - t.depth / 2, maxZ: t.z + t.depth / 2, top: t.height },
    // Her and her chair: nobody squeezes in or climbs over.
    { minX: t.x + back - 0.28, maxX: t.x + back + 0.3, minZ: t.z - 0.26, maxZ: t.z + 0.26, top: 1.5, fence: true },
  ];
  return { view: { def, group, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 0 }, colliders };
}

/** The sink against the west wall, the mirror over it, and the soap and towels beside it. */
export function sink(): { group: THREE.Group; collider: Collider } {
  const { sink: s, minX } = RESTROOM;
  const g = new THREE.Group();
  // Built against x = 0, facing +x, then set on the wall.
  g.position.set(minX, 0, s.z);
  const white = toon('#fbfbf8');
  const chrome = toon('#c9d1d9');
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, s.height - 0.12, 14), white, s.depth / 2, (s.height - 0.12) / 2, 0));
  const basin = mesh(roundedBox(s.depth, 0.14, s.width, 0.06), white, s.depth / 2, s.height - 0.07, 0);
  g.add(basin);
  g.add(mesh(new THREE.CircleGeometry(0.16, 18).rotateX(-Math.PI / 2), toon('#9ad1d4'), s.depth / 2 + 0.02, s.height + 0.002, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), chrome, 0.07, s.height + 0.1, 0, false));
  const spout = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8).rotateZ(Math.PI / 2), chrome, 0.13, s.height + 0.19, 0, false);
  g.add(spout);
  g.add(mesh(roundedBox(0.07, 0.13, 0.07, 0.02), toon('#80ed99'), 0.09, s.height + 0.065, s.width / 2 - 0.1, false));

  // The mirror: a frame, a pale glass with a glint across it, and a shelf under it.
  const mirrorW = s.width + 0.1;
  const mirrorH = 0.8;
  const y = s.height + 0.45 + mirrorH / 2;
  g.add(mesh(box(0.03, mirrorH + 0.08, mirrorW + 0.08), toon(PALETTE.ink), 0.015, y, 0, false));
  const glass = new THREE.MeshBasicMaterial({ color: '#cfe8f2' });
  g.add(mesh(new THREE.PlaneGeometry(mirrorW, mirrorH).rotateY(Math.PI / 2), glass, 0.032, y, 0, false));
  const glint = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
  for (const [dz, w] of [
    [-0.12, 0.08],
    [0.02, 0.03],
  ]) {
    const streak = mesh(new THREE.PlaneGeometry(w, mirrorH * 0.7).rotateY(Math.PI / 2), glint, 0.034, y, dz, false);
    streak.rotation.x = 0.5;
    g.add(streak);
  }
  g.add(mesh(box(0.12, 0.03, mirrorW), toon('#fbfbf8'), 0.06, y - mirrorH / 2 - 0.08, 0, false));
  // A towel dispenser to the side.
  g.add(mesh(roundedBox(0.14, 0.3, 0.26, 0.03), toon('#e9ecef'), 0.07, 1.25, -(s.width / 2 + 0.3), false));

  const collider: Collider = { minX, maxX: minX + s.depth, minZ: s.z - s.width / 2, maxZ: s.z + s.width / 2, top: s.height };
  return { group: g, collider };
}
