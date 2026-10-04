import { h } from '../dom.js';
import { tour } from '../tour.js';
import { loadMe } from '../session.js';
import { api, send } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { swapSheet, mealSheet } from '../swap.js';
import { installCard } from '../install.js';
import { icon, sheet, toast, emptyState, field, numInput, foodPicker, seg, weekStrip as weekStripUI, celebrate, local, amountPicker } from '../ui.js';

/*
 * Today: the hub. Food for the day, today's workout, and the week at a glance.
 *
 * Interaction model (optimistic): ticking an item updates the screen immediately from the
 * item's own macros, then syncs in the background. If the server rejects it, the tick is
 * reverted and a toast explains. The day score comes back from the server on the next
 * quiet refresh, so nothing on screen waits for the network after a tap.
 */
export async function todayView() {
  const main = paint('today', loading());
  const today = localDate();
  const date = state.date ?? today;
  const ui = { open: new Set() }; // meals the user opened or is working in (stay expanded)
  let d = null; let tr = null; let scores = new Map();
  // Extras that only matter when looking at today on your own account: streak, weigh-in, recap.
  const own = date === today && !state.as;
  const weekend = [5, 6, 0].includes(new Date().getDay()); // Friday to Sunday: the weekly recap shows
  const extra = { streak: 0, metrics: null, recap: null };

  const load = async () => {
    const [day, train, adh, met, rec] = await Promise.all([
      api('GET', `/api/today?date=${date}`),
      api('GET', `/api/train?date=${date}`).catch(() => null),
      api('GET', `/api/adherence?days=14&today=${today}`).catch(() => ({ scores: [] })),
      own ? api('GET', '/api/metrics').catch(() => null) : null,
      own && weekend ? api('GET', `/api/recap?today=${today}`).catch(() => null) : null,
    ]);
    d = day; tr = train;
    scores = new Map(adh.scores.map((s) => [s.date, s]));
    extra.streak = adh.streak ?? 0;
    if (met) extra.metrics = met.metrics;
    if (rec) extra.recap = rec.recap;
  };
  const render = () => { main.replaceChildren(...build({ d, tr, scores, date, today, ui, act, extra })); maybeCelebrate(); };

  // The first time today's score is seen at 70 or more (here, after a tick, or after training),
  // celebrate once. Remembered per device and day.
  const maybeCelebrate = () => {
    const s = scores.get(today);
    if (!own || !d?.planId || !s || !(s.consumed?.kcal > 0) || s.total < 70 || local.get('dayDone') === today) return;
    local.set('dayDone', today);
    celebrate({ icon: 'check', title: 'Day complete', stat: `${s.total} pts`, text: extra.streak > 1 ? `${extra.streak}-day streak. Keep it going tomorrow.` : 'That is a 70+ day. Do it again tomorrow to start a streak.' });
  };

  // Quiet refresh after writes: pulls the server's score and totals without a loading state.
  let refreshTimer;
  const refreshSoon = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => { try { await load(); render(); } catch { /* keep the optimistic view */ } }, 600);
  };

  const recompute = () => {
    const sum = { kcal: 0, p: 0, c: 0, f: 0 };
    for (const m of d.meals) for (const it of m.items) {
      if (!it.log || it.log.status === 'skipped') continue;
      for (const k of ['kcal', 'p', 'c', 'f']) sum[k] += it.log[k] ?? it[k];
    }
    for (const e of d.extras) for (const k of ['kcal', 'p', 'c', 'f']) sum[k] += e[k] ?? 0;
    d.consumed = sum;
  };
  const eatenLog = (it) => ({ status: 'eaten', foodId: it.foodId, name: it.name, grams: it.grams, kcal: it.kcal, p: it.p, c: it.c, f: it.f });

  const act = {
    goDate: (dt) => { state.date = dt === today ? null : dt; todayView(); },
    // One tap: eaten <-> not logged. Instant on screen, synced behind.
    toggle: async (it, mealIdx) => {
      ui.open.add(mealIdx);
      const prev = it.log;
      it.log = prev ? null : eatenLog(it);
      recompute(); render();
      try {
        if (prev) await send('POST', '/api/log/remove', { date, ref: it.key });
        else await send('POST', '/api/log', { date, today, ref: it.key, status: 'eaten' });
        refreshSoon();
      } catch (e) { it.log = prev; recompute(); render(); toast(e.message, 'bad'); }
    },
    // Log every unlogged item in a meal, with Undo.
    logAll: async (mealIdx) => {
      const m = d.meals[mealIdx];
      const todo = m.items.filter((it) => !it.log);
      todo.forEach((it) => { it.log = eatenLog(it); });
      ui.open.delete(mealIdx);
      recompute(); render();
      try {
        for (const it of todo) await send('POST', '/api/log', { date, today, ref: it.key, status: 'eaten' });
        refreshSoon();
        toast(`${m.name} logged`, '', { label: 'Undo', run: () => act.undo(todo, mealIdx) });
      } catch (e) { toast(e.message, 'bad'); await load(); render(); }
    },
    undo: async (items, mealIdx) => {
      items.forEach((it) => { it.log = null; });
      ui.open.add(mealIdx);
      recompute(); render();
      try { for (const it of items) await send('POST', '/api/log/remove', { date, ref: it.key }); refreshSoon(); } catch (e) { toast(e.message, 'bad'); await load(); render(); }
    },
    options: (it) => itemSheet(it, date, today, async () => { await load(); render(); }),
    swap: (it) => swapSheet({ ref: it.key, date, name: it.name, onDone: async () => { await load(); render(); } }),
    changeMeal: (mealIdx) => mealSheet({ date, meal: mealIdx, onDone: async () => { await load(); render(); } }),
    water: async (ml) => {
      const prev = d.water.ml;
      d.water.ml = Math.max(0, prev + ml); render();
      try { const r = await send('POST', '/api/water', { date, add: ml }); if (r.water) { d.water = r.water; render(); } }
      catch (e) { d.water.ml = prev; render(); toast(e.message, 'bad'); }
    },
    rebalance: async (btn) => {
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/today/rebalance', { date });
        await load(); render();
        toast(r.changed ? (r.stillOver ? `Trimmed what is realistic: about ${fmt(r.after - r.target)} kcal over. One day like this is fine.` : `Rest of today trimmed: ${fmt(r.after)} kcal`) : 'Nothing left to trim today.');
      } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    },
    ask: (text) => { try { sessionStorage.setItem('coachDraft', text); } catch { /* private mode: open the coach without a draft */ } navigate('/coach'); },
    add: () => addSheet(date, today, async () => { await load(); render(); }),
    weigh: async (kg) => {
      const prev = extra.metrics?.filter((m) => m.weightKg).at(-1);
      await api('POST', '/api/metrics', { date: today, weightKg: kg });
      extra.metrics = [...(extra.metrics ?? []).filter((m) => m.date !== today), { date: today, weightKg: kg }];
      render();
      const diff = prev ? Math.round((kg - prev.weightKg) * 10) / 10 : null;
      toast(diff === null ? 'Weight saved' : `Weight saved · ${diff > 0 ? '+' : ''}${diff} kg since ${fmtDate(prev.date, { day: 'numeric', month: 'short' })}`);
    },
    dismiss: (key, value) => { local.set(key, value); render(); },
    removeExtra: async (e) => {
      d.extras = d.extras.filter((x) => x !== e); recompute(); render();
      try { await send('POST', '/api/log/remove', { date, ref: e.ref }); refreshSoon(); } catch (err) { toast(err.message, 'bad'); await load(); render(); }
    },
  };

  await guard(main, async () => {
    await load();
    // The app stayed open through an admin "Start everyone over": the profile is gone, so set up again.
    if (d.plan === null && !d.hasPending && state.me?.profile && !state.as) {
      await loadMe();
      if (!state.me.profile) { navigate('/onboarding'); return; }
    }
    render();
  }, () => todayView());
  // First open with a plan: the one-minute tour (once per phone, replay from Profile).
  if (own && d?.planId) tour();
}

