/**
 * The restroom's toilet (SEATING's `restroom` seat): sitting there, E tells the hajzel baba an idea, which
 * hires her with it, and then opens her terminal. Getting up while she's at it ends the brainstorm,
 * once you've said so. The server holds everyone else to the same rule (server/restroom.ts).
 */
import { STATION_AGENT } from '../../../shared/layout';
import { pressureNote } from '../../../shared/machine';
import { RESTROOM_DESK, brainstorming, toiletUse } from '../../../shared/restroom';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { STATION_INFO } from '../../core/stations';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { confirmDialog, openPrompt } from '../../ui/prompt';

export type ToiletParts = Pick<Parts, 'seating' | 'waiting' | 'actions'>;

/** How long after you send an idea her terminal still opens by itself once she's hired. */
const OPEN_WITHIN_MS = 30_000;

/** Hands the toilet's seat to seating (see useSeatAs). Install it after seating. */
export function installToilet(ctx: Ctx, parts: ToiletParts) {
  const { net } = ctx;
  const name = STATION_AGENT.restroom.name;
  const info = STATION_INFO.restroom;
  const baba = () => store.workerAtDesk(RESTROOM_DESK);
  const repo = () => store.currentFloor()?.repo;
  /** Still sitting on the toilet (or any seat flagged `restroom`). */
  const seated = () => !!ctx.plan().seatingById.get(ctx.player.seat?.seatId ?? '')?.restroom;

  /** Opens her terminal as soon as she's at work, unless you've got off the toilet by then. */
  function openWhenHired() {
    const off = store.on('workers', () => {
      const w = baba();
      if (!w || !brainstorming(w.status)) return;
      stop();
      if (seated()) parts.waiting.openWorkerTerminal(w.id);
    });
    const timer = setTimeout(() => stop(), OPEN_WITHIN_MS);
    function stop() {
      off();
      clearTimeout(timer);
    }
  }

  function askForIdea(on: string) {
    const hiring = !baba();
    if (hiring && parts.actions.officeIsFull()) return;
    openPrompt({
      title: `${info.icon} What's on your mind?`,
      subtitle: `${info.does} on ${on}.`,
      placeholder: `e.g. ${info.example}`,
      submitLabel: 'Send ✨',
      warning: hiring ? pressureNote(store.machine) : undefined,
      onSubmit: (text) => {
        net.send({ t: 'station.prompt', deskId: RESTROOM_DESK, prompt: text });
        openWhenHired();
      },
    });
  }

  parts.seating.useSeatAs('restroom', {
    label: () => (toiletUse(repo(), baba()?.status) === 'terminal' ? `${name}'s terminal` : 'Tell your idea'),
    use: () => {
      const on = repo();
      const w = baba();
      const what = toiletUse(on, w?.status);
      if (what === 'no-repo' || !on) toast('Ideas have nowhere to go here: this floor has no GitHub repo.', 'warn');
      else if (what === 'terminal' && w) parts.waiting.openWorkerTerminal(w.id);
      else askForIdea(on);
    },
    mayGetUp: (_seat, getUp) => {
      const w = baba();
      if (!w || !brainstorming(w.status)) return true;
      confirmDialog('End the brainstorm?', "The hajzel baba forgets what you haven't filed.", 'End it', () => {
        net.send({ t: 'worker.kill', workerId: w.id });
        getUp();
      });
      return false;
    },
  });
}
