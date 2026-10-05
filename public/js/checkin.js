import { h } from './dom.js';
import { fmt, fmt1 } from './state.js';
import { icon, sheet, toast, numInput, local } from './ui.js';

/*
 * The adaptive weekly check-in on Today (Friday to Sunday, and all week while a change waits for
 * an answer). The server does the maths (src/adaptive.js) and writes the sentence; this file only
 * shows it. One card, five states:
 *   needs_weight  weigh in here (the card replaces the Friday weigh-in card)
 *   learning      how far along the data is (10 logged days, 3 weigh-ins)
 *   on_track      the plan stays; "Got it" hides it
 *   hold          the plan stays and why (ate under / over the plan, at the safe minimum)
 *   proposed      "2,325 → 2,175 kcal a day" with Update my plan / Keep my plan
 */

const signed = (n) => (n > 0 ? `+${fmt1(n)}` : n < 0 ? `−${fmt1(-n)}` : '0');

/**
 * ci: GET /api/checkin/weekly's `checkin`. act: { weigh(kg), answer(answer, btn), dismiss(week) }.
 * Returns the card, or null when there is nothing to show.
 */
export function checkinCard(ci, act) {
  if (!ci) return null;
  const live = ci.status === 'live';
  if (!(live || ci.status === 'open')) return null;
  // Weigh-in and learning notes can be hidden for the week; a change or result needs an answer.
  if ((ci.kind === 'learning' || ci.kind === 'needs_weight') && local.get('ciSeen') === ci.week) return null;

  const head = (sub, closable) => h('div', { class: 'head' },
    h('span', { class: 'ic' }, icon('chart', 22)),
    h('span', { class: 'grow' },
      h('span', { class: 'strong' }, 'Weekly check-in'),
      h('span', { class: 'sub' }, sub)),
    closable ? h('button', { class: 'icon-btn x', 'aria-label': 'Hide this week\'s check-in', onclick: closable }, icon('close', 18)) : null);
  const how = h('button', { class: 'link wc-how', onclick: howSheet }, 'How the check-in works');

  if (ci.kind === 'needs_weight') {
    const input = numInput('', { min: 30, max: 400, step: 0.1, placeholder: ci.trendKg ? String(ci.trendKg) : 'kg', 'aria-label': 'Weight in kg' });
    const save = h('button', { class: 'btn', onclick: async () => {
      const kg = Number(input.value);
      if (!(kg >= 30 && kg <= 400)) { toast('Enter your weight in kg', 'bad'); input.focus(); return; }
      save.disabled = true;
      try { await act.weigh(Math.round(kg * 10) / 10); } catch (e) { toast(e.message, 'bad'); save.disabled = false; }
    } }, 'Save');
    return h('section', { class: 'prompt-card wc-card' },
      head('Weigh in first: same scale, after the toilet, before food or water.', () => act.dismiss(ci.week)),
      h('div', { class: 'weigh-row' }, input, save),
      h('p', { class: 'sub wc-text' }, 'Your weight trend and what you logged decide whether your calories should change this week.'));
  }

  if (ci.kind === 'learning') {
    const bar = (label, have, need) => h('div', { class: 'wc-prog' },
      h('div', { class: 'wc-prog-top' }, h('span', {}, label), h('b', {}, `${Math.min(have, need)} of ${need}`)),
      h('div', { class: 'wc-bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': need, 'aria-valuenow': Math.min(have, need) },
        h('i', { style: `width:${Math.min(100, (have / need) * 100)}%` })));
    return h('section', { class: 'prompt-card wc-card' },
      head('Starts once there is enough data', () => act.dismiss(ci.week)),
      h('div', { class: 'wc-progs' }, bar('Fully logged days (last 3 weeks)', ci.days, ci.needDays), bar('Weekly weigh-ins (last 4 weeks)', ci.weighIns, ci.needWeighIns)),
      h('p', { class: 'wc-text' }, ci.text),
      how);
  }

  // on_track / hold / proposed: the three numbers the decision is based on.
  const stats = h('div', { class: 'recap-stats wc-stats' },
    h('div', {}, h('b', {}, fmt1(ci.trendKg)), h('span', {}, 'kg trend')),
    h('div', {}, h('b', {}, signed(ci.ratePerWeek)), h('span', {}, `kg a week · goal ${signed(ci.goalRate)}`)),
    h('div', {}, h('b', {}, fmt(ci.avgIntake)), h('span', {}, 'kcal a day eaten')));
  const sub = `Last 3 weeks · ${ci.days} of 21 days logged`;

  if (ci.kind === 'proposed') {
    const yes = h('button', { class: 'btn', onclick: () => act.answer('accept', yes) }, 'Update my plan');
    const no = h('button', { class: 'btn ghost', onclick: () => act.answer('keep', no) }, 'Keep my plan');
    const up = ci.kcal.to > ci.kcal.from;
    return h('section', { class: 'prompt-card wc-card wc-proposed' },
      head(sub),
      stats,
      h('p', { class: 'wc-text' }, ci.text),
      h('div', { class: 'wc-change', 'aria-label': `Daily calories from ${fmt(ci.kcal.from)} to ${fmt(ci.kcal.to)}` },
        h('span', { class: 'sub' }, 'Daily calories'),
        h('span', { class: 'wc-nums' }, h('s', {}, fmt(ci.kcal.from)), icon('send', 16), h('b', {}, fmt(ci.kcal.to)), h('span', { class: `wc-delta ${up ? 'up' : 'down'}` }, `${up ? '+' : '−'}${fmt(Math.abs(ci.kcal.to - ci.kcal.from))}`))),
      h('p', { class: 'sub' }, 'Your foods stay the same. Only portions change, mostly rice, bread, oil and extras.'),
      h('div', { class: 'wc-actions' }, no, yes),
      how);
  }

  // on_track or hold
  const ok = ci.kind === 'on_track';
  return h('section', { class: `prompt-card wc-card ${ok ? 'wc-ok' : 'wc-hold'}` },
    head(sub),
    stats,
    h('p', { class: 'wc-text' }, ok ? h('span', { class: 'wc-badge' }, icon('check', 14), 'On track') : null, ci.text),
    h('div', { class: 'wc-actions one' }, h('button', { class: 'btn ghost', onclick: (e) => act.answer('dismiss', e.currentTarget) }, 'Got it')),
    how);
}