// ---------- view ----------
function build({ d, tr, scores, date, today, ui, act, extra }) {
  const head = [
    h('div', { class: 'today-head' },
      h('div', {},
        h('h1', { class: 'title', style: 'margin-bottom:4px' }, date === today ? 'Today' : fmtDate(date, { weekday: 'long' })),
        h('p', { class: 'sub', style: 'margin-bottom:16px' }, fmtDate(date, { weekday: date === today ? 'long' : undefined, day: 'numeric', month: 'long' }))),
      // Streak of 70+ days, always in sight (like a flame counter), linked to Progress.
      date === today && extra.streak > 0 ? h('a', { class: 'streak-chip', href: '#/progress', 'aria-label': `${extra.streak}-day streak` }, icon('flame', 18), String(extra.streak), h('span', {}, extra.streak === 1 ? 'day' : 'days')) : null),
    weekStrip(date, today, scores, act),
  ];

  if (d.plan === null) {
    const isAdmin = state.me?.user.role === 'admin';
    return [...head, d.hasPending
      ? emptyState('Your plan is with the admin', 'A plan has been drafted for you. It shows up here as soon as it is approved.',
          isAdmin && !state.as ? h('button', { class: 'btn', onclick: () => navigate('/admin') }, 'Review plans') : null)
      : emptyState('No plan yet', 'Tell us about you and your goal, and a plan is drafted for you.', h('button', { class: 'btn', onclick: () => navigate('/onboarding') }, 'Set up my plan'))];
  }

  // Food first: the numbers, then the meals with the next one to eat marked. Training, water
  // and the install tip come after, so the thing you open the app for is on the first screen.
  const next = date === today ? d.meals.findIndex((m) => m.items.some((i) => !i.log)) : -1;
  // On a training day that is not finished yet, the session sits right under the numbers so it
  // is never buried below five meals; otherwise it stays at the end.
  const planned = tr?.blocks?.reduce((a, b) => a + (b.plan?.sets ?? 0), 0) ?? 0;
  const trainingOpen = date === today && tr?.hasPlan && !tr.restDay && (tr.blocks.reduce((a, b) => a + b.sets.length, 0) < planned || tr.checkin?.status !== 'approved');
  return [
    ...head,
    summaryCard(d, scores.get(date)),
    dayDoneCard(scores.get(date), date === today, extra),
    weighInCard(extra, today, act),
    trainingOpen ? workoutRow(tr, true) : null,
    recapCard(extra.recap, act),
    overBanner(d, act),
    ...d.meals.map((m, i) => mealPanel(m, i, ui, act, i === next)),
    extrasPanel(d.extras, act),
    askBar(act),
    trainingOpen ? null : workoutRow(tr, date === today),
    waterCard(d.water, act),
    installCard(),
  ];
}

