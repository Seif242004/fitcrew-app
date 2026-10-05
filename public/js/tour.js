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
    { ic: 'today', title: 'Today', lines: ['Tick each food as you eat it. One tap, no typing.', 'Ate a different amount? Tap ⋯ and say it the normal way: 3 eggs, 1½ loaves, 2 cups of rice.', 'Had a coffee or a juice with a meal? "Add food or drink" under that meal.'] },
    { ic: 'plan', title: 'Your plan', lines: ['One simple day, the Egyptian way: lunch is the cooked meal, dinner is light and made from what was cooked.', 'Swap any food for an equivalent, or tap "Change meal" for a whole different meal with the same calories.', 'Rice and pasta are weighed dry, the way dietitians write it.'] },
    { ic: 'train', title: 'Train', lines: ['At the gym, tap "Check in" and snap a photo: that is all 30 training points. Gym, CrossFit or a class all count.', 'Resting today instead? Switch the day to a rest day in one tap.', 'Logging sets is optional: tap an exercise to open it, ▶ shows how to do it.'] },
    { ic: 'trophy', title: 'Points and the monthly prize', lines: ['Up to 100 points a day: calories and protein 40, how close each meal is to its plan 20 (diet food only), logging on the day 10, gym check-in 30. Training on a rest day adds 10.', priv ? 'You are a private member: only the admin sees your points.' : 'Points add up over the month. Most points on the last day wins the prize.', '70+ in a day keeps your streak going.'] },
    { ic: 'coach', title: 'Your coach', lines: ['Just type: "I ate my lunch", "swap the rice", "what is my workout?".', 'It logs, swaps and adjusts for you, and checks in morning and evening.', 'Photos are never sent to the chat coach.'] },
    { ic: 'group', title: priv ? 'Progress' : 'Progress and the crew', lines: ['Weigh in on Fridays: the weekly check-in uses it to fine-tune your calories. Add photos every few weeks in Progress; they stay private.', priv ? 'Nobody else can see you anywhere in the app.' : 'Crew shows the board and what everyone is doing. Add a profile picture from Profile so the crew sees you.', 'Pull down on Today or Crew to refresh. Replay this tour any time from Profile.'] },
  ];
};

// Bump when the app gains something worth a short "What's new" for people who already took the tour.
const TOUR_VERSION = 6;
// The cards each version added. People see every version newer than the one they last saw.
const NEW_IN = () => ({
  2: [
    { ic: 'today', title: 'Log it the way you say it', lines: ['Tap ⋯ on any food: 3 eggs instead of 2, 1½ loaves, a plate of koshari. No more grams to type.', 'Foods show their Arabic name too.'] },
    { ic: 'plan', title: 'Meals that make sense', lines: ['Lunch is the cooked meal, dinner is light and uses what was cooked.', 'Tap "Change meal" for another complete meal with the same calories, for today or every day.'] },
    { ic: 'group', title: 'Your face on the board', lines: ['Add a profile picture from Profile (tap the circle).', 'Pull down on Today or Crew to refresh.'] },
  ],
  3: [
    { ic: 'progress', title: 'Your weekly check-in', lines: ['Every Friday, weigh in on Today. FitCrew compares your weight trend with what you logged and works out your real calorie burn.', 'If you are losing or gaining too slowly or too fast, it suggests a small change: same foods, adjusted portions. Nothing changes until you tap Update my plan.'] },
  ],
  4: [
    { ic: 'train', title: 'Training points = gym check-in', lines: ['One photo where you train is all 30 training points: gym, CrossFit, a class. No need to tick every set.', 'Logging sets is still there for your records and PRs. Exercises now fold into one line; tap to open.'] },
    { ic: 'clock', title: 'Rest day or training day', lines: ['Plans change. On the Train tab, switch today to a rest day or a training day in one tap.', 'Rest days earn the 30 for as many rest days as your plan has each week.'] },
  ],
  5: [
    { ic: 'plus', title: 'Ate out? Log it exactly', lines: ['Add food now finds pizza, burgers, nuggets, fries, chocolate, coffee drinks and more, in slices, pieces and cans.', 'Then tell it if it replaced a meal, and trim the rest of today in one tap. No guessing, no guilt.'] },
  ],
  6: [
    { ic: 'plus', title: 'Food and drinks go in their meal', lines: ['Every meal has "Add food or drink": the Nescafé with breakfast, the juice with lunch. It shows inside that meal.', 'About 150 more foods: coffee and tea drinks, juices, sauces, breads, cheeses, street sandwiches and home dishes.'] },
    { ic: 'coach', title: 'Tell the coach, the way you would say it', lines: ['"Egg sandwich for breakfast: 100 g bread, 2 eggs, a slice of cheddar, and a Nescafé with milk."', 'It logs each part in that meal, ticks what matches your plan and never logs the same thing twice.'] },
    { ic: 'trophy', title: 'Points got fairer', lines: ['Each meal earns by how close it is to its plan: calories, protein, carbs and fat. Off-plan food still counts toward calories but earns nothing. Tap your score on Today to see how it adds up.', 'Cutting or maintaining: going well over your calories costs points. Training on a planned rest day: +10 bonus.'] },
  ],
});
const WHATS_NEW = (seen) => {
  const cards = Object.entries(NEW_IN()).filter(([v]) => Number(v) > seen).flatMap(([, c]) => c);
  return [{ ic: 'spark', title: 'What\'s new in FitCrew', lines: [cards.length === 1 ? 'One new thing since your last visit.' : `A few things changed since your last visit. ${cards.length} quick cards.`] }, ...cards];
};

/** Open the tour, or the short "What's new" for people who took an older tour. Resolves when closed. */
export function tour({ force = false } = {}) {
  const seen = Number(local.get('tourVersion') ?? (local.get('tourDone') ? 1 : 0));
  if (!force && seen >= TOUR_VERSION) return Promise.resolve();
  if (document.querySelector('.tour')) return Promise.resolve();
  const cards = force || !seen ? CARDS() : WHATS_NEW(seen);
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
