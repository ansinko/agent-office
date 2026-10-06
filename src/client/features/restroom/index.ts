/**
 * The restroom in the back office (built in world.ts): the sign on the cubicle door goes red while
 * anyone on your floor, you included, sits on the toilet, and green again once they get up.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { toiletTaken } from './occupied';

export function installRestroom(ctx: Ctx) {
  ctx.ticks.add('world', () => {
    const taken = ctx.inOffice() && toiletTaken(store.peers.values(), store.floor, store.you, ctx.player.seat?.key);
    ctx.office.restroom.setOccupied(taken);
  });
}