/** A quiet, permanent "you did it" under the numbers once the day scores 70+. */
function dayDoneCard(s, isToday, extra) {
  if (!s || !(s.consumed?.kcal > 0) || s.total < 70) return null;
  return h('section', { class: 'done-card', 'aria-label': `${s.total} points, a 70+ day` },
    h('span', { class: 'ic' }, icon('flame', 22)),
    h('span', {},
      h('span', { class: 'strong' }, `${s.total} points${isToday ? ' today' : ''}`),
      h('span', { class: 'sub' }, isToday && extra.streak > 1 ? `${extra.streak}-day streak. Keep it going.` : isToday ? 'A 70+ day. Repeat tomorrow for a streak.' : 'A 70+ day, counted toward the month')),
    h('span', { class: 'ic gold', 'aria-hidden': 'true' }, icon('trophy', 20)));
}

/**
 * Weekly weigh-in: on Fridays, or when the last weight is more than a week old. One field, one tap.
 * "Not today" hides it until tomorrow.
 */
function weighInCard(extra, today, act) {
  const m = extra.metrics;
  if (!m || local.get('weighSkip') === today) return null;
  const weights = m.filter((x) => x.weightKg);
  const last = weights.at(-1);
  if (last?.date === today) return null;
  const friday = new Date().getDay() === 5;
  const stale = !last || (Date.parse(today) - Date.parse(last.date)) / 86400000 >= 8;
  if (!friday && !stale) return null;
  const input = numInput('', { min: 30, max: 400, step: 0.1, placeholder: last ? String(last.weightKg) : 'kg', 'aria-label': 'Weight in kg' });
  const save = h('button', { class: 'btn', onclick: async () => {
    const kg = Number(input.value);
    if (!(kg >= 30 && kg <= 400)) { toast('Enter your weight in kg', 'bad'); input.focus(); return; }
    save.disabled = true;
    try { await act.weigh(Math.round(kg * 10) / 10); } catch (e) { toast(e.message, 'bad'); save.disabled = false; }
  } }, 'Save');
  return h('section', { class: 'prompt-card' },
    h('div', { class: 'head' },
      h('span', { class: 'ic' }, icon('scale', 22)),
      h('span', { class: 'grow' },
        h('span', { class: 'strong' }, friday ? 'Friday weigh-in' : 'Time to weigh in'),
        h('span', { class: 'sub' }, last ? `Last: ${last.weightKg} kg on ${fmtDate(last.date, { day: 'numeric', month: 'short' })}. Weigh after the toilet, before food or water.` : 'Weigh after the toilet, before food or water. Same scale each week.')),
      h('button', { class: 'icon-btn x', 'aria-label': 'Not today', onclick: () => act.dismiss('weighSkip', today) }, icon('close', 18))),
    h('div', { class: 'weigh-row' }, input, save));
}

