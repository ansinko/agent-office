import * as THREE from 'three';
import type { PeasantGarb } from '../costumes';
import { mesh, toon, toonUnique } from '../toon';

// The hajzel baba's clothes (see Worker.setOutfit): a checked apron tied round the bean, and a
// headscarf knotted at the back of the head. Built like the peasant's garb, so it wears and comes off the same way.

/** The apron's cloth: pale blue with darker checks. */
function checks(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfe3f5';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(58, 110, 165, 0.45)';
  for (let i = 0; i < 64; i += 16) {
    g.fillRect(i, 0, 8, 64);
    g.fillRect(0, i, 64, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The scarf's print: red with cream dots. */
function dots(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d62839';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f6e7c1';
  for (const [x, y] of [
    [10, 12],
    [42, 8],
    [26, 34],
    [54, 40],
    [12, 54],
  ]) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The apron hangs from the waist over the front of the bean, flaring a little at the hem: [radius, y]. */
const SKIRT: [number, number][] = [
  [0.305, 0.16],
  [0.3, 0.26],
  [0.292, 0.36],
  [0.29, 0.44],
];
/** The bib above it, up to the chest. */
const BIB: [number, number][] = [
  [0.291, 0.44],
  [0.291, 0.6],
];

/** A checked apron with a bib and a white waist tie, and a red polka-dot headscarf: the hajzel baba's. */
export function attendantGarb(): PeasantGarb {
  const body = new THREE.Group();
  // The colors are in the maps: the material's own color is what gets grubby (see wearGarb).
  const clean = new THREE.Color('#ffffff');
  const cloth = toonUnique(clean);
  cloth.map = checks();
  cloth.side = THREE.DoubleSide;
  const lathe = (points: [number, number][], half: number) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 16, -half, half * 2);
  body.add(mesh(lathe(SKIRT, 1.05), cloth));
  body.add(mesh(lathe(BIB, 0.55), cloth, 0, 0, 0, false));
  // The waist tie all the way round, and its bow at the back.
  const tie = toon('#fdfdfd');
  const band = mesh(new THREE.TorusGeometry(0.292, 0.016, 5, 28), tie, 0, 0.44, 0, false);
  band.rotation.x = Math.PI / 2;
  body.add(band);
  for (const sx of [-1, 1]) {
    const loop = mesh(new THREE.SphereGeometry(0.05, 8, 6), tie, sx * 0.05, 0.44, -0.3, false);
    loop.scale.set(1, 0.6, 0.4);
    body.add(loop);
  }
  // A pocket on the front, with a pencil stuck in it.
  body.add(mesh(new THREE.BoxGeometry(0.12, 0.08, 0.01), tie, 0, 0.3, 0.3, false));
  const pencil = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5), toon('#ffb703'), 0.035, 0.36, 0.305, false);
  pencil.rotation.z = -0.25;
  body.add(pencil);

  // The headscarf over the crown, pulled down to the brow, and its knot and ends at the back.
  const cap = new THREE.Group();
  const scarf = toonUnique('#ffffff');
  scarf.map = dots();
  cap.add(mesh(new THREE.SphereGeometry(0.306, 20, 10, 0, Math.PI * 2, 0, 1.12), scarf, 0, 0.7, -0.01));
  const hem = mesh(new THREE.TorusGeometry(0.27, 0.02, 5, 24), scarf, 0, 0.83, -0.01, false);
  hem.rotation.x = Math.PI / 2;
  cap.add(hem);
  cap.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), scarf, 0, 0.8, -0.3, false));
  for (const sx of [-1, 1]) {
    const end = mesh(new THREE.ConeGeometry(0.05, 0.16, 4), scarf, sx * 0.04, 0.71, -0.31, false);
    end.rotation.set(Math.PI - 0.2, 0, sx * 0.35);
    cap.add(end);
  }
  cap.rotation.x = -0.1;
  return { body, cap, cloth, clean, patches: [] };
}