/** After "Update my plan": the new target and exactly which portions changed. */
export function resultSheet(result) {
  sheet('Plan updated', (close) => h('div', { class: 'stack' },
    h('div', { class: 'wc-change big' },
      h('span', { class: 'sub' }, 'Daily calories'),
      h('span', { class: 'wc-nums' }, h('s', {}, fmt(result.kcal.from)), icon('send', 16), h('b', {}, fmt(result.kcal.to)))),
    h('p', { class: 'sub' }, `Protein ${result.macros.p} g · Carbs ${result.macros.c} g · Fat ${result.macros.f} g`),
    result.planStatus === 'pending'
      ? h('div', { class: 'notice' }, 'Seif reviews the new portions first. Your current plan stays until then.')
      : null,
    result.newMenu
      ? h('p', {}, 'Your plan was rebuilt around the new target, so some meals are new. Swaps still work as before.')
      : result.changes.length
        ? h('div', {},
            h('h3', { class: 'h3', style: 'margin-bottom:4px' }, 'What changes'),
            result.changes.map((c) => h('div', { class: 'list-row wc-row' },
              h('span', { class: 'grow strong' }, c.name),
              h('span', { class: 'wc-amt' }, h('s', {}, c.from), icon('send', 14), h('b', {}, c.to)))),
            h('p', { class: 'sub', style: 'margin-top:8px' }, 'Everything else stays the same.'))
        : h('p', {}, 'Your plan already fits the new target, so your portions stay the same.'),
    h('button', { class: 'btn block', onclick: close }, 'Done')));
}

function howSheet() {
  const li = (b, t) => h('li', {}, h('b', {}, b), ' ', t);
  sheet('How the check-in works', () => h('div', { class: 'stack' },
    h('p', {}, 'Every Friday, FitCrew compares what you logged with what your weight actually did, the way a dietitian reviews a client each week.'),
    h('ul', { class: 'wc-list' },
      li('Your real burn.', 'Calories eaten plus the energy behind your weight change (about 7,700 kcal per kg) shows how much you really burn. The starting formula is only a first guess.'),
      li('Small steps.', 'Calories move at most 150 a day per week, and never below the safe minimum.'),
      li('Same plan.', 'Your foods stay. Rice, bread, oil and extras are adjusted; protein and vegetables are not.'),
      li('Only with good data.', 'It needs 10 fully logged days in the last 3 weeks and 3 weekly weigh-ins. If you ate well under or over your plan, it asks you to eat the plan first instead of changing it.'),
      li('You decide.', 'Nothing changes until you tap Update my plan. Seif\'s own targets always come first.')),
    h('p', { class: 'sub' }, 'Weigh in on Fridays after the toilet, before food or water, on the same scale.')));
}
