import { h } from '../dom.js';
import { tour } from '../tour.js';
import { loadMe } from '../session.js';
import { api, send } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt } from '../state.js';
import { paint, loading, guard, onPull } from '../shell.js';
import { navigate } from '../router.js';
import { swapSheet, mealSheet } from '../swap.js';
import { installCard } from '../install.js';
import { checkinCard, resultSheet } from '../checkin.js';
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
  const extra = { streak: 0, metrics: null, recap: null, checkin: null };

  const load = async () => {
    const [day, train, adh, met, rec, ci] = await Promise.all([
      api('GET', `/api/today?date=${date}`),
      api('GET', `/api/train?date=${date}`).catch(() => null),
      api('GET', `/api/adherence?days=14&today=${today}`).catch(() => ({ scores: [] })),
      own ? api('GET', '/api/metrics').catch(() => null) : null,
      own && weekend ? api('GET', `/api/recap?today=${today}`).catch(() => null) : null,
      // Adaptive weekly check-in: opens Friday to Sunday; a proposed change stays until answered.
      own ? api('GET', `/api/checkin/weekly?today=${today}`).catch(() => null) : null,
    ]);
    d = day; tr = train;
    scores = new Map(adh.scores.map((s) => [s.date, s]));
    extra.streak = adh.streak ?? 0;
    if (met) extra.metrics = met.metrics;
    if (rec) extra.recap = rec.recap;
    extra.checkin = ci?.checkin ?? null;
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
    // Extras count wherever they are: inside a meal or not placed yet.
    for (const e of [...d.extras, ...d.meals.flatMap((m) => m.extras ?? [])]) for (const k of ['kcal', 'p', 'c', 'f']) sum[k] += e[k] ?? 0;
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
      // Ticking on: the check pops and Android gives a tiny buzz.
      if (!prev) { justKeys.add(it.key); navigator.vibrate?.(10); }
      recompute(); render(); justKeys.clear();
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
      navigator.vibrate?.(15);
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
    // Add food or a drink to a meal (the meal's own "+ Add", or the one at the end of the day).
    add: (mealIdx = null) => addSheet({ date, today, reload: async () => { await load(); render(); }, getDay: () => d, ask: act.ask, meal: mealIdx }),
    extra: (e) => extraSheet(e, d, { date, onDone: async () => { await load(); render(); }, remove: () => act.removeExtra(e) }),
    points: () => pointsSheet(scores.get(date) ?? d.score, d, date === today),
    weigh: async (kg) => {
      const prev = extra.metrics?.filter((m) => m.weightKg).at(-1);
      await api('POST', '/api/metrics', { date: today, weightKg: kg });
      extra.metrics = [...(extra.metrics ?? []).filter((m) => m.date !== today), { date: today, weightKg: kg }];
      render();
      const diff = prev ? Math.round((kg - prev.weightKg) * 10) / 10 : null;
      toast(diff === null ? 'Weight saved' : `Weight saved · ${diff > 0 ? '+' : ''}${diff} kg since ${fmtDate(prev.date, { day: 'numeric', month: 'short' })}`);
      // A Friday weigh-in is what the weekly check-in waits for: fetch it again.
      if (extra.checkin) { try { extra.checkin = (await api('GET', `/api/checkin/weekly?today=${today}`)).checkin; render(); } catch { /* keep the card as it was */ } }
    },
    checkin: {
      weigh: (kg) => act.weigh(kg),
      dismiss: (week) => act.dismiss('ciSeen', week),
      answer: async (answer, btn) => {
        btn.disabled = true; btn.classList.add('busy');
        try {
          const r = await api('POST', '/api/checkin/weekly/answer', { today, answer });
          extra.checkin = r.checkin;
          if (answer === 'accept' && r.checkin.result) { await load(); render(); resultSheet(r.checkin.result); }
          else { render(); if (answer === 'keep') toast('Kept your current plan. See you next Friday.'); }
        } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('busy'); }
      },
    },
    dismiss: (key, value) => { local.set(key, value); render(); },
    removeExtra: async (e) => {
      d.extras = d.extras.filter((x) => x !== e);
      for (const m of d.meals) m.extras = (m.extras ?? []).filter((x) => x !== e);
      recompute(); render();
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
  // Pull down to reload the day (another phone, or the coach, may have logged something).
  onPull(async () => { await load(); render(); });
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
  // On a training day without the gym check-in yet, the session sits right under the numbers so
  // it is never buried below five meals; otherwise it stays at the end.
  const trainingOpen = date === today && tr?.hasPlan && !tr.restDay && tr.checkin?.status !== 'approved'; // until the check-in is in
  return [
    ...head,
    summaryCard(d, scores.get(date), act),
    dayDoneCard(scores.get(date), date === today, extra),
    trainingOpen ? workoutRow(tr, true) : null,
    overBanner(d, act),
    // The weigh-in prompt sits after the next meal, so food stays the first thing on screen.
    ...d.meals.flatMap((m, i) => [mealPanel(m, i, ui, act, i === next, (scores.get(date) ?? d.score)?.meals?.[i] ?? null), i === Math.max(next, 0) ? [checkinOrWeighIn(extra, today, act), recapCard(extra.recap, act)] : null]),
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

/** The weekly check-in card when there is one (it asks for the weigh-in itself), else the weigh-in prompt. */
function checkinOrWeighIn(extra, today, act) {
  return checkinCard(extra.checkin, act.checkin) ?? weighInCard(extra, today, act);
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
function summaryCard(d, s, act) {
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
          // Nothing eaten yet: no fill at all (a zero-length round cap would draw a stray dot).
          pct > 0 ? h('circle', { class: 'fill', cx: 64, cy: 64, r: R, 'stroke-dasharray': `${C * pct} ${C}` }) : null),
        h('div', { class: 'center' }, h('b', {}, fmt(Math.abs(left))), h('span', {}, left < 0 ? 'kcal over' : 'kcal left'))),
      h('div', { class: 'macros' },
        macro('Protein', 'p', c.p, t.proteinG), macro('Carbs', 'c', c.c, t.carbsG), macro('Fat', 'f', c.f, t.fatG))),
    h('div', { class: 'summary-foot' },
      h('span', {}, 'Eaten ', h('b', {}, fmt(c.kcal)), ` of ${fmt(t.kcal)} kcal`),
      // The score opens what it is made of (and what would raise it), so points are never a mystery.
      score !== null && score !== undefined ? h('button', { class: 'foot-link', type: 'button', onclick: act.points, 'aria-label': `Score ${score}. See how today's points add up` }, 'Score ', h('b', { class: score >= 70 ? 'good' : '' }, score), icon('chevR', 16)) : h('a', { href: '#/progress', class: 'foot-link' }, 'Progress', icon('chevR', 16))));
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

