import * as THREE from 'three';

/**
 * A word across the front of a shirt (Look.print): a strip of the chest just off the torso, so it
 * follows the shirt's curve instead of cutting into it. Printed in white or ink, whichever stands out.
 */
export class ShirtPrint {
  private strip: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private painted = '';

  constructor(
    body: THREE.Object3D,
    private shirt: THREE.MeshToonMaterial,
  ) {
    this.strip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.263, 0.263, 0.13, 16, 1, true, -0.75, 1.5),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    this.strip.position.y = 0.78;
    this.strip.visible = false;
    this.strip.material.userData.outlineParameters = { visible: false };
    body.add(this.strip);
  }

  /** Shows `text` on the shirt, or nothing: a holiday costume covers it up. */
  paint(text = '', covered = false) {
    const ink = this.shirt.color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l > 0.6 ? '#1d1d1d' : '#ffffff';
    const key = `${text}|${ink}`;
    if (key !== this.painted) {
      this.painted = key;
      const mat = this.strip.material;
      mat.map?.dispose();
      mat.map = text ? texture(text, ink) : null;
      mat.needsUpdate = true;
    }
    this.strip.visible = !!text && !covered;
  }
}

/** The strip is about 0.39 m round and 0.13 m tall, so a 3:1 canvas keeps the letters their shape. */
function texture(text: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  let size = 84;
  const font = () => `900 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font();
  while (size > 28 && ctx.measureText(text).width > canvas.width * 0.86) {
    size -= 4;
    ctx.font = font();
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.05);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
