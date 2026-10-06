// Only whoever sits on the restroom's toilet talks to the hajzel baba (see shared/restroom.ts): tells
// her an idea, works her terminal or ends the brainstorm. Everyone else on the floor sees her and her
// status, and the message handlers ask here before doing any of it.

import { RESTROOM_DESK, onToilet } from '../shared/restroom.js';
import type { PeerInfo } from '../shared/protocol.js';
import type { Client } from './office/client.js';
import type { Ctx } from './office/context.js';

/** What someone does with the worker at a desk: prompt it, attach to or type into its terminal, or send it home. */
export type RestroomAct = 'prompt' | 'terminal' | 'kill';

/** The floor it's on: its id, and its GitHub repository if it has one. */
export interface RestroomFloor {
  id: string;
  def: { repo?: string };
}

const SIT_FIRST: Record<RestroomAct, string> = {
  prompt: 'Sit on the toilet to tell the hajzel baba your idea',
  terminal: "Only whoever sits on the toilet can use the hajzel baba's terminal",
  kill: 'Only whoever sits on the toilet can end the brainstorm',
};

/**
 * Why someone (`peer`) may not `act` on the worker at `deskId` on `floor`, or undefined when they may:
 * any desk but hers, or the hajzel baba while they sit on that floor's toilet. Prompting her also takes
 * a GitHub repository on the floor, where her issues go.
 */
export function restroomRefusal(peer: Pick<PeerInfo, 'floor' | 'seat'>, floor: RestroomFloor, deskId: string, act: RestroomAct): string | undefined {
  if (deskId !== RESTROOM_DESK) return undefined;
  if (peer.floor !== floor.id || !onToilet(peer.seat)) return SIT_FIRST[act];
  if (act === 'prompt' && !floor.def.repo) return 'Ideas have nowhere to go here: this floor has no GitHub repo.';
  return undefined;
}

/** restroomRefusal for `c`, told to them: true when they may not. */
export function refusedInRestroom(ctx: Ctx, c: Client, floor: RestroomFloor, deskId: string, act: RestroomAct): boolean {
  const why = restroomRefusal(c.peer, floor, deskId, act);
  if (why) ctx.warn(c, why);
  return !!why;
}

/**
 * Why another worker (through office-workers or its MCP tools) may not tell or send home the worker at
 * `deskId`, or undefined when it may: a worker never sits on the toilet, so the hajzel baba is never its to reach.
 */
export function workerRestroomRefusal(deskId: string): string | undefined {
  return deskId === RESTROOM_DESK ? 'Only whoever sits on the toilet talks to the hajzel baba' : undefined;
}