/** "2.5 of 5 pts" under the target, "5 + 1.1 pts" past it, "7 pts · max" at the cap. */
function waterLabel(w) {
  const r = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
  if (w.ml < w.target) return `${r(w.points)} of 5 pts`;
  return w.points >= 6.95 ? '7 pts · max' : `5 + ${r(w.points - 5)} pts`;
}

/** Water: 250 ml glasses; tap the next empty glass to add, tap a full one to remove. */
function waterCard(w, act) {
  if (!w) return null;
  const glasses = Math.round(w.target / 250);
  const full = Math.floor(w.ml / 250);
  const L = (ml) => (ml / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return h('section', { class: 'section water' },
    h('div', { class: 'meal-head' },
      h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Water'), h('span', { class: 'sub' }, `${L(w.ml)} of ${L(w.target)} L`,
        // Points for water: 5 at the target, a little more (up to 7) for each litre over it.
        w.points !== undefined ? h('span', { class: `match-chip ${w.ml >= w.target ? 'good' : ''}`, title: 'Water points: 5 at your target, up to 7 above it' }, waterLabel(w)) : null)),
      h('button', { class: 'textbtn', onclick: () => act.water(500) }, '+ 500 ml')),
    h('div', { class: 'glasses', role: 'group', 'aria-label': `Water, ${L(w.ml)} of ${L(w.target)} litres` },
      Array.from({ length: glasses }, (_, i) => h('button', {
        class: `glass ${i < full ? 'full' : ''}`, 'aria-label': i < full ? `Remove a glass (${i + 1})` : `Add a glass (${i + 1})`,
        onclick: () => act.water(i < full ? -250 : 250),
      }, icon('drop', 20)))));
}

