import * as THREE from 'three';
import { MEETING_SCREEN, MEETING_TABLE } from '../../../shared/layout';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { PALETTE } from '../../world/office/materials';

declare module '../../world/types' {
  interface OfficeHandles {
    /** The meeting room's screen: its picture, which features/appscreen paints. */
    appScreen: THREE.Mesh;
  }
}

/** The meeting room's screen: a big flat screen on the east wall, at the head of the table. */
export const appScreen: Fixture<'appScreen'> = (site) => {
  const s = MEETING_SCREEN;
  const group = new THREE.Group();
  const bezel = mesh(roundedBox(s.width + 2 * s.bezel, 0.07, s.height + 2 * s.bezel, 0.04), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  group.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.height), new THREE.MeshBasicMaterial({ color: '#1b1d2e', toneMapped: false }));
  screen.position.z = 0.04;
  group.add(screen);
  group.position.set(s.x - 0.05, s.y, s.z);
  group.rotation.y = -Math.PI / 2;
  // From the far end of the table too: the screen is for everyone sitting round it.
  const it: Interactable = { kind: 'appscreen', x: MEETING_TABLE.x + MEETING_TABLE.width / 2 + 0.3, z: s.z, radius: 1.6 };
  group.userData.interact = it;
  site.wall('east', s.z, s.y, s.width + 2 * s.bezel, s.height + 2 * s.bezel);
  return { group, interactables: [it], handle: { appScreen: screen } };
};
