import { spotifyUri } from '../../../shared/spotify';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';

/** How often the window asks what Spotify is on, while it's open: songs end and change by themselves. */
const POLL_MS = 3000;

/**
 * The jukebox window's Spotify part: the office machine's Spotify app, for an admin on that Mac. It
 * stays hidden until the office says it's yours. `stop` is for when the window closes.
 */
export function spotifySection(net: Net): { el: HTMLElement; stop(): void } {
  const now = h('div.jb-now');
  const url = h('input', { type: 'text', placeholder: 'https://open.spotify.com/… a song, album or playlist', 'aria-label': 'Spotify link', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const playUrl = h('button.btn.primary', { type: 'button' }, '▶️ Play');
  const el = h(
    'div.jb-spotify',
    { hidden: true },
    h('label', { style: 'margin-top:16px' }, 'Spotify on this computer'),
    now,
    h('div.webhook', { style: 'margin-top:8px' }, url, playUrl),
    h('p.setting-note', {}, 'It plays from the office computer’s speakers on its Spotify account, for you alone, and turns the jukebox off.'),
  );

  const button = (label: string, title: string, msg: Parameters<Net['send']>[0]) => h('button.btn', { type: 'button', title, onclick: () => net.send(msg) }, label);

  const render = () => {
    const s = store.spotify;
    el.hidden = !s;
    if (!s) return;
    now.replaceChildren(
      h('span.jb-disc', { class: s.playing ? 'spin' : '' }, '🟢'),
      h('div.svc-main', {}, h('div.svc-title', {}, s.title ?? 'Nothing on'), h('div.svc-meta', {}, s.title ? [s.artist, s.playing ? 'playing' : 'paused'].filter(Boolean).join(' · ') : 'Paste a link to put something on')),
      button('⏮️', 'Previous song', { t: 'spotify.prev' }),
      s.playing ? button('⏸️', 'Pause', { t: 'spotify.pause' }) : button('▶️', 'Play', { t: 'spotify.play' }),
      button('⏭️', 'Next song', { t: 'spotify.next' }),
    );
  };

  const play = () => {
    const u = spotifyUri(url.value);
    if ('error' in u) {
      toast(u.error, 'warn');
      return url.focus();
    }
    net.send({ t: 'spotify.play', url: u.uri });
    url.value = '';
  };
  playUrl.addEventListener('click', play);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });

  const off = store.on('spotify', render);
  net.send({ t: 'spotify.get' });
  const poll = setInterval(() => {
    if (store.spotify) net.send({ t: 'spotify.get' });
  }, POLL_MS);
  render();
  return {
    el,
    stop() {
      clearInterval(poll);
      off();
    },
  };
}
