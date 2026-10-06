import './ui.css';
import type { Net } from '../../net';
import { store } from '../../state';
import { ROTATE_CHOICES, checkScreenUrl } from '../../../shared/appscreen';
import type { AppScreenState, ScreenPage, ScreenPageInput } from '../../../shared/protocol';
import { h, openModal, setDoing, timeAgo, toast } from '../../ui/dom';

// The screen's window: its pages to put up with a click, how long each stays up when they take
// turns, and the page that's up itself. An app on the office's own network comes through the office
// (server/appscreen/proxy.ts); a site out on the internet is framed as it is, or shown as its
// snapshot with a link to open it in a tab of its own when it won't be framed. Admins edit the
// pages and the sign-ins their snapshots use.

const rotateLabel = (s: number) => (s === 0 ? 'Stay on this page' : s % 60 ? `Every ${s} s` : `Every ${s / 60} min`);

/** Where the page opens in a tab, or in the window's frame: through the office for its own network's apps. */
function pageAddress(page: ScreenPage, state: AppScreenState): string | undefined {
  if (page.view !== 'proxy') return page.url;
  if (!state.proxyPort) return undefined;
  return `${location.protocol}//${location.hostname}:${state.proxyPort}/__agent-office/open?page=${encodeURIComponent(page.id)}`;
}

const shotUrl = (page: ScreenPage) => `/api/app-screen/shot?page=${encodeURIComponent(page.id)}&at=${page.shotAt}`;

