import { h } from './dom.js';
import { state } from './state.js';
import { icon, errorBlock } from './ui.js';
import { navigate } from './router.js';
import { loadMe } from './session.js';

const root = () => document.getElementById('app');

const TABS = [
  ['today', 'Today', '/today'],
  ['plan', 'Plan', '/plan'],
  ['coach', 'Coach', '/coach'],
  ['train', 'Train', '/train'],
  ['group', 'Crew', '/group'],
];

/** Paints the app frame and returns <main> for the view to fill. */
export function paint(active, ...content) {
  const me = state.me?.user;
  const as = state.as;
  const main = h('main', {}, ...content);
  root().replaceChildren(
    as ? h('div', { class: 'as-banner' }, h('span', {}, `Editing ${as.name}'s data`), h('button', { onclick: async () => { state.as = null; await loadMe(); navigate('/admin'); } }, 'Exit')) : null,
    h('header', { class: 'topbar' },
      h('span', { class: 'bar-title', 'aria-hidden': 'true' }),
      h('button', { class: 'avatar', 'aria-label': 'Profile and settings', onclick: () => navigate('/profile') }, (me?.name ?? '?').slice(0, 1).toUpperCase())),
    main,
    h('nav', { class: 'tabs', 'aria-label': 'Main' },
      TABS.map(([key, label, path]) => h('a', { class: 'tab', href: `#${path}`, 'aria-current': active === key ? 'page' : null }, icon(key, 24), label,
        key === 'coach' && active !== 'coach' && state.me?.coachUnread ? h('span', { class: 'badge', 'aria-label': `${state.me.coachUnread} new` }, state.me.coachUnread) : null))));
  window.scrollTo(0, 0);
  syncBarTitle();
  return main;
}

// iOS-style large title: the page's own <h1 class="title"> scrolls away and its text appears
// small in the top bar. One listener for the app's lifetime.
function syncBarTitle() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const h1 = document.querySelector('main .title');
  const el = bar.querySelector('.bar-title'); const text = h1?.textContent ?? '';
  if (el.textContent !== text) el.textContent = text; // only write on change: avoids re-triggering the observer
  bar.classList.toggle('scrolled', window.scrollY > 40);
}
let barHooked = false;
export function hookBar() {
  if (barHooked) return; barHooked = true;
  addEventListener('scroll', () => document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 40), { passive: true });
  // Views replace <main> content after loading: keep the small title in sync.
  new MutationObserver(() => syncBarTitle()).observe(document.getElementById('app'), { childList: true, subtree: true, characterData: false });
}

/** Skeleton placeholder shaped like a page: title, a panel, two lists. Shown only if loading takes >150 ms. */
export const loading = () => {
  const el = h('div', { role: 'status', 'aria-label': 'Loading', style: 'opacity:0;transition:opacity 150ms' },
    h('div', { class: 'skel', style: 'height:32px;width:45%;margin:8px 0 20px' }),
    h('div', { class: 'skel', style: 'height:168px;border-radius:16px' }),
    h('div', { class: 'skel', style: 'height:64px;border-radius:16px;margin-top:16px' }),
    h('div', { class: 'skel', style: 'height:220px;border-radius:16px;margin-top:16px' }));
  setTimeout(() => { el.style.opacity = '1'; }, 150);
  return el;
};

/** Runs an async view body, turning failures into a retry screen (or the login screen on 401). */
export async function guard(main, body, retry) {
  try {
    await body();
  } catch (e) {
    if (e.status === 401) { state.me = null; state.as = null; location.hash = '/login'; return; }
    main.replaceChildren(errorBlock(e, retry));
  }
}

export function plain(...content) {
  root().replaceChildren(h('div', { class: 'auth' }, ...content));
  window.scrollTo(0, 0);
}
