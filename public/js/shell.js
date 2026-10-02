import { h } from './dom.js';
import { state } from './state.js';
import { icon, errorBlock } from './ui.js';
import { navigate } from './router.js';
import { loadMe } from './session.js';

const root = () => document.getElementById('app');

const TABS = [
  ['today', 'Today', '/today'],
  ['plan', 'Plan', '/plan'],
  ['train', 'Train', '/train'],
  ['progress', 'Progress', '/progress'],
  ['group', 'Group', '/group'],
];

/** Paints the app frame and returns <main> for the view to fill. */
export function paint(active, ...content) {
  const me = state.me?.user;
  const as = state.as;
  const main = h('main', {}, ...content);
  root().replaceChildren(
    as ? h('div', { class: 'as-banner' }, h('span', {}, `Editing ${as.name}'s data`), h('button', { onclick: async () => { state.as = null; await loadMe(); navigate('/admin'); } }, 'Exit')) : null,
    h('header', { class: 'topbar' },
      h('span', { class: 'brand' }, 'FitCrew'),
      h('button', { class: 'avatar', 'aria-label': 'Profile and settings', onclick: () => navigate('/profile') }, (me?.name ?? '?').slice(0, 1).toUpperCase())),
    main,
    h('nav', { class: 'tabs', 'aria-label': 'Main' },
      TABS.map(([key, label, path]) => h('a', { class: 'tab', href: `#${path}`, 'aria-current': active === key ? 'page' : null }, icon(key, 24), label))));
  window.scrollTo(0, 0);
  return main;
}

export const loading = () => h('p', { class: 'muted pad', role: 'status' }, 'Loading…');

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
