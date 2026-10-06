/**
 * The meeting room's screen: the office's showcase, one of its saved web pages up for everyone, as
 * the office's latest snapshot of it. E opens the page itself in a window (see ui.ts).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { SHOT_HEIGHT, SHOT_WIDTH, screenHost } from '../../../shared/appscreen';
import type { ScreenPage } from '../../../shared/protocol';
import { clip } from '../../ui/dom';
import { openAppScreen } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    appscreen: true;
  }
}

/** The screen's own card, while there's no snapshot to show: what's coming up, or why it isn't. */
function card(title: string, line: string, tone: 'wait' | 'error'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = SHOT_WIDTH;
  c.height = SHOT_HEIGHT;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, SHOT_WIDTH, SHOT_HEIGHT);
  grad.addColorStop(0, tone === 'error' ? '#6a040f' : '#1b1d2e');
  grad.addColorStop(1, tone === 'error' ? '#2b2d42' : '#3a0ca3');
  g.fillStyle = grad;
  g.fillRect(0, 0, SHOT_WIDTH, SHOT_HEIGHT);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '900 96px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(tone === 'error' ? '⚠️' : '🖥️', SHOT_WIDTH / 2, 300);
  g.font = '900 76px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(clip(title, 34), SHOT_WIDTH / 2, 430);
  g.font = '700 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,.85)';
  // The line, broken where it would run off the screen.
  const words = line.split(' ');
  let row = '';
  let y = 540;
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (g.measureText(next).width > SHOT_WIDTH - 240 && row) {
      g.fillText(row, SHOT_WIDTH / 2, y);
      row = w;
      y += 58;
      if (y > 760) break;
    } else row = next;
  }
  if (y <= 760) g.fillText(row, SHOT_WIDTH / 2, y);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The page that's up on the screen now. */
export const pageUp = (): ScreenPage | undefined => store.appScreen.pages.find((p) => p.id === store.appScreen.current);

export function installAppScreen(ctx: Ctx) {
  const mat = ctx.office.appScreen.material as THREE.MeshBasicMaterial;
  mat.color.set('#ffffff');
  const loader = new THREE.TextureLoader();
  /** What's on the screen: a snapshot by its address, or a card by what it says. */
  let showing = '';
  let texture: THREE.Texture | undefined;

  const put = (key: string, t: THREE.Texture) => {
    if (key !== showing) return t.dispose();
    texture?.dispose();
    texture = t;
    mat.map = t;
    mat.needsUpdate = true;
  };

  const paint = () => {
    const page = pageUp();
    if (!page) {
      showing = 'none';
      return put(showing, card('Meeting room screen', 'No pages yet: walk up and press E to add one.', 'wait'));
    }
    if (page.error) {
      const key = `error ${page.id} ${page.error}`;
      if (key === showing) return;
      showing = key;
      return put(key, card(page.name, page.error, 'error'));
    }
    if (!page.shotAt) {
      const key = `wait ${page.id}`;
      if (key === showing) return;
      showing = key;
      return put(key, card(page.name, `Taking a snapshot of ${screenHost(page.url)}…`, 'wait'));
    }
    const url = `/api/app-screen/shot?page=${encodeURIComponent(page.id)}&at=${page.shotAt}`;
    if (url === showing) return;
    showing = url;
    // The last picture stays up until the next one has come.
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      put(url, t);
    });
  };
  store.on('appScreen', paint);
  paint();

  ctx.interactions.define('appscreen', {
    reach: 9,
    hint: () => {
      const page = pageUp();
      return { k: page?.id ?? '', parts: [hintTitle('🖥️ Screen'), aside(page ? clip(page.name, 40) : 'no pages yet'), key('E', page ? 'Open it' : 'Set it up')] };
    },
    use: onE(() => openAppScreen(ctx.net)),
  });
}