function workoutRow(tr, isToday) {
  if (!tr || !tr.hasPlan) return null;
  const ci = tr.checkin?.status;
  if (tr.restDay) {
    // A rest day: earns the training points when the day is logged (within the plan's rest days).
    const sub = ci === 'approved' ? 'Trained on a rest day: 20 + 10 = 30 points'
      : tr.rest && !tr.rest.counts ? 'Extra rest day this week: no training points. Tap to train instead.'
        : isToday ? 'Rest day: 20 points when you log today. Train anyway for +10.' : 'Rest day: 20 points when the day is logged.';
    return h('a', { class: `strip ${ci === 'approved' ? 'done' : ''}`, href: '#/train' }, h('span', { class: 'ico' }, icon(ci === 'approved' ? 'check' : 'train', 22)),
      h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Rest day'), h('span', { class: 'sub' }, sub)), icon('chevR', 20));
  }
  // A training day is done when the gym check-in is in: that is all 30 points. Sets are optional.
  const logged = tr.blocks.reduce((a, b) => a + b.sets.length, 0);
  const sub = ci === 'approved' ? `Checked in: +30 points${logged ? ` · ${logged} sets logged` : ''}`
    : ci === 'pending' ? 'Check-in pending'
      : isToday ? `${tr.blocks.length} exercises · check in at the gym for 30 points` : 'No check-in';
  return h('a', { class: `strip ${ci === 'approved' ? 'done' : ''}`, href: '#/train' }, h('span', { class: 'ico' }, icon(ci === 'approved' ? 'check' : 'train', 22)),
    h('span', { class: 'grow' }, h('span', { class: 'h3' }, tr.dayName ?? 'Workout'), h('span', { class: 'sub' }, sub)),
    h('span', { class: 'cta' }, ci === 'approved' ? 'View' : isToday ? 'Check in' : 'View'));
}

/** A meal panel. Fully logged meals fold to one line; tap to review. */
function mealPanel(m, idx, ui, act, isNext = false, mealScore = null) {
  const match = mealScore?.match ?? null;
  // Eating-out food in this meal earns when the meal still matches its plan (score.meals[].offCounted).
  const offCounted = mealScore?.offCounted ?? null;
  // The meal's numbers include what was added to it (the coffee with breakfast counts as breakfast).
  const planned = m.items.reduce((a, i) => a + i.kcal, 0) + (m.extras ?? []).reduce((a, e) => a + e.kcal, 0);
  const handled = m.items.filter((i) => i.log).length;
  const complete = handled === m.items.length;
  const extras = m.extras ?? [];
  const eaten = m.items.filter((i) => i.log && i.log.status !== 'skipped').reduce((a, i) => a + (i.log.kcal ?? i.kcal), 0) + extras.reduce((a, e) => a + e.kcal, 0);
  const titleBlock = h('span', { class: 'grow' }, h('span', { class: 'h3' }, m.name, isNext ? h('span', { class: 'next-chip' }, 'Up next') : null),
    h('span', { class: 'sub' }, complete ? `Done · ${fmt(eaten)} kcal` : m.title ?? `${m.items.length} items`,
      m.mealSwappedFrom && !complete ? h('span', { class: 'changed-chip' }, 'Today only') : null,
      // How close what was eaten is to this meal's plan (the meal-match points), once anything is logged.
      match !== null ? h('span', { class: `match-chip ${match >= 90 ? 'good' : match < 50 ? 'low' : ''}`, title: 'How close this meal is to its plan: calories, protein, carbs, fat' }, `${match}% match`) : null));
  const rows = [...m.items.map((it) => itemRow(it, idx, act)), ...extras.map((e) => extraRow(e, act, offCounted))];
  // Add food or a drink to this meal: coffee with breakfast, a juice with lunch.
  const addHere = h('button', { class: 'add-row meal-add', type: 'button', onclick: () => act.add(idx), 'aria-label': `Add food or a drink to ${m.name.toLowerCase()}` }, icon('plus', 18), 'Add food or drink');
  if (complete && !ui.open.has(idx)) {
    return h('details', { class: 'section meal', ontoggle: (e) => { if (e.currentTarget.open) ui.open.add(idx); else ui.open.delete(idx); } },
      h('summary', { class: 'meal-head', 'aria-label': `${m.name}, all logged, ${fmt(eaten)} kcal. Show items` },
        h('span', { class: 'tick', style: 'background:var(--go);border-color:var(--go);color:var(--go-ink)' }, icon('check', 14)), titleBlock, h('span', { class: 'chev' }, icon('chevR', 18))),
      ...rows, addHere);
  }
  // Number-first card: "Meal 2 · Lunch" with the calories big on the right, the meal's macros under
  // it, the items, then "Change meal" and "Log all" at the foot where the thumb is.
  const sum = (k) => Math.round([...m.items, ...extras].reduce((a, i) => a + (i[k] ?? 0), 0));
  return h('section', { class: `section${isNext ? ' meal-next' : ''}` },
    h('div', { class: 'meal-head' },
      h('span', { class: 'grow' }, h('span', { class: 'meal-eyebrow' }, `Meal ${idx + 1}`), titleBlock.firstChild, titleBlock.lastChild),
      h('span', { class: 'meal-kcal' }, fmt(planned), h('small', {}, 'kcal'))),
    h('div', { class: 'meal-macros', 'aria-label': `Protein ${sum('p')} g, carbs ${sum('c')} g, fat ${sum('f')} g` },
      h('span', {}, h('i', { style: 'background:var(--protein)' }), 'P ', h('b', {}, sum('p')), 'g'),
      h('span', {}, h('i', { style: 'background:var(--carbs)' }), 'C ', h('b', {}, sum('c')), 'g'),
      h('span', {}, h('i', { style: 'background:var(--fat)' }), 'F ', h('b', {}, sum('f')), 'g')),
    ...rows,
    addHere,
    complete ? null : h('div', { class: 'meal-foot' },
      h('button', { class: 'swap-link', onclick: () => act.changeMeal(idx), 'aria-label': `Change ${m.name.toLowerCase()} for another meal` }, icon('swap', 16), 'Change meal'),
      h('button', { class: 'btn small', onclick: (e) => { e.currentTarget.disabled = true; act.logAll(idx); } }, icon('check', 16), 'Log all')));
}

// Items ticked in this render (their check animates once).
const justKeys = new Set();

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
  return h('div', { class: `item${justKeys.has(it.key) ? ' just' : ''}`, 'data-state': st },
    h('button', { class: 'rowbtn', role: 'checkbox', 'aria-checked': String(st !== 'none' && st !== 'skipped'), 'aria-label': `${it.name}, ${planned}, ${fmt(kcal)} kcal`, onclick: () => act.toggle(it, mealIdx) },
      h('span', { class: 'tick' }, icon('check', 14)),
      h('span', { class: 'item-main', style: 'padding:0;min-height:0' }, h('span', { class: 'name-row' }, h('span', { class: 'item-name' }, shortName(it.name)), it.ar ? h('span', { class: 'ar', lang: 'ar', dir: 'rtl' }, it.ar) : null), h('span', { class: 'item-amt' }, amt)),
      h('span', { class: 'item-kcal' }, fmt(kcal))),
    h('button', { class: 'more', 'aria-label': `More options for ${it.name}`, onclick: () => act.options(it, act) }, icon('dots', 20)));
}