/** Friday to Sunday: the week in three numbers, with the full recap one tap away. Dismiss per week. */
function recapCard(r, act) {
  if (!r || local.get('recapSeen') === r.to) return null;
  const sofar = r.to >= localDate();
  return h('section', { class: 'prompt-card recap-card' },
    h('div', { class: 'head' },
      h('span', { class: 'ic' }, icon('trophy', 22)),
      h('span', { class: 'grow' },
        h('span', { class: 'strong' }, sofar ? 'Your week so far' : 'Your week'),
        h('span', { class: 'sub' }, `${fmtDate(r.from, { weekday: 'short', day: 'numeric' })} – ${fmtDate(r.to, { weekday: 'short', day: 'numeric', month: 'short' })}`)),
      h('button', { class: 'icon-btn x', 'aria-label': 'Hide this week\'s recap', onclick: () => act.dismiss('recapSeen', r.to) }, icon('close', 18))),
    h('div', { class: 'recap-stats' },
      h('div', {}, h('b', {}, fmt(r.points)), h('span', {}, 'points')),
      h('div', {}, h('b', {}, `#${r.rank}`), h('span', {}, `of ${r.of}`)),
      h('div', {}, h('b', {}, r.gym ? `${r.gym.attended}/${r.gym.planned}` : `${r.days70}`), h('span', {}, r.gym ? 'gym days' : '70+ days'))),
    h('button', { class: 'btn ghost block', onclick: () => recapSheet(r) }, 'See the full recap'));
}

function recapSheet(r) {
  const rows = [
    ['Average day', `${r.avg} points`],
    ['70+ days', `${r.days70} of ${r.days}`],
    r.gym ? ['Gym', `${r.gym.attended} of ${r.gym.planned} sessions`] : null,
    r.sets ? ['Sets ticked', String(r.sets)] : null,
    r.bestLift ? ['Best lift', `${r.bestLift.name}: ${r.bestLift.weightKg} kg × ${r.bestLift.reps}`] : null,
    r.prs ? ['Personal records', String(r.prs)] : null,
    r.weightChange !== null ? ['Weight', `${r.weightChange > 0 ? '+' : ''}${r.weightChange} kg`] : null,
  ].filter(Boolean);
  sheet('Your week', () => h('div', { class: 'stack' },
    h('div', { class: 'recap-stats' },
      h('div', {}, h('b', {}, fmt(r.points)), h('span', {}, 'points')),
      h('div', {}, h('b', {}, `#${r.rank}`), h('span', {}, `of ${r.of} in the crew`)),
      h('div', {}, h('b', {}, r.avg), h('span', {}, 'a day'))),
    h('div', {}, rows.map(([k, v]) => h('div', { class: 'list-row', style: 'cursor:default;min-height:48px' }, h('span', { class: 'grow sub' }, k), h('span', { class: 'strong' }, v)))),
    h('div', { class: 'notice' }, h('b', {}, 'Next week: '), r.tip),
    h('a', { class: 'btn ghost block', href: '#/group' }, 'See the crew board')));
}

function weekStrip(date, today, scores, act) {
  const dots = new Map();
  for (const [dt, sc] of scores) if (dt !== today && sc.consumed.kcal > 0) dots.set(dt, sc.total >= 70 ? 'hit' : 'miss');
  return weekStripUI({ date, today, onPick: act.goDate, dots, labelFor: (dt) => (dots.has(dt) ? `, score ${scores.get(dt).total}` : '') });
}

