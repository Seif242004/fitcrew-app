import { h } from '../dom.js';
import { api } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt, fmt1 } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { icon, sheet, toast, emptyState, field, numInput, exercisePicker } from '../ui.js';

// ---------------------------------------------------------------- screen wake lock
let wake = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch { /* not supported or refused: the workout still works */ }
}
addEventListener('hashchange', () => {
  if (!location.hash.includes('/train')) {
    if (wake) { wake.release().catch(() => {}); wake = null; }
    stopRest();
  }
});

// ---------------------------------------------------------------- rest timer
const rest = { end: 0, timer: null };
function restBar() {
  let el = document.getElementById('rest');
  if (!el) { el = h('div', { id: 'rest', class: 'rest', role: 'timer' }); document.body.append(el); }
  return el;
}
function stopRest() {
  clearInterval(rest.timer);
  document.getElementById('rest')?.classList.remove('show');
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15);
    });
  } catch { /* audio is optional */ }
}
function startRest(seconds) {
  const el = restBar();
  rest.end = Date.now() + seconds * 1000;
  clearInterval(rest.timer);
  const draw = () => {
    const left = Math.ceil((rest.end - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(rest.timer);
      el.replaceChildren(h('span', { class: 'num', style: 'font-size:28px' }, 'Go'));
      beep(); navigator.vibrate?.([200, 100, 200]);
      setTimeout(() => el.classList.remove('show'), 2500);
      return;
    }
    el.replaceChildren(
      h('span', {}, 'Rest'),
      h('span', { class: 'num', style: 'font-size:30px' }, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`),
      h('button', { onclick: () => { rest.end += 15000; draw(); } }, '+15 s'),
      h('button', { onclick: stopRest }, 'Skip'));
  };
  el.classList.add('show');
  draw();
  rest.timer = setInterval(draw, 250);
}

const CHANGE = { 'add weight': 'Add weight', 'add reps': 'Add a rep', repeat: 'Match last time' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- Train screen
export async function trainView() {
  const main = paint('train', loading());
  const today = localDate();
  const date = state.trainDate ?? today;
  const run = () => guard(main, async () => {
    const d = await api('GET', `/api/train?date=${date}`);
    main.replaceChildren(...build(d, date, today, run));
    if (date === today && d.dayName) keepAwake();
  }, run);
  await run();
}

function build(d, date, today, reload) {
  const nav = h('div', { class: 'date-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { state.trainDate = shiftDate(date, -1); trainView(); } }, icon('chevL', 22)),
    h('span', { class: 'label' }, date === today ? 'Today' : fmtDate(date)),
    h('button', { class: 'icon-btn', 'aria-label': 'Next day', disabled: date >= today ? true : null, style: date >= today ? 'opacity:.3' : null, onclick: () => { const n = shiftDate(date, 1); state.trainDate = n === today ? null : n; trainView(); } }, icon('chevR', 22)));

  if (!d.hasPlan && !d.blocks.length) {
    return [nav, d.hasPending
      ? emptyState('Your training plan is being checked', 'It is drafted and waiting for the admin to approve it.')
      : emptyState('No training plan for this day', 'Fill in your details so a plan can be drafted for you.', h('button', { class: 'btn', onclick: () => navigate('/onboarding') }, 'Set up my plan')),
      h('p', {}, h('button', { class: 'link', onclick: () => navigate('/history') }, 'History and records'))];
  }

  const progress = h('p', { class: 'sub', 'aria-live': 'polite' });
  const blocksEl = h('div', {});
  const refresh = () => {
    const rows = [...blocksEl.querySelectorAll('.setrow')];
    const done = rows.filter((r) => r.dataset.done === 'true').length;
    const planned = d.blocks.reduce((a, b) => a + (b.plan?.sets ?? 0), 0);
    progress.textContent = d.restDay && !done ? 'Rest day. Log cardio or an extra exercise if you feel like it.'
      : planned ? `${done} of ${planned} planned sets done` : `${done} sets logged`;
  };
  const ctx = { date, today, refresh };
  d.blocks.forEach((b) => blocksEl.append(blockEl(b, ctx)));
  refresh();

  const addExercise = () => sheet('Add an exercise', (close) => exercisePicker((e) => {
    close();
    blocksEl.append(blockEl({ exerciseId: e.id, name: e.name, muscle: e.muscle, notes: e.notes, timed: e.timed, plan: null, sets: [], last: null, target: null }, ctx));
    refresh();
  }));

  return [
    nav,
    h('h1', { class: 'title' }, d.dayName ?? (d.restDay ? 'Rest day' : 'Train')),
    progress,
    blocksEl,
    h('button', { class: 'add-row', onclick: addExercise }, icon('plus', 22), 'Add an exercise'),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Cardio')),
      d.cardio.map((c) => h('div', { class: 'item', 'data-state': 'eaten' },
        h('span', { class: 'item-main', style: 'padding-left:2px' }, h('span', { class: 'item-name' }, c.kind), h('span', { class: 'item-amt' }, `${fmt1(c.minutes)} min${c.distanceKm ? ` · ${fmt1(c.distanceKm)} km` : ''}${c.avgHr ? ` · ${c.avgHr} bpm` : ''}`)),
        h('button', { class: 'icon-btn', 'aria-label': `Remove ${c.kind}`, onclick: async () => { try { await api('POST', '/api/train/cardio/remove', { id: c.id }); reload(); } catch (e) { toast(e.message, 'bad'); } } }, icon('trash', 20)))),
      h('button', { class: 'add-row', onclick: () => cardioSheet(date, today, reload) }, icon('plus', 22), 'Log cardio')),
    h('p', { style: 'margin-top:22px' }, h('button', { class: 'link', onclick: () => navigate('/history') }, 'History and records')),
  ];
}

function blockEl(b, ctx) {
  const plan = b.plan;
  const lastTop = b.last ? Math.max(...b.last.sets.map((s) => s.weightKg)) : null;
  const defKg = b.target?.weightKg ?? lastTop ?? '';
  const defReps = b.target?.reps ?? plan?.repMin ?? '';
  const rowsEl = h('div', {});
  const logged = new Map(b.sets.map((s) => [s.setNo, s]));

  const setRow = (n) => {
    const l = logged.get(n);
    let done = Boolean(l);
    const kg = numInput(l?.weightKg ?? defKg, { min: 0, max: 600, 'aria-label': `Set ${n} weight in kilograms` });
    const reps = numInput(l?.reps ?? defReps, { min: 1, max: 500, inputmode: 'numeric', 'aria-label': `Set ${n} ${b.timed ? 'seconds' : 'reps'}` });
    const btn = h('button', { class: 'setcheck', role: 'checkbox', 'aria-checked': String(done), 'aria-label': `Log set ${n}` }, icon('check', 22));
    const row = h('div', { class: 'setrow', 'data-done': String(done) },
      h('span', { class: 'setno' }, n),
      b.timed ? h('span', { class: 'sub' }, 'secs') : h('label', { class: 'unit' }, kg, h('span', {}, 'kg')),
      h('label', { class: 'unit' }, reps, h('span', {}, b.timed ? 'sec' : 'reps')),
      btn);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (!done) {
          if (!reps.value) { toast('Enter the reps first', 'bad'); return; }
          const r = await api('POST', '/api/train/set', { date: ctx.date, today: ctx.today, exerciseId: b.exerciseId, setNo: n, weightKg: b.timed ? 0 : Number(kg.value || 0), reps: Number(reps.value) });
          done = true;
          if (r.pr) toast(`New personal best. Estimated max ${fmt1(r.e1rm)} kg`);
          if (ctx.date === ctx.today) startRest(plan?.restSec ?? 90);
        } else {
          await api('POST', '/api/train/set/remove', { date: ctx.date, exerciseId: b.exerciseId, setNo: n });
          done = false;
        }
        row.dataset.done = String(done);
        btn.setAttribute('aria-checked', String(done));
        ctx.refresh();
      } catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
    });
    return row;
  };

  let count = Math.max(plan?.sets ?? 3, b.sets.length);
  for (let n = 1; n <= count; n++) rowsEl.append(setRow(n));

  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, b.name), h('span', { class: 'sub' }, plan ? `${plan.sets} × ${plan.repMin}–${plan.repMax}${b.timed ? ' sec' : ''} · rest ${mmss(plan.restSec)}` : 'Extra')),
    b.last ? h('p', { class: 'sub', style: 'margin-top:8px' }, `Last time (${fmtDate(b.last.date, { day: 'numeric', month: 'short' })}): ${b.last.sets.map((s) => (b.timed || s.weightKg === 0 ? `${s.reps}` : `${fmt1(s.weightKg)} × ${s.reps}`)).join(', ')}`) : null,
    b.target ? h('p', { style: 'font-weight:600;margin-top:2px' }, `${CHANGE[b.target.change]}: ${b.timed || b.target.weightKg === 0 ? `${b.target.reps}` : `${fmt1(b.target.weightKg)} kg × ${b.target.reps}`}`) : null,
    h('div', { class: 'setrow head', 'aria-hidden': 'true' }, h('span', {}, 'Set'), h('span', {}, b.timed ? '' : 'Weight'), h('span', {}, b.timed ? 'Time' : 'Reps'), h('span', {})),
    rowsEl,
    h('div', { class: 'row-flex', style: 'justify-content:space-between' },
      h('button', { class: 'add-row', style: 'width:auto', onclick: () => { count += 1; rowsEl.append(setRow(count)); } }, icon('plus', 20), 'Add a set'),
      b.notes ? h('details', { style: 'max-width:60%' }, h('summary', { style: 'min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600' }, 'Technique'), h('p', { class: 'sub', style: 'padding-bottom:8px' }, b.notes)) : null));
}

function cardioSheet(date, today, done) {
  sheet('Log cardio', (close) => {
    const kind = h('select', { 'aria-label': 'Type' }, ['Run', 'Walk', 'Cycle', 'Row', 'Swim', 'Elliptical', 'Stairs', 'Other'].map((k) => h('option', { value: k }, k)));
    const i = { minutes: numInput('', { min: 1, max: 600 }), km: numInput('', { min: 0, max: 500 }), hr: numInput('', { min: 40, max: 230, inputmode: 'numeric' }) };
    return h('div', { class: 'stack' },
      field('Type', kind),
      h('div', { class: 'grid3' }, field('Minutes', i.minutes), field('Distance (km)', i.km), field('Avg heart rate', i.hr)),
      h('button', { class: 'btn block', onclick: async () => {
        try { await api('POST', '/api/train/cardio', { date, today, kind: kind.value, minutes: Number(i.minutes.value), distanceKm: i.km.value || undefined, avgHr: i.hr.value || undefined }); close(); toast('Cardio saved'); done(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Save cardio'));
  });
}

// ---------------------------------------------------------------- history & records
export async function historyView() {
  const main = paint('train', loading());
  const run = () => guard(main, async () => {
    const h_ = await api('GET', '/api/train/history');
    main.replaceChildren(
      h('p', { style: 'margin:0 0 10px -4px' }, h('button', { class: 'link', style: 'text-decoration:none;font-weight:600', onclick: () => navigate('/train') }, '‹ Train')),
      h('h1', { class: 'title' }, 'History'),
      h_.records.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Personal bests'), h('span', { class: 'sub' }, 'Estimated max')),
        h_.records.slice(0, 25).map((r) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, r.name), h('span', { class: 'sub' }, `${r.weightKg > 0 ? `${fmt1(r.weightKg)} kg × ${r.reps}` : `${r.reps} reps`} · ${fmtDate(r.date, { day: 'numeric', month: 'short' })}`)),
          h('span', { class: 'num', style: 'font-size:28px' }, r.e1rm > 0 ? `${fmt1(r.e1rm)}` : '–')))) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Sessions')),
        h_.sessions.length ? h_.sessions.map((s) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, fmtDate(s.date)), h('span', { class: 'sub' }, `${s.exercises} exercises · ${s.sets} sets`)),
          h('span', { class: 'sub' }, `${fmt(s.volume)} kg lifted`)))
          : h('p', { class: 'muted', style: 'padding:14px 0' }, 'Log your first workout and it appears here.')),
      h_.cardio.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Cardio')),
        h_.cardio.map((c) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, c.kind), h('span', { class: 'sub' }, fmtDate(c.date))),
          h('span', { class: 'sub' }, `${fmt1(c.minutes)} min${c.distanceKm ? ` · ${fmt1(c.distanceKm)} km` : ''}`)))) : null);
  }, run);
  await run();
}
