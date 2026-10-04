// First-run tour and one-time screen tips.
//
// tour(): seven swipeable cards that explain the whole app in about a minute. It opens by itself
// the first time someone lands on Today with a plan, and can be replayed from Profile.
// screenTip(): a small card at the top of a tab the first time it is opened ("Got it" hides it).
// Both are remembered per phone (fc.tourDone + fc.tourVersion, fc.tip.<key>) and cleared by an admin fresh start.
import { h } from './dom.js';
import { icon, local } from './ui.js';
import { state } from './state.js';

// The full tour for someone new (or a replay from Profile).
const CARDS = () => {
  const priv = state.me?.user?.private;
  return [
    { ic: 'spark', title: 'Welcome to FitCrew', lines: ['Your diet plan, your training and the crew, in one app.', 'This takes a minute. Swipe or tap Next.'] },
    { ic: 'today', title: 'Today', lines: ['Tick each food as you eat it. One tap, no typing.', 'Ate a different amount? Tap ⋯ and say it the normal way: 3 eggs, 1½ loaves, 2 cups of rice.', 'Ate too much? "Rebalance" trims the rest of the day.'] },
    { ic: 'plan', title: 'Your plan', lines: ['One simple day, the Egyptian way: lunch is the cooked meal, dinner is light and made from what was cooked.', 'Swap any food for an equivalent, or tap "Change meal" for a whole different meal with the same calories.', 'Rice and pasta are weighed dry, the way dietitians write it.'] },
    { ic: 'train', title: 'Train', lines: ['Each set shows the weight × reps to do. Tap the check when it is done.', 'Tap the numbers to change them. ▶ shows how to do the exercise.', 'At the gym, tap "Check in" and snap a photo for 15 points.'] },
    { ic: 'trophy', title: 'Points and the monthly prize', lines: ['Up to 100 points a day: calories and protein 40, planned food 20, logging on the day 10, training 30.', priv ? 'You are a private member: only the admin sees your points.' : 'Points add up over the month. Most points on the last day wins the prize.', '70+ in a day keeps your streak going.'] },
    { ic: 'coach', title: 'Your coach', lines: ['Just type: "I ate my lunch", "swap the rice", "what is my workout?".', 'It logs, swaps and adjusts for you, and checks in morning and evening.', 'Photos are never sent to the chat coach.'] },
    { ic: 'group', title: priv ? 'Progress' : 'Progress and the crew', lines: ['Weigh in on Fridays and add photos every few weeks in Progress. Photos stay private.', priv ? 'Nobody else can see you anywhere in the app.' : 'Crew shows the board and what everyone is doing. Add a profile picture from Profile so the crew sees you.', 'Pull down on Today or Crew to refresh. Replay this tour any time from Profile.'] },
  ];
};

// Bump when the app gains something worth a short "What's new" for people who already took the tour.
const TOUR_VERSION = 2;
const WHATS_NEW = () => [
  { ic: 'spark', title: 'What\'s new in FitCrew', lines: ['A few things changed since your last visit. Three quick cards.'] },
  { ic: 'today', title: 'Log it the way you say it', lines: ['Tap ⋯ on any food: 3 eggs instead of 2, 1½ loaves, a plate of koshari. No more grams to type.', 'Foods show their Arabic name too.'] },
  { ic: 'plan', title: 'Meals that make sense', lines: ['Lunch is the cooked meal, dinner is light and uses what was cooked.', 'Tap "Change meal" for another complete meal with the same calories, for today or every day.'] },
  { ic: 'group', title: 'Your face on the board', lines: ['Add a profile picture from Profile (tap the circle).', 'Pull down on Today or Crew to refresh.'] },
];

/** Open the tour, or the short "What's new" for people who took an older tour. Resolves when closed. */
export function tour({ force = false } = {}) {
  const seen = Number(local.get('tourVersion') ?? (local.get('tourDone') ? 1 : 0));
  if (!force && seen >= TOUR_VERSION) return Promise.resolve();
  if (document.querySelector('.tour')) return Promise.resolve();
  const cards = force || !seen ? CARDS() : WHATS_NEW();
  let i = 0;
  return new Promise((resolve) => {
    const track = h('div', { class: 'tour-track' }, cards.map((c, k) => h('section', { class: 'tour-card', 'aria-roledescription': 'slide', 'aria-label': `${k + 1} of ${cards.length}: ${c.title}` },
      h('div', { class: 'tour-ic' }, icon(c.ic, 34)),
      h('h2', {}, c.title),
      h('ul', {}, c.lines.map((l) => h('li', {}, l))))));
    const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, cards.map(() => h('i', {})));
    const back = h('button', { class: 'btn ghost', type: 'button', onclick: () => go(i - 1) }, 'Back');
    const next = h('button', { class: 'btn', type: 'button', onclick: () => (i === cards.length - 1 ? close() : go(i + 1)) }, 'Next');
    const skip = h('button', { class: 'link tour-skip', type: 'button', onclick: () => close() }, 'Skip');
    const el = h('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'App tour' },
      h('div', { class: 'tour-box' }, skip, track, dots, h('div', { class: 'tour-nav' }, back, next)));

    // Index follows the swipe position, and the buttons scroll the track.
    const draw = () => {
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      back.style.visibility = i === 0 ? 'hidden' : 'visible';
      next.textContent = i === cards.length - 1 ? 'Let\'s go' : 'Next';
    };
    const go = (k) => { i = Math.max(0, Math.min(cards.length - 1, k)); track.scrollTo({ left: i * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); draw(); };
    let t;
    track.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => { const k = Math.round(track.scrollLeft / track.clientWidth); if (k !== i) { i = k; draw(); } }, 60); });
    const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); };
    function close() {
      local.set('tourDone', '1');
      local.set('tourVersion', String(TOUR_VERSION));
      removeEventListener('keydown', onKey);
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 180);
    }
    addEventListener('keydown', onKey);
    document.body.append(el);
    draw();
    next.focus({ focusVisible: false }); // keyboard users still get the ring once they press a key
  });
}

/** One-time tip at the top of a screen. Returns the element, or null once dismissed. */
export function screenTip(key, title, text) {
  if (local.get(`tip.${key}`) || state.as) return null;
  const el = h('aside', { class: 'tip', role: 'note' },
    h('span', { class: 'tip-ic' }, icon('info', 18)),
    h('div', { class: 'grow' }, h('b', {}, title), h('p', {}, text)),
    h('button', { class: 'link', type: 'button', onclick: () => { local.set(`tip.${key}`, '1'); el.remove(); } }, 'Got it'));
  return el;
}

/** Replay from Profile: the tour again, and every screen tip comes back. */
export function resetTips() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('fc.tip.')) localStorage.removeItem(k); } catch { /* blocked */ }
}
