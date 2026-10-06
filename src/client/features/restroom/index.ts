/**
 * The restroom in the back office (built in world.ts): the sign on the cubicle door goes red while
 * anyone on your floor, you included, sits on the toilet, and green again once they get up. The cork
 * board on the inside of that door shows the issues board's own texture, so it holds the same notes.
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { toiletTaken } from './occupied';

export function installRestroom(ctx: Ctx, parts: Pick<Parts, 'boards'>) {
  ctx.ticks.add('world', () => {
    const taken = ctx.inOffice() && toiletTaken(store.peers.values(), store.floor, store.you, ctx.player.seat?.key);
    ctx.office.restroom.setOccupied(taken);
    showOn(ctx.office.restroom.doorBoard, parts.boards.issuesTex.texture);
  });
}

/** Puts `texture` on `mesh`'s face, once. */
function showOn(mesh: THREE.Mesh, texture: THREE.Texture) {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (mat.map === texture) return;
  mat.map = texture;
  mat.needsUpdate = true;
}