/** An added food or drink inside a meal (or not placed yet): ⋯ moves it to another meal or removes it. */
function extraRow(e, act, offCounted = null) {
  // Eating-out food: "counts" when its meal still matches the plan, else it is calories only.
  const kind = !e.offplan ? 'added' : offCounted ? 'counts in this meal' : e.treat ? 'eating out' : 'added';
  return h('div', { class: 'item extra', 'data-state': 'eaten' },
    h('button', { class: 'rowbtn', type: 'button', onclick: () => act.extra(e), 'aria-label': `${e.name}, ${e.amount ?? 'custom entry'}, ${fmt(e.kcal)} kcal, added. Move or remove` },
      h('span', { class: 'tick added', 'aria-hidden': 'true' }, icon('plus', 12)),
      h('span', { class: 'item-main', style: 'padding:0;min-height:0' },
        h('span', { class: 'name-row' }, h('span', { class: 'item-name' }, shortName(e.name))),
        h('span', { class: 'item-amt' }, `${e.amount ?? (e.grams ? `${e.grams} g` : 'Custom entry')} · ${kind}`)),
      h('span', { class: 'item-kcal' }, fmt(e.kcal))),
    h('button', { class: 'more', type: 'button', 'aria-label': `Move or remove ${e.name}`, onclick: () => act.extra(e) }, icon('dots', 20)));
}

