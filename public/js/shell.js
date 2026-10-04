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
  pullFn = null; // each view opts in to pull-to-refresh again
  const me = state.me?.user;
  const as = state.as;
  const main = h('main', { class: 'enter' }, ...content);
  root().replaceChildren(
    as ? h('div', { class: 'as-banner' }, h('span', {}, `Editing ${as.name}'s data`), h('button', { onclick: async () => { state.as = null; await loadMe(); navigate('/admin'); } }, 'Exit')) : null,
    h('header', { class: 'topbar' },
      h('span', { class: 'bar-title', 'aria-hidden': 'true' }),
      h('button', { class: 'avatar', 'aria-label': 'Profile and settings', onclick: () => navigate('/profile') },
        (me?.name ?? '?').slice(0, 1).toUpperCase(), me?.avatar ? h('img', { src: me.avatar, alt: '', width: 36, height: 36, onerror: (e) => e.currentTarget.remove() }) : null)),
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

// ---------- pull to refresh ----------
// Today and Crew can be pulled down from the top to reload, the way native apps do it:
//   - the page itself follows the finger with rubber-band resistance (it never jumps),
//   - a ring fills as you pull; once full it locks (a tiny buzz) and releasing refreshes,
//   - while loading the page waits a little lower with a spinning ring, then glides back.
// Sideways swipes (the week strip, chip rows) and normal scrolling never trigger it. The
// installed app has no browser pull-to-refresh (overscroll is off), so this is the only one.
let pullFn = null;
let pullHooked = false;
const PULL_MAX = 120;  // furthest the page can be dragged (px)
const PULL_READY = 70; // drag needed to refresh (px)
const PULL_HOLD = 56;  // where the page waits while refreshing (px)
const R = 11; const CIRC = 2 * Math.PI * R;

/** The current view's refresh (an async function), or null to switch pulling off. */
export function onPull(fn) {
  pullFn = fn;
  if (pullHooked) return;
  pullHooked = true;
  const arc = h('circle', { class: 'ptr-arc', cx: 14, cy: 14, r: R, 'stroke-dasharray': `0 ${CIRC}` });
  const ind = h('div', { class: 'ptr', 'aria-hidden': 'true' },
    h('svg', { viewBox: '0 0 28 28', width: 28, height: 28 }, h('circle', { class: 'ptr-track', cx: 14, cy: 14, r: R }), arc));
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  document.body.append(ind, live);
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let startX = 0; let startY = 0; let tracking = false; let decided = false; let dist = 0; let ready = false; let busy = false; let page = null;
  // Rubber band: easy at first, then harder and harder, never past PULL_MAX.
  const band = (dy) => PULL_MAX * (1 - Math.exp(-dy / (PULL_MAX * 1.6)));
  const place = (d, animate) => {
    const t = animate && !reduce() ? 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
    if (page) { page.style.transition = t; page.style.transform = d ? `translateY(${d}px)` : ''; }
    ind.style.transition = animate && !reduce() ? 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms' : 'none';
    ind.style.transform = `translate(-50%, ${d - 44}px)`;
    ind.style.opacity = d > 8 ? '1' : '0';
  };
  const progress = (p) => {
    // The arc grows to 80% of the ring and turns with the pull, like Android's indicator.
    arc.setAttribute('stroke-dasharray', `${Math.min(1, p) * CIRC * 0.8} ${CIRC}`);
    ind.querySelector('svg').style.transform = `rotate(${-90 + p * 240}deg)`;
  };
  const settle = () => { place(0, true); setTimeout(() => { ind.classList.remove('ready', 'spin'); progress(0); if (page) { page.style.transition = ''; page.style.transform = ''; } }, 300); };

  addEventListener('touchstart', (e) => {
    tracking = Boolean(!busy && pullFn && window.scrollY <= 0 && e.touches.length === 1 && !document.querySelector('dialog[open], .tour'));
    if (!tracking) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; decided = false; dist = 0; ready = false;
    page = document.querySelector('main');
  }, { passive: true });

  addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX; const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      // Only a downward, mostly vertical drag from the top is a pull.
      decided = true;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { tracking = false; return; }
    }
    if (e.cancelable) e.preventDefault(); // keep the page from scrolling under the finger
    dist = band(Math.max(0, dy));
    place(dist, false);
    progress(dist / PULL_READY);
    const now = dist >= PULL_READY;
    if (now !== ready) { ready = now; ind.classList.toggle('ready', ready); if (ready) navigator.vibrate?.(8); }
  }, { passive: false });

  const end = async () => {
    if (!tracking) return;
    tracking = false;
    if (!decided || !ready || !pullFn) { settle(); return; }
    busy = true;
    ind.classList.add('spin');
    place(PULL_HOLD, true);
    live.textContent = 'Refreshing';
    const started = Date.now();
    try { await pullFn(); } catch { /* the view shows its own error */ }
    // Never a flash: the spinner shows for at least 450 ms.
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
    live.textContent = 'Up to date';
    busy = false;
    settle();
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);
}