export function openAppScreen(net: Net) {
  const tabs = h('nav.as-pages', { 'aria-label': 'Pages' });
  const rotate = h('select.as-rotate', { title: 'Let the pages take turns on the screen, for everyone' }) as HTMLSelectElement;
  rotate.append(...ROTATE_CHOICES.map((s) => h('option', { value: String(s) }, rotateLabel(s))));
  rotate.addEventListener('change', () => net.send({ t: 'appScreen.rotate', every: Number(rotate.value) }));
  const newTab = h('a.btn.as-newtab', { target: '_blank', rel: 'noopener noreferrer' }, '↗ New tab') as HTMLAnchorElement;
  const snap = h('button.btn', { type: 'button', title: 'Snapshot it again now, for the screen', onclick: () => net.send({ t: 'appScreen.refresh' }) }, '📸');
  const manageBtn = h('button.btn', { type: 'button', title: 'The pages the screen can show (admins)', onclick: () => toggleManage() }, '⚙️ Pages');
  const pinBtn = h('button.btn', { type: 'button', title: 'Put the page this window is on up on the screen, for everyone, and save it with the pages', onclick: () => at && net.send({ t: 'appScreen.pin', from: at.page, path: at.path }) }, '📌 Put this up');
  const title = h('h2', {}, '🖥️ Meeting room screen');
  const view = h('div.as-view');
  const foot = h('div.as-foot');
  const manage = h('div.as-manage');
  manage.hidden = true;
  const el = h('div.modal.appscreen', {}, h('header', {}, title, pinBtn, snap, newTab, manageBtn), h('div.as-bar', {}, tabs, rotate), view, manage, foot);

  /** What the frame was last pointed at, so a new snapshot doesn't reload the page someone is using. */
  let shown = '';
  let frame: HTMLIFrameElement | undefined;
  /** The page the frame was opened on, and where in its app it is now, as its frame script says. */
  let at: { page: string; path: string } | undefined;
  const pathOf = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };
  /** 📌 shows while an admin's window is on another page of the app than the one up. */
  const paintPin = () => {
    const up = store.appScreen.pages.find((p) => p.id === store.appScreen.current);
    pinBtn.hidden = !store.me.admin || !frame || !at || !up || (up.id === at.page && pathOf(up.url) === at.path);
  };

  const render = () => {
    const state = store.appScreen;
    const page = state.pages.find((p) => p.id === state.current);
    manageBtn.hidden = !store.me.admin;
    paintPin();
    rotate.value = String(state.rotate);
    rotate.disabled = state.pages.length < 2;
    tabs.replaceChildren(
      ...state.pages.map((p) =>
        h('button.btn.as-tab', { type: 'button', class: p.id === state.current ? 'on' : '', 'aria-pressed': String(p.id === state.current), title: p.url, onclick: () => p.id !== state.current && net.send({ t: 'appScreen.show', id: p.id }) }, p.name),
      ),
      state.pages.length ? '' : h('span.as-none', {}, store.me.admin ? 'No pages yet: add one under ⚙️ Pages.' : 'No pages yet: an admin adds them.'),
    );
    if (!page) {
      shown = '';
      frame = undefined;
      paintPin();
      view.replaceChildren();
      newTab.hidden = true;
      foot.textContent = '';
      return;
    }
    setDoing(modal, `🖥️ looking at ${page.name}`);
    const address = pageAddress(page, state);
    newTab.hidden = !address;
    if (address) newTab.href = address;
    const by = state.by ? `Put up by ${state.by}${state.at ? ` ${timeAgo(state.at)}` : ''}. ` : '';
    const snapped = page.shotAt ? `Snapshot ${timeAgo(page.shotAt)}.` : '';
    if (page.view !== 'shot' && address) {
      foot.textContent = `${by}${page.view === 'proxy' ? 'Shown through the office. Blank? Open it in a new tab once to let your browser trust the office there.' : 'Esc inside the page? Click outside it first, or ✕.'}`;
      if (shown === address) return;
      shown = address;
      at = undefined;
      frame = h('iframe.as-frame', { 'data-page': page.id, src: address, title: page.name, allow: 'clipboard-read; clipboard-write; fullscreen', sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals' }) as HTMLIFrameElement;
      view.replaceChildren(frame);
      paintPin();
      return;
    }
    // A page shown as its snapshot: why, and the way to it.
    frame = undefined;
    paintPin();
    const why = page.view === 'proxy' ? (state.proxyError ?? 'The office isn’t serving its apps right now.') : page.why;
    foot.textContent = `${by}${snapped}`;
    const key = `shot ${page.id} ${page.shotAt} ${page.error} ${why}`;
    if (shown === key) return;
    shown = key;
    view.replaceChildren(
      h(
        'div.as-shot',
        {},
        page.shotAt ? h('img', { src: shotUrl(page), alt: page.name }) : h('div.as-wait', {}, page.error ? `⚠️ ${page.error}` : 'Taking a snapshot…'),
        h('div.as-why', {}, h('p', {}, why ?? ''), address ? h('a.btn.primary', { href: address, target: '_blank', rel: 'noopener noreferrer' }, '↗ Open in a new tab') : ''),
      ),
    );
  };

  // ---- ⚙️ Pages (admins) ----------------------------------------------------------------------
  let draft: ScreenPageInput[] = [];
  const toggleManage = () => {
    manage.hidden = !manage.hidden;
    if (!manage.hidden) {
      draft = store.appScreen.pages.map(({ id, name, url }) => ({ id, name, url }));
      paintManage();
    }
  };
  const paintManage = () => {
    const known = new Map(store.appScreen.pages.map((p) => [p.id, p]));
    const rows = draft.map((p, i) => {
      const name = h('input', { type: 'text', value: p.name, placeholder: 'Name', 'aria-label': 'Name', oninput: () => (p.name = name.value) }) as HTMLInputElement;
      const url = h('input', { type: 'text', value: p.url, placeholder: 'https://…', 'aria-label': 'Address', oninput: () => (p.url = url.value) }) as HTMLInputElement;
      const move = (d: number) => {
        const j = i + d;
        if (j < 0 || j >= draft.length) return;
        [draft[i], draft[j]] = [draft[j], draft[i]];
        paintManage();
      };
      const saved = p.id ? known.get(p.id) : undefined;
      const login = saved ? h('button.btn', { type: 'button', title: 'How its snapshots sign in to it', onclick: () => editLogin(saved) }, saved.login ? '🔑 Signed in' : '🔑 Sign-in') : '';
      return h(
        'div.as-row',
        {},
        name,
        url,
        h('button.btn', { type: 'button', title: 'Up', onclick: () => move(-1) }, '↑'),
        h('button.btn', { type: 'button', title: 'Down', onclick: () => move(1) }, '↓'),
        login,
        h('button.btn', { type: 'button', title: 'Take it off the list', onclick: () => (draft.splice(i, 1), paintManage()) }, '🗑'),
      );
    });
    manage.replaceChildren(
      h('h3', {}, 'Pages'),
      h('p.as-note', {}, 'Anyone can put one of these up. The office snapshots them for the screen; apps on its own network open through it, sites out on the internet open as they are.'),
      ...rows,
      h(
        'div.as-actions',
        {},
        h('button.btn', { type: 'button', onclick: () => (draft.push({ name: '', url: '' }), paintManage()) }, '+ Add a page'),
        h('button.btn.primary', { type: 'button', onclick: () => savePages() }, 'Save'),
      ),
      loginBox,
    );
  };
  const savePages = () => {
    for (const p of draft) {
      const checked = checkScreenUrl(p.url);
      if ('error' in checked) return toast(`${p.name || p.url || 'A page'}: ${checked.error}`, 'warn');
    }
    net.send({ t: 'appScreen.pages', pages: draft });
    manage.hidden = true;
  };
  const loginBox = h('div.as-login');
  const editLogin = (page: ScreenPage) => {
    const cookie = h('textarea', { rows: 2, placeholder: 'session=…; other=…', 'aria-label': 'Cookie' }) as HTMLTextAreaElement;
    const user = h('input', { type: 'text', placeholder: 'Name', autocomplete: 'off', 'aria-label': 'Name' }) as HTMLInputElement;
    const password = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'new-password', 'aria-label': 'Password' }) as HTMLInputElement;
    loginBox.replaceChildren(
      h('h3', {}, `🔑 How snapshots of ${page.name} sign in`),
      h('p.as-note', {}, `${page.login ? `It has a ${page.login === 'cookie' ? 'cookie' : 'name and password'} now. ` : ''}Paste a Cookie header from a browser that’s signed in, or a name and password for its sign-in form. Only the office keeps it: nobody sees it again.`),
      cookie,
      h('div.as-pair', {}, user, password),
      h(
        'div.as-actions',
        {},
        page.login ? h('button.btn', { type: 'button', onclick: () => (net.send({ t: 'appScreen.login', id: page.id, login: null }), loginBox.replaceChildren()) }, 'Forget it') : '',
        h('button.btn', { type: 'button', onclick: () => loginBox.replaceChildren() }, 'Cancel'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: () => {
              const login = cookie.value.trim() ? { cookie: cookie.value } : { user: user.value, password: password.value };
              net.send({ t: 'appScreen.login', id: page.id, login });
              loginBox.replaceChildren();
            },
          },
          'Save sign-in',
        ),
      ),
    );
    cookie.focus();
  };

  // From the frame script of an app that comes through the office: Esc pressed inside it closes the
  // window too, and where in the app the window is now.
  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const data = e.data as { agentOffice?: string; path?: unknown } | null;
    if (data?.agentOffice === 'escape') modal.close();
    if (data?.agentOffice === 'at' && typeof data.path === 'string' && data.path.startsWith('/')) {
      at = { page: frame.dataset.page ?? '', path: data.path };
      paintPin();
    }
  };
  window.addEventListener('message', onMessage);
  const off = store.on('appScreen', () => {
    render();
    if (!manage.hidden && !draft.length) paintManage();
  });
  const modal = openModal(el, {
    doing: '🖥️ at the meeting room screen',
    onClose: () => {
      off();
      window.removeEventListener('message', onMessage);
    },
  });
  render();
  if (store.me.admin && !store.appScreen.pages.length) toggleManage();
}