/**
 * The end of the day's list. Foods logged before meals existed for extras (or without a meal) sit
 * here with a one-tap move into a meal; otherwise it is only the "Add food or drink" button.
 */
function extrasPanel(extras, act) {
  if (!extras.length) {
    return h('section', { class: 'section add-only' },
      h('button', { class: 'add-row', type: 'button', onclick: () => act.add() }, icon('plus', 20),
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Add food or drink'), h('span', { class: 'sub' }, 'Coffee, juice, a snack, eating out. It goes into the meal you pick.'))));
  }
  return h('section', { class: 'section' },
    h('div', { class: 'meal-head' }, h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Not in a meal yet'),
      h('span', { class: 'sub' }, `${fmt(extras.reduce((a, e) => a + e.kcal, 0))} kcal · tap one to put it in the meal you had it with`))),
    ...extras.map((e) => extraRow(e, act)),
    h('button', { class: 'add-row', type: 'button', onclick: () => act.add() }, icon('plus', 20), 'Add food or drink'));
}

/** Move an added food to the meal it belongs to, or remove it. */
function extraSheet(e, d, { date, onDone, remove }) {
  sheet(shortName(e.name), (close) => {
    const move = async (mi, btn) => {
      btn.disabled = true;
      try { await send('POST', '/api/log/meal', { date, ref: e.ref, meal: mi }); close(); toast(`Moved to ${d.meals[mi].name.toLowerCase()}`); await onDone(); } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
    };
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'stack' },
        h('p', { class: 'eyebrow' }, `${e.amount ?? 'Custom entry'} · ${fmt(e.kcal)} kcal`),
        h('p', { class: 'sub' }, !e.foodId ? 'Custom entry: it counts toward today\'s calories, but earns no points.' : e.offplan ? 'Eating out: it counts toward today\'s calories, and earns points when its meal still matches the plan (about 30% off at most).' : 'A diet food added to your plan: it counts toward today\'s calories and the meal\'s points.')),
      h('div', { class: 'stack' }, h('p', { class: 'h3' }, e.meal === null ? 'Which meal was it with?' : 'Move to another meal'),
        h('div', { class: 'meal-chips', role: 'group', 'aria-label': 'Meals' }, d.meals.map((m, mi) => h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(e.meal === mi), disabled: e.meal === mi ? true : null, onclick: (ev) => move(mi, ev.currentTarget),
        }, m.name)))),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'act-row', type: 'button', onclick: () => { close(); remove(); } }, h('span', { class: 'ico' }, icon('trash', 20)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Remove it')), null)));
  });
}

/** "14/20", or for water past its target "5 + 1.1" (the bonus is fractional, so one decimal). */
function ptsValue(got, max) {
  if (!max) return fmt(Math.round(got));
  if (got > max) return `${max} + ${(Math.round((got - max) * 10) / 10).toLocaleString('en-US')}`;
  return `${fmt(Math.round(got))}/${max}`;
}

