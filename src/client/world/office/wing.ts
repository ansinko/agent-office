import * as THREE from 'three';
import { FLOOR, SLAB, WALL_HEIGHT, WALL_T, WING, wingMinZ } from '../../../shared/layout';
import type { NightParts } from '../outside';
import { mesh, toon } from '../toon';
import { wingWindows } from '../tower';
import type { Collider } from '../types';
import type { Fixture } from './fixture';
import { box, type Looks } from './materials';
import { wallRun, wetPane, windowIn } from './shell';

// The back office through the north wall: the restroom's walls, floor and ceiling (see RESTROOM).

/** The back office, as far as it's built out (see WING). */
export interface WingView {
  /** How many rows it's built out: WING.rows on an office floor, 0 where there's none. */
  level: number;
  /** Builds it out `level` rows (or walls it up): walls, floor and ceiling. */
  set(level: number): void;
}

/**
 * The back office: the bit of north wall between the gong and the east wall, which comes down where
 * there's a back office, and behind it the bay, `WING.row` deep a row, with a window in the east wall.
 */
export function buildWing(group: THREE.Group, colliders: Collider[], looks: Looks, planks: THREE.Material, ceiling: THREE.Material, night: NightParts): WingView {
  const T = WALL_T;
  const midX = (WING.minX + WING.maxX) / 2;

  // The wall where it goes through, standing while there's none.
  const plug = new THREE.Group();
  const plugCols: Collider[] = [];
  wallRun(plug, plugCols, 'x', FLOOR.minZ - T / 2, WING.minX, FLOOR.maxX + T, -1, [], looks, [false, true]);
  group.add(plug);

  let built: THREE.Object3D[] = [];
  let mine: Collider[] = [];
  const view: WingView = {
    level: -1,
    set(level) {
      level = Math.max(0, Math.min(WING.rows, level));
      if (level === view.level) return;
      view.level = level;
      for (const o of built) {
        o.removeFromParent();
        o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
        });
      }
      built = [];
      for (const c of mine) {
        const i = colliders.indexOf(c);
        if (i >= 0) colliders.splice(i, 1);
      }
      mine = [];
      const take = (o: THREE.Object3D) => {
        group.add(o);
        built.push(o);
        return o;
      };

      plug.visible = level === 0;
      if (level === 0) mine.push(...plugCols);

      const back = wingMinZ(level);
      if (level > 0) {
        const shell = new THREE.Group();
        wallRun(shell, mine, 'z', WING.minX - T / 2, back, FLOOR.minZ - T, -1, [], looks, [false, false]);
        const windows = wingWindows(level);
        wallRun(shell, mine, 'z', FLOOR.maxX + T / 2, back, FLOOR.minZ, 1, windows, looks, [false, false]);
        wallRun(shell, mine, 'x', back - T / 2, WING.minX - T, FLOOR.maxX + T, -1, [], looks, [true, true]);
        for (const o of windows) {
          shell.add(windowIn(o));
          shell.add(wetPane(o, night.wetGlass));
        }
        take(shell);

        // The floor: the room's planks carried on through (the same texture, lined up with it), on a
        // slab like the room's; and the ceiling's tiles over it.
        const w = WING.maxX - WING.minX;
        const d = FLOOR.minZ - back;
        const floorGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(midX, 0, (back + FLOOR.minZ) / 2);
        const uv = floorGeo.getAttribute('uv');
        const pos = floorGeo.getAttribute('position');
        for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) - FLOOR.minX) / (FLOOR.maxX - FLOOR.minX), (FLOOR.maxZ - pos.getZ(k)) / (FLOOR.maxZ - FLOOR.minZ));
        const floor = take(new THREE.Mesh(floorGeo, planks)) as THREE.Mesh;
        floor.receiveShadow = true;
        // Its edges are the band between the floors outside, its underside concrete.
        const band = toon('#e8a87c');
        const concrete = toon('#d3d6dd');
        const slab = new THREE.Mesh(box(w + 2 * T, SLAB - 0.01, d), [band, band, concrete, concrete, band, band]);
        slab.position.set(midX, -SLAB / 2 - 0.005, (back - T + FLOOR.minZ - T) / 2);
        slab.receiveShadow = true;
        take(slab);
        const ceilGeo = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(midX, WALL_HEIGHT, (back + FLOOR.minZ) / 2);
        const cuv = ceilGeo.getAttribute('uv');
        const cpos = ceilGeo.getAttribute('position');
        for (let k = 0; k < cpos.count; k++) cuv.setXY(k, cpos.getX(k), cpos.getZ(k));
        take(new THREE.Mesh(ceilGeo, ceiling)).receiveShadow = false;
        // Its roof, flush with the tops of its walls, for when there's no floor over it.
        take(mesh(box(w + 2 * T, 0.02, d + T), toon('#fffaf3'), midX, WALL_HEIGHT + 0.03, (back - T + FLOOR.minZ) / 2, false));
        mine.push({ minX: WING.minX - T, maxX: FLOOR.maxX + T, minZ: back - T, maxZ: FLOOR.minZ - T, bottom: -SLAB, top: 0 });
        mine.push({ minX: WING.minX, maxX: FLOOR.maxX, minZ: back, maxZ: FLOOR.minZ, bottom: WALL_HEIGHT, top: WALL_HEIGHT + SLAB });
      }
      colliders.push(...mine);
    },
  };
  view.set(0);
  return view;
}

declare module '../types' {
  interface OfficeHandles {
    /** The back office through the north wall (see WING). */
    wing: WingView;
    /** Builds the back office out `level` rows, or walls it up: the plants in the way go too. */
    setWing(level: number): void;
  }
}

/** The back office through the north wall past the gong, walled up where there's none. */
export const wing: Fixture<'wing' | 'setWing'> = (site) => {
  const built = buildWing(site.group, site.colliders, site.looks, site.planks, site.get('stack').ceiling, site.get('night'));
  const setWing = (level: number) => {
    built.set(level);
    for (const p of site.inTheWay) {
      const out = built.level === 0;
      if (p.group.visible === out) continue;
      p.group.visible = out;
      const i = site.colliders.indexOf(p.collider);
      if (out && i < 0) site.colliders.push(p.collider);
      else if (!out && i >= 0) site.colliders.splice(i, 1);
    }
  };
  return { handle: { wing: built, setWing } };
};
