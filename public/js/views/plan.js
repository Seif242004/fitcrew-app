import { h } from '../dom.js';
import { screenTip } from '../tour.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { sheet, toast, emptyState, seg, icon } from '../ui.js';
import { swapLink, mealSheet } from '../swap.js';

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export async function planView() {
  const main = paint('plan', loading());
  const run = () => guard(main, async () => {
    const [{ plan, hasPending }, wk] = await Promise.all([api('GET', '/api/plan'), api('GET', '/api/workout-plan')]);
    let mode = location.hash.includes('mode=training') ? 'training' : 'meals';
    const view = h('div', {});
    const switcher = (wk.plan || wk.hasPending) ? seg([['meals', 'Meals'], ['training', 'Training']], mode, (v) => { mode = v; show(); }, 'Plan type') : null;
    const show = () => view.replaceChildren(mode === 'training' ? trainingPlan(wk) : mealsPlan(plan, hasPending));
    show();
    main.replaceChildren(h('h1', { class: 'title', style: 'margin-bottom:12px' }, 'Your plan'), screenTip('plan', 'Your whole plan', 'Exact grams for every item, with cups and pieces where they fit. Rice and pasta are weighed dry. Swap any item, or tap the arrows on a meal to change the whole meal.'), switcher ? h('div', { style: 'margin:12px 0 4px' }, switcher) : null, view);
  }, run);
  await run();
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function trainingPlan({ plan, hasPending }) {
  if (!plan) return emptyState('Your training plan is being checked', 'It is drafted and waiting for admin approval.');
  const todayDow = new Date().getDay();
  return h('div', {},
    h('p', { class: 'sub', style: 'margin-top:6px' }, `${plan.daysPerWeek} sessions a week, started ${fmtDate(plan.startDate)}. Each session shows last time's numbers and what to aim for.`),
    hasPending ? h('p', { class: 'notice', style: 'margin-top:12px' }, 'A newer training plan is waiting for admin approval.') : null,
    ...(plan.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:10px' }, w)),
    plan.days.map((d) => h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, d.name), h('span', { class: 'sub' }, WEEKDAYS[d.weekday] + (d.weekday === todayDow ? ' · today' : ''))),
      d.exercises.map((e) => h('div', { class: 'item' },
        h('span', { class: 'item-main', style: 'padding-left:2px' }, h('span', { class: 'item-name' }, e.name), h('span', { class: 'item-amt' }, `${e.sets} × ${e.repMin}–${e.repMax} · rest ${mmss(e.restSec)}`)))))),
    h('div', { style: 'margin-top:24px' }, h('button', { class: 'btn ghost block', onclick: () => navigate('/coach') }, 'Ask the coach for a change')));
}

function mealsPlan(plan, hasPending) {
  if (!plan) {
    return hasPending
      ? emptyState('Your plan is with the admin', 'It needs a person to check it. It shows up here as soon as it is approved.')
      : emptyState('No plan yet', 'Tell us about you and your goal, and your plan is ready in seconds.', h('button', { class: 'btn', onclick: () => navigate('/onboarding') }, 'Set up my plan'));
  }
  const len = plan.days.length;
  let sel = plan.todayIdx ?? 0;
  const body = h('div', {});
  const tabs = len > 1 ? h('div', { class: 'chips scroll', role: 'tablist', 'aria-label': 'Plan days', style: 'margin:8px -16px 0' }) : null;
  const date = localDate();
  const reload = () => planView();
  const draw = () => {
    if (tabs) tabs.replaceChildren(...plan.days.map((_, i) => h('button', { class: 'chip', role: 'tab', 'aria-pressed': String(i === sel), onclick: () => { sel = i; draw(); } }, i === plan.todayIdx ? 'Today' : `Day ${i + 1}`)));
    const day = plan.days[sel];
    const canSwap = sel === plan.todayIdx;
    body.replaceChildren(
      h('section', { class: 'section', style: 'padding-bottom:16px' },
        h('div', { class: 'spread' }, h('span', { class: 'h3' }, 'Every day'), h('span', { class: 'num', style: 'font-size:24px' }, `${fmt(day.totals.kcal)} kcal`)),
        macroRow(day.totals)),
      ...day.meals.map((m, mi) => h('section', { class: 'section' },
        h('div', { class: 'meal-head' },
          h('span', { class: 'grow' }, h('span', { class: 'h3' }, m.name), m.title ? h('span', { class: 'sub' }, m.title) : null),
          h('span', { class: 'kcal' }, `${fmt(m.totals.kcal)} kcal`),
          canSwap ? h('button', { class: 'icon-btn meal-change', 'aria-label': `Change ${m.name.toLowerCase()} for another meal`, title: 'Change this meal', onclick: () => mealSheet({ date, meal: mi, onDone: reload }) }, icon('swap', 18)) : null),
        macroRow(m.totals),
        ...m.items.map((it) => h('div', { class: 'pitem' },
          h('span', {}, h('span', { class: 'name-row' }, h('span', { class: 'item-name' }, it.name.split(' (')[0]), it.ar ? h('span', { class: 'ar', lang: 'ar', dir: 'rtl' }, it.ar) : null), h('span', { class: 'item-amt' }, (it.amount ?? `${it.grams} g`) + (it.hint ? ` · ${it.hint}` : ''))),
          h('span', { class: 'item-kcal' }, fmt(it.kcal)),
          canSwap ? swapLink({ ref: it.ref, date, name: it.name, count: it.alts, onDone: reload }) : null)))));
  };
  draw();
  const regen = h('button', { class: 'btn ghost block', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Making a new plan…';
    try {
      const r = await api('POST', '/api/plan/regenerate', { note: 'Asked for a new plan' });
      toast(r.status === 'active' ? 'Your new plan is ready' : 'Your new plan was sent to the admin');
      planView();
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; b.textContent = 'Make me a different plan'; }
  } }, 'Make me a different plan');
  return h('div', {},
    h('p', { class: 'sub', style: 'margin-top:8px' }, len === 1 ? 'The same simple plan every day. Swap an item, or change a whole meal with the arrows.' : `Repeats every ${len} days.`),
    hasPending ? h('p', { class: 'notice', style: 'margin-top:12px' }, 'A newer plan is waiting for the admin.') : null,
    tabs, body,
    h('div', { class: 'stack', style: 'margin-top:24px' },
      h('button', { class: 'btn block', onclick: () => navigate('/coach') }, icon('coach', 20), 'Ask the coach to change something'),
      regen));
}

function macroRow(t) {
  return h('div', { class: 'mmacros' },
    h('span', {}, h('i', { style: 'background:var(--protein)' }), 'P ', h('b', {}, Math.round(t.p)), ' g'),
    h('span', {}, h('i', { style: 'background:var(--carbs)' }), 'C ', h('b', {}, Math.round(t.c)), ' g'),
    h('span', {}, h('i', { style: 'background:var(--fat)' }), 'F ', h('b', {}, Math.round(t.f)), ' g'));
}