/** Today's points, part by part, with the rule behind each and what would raise it. */
function pointsSheet(s, d, isToday) {
  if (!s?.parts) return;
  const p = s.parts;
  const goal = state.me?.profile?.goal;
  const rows = [
    ['Calories', p.calories, 20, 'From food that counts: within 10% of your target is full marks.'],
    ['Protein', p.protein, 20, 'From food that counts: 90% of your protein target or more.'],
    ['Meals matched', p.meals, 20, 'Each meal vs its plan (calories, protein, carbs, fat). Within 10% is full marks; bigger meals count more. Eating out counts when the meal still matches.'],
    ['Logged on the day', p.logging, 10, 'Logging the same day you eat.'],
    p.workout !== undefined ? ['Training', p.workout, p.bonus ? 20 : 30, p.bonus ? 'Rest day, logged.' : 'A gym check-in is 30 on any day. A logged rest day is 20.'] : null,
    p.bonus ? ['Gym on a rest day', p.bonus, 10, 'Trained on a rest day: 20 + 10, the same 30 as a training day.'] : null,
    p.water !== undefined ? ['Water', p.water, 5, `${d.water?.target ? `Drinking your ${(d.water.target / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} L target` : 'Your water target'} is 5. More adds a little, less each litre, up to 7.`] : null,
    p.over ? ['Over target', p.over, null, goal === 'maintain' ? 'Maintaining: more than 10% over your calories costs 1 point per % (all food counts).' : 'Cutting: more than 5% over your calories costs 1 point per % (all food counts).'] : null,
  ].filter(Boolean);
  // Logging-only food (pizza, coffee drinks, sauces) and custom entries: counted, never scored.
  // Eating-out food in a meal that still matched its plan counted, so it is left out here.
  const extrasKcal = [...d.extras, ...d.meals.flatMap((m, mi) => (m.extras ?? []).filter((e) => !(e.offplan && s.meals?.[mi]?.offCounted)))].filter((e) => e.offplan || !e.foodId).reduce((a, e) => a + e.kcal, 0);
  const matches = (s.meals ?? []).filter((m) => m.match !== null);
  sheet(isToday ? 'Today\'s points' : 'Points that day', () => h('div', { class: 'stack' },
    h('div', { class: 'pts-total' }, h('b', { class: s.total >= 70 ? 'good' : '' }, s.total), h('span', {}, s.total >= 70 ? 'points · a 70+ day' : `points · ${70 - s.total} more for a 70+ day`)),
    h('div', { class: 'pts-rows' }, rows.map(([label, got, max, why]) => h('div', { class: 'pts-row' },
      h('span', { class: 'grow' }, h('span', { class: 'strong' }, label), h('span', { class: 'sub' }, why)),
      h('span', { class: `pts-val ${got < 0 ? 'neg' : max && got >= max ? 'full' : ''}` }, ptsValue(got, max))))),
    // Each meal's match, so "meals matched 12/20" says which meal cost the points.
    matches.length ? h('div', { class: 'pts-meals', 'aria-label': 'How close each meal was to its plan' }, (s.meals ?? []).map((m) => h('span', { class: `pts-meal ${m.match === null ? 'none' : m.match >= 90 ? 'good' : m.match < 50 ? 'low' : ''}` },
      h('span', {}, m.name), h('b', {}, m.match === null ? '–' : `${m.match}%`)))) : null,
    extrasKcal ? h('p', { class: 'notice' }, `${fmt(extrasKcal)} kcal today came from eating out that did not fit a meal\'s plan, or custom entries. It counts toward your calories, but earns no points.`) : null,
    // Where the penalty starts, in kcal, so "going over" is a number and not a guess.
    goal === 'cut' || goal === 'maintain' ? h('p', { class: 'sub' }, `Over ${fmt(Math.round(d.targets.kcal * (goal === 'cut' ? 1.05 : 1.1)))} kcal (all food counted), each 1% more costs a point.`) : null,
    h('a', { class: 'btn ghost block', href: '#/progress' }, 'See your progress')));
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
    // Ate something else instead of this item: any food, eating-out foods included (it is a log, not a swap).
    const pickSwap = () => swap.replaceChildren(foodPicker((f) => {
      const p = amountPicker({ units: f.units, grams: 0, per100: f });
      const add = h('button', { class: 'btn', onclick: () => { const v = p.value(); if (v.grams > 0) save({ status: 'swapped', foodId: f.id, unit: v.unit, qty: v.qty }, `Logged ${v.label}`); } }, 'Save');
      swap.replaceChildren(h('div', { class: 'stack' },
        h('p', { class: 'item-name' }, f.name),
        p.el,
        h('div', { class: 'row-flex' }, add, h('button', { class: 'btn ghost', onclick: pickSwap }, 'Pick another'))));
    }, { offplan: true, recent: true }));
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

/**
 * Add food: search the food list and the eating-out foods (pizza, burgers, sweets), or enter it by
 * hand. After something off-plan (or anything that pushes the day over), a short "what now" step
 * follows: was it instead of a meal, and should the rest of today be trimmed.
 */
function addSheet({ date, today, reload, getDay, ask, meal = null }) {
  const day = getDay();
  // Which meal it goes in: the one it was opened from, else the next meal still to eat, else the last.
  const next = day.meals.findIndex((m) => m.items.some((i) => !i.log));
  let mealIdx = meal ?? (next >= 0 ? next : day.meals.length - 1);
  sheet('Add food or drink', (close) => {
    const area = h('div', {});
    const chips = h('div', { class: 'meal-chips', role: 'radiogroup', 'aria-label': 'Add it to' });
    const drawChips = () => chips.replaceChildren(...day.meals.map((m, mi) => h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(mi === mealIdx), onclick: () => { mealIdx = mi; drawChips(); },
    }, m.name)));
    drawChips();
    const add = async (body, label, info) => {
      try {
        const name = day.meals[mealIdx]?.name;
        await api('POST', '/api/log/extra', { date, today, meal: mealIdx, ...body });
        close(); await reload();
        const d = getDay();
        const over = d && d.projectedKcal > d.targets.kcal * 1.05;
        // Today only: suggestions about the rest of the day make no sense for a past day.
        if (date === today && d?.planId && (info?.treat || over)) afterSheet({ label, kcal: info?.kcal, date, today, reload, getDay, meal: mealIdx, treat: info?.treat });
        else toast(`Added ${label || 'it'} to ${name ? name.toLowerCase() : 'today'}`);
      } catch (e) { toast(e.message, 'bad'); }
    };
    const toCoach = h('div', { class: 'stack', style: 'margin-top:4px' },
      h('button', { class: 'btn ghost block', onclick: () => { close(); ask(`For ${day.meals[mealIdx]?.name.toLowerCase() ?? 'today'} I had `); } }, icon('coach', 18), 'Describe it to the coach'),
      h('p', { class: 'sub' }, 'The coach estimates it for you, or use “Enter it myself” above.'));
    // Pick a food, then say how much the way you would say it: 2 slices, 1 plate of koshari, 1 cup.
    const showSearch = () => area.replaceChildren(foodPicker((f) => {
      const p = amountPicker({ units: f.units, grams: 0, per100: f });
      area.replaceChildren(h('div', { class: 'stack' },
        h('p', { class: 'h3' }, f.name),
        f.offplan ? h('p', { class: 'sub' }, `${f.treat ? 'Eating out & treats' : 'Everyday food'} · typical values · earns points when its meal still matches your plan`) : null,
        p.el,
        h('div', { class: 'row-flex' },
          h('button', { class: 'btn', onclick: () => { const v = p.value(); if (v.grams > 0) add({ foodId: f.id, unit: v.unit, qty: v.qty }, amountLabel(v.label, f.name), { treat: f.treat, kcal: Math.round((f.kcal * v.grams) / 100) }); } }, 'Add'),
          h('button', { class: 'btn ghost', onclick: showSearch }, 'Pick another'))));
    }, { offplan: true, recent: true, noMatch: toCoach }));
    const showCustom = () => {
      const f = { name: h('input', { type: 'text', 'aria-label': 'Name' }), kcal: numInput('', { min: 0 }), p: numInput('', { min: 0 }), c: numInput('', { min: 0 }), f: numInput('', { min: 0 }) };
      area.replaceChildren(h('div', { class: 'stack' },
        field('What did you eat?', f.name),
        h('div', { class: 'grid2' }, field('Calories', f.kcal), field('Protein (g)', f.p)),
        h('div', { class: 'grid2' }, field('Carbs (g)', f.c), field('Fat (g)', f.f)),
        h('button', { class: 'btn', onclick: () => add({ name: f.name.value, kcal: Number(f.kcal.value), p: Number(f.p.value || 0), c: Number(f.c.value || 0), f: Number(f.f.value || 0) }, f.name.value, { kcal: Number(f.kcal.value) }) }, 'Add')));
    };
    const tabs = seg([['search', 'Search foods'], ['custom', 'Enter it myself']], 'search', (v) => (v === 'search' ? showSearch() : showCustom()), 'How to add');
    showSearch();
    return h('div', { class: 'stack' }, h('div', { class: 'stack-sm' }, h('p', { class: 'eyebrow' }, 'Add it to'), chips), tabs, area);
  });
}