/** Calorie ring (remaining in the centre) + three macro bars + score footer. */
function summaryCard(d, s) {
  const t = d.targets; const c = d.consumed;
  const left = Math.round(t.kcal - c.kcal);
  const R = 56; const C = 2 * Math.PI * R; const pct = Math.min(1, c.kcal / t.kcal);
  const macro = (label, k, v, target) => h('div', { class: 'macro' },
    h('div', { class: 'row' }, h('span', {}, label), h('span', {}, h('b', {}, Math.round(v)), ` / ${Math.round(target)} g`)),
    h('div', { class: `mbar ${k}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': Math.round(target), 'aria-valuenow': Math.round(v) },
      h('i', { style: `transform:scaleX(${Math.min(1, target ? v / target : 0)})` })));
  const score = c.kcal > 0 ? (s?.total ?? d.score?.total) : null;
  const allDone = d.meals.every((m) => m.items.every((i) => i.log));
  return h('section', { class: `section summary-card ${allDone ? 'complete' : ''}` },
    allDone ? h('p', { class: 'done-banner' }, icon('check', 16), 'Day complete. Everything is logged.') : null,
    h('div', { class: 'summary' },
      h('div', { class: `kring ${-left > t.kcal * 0.05 ? 'over' : ''}`, role: 'img', 'aria-label': `${Math.abs(left)} calories ${left < 0 ? 'over target' : 'left'} of ${fmt(t.kcal)}` },
        h('svg', { viewBox: '0 0 128 128', width: 128, height: 128 },
          // Accent gradient for the ring (colours come from the theme tokens).
          h('defs', {}, h('linearGradient', { id: 'kgrad', x1: '0', y1: '0', x2: '1', y2: '1' },
            h('stop', { offset: '0', style: 'stop-color:var(--go)' }), h('stop', { offset: '1', style: 'stop-color:var(--go-2)' }))),
          h('circle', { class: 'track', cx: 64, cy: 64, r: R }),
          h('circle', { class: 'fill', cx: 64, cy: 64, r: R, 'stroke-dasharray': `${C * pct} ${C}` })),
        h('div', { class: 'center' }, h('b', {}, fmt(Math.abs(left))), h('span', {}, left < 0 ? 'kcal over' : 'kcal left'))),
      h('div', { class: 'macros' },
        macro('Protein', 'p', c.p, t.proteinG), macro('Carbs', 'c', c.c, t.carbsG), macro('Fat', 'f', c.f, t.fatG))),
    h('div', { class: 'summary-foot' },
      h('span', {}, 'Eaten ', h('b', {}, fmt(c.kcal)), ` of ${fmt(t.kcal)} kcal`),
      score !== null && score !== undefined ? h('a', { href: '#/progress', class: 'foot-link' }, 'Score ', h('b', { class: score >= 70 ? 'good' : '' }, score), icon('chevR', 16)) : h('a', { href: '#/progress', class: 'foot-link' }, 'Progress', icon('chevR', 16))));
}

/** Shown only when what is logged puts the day on course to go over by more than 5%. */
function overBanner(d, act) {
  const left = d.meals.some((m) => m.items.some((i) => !i.log));
  if (!left || !(d.projectedKcal > d.targets.kcal * 1.05)) return null;
  const over = d.projectedKcal - d.targets.kcal;
  return h('section', { class: 'section over-banner' },
    h('div', { class: 'meal-head' },
      h('span', { class: 'grow' }, h('span', { class: 'h3' }, `On course for ${fmt(d.projectedKcal)} kcal`),
        h('span', { class: 'sub' }, `${fmt(over)} over your ${fmt(d.targets.kcal)}. Trim what is left of today, keeping your protein.`)),
      h('button', { class: 'btn small', onclick: (e) => act.rebalance(e.currentTarget) }, 'Rebalance')));
}

/** One line to the coach: "I had koshari for lunch", "swap my rice", anything. */
function askBar(act) {
  const input = h('input', { type: 'text', placeholder: 'Ate something else? Tell the coach…', 'aria-label': 'Message your coach', enterkeyhint: 'send', autocomplete: 'off' });
  const go = () => { const t = input.value.trim(); if (t) act.ask(t); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'askbar' }, h('span', { class: 'ico' }, icon('coach', 20)), input, h('button', { class: 'send', 'aria-label': 'Send to coach', onclick: go }, icon('send', 18)));
}

/** Water: 250 ml glasses; tap the next empty glass to add, tap a full one to remove. */
function waterCard(w, act) {
  if (!w) return null;
  const glasses = Math.round(w.target / 250);
  const full = Math.floor(w.ml / 250);
  const L = (ml) => (ml / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return h('section', { class: 'section water' },
    h('div', { class: 'meal-head' },
      h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Water'), h('span', { class: 'sub' }, `${L(w.ml)} of ${L(w.target)} L`)),
      h('button', { class: 'textbtn', onclick: () => act.water(500) }, '+ 500 ml')),
    h('div', { class: 'glasses', role: 'group', 'aria-label': `Water, ${L(w.ml)} of ${L(w.target)} litres` },
      Array.from({ length: glasses }, (_, i) => h('button', {
        class: `glass ${i < full ? 'full' : ''}`, 'aria-label': i < full ? `Remove a glass (${i + 1})` : `Add a glass (${i + 1})`,
        onclick: () => act.water(i < full ? -250 : 250),
      }, icon('drop', 20)))));
}

function workoutRow(tr, isToday) {
  if (!tr || !tr.hasPlan) return null;
  if (tr.restDay) {
    return h('a', { class: 'strip', href: '#/train' }, h('span', { class: 'ico' }, icon('train', 22)),
      h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Rest day'), h('span', { class: 'sub' }, 'Recovery counts. Cardio is optional.')), icon('chevR', 20));
  }
  const planned = tr.blocks.reduce((a, b) => a + (b.plan?.sets ?? 0), 0);
  const logged = tr.blocks.reduce((a, b) => a + b.sets.length, 0);
  const done = planned > 0 && logged >= planned;
  const ci = tr.checkin?.status;
  const checkin = ci === 'approved' ? 'checked in' : ci === 'pending' ? 'check-in pending' : isToday ? 'check in at the gym' : 'no check-in';
  return h('a', { class: `strip ${done && ci === 'approved' ? 'done' : ''}`, href: '#/train' }, h('span', { class: 'ico' }, icon(done && ci === 'approved' ? 'check' : 'train', 22)),
    h('span', { class: 'grow' }, h('span', { class: 'h3' }, tr.dayName ?? 'Workout'),
      h('span', { class: 'sub' }, `${logged ? `${logged} of ${planned} sets` : `${tr.blocks.length} exercises · ${planned} sets`} · ${checkin}`)),
    h('span', { class: 'cta' }, done ? 'View' : logged ? 'Continue' : isToday ? 'Start' : 'Log'));
}

/** A meal panel. Fully logged meals fold to one line; tap to review. */
function mealPanel(m, idx, ui, act, isNext = false) {
  const planned = m.items.reduce((a, i) => a + i.kcal, 0);
  const handled = m.items.filter((i) => i.log).length;
  const complete = handled === m.items.length;
  const eaten = m.items.filter((i) => i.log && i.log.status !== 'skipped').reduce((a, i) => a + (i.log.kcal ?? i.kcal), 0);
  const titleBlock = h('span', { class: 'grow' }, h('span', { class: 'h3' }, m.name, isNext ? h('span', { class: 'next-chip' }, 'Up next') : null),
    h('span', { class: 'sub' }, complete ? `Done · ${fmt(eaten)} kcal` : m.title ?? `${m.items.length} items`,
      m.mealSwappedFrom && !complete ? h('span', { class: 'changed-chip' }, 'Today only') : null));
  const rows = m.items.map((it) => itemRow(it, idx, act));
  if (complete && !ui.open.has(idx)) {
    return h('details', { class: 'section meal', ontoggle: (e) => { if (e.currentTarget.open) ui.open.add(idx); else ui.open.delete(idx); } },
      h('summary', { class: 'meal-head', 'aria-label': `${m.name}, all logged, ${fmt(eaten)} kcal. Show items` },
        h('span', { class: 'tick', style: 'background:var(--go);border-color:var(--go);color:var(--go-ink)' }, icon('check', 14)), titleBlock, h('span', { class: 'chev' }, icon('chevR', 18))),
      ...rows);
  }
  // Number-first card: "Meal 2 · Lunch" with the calories big on the right, the meal's macros under
  // it, the items, then "Change meal" and "Log all" at the foot where the thumb is.
  const sum = (k) => Math.round(m.items.reduce((a, i) => a + (i[k] ?? 0), 0));
  return h('section', { class: `section${isNext ? ' meal-next' : ''}` },
    h('div', { class: 'meal-head' },
      h('span', { class: 'grow' }, h('span', { class: 'meal-eyebrow' }, `Meal ${idx + 1}`), titleBlock.firstChild, titleBlock.lastChild),
      h('span', { class: 'meal-kcal' }, fmt(planned), h('small', {}, 'kcal'))),
    h('div', { class: 'meal-macros', 'aria-label': `Protein ${sum('p')} g, carbs ${sum('c')} g, fat ${sum('f')} g` },
      h('span', {}, h('i', { style: 'background:var(--protein)' }), 'P ', h('b', {}, sum('p')), 'g'),
      h('span', {}, h('i', { style: 'background:var(--carbs)' }), 'C ', h('b', {}, sum('c')), 'g'),
      h('span', {}, h('i', { style: 'background:var(--fat)' }), 'F ', h('b', {}, sum('f')), 'g')),
    ...rows,
    complete ? null : h('div', { class: 'meal-foot' },
      h('button', { class: 'swap-link', onclick: () => act.changeMeal(idx), 'aria-label': `Change ${m.name.toLowerCase()} for another meal` }, icon('swap', 16), 'Change meal'),
      h('button', { class: 'btn small', onclick: (e) => { e.currentTarget.disabled = true; act.logAll(idx); } }, icon('check', 16), 'Log all')));
}

// "Egyptian salad (salata baladi)" -> "Egyptian salad": the list stays readable; the sheet has the full name.
const shortName = (n) => String(n).replace(/\s*\([^)]*\)\s*$/, '');

function itemRow(it, mealIdx, act) {
  const st = it.log?.status ?? 'none';
  // Planned amount, with a household hint when one reads naturally ("260 g cooked · about 1½ cups").
  const base = (it.amount ?? (it.label ? `${it.label} · ${it.grams} g` : `${it.grams} g`)) + (it.hint ? ` · ${it.hint}` : '');
  const planned = it.swappedFrom ? `${base} · instead of ${it.swappedFrom.split(/[,(]/)[0].trim().toLowerCase()}`
    : it.resizedFrom ? `${base} · trimmed from ${it.resizedFrom} g` : base;
  // What was logged reads back the way it was entered: "Ate 3 eggs (planned 2 eggs)".
  const amt = st === 'adjusted' ? `Ate ${it.log.amount ?? `${it.log.grams} g`} · planned ${it.amount ?? `${it.grams} g`}`
    : st === 'swapped' ? `Had ${shortName(it.log.name).toLowerCase()} instead, ${it.log.amount ?? `${it.log.grams} g`}`
    : st === 'skipped' ? 'Skipped' : planned;
  const kcal = st === 'adjusted' || st === 'swapped' ? it.log.kcal : st === 'skipped' ? 0 : it.kcal;
  return h('div', { class: 'item', 'data-state': st },
    h('button', { class: 'rowbtn', role: 'checkbox', 'aria-checked': String(st !== 'none' && st !== 'skipped'), 'aria-label': `${it.name}, ${planned}, ${fmt(kcal)} kcal`, onclick: () => act.toggle(it, mealIdx) },
      h('span', { class: 'tick' }, icon('check', 14)),
      h('span', { class: 'item-main', style: 'padding:0;min-height:0' }, h('span', { class: 'item-name' }, shortName(it.name)), h('span', { class: 'item-amt' }, amt)),
      h('span', { class: 'item-kcal' }, fmt(kcal))),
    h('button', { class: 'more', 'aria-label': `More options for ${it.name}`, onclick: () => act.options(it, act) }, icon('dots', 20)));
}

function extrasPanel(extras, act) {
  return h('section', { class: 'section' },
    h('div', { class: 'meal-head' }, h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Other food'),
      h('span', { class: 'sub' }, extras.length ? `${fmt(extras.reduce((a, e) => a + e.kcal, 0))} kcal outside the plan` : 'Anything you ate that is not in the plan'))),
    ...extras.map((e) => h('div', { class: 'item', 'data-state': 'eaten' },
      h('span', { class: 'item-main' }, h('span', { class: 'item-name', style: 'color:var(--ink)' }, e.name), h('span', { class: 'item-amt' }, e.amount ?? (e.grams ? `${e.grams} g` : 'Custom entry'))),
      h('span', { class: 'item-kcal' }, fmt(e.kcal)),
      h('button', { class: 'more', 'aria-label': `Remove ${e.name}`, onclick: () => act.removeExtra(e) }, icon('trash', 18)))),
    h('button', { class: 'add-row', onclick: act.add }, icon('plus', 20), 'Add food'));
}

/**
 * Item sheet. Leads with "How much did you eat?": the planned amount in its natural unit
 * (4 eggs, 1½ loaves, 95 g dry) on a − / + stepper, so "I had 3 eggs, not 2" is two taps.
 * Then swaps, the whole-meal change, skip, and "ate something else".
 */
function itemSheet(it, date, today, reload) {
  const mealIdx = Number(String(it.key).split('-')[1]);
  sheet(shortName(it.name), (close) => {
    const save = async (body, msg = 'Saved') => {
      try { await send('POST', '/api/log', { date, today, ref: it.key, ...body }); close(); toast(msg); await reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    const clearLog = async () => { try { await send('POST', '/api/log/remove', { date, ref: it.key }); close(); await reload(); } catch (e) { toast(e.message, 'bad'); } };
    // Start from what was logged, if it was adjusted; otherwise from the plan.
    const startG = it.log?.status === 'adjusted' ? it.log.grams : it.grams;
    // The button says what will be saved: "Ate it as planned" or "Log 3 eggs".
    const saveBtn = h('button', { class: 'btn block' });
    const picker = amountPicker({
      units: it.units, grams: startG, planned: it.grams, per100: it.per100,
      onChange: (v) => {
        saveBtn.textContent = Math.abs(v.grams - it.grams) < 0.5 ? 'Ate it as planned' : `Log ${v.label}`;
        saveBtn.disabled = !(v.grams > 0);
      },
    });
    saveBtn.addEventListener('click', () => {
      const v = picker.value();
      if (Math.abs(v.grams - it.grams) < 0.5) save({ status: 'eaten' }, 'Logged');
      else save({ status: 'adjusted', unit: v.unit, qty: v.qty }, `Logged ${v.label}`);
    });
    const swap = h('div', {});
    const pickSwap = () => swap.replaceChildren(foodPicker((f) => {
      const p = amountPicker({ units: f.units, grams: 0, per100: f });
      const add = h('button', { class: 'btn', onclick: () => { const v = p.value(); if (v.grams > 0) save({ status: 'swapped', foodId: f.id, unit: v.unit, qty: v.qty }, `Logged ${v.label}`); } }, 'Save');
      swap.replaceChildren(h('div', { class: 'stack' },
        h('p', { class: 'item-name' }, f.name),
        p.el,
        h('div', { class: 'row-flex' }, add, h('button', { class: 'btn ghost', onclick: pickSwap }, 'Pick another'))));
    }));
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'stack' },
        h('p', { class: 'eyebrow' }, `Planned · ${it.amount ?? `${it.grams} g`} · ${fmt(it.kcal)} kcal`),
        h('h3', { class: 'h2' }, 'How much did you eat?'),
        picker.el, saveBtn),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'act-row', onclick: () => { close(); swapSheet({ ref: it.key, date, name: it.name, onDone: reload }); } },
          h('span', { class: 'ico' }, icon('swap', 20)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Swap for an equivalent'), h('span', { class: 'sub' }, 'Same protein, carbs or fat')), icon('chevR', 18)),
        h('button', { class: 'act-row', onclick: () => { close(); mealSheet({ date, meal: mealIdx, onDone: reload }); } },
          h('span', { class: 'ico' }, icon('plan', 20)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Change the whole meal'), h('span', { class: 'sub' }, 'Another complete meal, same calories')), icon('chevR', 18)),
        h('button', { class: 'act-row', onclick: () => save({ status: 'skipped' }, 'Marked skipped') },
          h('span', { class: 'ico' }, icon('close', 20)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'I skipped it')), null),
        it.log ? h('button', { class: 'act-row', onclick: clearLog }, h('span', { class: 'ico' }, icon('trash', 20)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Clear what I logged')), null) : null),
      h('div', { class: 'stack' }, h('p', { class: 'h3' }, 'Ate something else instead'),
        swap, h('button', { class: 'btn ghost block', onclick: (e) => { e.currentTarget.remove(); pickSwap(); } }, icon('plus', 18), 'Find a food')));
  });
}

function addSheet(date, today, reload) {
  sheet('Add food', (close) => {
    const area = h('div', {});
    const add = async (body, label) => {
      try { await api('POST', '/api/log/extra', { date, today, ...body }); close(); toast(label ? `Added ${label}` : 'Added'); await reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    // Pick a food, then say how much the way you would say it: 2 pieces of taameya, 1 plate of koshari.
    const showSearch = () => area.replaceChildren(foodPicker((f) => {
      const p = amountPicker({ units: f.units, grams: 0, per100: f });
      area.replaceChildren(h('div', { class: 'stack' }, h('p', { class: 'h3' }, f.name), p.el,
        h('div', { class: 'row-flex' },
          h('button', { class: 'btn', onclick: () => { const v = p.value(); if (v.grams > 0) add({ foodId: f.id, unit: v.unit, qty: v.qty }, v.label); } }, 'Add'),
          h('button', { class: 'btn ghost', onclick: showSearch }, 'Pick another'))));
    }));
    const showCustom = () => {
      const f = { name: h('input', { type: 'text', 'aria-label': 'Name' }), kcal: numInput('', { min: 0 }), p: numInput('', { min: 0 }), c: numInput('', { min: 0 }), f: numInput('', { min: 0 }) };
      area.replaceChildren(h('div', { class: 'stack' },
        field('What did you eat?', f.name),
        h('div', { class: 'grid2' }, field('Calories', f.kcal), field('Protein (g)', f.p)),
        h('div', { class: 'grid2' }, field('Carbs (g)', f.c), field('Fat (g)', f.f)),
        h('button', { class: 'btn', onclick: () => add({ name: f.name.value, kcal: Number(f.kcal.value), p: Number(f.p.value || 0), c: Number(f.c.value || 0), f: Number(f.f.value || 0) }) }, 'Add')));
    };
    const tabs = seg([['search', 'From the food list'], ['custom', 'Enter it myself']], 'search', (v) => (v === 'search' ? showSearch() : showCustom()), 'How to add');
    showSearch();
    return h('div', { class: 'stack' }, tabs, area);
  });
}
