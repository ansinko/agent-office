import { EMPTY_PLAN, type FloorPlan } from '../../../shared/floorplan';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The signs over the desks (not the map's plan: see plan()). */
    floorPlan: FloorPlan;
  }
  interface Topics {
    floorPlan: true;
  }
}

export const floorPlan: Slice = {
  init(s) {
    s.floorPlan = EMPTY_PLAN;
  },
  on: {
    plan(s, m) {
      s.floorPlan = m.plan;
      return ['floorPlan'];
    },
  },
  enter(s, v) {
    s.floorPlan = v.plan ?? EMPTY_PLAN;
    return ['floorPlan'];
  },
};
