import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { sheet, toast, emptyState, seg } from '../ui.js';

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
    main.replaceChildren(switcher ? h('div', { style: 'margin-bottom:14px' }, switcher) : null, view);
  }, run);
  await run();
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function trainingPlan({ plan, hasPending }) {
  if (!plan) return emptyState('Your training plan is being checked', 'It is drafted and waiting for admin approval.');
  const todayDow = new Date().getDay();
  return h('div', {},
    h('h1', { class: 'title' }, 'Your training plan'),
    h('p', { class: 'sub', style: 'margin-top:6px' }, `${plan.daysPerWeek} sessions a week, started ${fmtDate(plan.startDate)}. Each session shows last time's numbers and what to aim for.`),
    hasPending ? h('p', { class: 'notice', style: 'margin-top:12px' }, 'A newer training plan is waiting for admin approval.') : null,
    ...(plan.warnings ?? []).map((w) => h('p', { class: 'notice', style: 'margin-top:10px' }, w)),
    plan.days.map((d) => h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, d.name), h('span', { class: 'sub' }, WEEKDAYS[d.weekday] + (d.weekday === todayDow ? ' · today' : ''))),
      d.exercises.map((e) => h('div', { class: 'item' },
        h('span', { class: 'item-main', style: 'padding-left:2px' }, h('span', { class: 'item-name' }, e.name), h('span', { class: 'item-amt' }, `${e.sets} × ${e.repMin}–${e.repMax} · rest ${mmss(e.restSec)}`)))))),
    h('div', { style: 'margin-top:28px' }, h('button', { class: 'btn ghost block', onclick: requestChange }, 'Ask for a change')));
}

function mealsPlan(plan, hasPending) {
  if (!plan) {
    return hasPending
      ? emptyState('Your plan is being checked', 'It is drafted and waiting for admin approval.')
      : emptyState('No plan yet', 'Fill in your details so a plan can be drafted for you.', h('button', { class: 'btn', onclick: () => navigate('/onboarding') }, 'Set up my plan'));
  }
  const len = plan.days.length;
  const today = localDate();
  let sel = Math.max(0, daysBetween(plan.startDate, today)) % len;
  const todayIdx = sel;
  const body = h('div', {});
  const tabs = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Plan days', style: 'margin:6px 0 4px' });
  const draw = () => {
    tabs.replaceChildren(...plan.days.map((_, i) => {
      const dt = shiftDate(plan.startDate, i);
      return h('button', { class: 'chip', role: 'tab', 'aria-pressed': String(i === sel), 'aria-selected': String(i === sel), onclick: () => { sel = i; draw(); } },
        fmtDate(dt, { weekday: 'short' }), i === todayIdx ? ' · today' : '');
    }));
    const day = plan.days[sel];
    body.replaceChildren(
      h('p', { class: 'sub', style: 'margin:8px 0 0' }, `${fmt(day.totals.kcal)} kcal · Protein ${day.totals.p} g · Carbs ${day.totals.c} g · Fat ${day.totals.f} g`),
      ...day.meals.map((m) => h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, m.name), h('span', { class: 'sub' }, `${fmt(m.totals.kcal)} kcal`)),
        m.items.map((it) => h('div', { class: 'item' },
          h('span', { class: 'item-main', style: 'padding-left:2px' }, h('span', { class: 'item-name' }, it.name), h('span', { class: 'item-amt' }, it.label ? `${it.label} · ${it.grams} g` : `${it.grams} g`)),
          h('span', { class: 'item-kcal' }, fmt(it.kcal)))))));
  };
  draw();
  return h('div', {},
    h('h1', { class: 'title' }, 'Your plan'),
    h('p', { class: 'sub', style: 'margin-top:6px' }, `Version ${plan.version}, started ${fmtDate(plan.startDate)}. The days repeat every ${len}.`),
    hasPending ? h('p', { class: 'notice', style: 'margin-top:12px' }, 'A newer plan is waiting for admin approval.') : null,
    tabs, body,
    h('div', { style: 'margin-top:28px' }, h('button', { class: 'btn ghost block', onclick: requestChange }, 'Ask for a change')));
}

function requestChange() {
  sheet('Ask for a change', (close) => {
    const note = h('textarea', { 'aria-label': 'What should change', placeholder: 'For example: no more tuna, swap rice for potatoes at lunch, I need a bigger breakfast.' });
    return h('div', { class: 'stack' },
      h('p', { class: 'sub' }, 'The admin sees this and updates your plan.'),
      note,
      h('button', { class: 'btn block', onclick: async () => {
        if (!note.value.trim()) { toast('Write what you would like changed', 'bad'); return; }
        try { await api('POST', '/api/plan/request-change', { note: note.value.trim() }); close(); toast('Request sent'); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Send request'));
  });
}