/**
 * After an off-plan food: no guilt, just the next step. 1) Was it instead of a meal? Then that
 * meal is marked skipped (honest, and the day adds up). 2) The day as it now stands, and if it
 * is over, one tap trims the rest of today (the rebalance), or leave it: one day is fine.
 */
function afterSheet({ label, kcal, date, today, reload, getDay, meal = null, treat = false }) {
  sheet('Logged', (close) => {
    const body = h('div', { class: 'stack' });
    // Meals with planned items still to eat; the meal it was added to first ("instead of lunch").
    const mealsLeft = () => (getDay()?.meals ?? []).map((m, mi) => ({ m, mi, open: m.items.filter((it) => !it.log) })).filter((x) => x.open.length)
      .sort((a, b) => (b.mi === meal) - (a.mi === meal));
    const replaced = async (x, btn) => {
      btn.disabled = true;
      try {
        for (const it of x.open) await send('POST', '/api/log', { date, today, ref: it.key, status: 'skipped' });
        await reload(); dayStep(`${x.m.title ?? x.m.name} marked as skipped.`);
      } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    };
    const head = h('div', { class: 'after-head' }, h('span', { class: 'ic' }, icon('check', 22)),
      h('span', {}, h('span', { class: 'h3' }, label ? cap(label) : 'Added'), kcal ? h('span', { class: 'sub' }, `${fmt(kcal)} kcal`) : null));
    // Step 1: instead of a meal?
    const mealStep = () => {
      const left = mealsLeft();
      if (!left.length || !treat) { dayStep(); return; } // "instead of a meal?" is for eating out and treats
      body.replaceChildren(head,
        h('p', { class: 'h3' }, 'Was it instead of a meal?'),
        h('div', { class: 'after-choices' },
          ...left.map((x) => h('button', { class: 'act-row', onclick: (e) => replaced(x, e.currentTarget) },
            h('span', { class: 'grow' }, h('span', { class: 'strong' }, `Instead of ${x.m.name.toLowerCase()}`), x.m.title ? h('span', { class: 'sub' }, x.m.title) : null), icon('chevR', 18))),
          h('button', { class: 'act-row', onclick: () => dayStep() }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'No, on top of my plan')), icon('chevR', 18))));
    };
    // Step 2: where the day stands now, and the one useful action.
    const dayStep = (note = null) => {
      const d = getDay();
      const target = d.targets.kcal; const proj = d.projectedKcal; const over = proj - target;
      const fine = over <= target * 0.05;
      const trim = h('button', { class: 'btn block', onclick: async () => {
        trim.disabled = true; trim.classList.add('busy');
        try {
          const r = await api('POST', '/api/today/rebalance', { date });
          await reload(); close();
          toast(r.changed ? (r.stillOver ? `Trimmed what is realistic: about ${fmt(r.after - r.target)} kcal over. One day like this is fine.` : `Rest of today trimmed: ${fmt(r.after)} kcal`) : 'Nothing left to trim today.');
        } catch (e) { toast(e.message, 'bad'); trim.disabled = false; trim.classList.remove('busy'); }
      } }, 'Trim the rest of today');
      body.replaceChildren(head,
        note ? h('p', { class: 'sub' }, note) : null,
        h('div', { class: 'after-day' },
          h('span', { class: 'sub' }, 'Today, if you eat the rest of your plan'),
          h('span', { class: 'after-nums' }, h('b', {}, fmt(proj)), ` of ${fmt(target)} kcal`)),
        fine
          ? h('p', {}, 'Still within today\'s target. Eat the rest of your plan as normal.')
          : h('p', {}, `That is about ${fmt(over)} kcal over. Trimming makes the meals you have not eaten yet a bit smaller (rice, bread, oil first), so the day lands back near your target.`),
        fine ? h('button', { class: 'btn block', onclick: close }, 'Done') : trim,
        fine ? null : h('button', { class: 'btn ghost block', onclick: () => { close(); toast('Left as it is. One day over is fine; the week is what counts.'); } }, 'Leave today as it is'));
    };
    mealStep();
    return body;
  });
}
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** "2 slices of pizza", "2 eggs", "100 g chicken", "1 3-in-1 coffee sachet": the unit said once. */
function amountLabel(label, foodName) {
  const nm = String(foodName).split(/[,(]/)[0].trim().toLowerCase();
  const m = /^([\d.½]+)\s+(.+)$/.exec(label);
  if (!m) return `${label} of ${nm}`;
  const unit = m[2]; const sing = unit.replace(/(es|s)$/, '');
  if (nm.startsWith(sing)) return label;
  if (nm.includes(sing)) return `${m[1]} ${nm}`;
  if (/^(g|ml|g dry)$/.test(unit)) return `${label} ${nm}`;
  return `${label} of ${nm}`;
}
