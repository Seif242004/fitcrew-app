// Train tab: today's session from the coach-style plan, ticked off set by set.
//   - Attendance week (Saturday to Friday) and the gym check-in photo (15 points).
//   - Every exercise shows sets x reps, RIR, rest, tempo, a demo video and what to lift today.
//     One tap on the check logs the suggested weight x reps (15 points for all sets).
//   - Warm-up, post-workout cardio, the whole week's plan, history and records.
import { h } from '../dom.js';
import { screenTip } from '../tour.js';
import { api, send } from '../api.js';
import { state, localDate, shiftDate, fmtDate, fmt, fmt1 } from '../state.js';
import { paint, loading, guard } from '../shell.js';
import { navigate } from '../router.js';
import { icon, sheet, toast, emptyState, field, numInput, exercisePicker, confirmSheet, celebrate, local } from '../ui.js';
import { shrink, averageHash } from './progress.js';
import { SPLIT_CHOICES, INTENSITY_CHOICES } from './onboarding.js';

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
// The end-of-rest beep is scheduled on the audio clock when the timer starts (a tap, so audio is
// allowed), so it still sounds if the browser throttles timers while the screen is off. A locked
// iPhone suspends web apps completely, so nothing can wake it; Android shows a notification.
const rest = { end: 0, timer: null, audio: null, nodes: [], notifyAt: null };
function restBar() {
  let el = document.getElementById('rest');
  if (!el) { el = h('div', { id: 'rest', class: 'rest', role: 'timer', 'aria-live': 'off' }); document.body.append(el); }
  return el;
}
function stopRest() {
  clearInterval(rest.timer);
  cancelBeep();
  clearTimeout(rest.notifyAt);
  document.getElementById('rest')?.classList.remove('show');
}
function cancelBeep() {
  for (const o of rest.nodes) { try { o.stop(); } catch { /* already done */ } }
  rest.nodes = [];
}
/** Two short beeps `inSec` seconds from now, on the audio clock. */
function scheduleBeep(inSec) {
  cancelBeep();
  try {
    rest.audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = rest.audio;
    if (ctx.state === 'suspended') ctx.resume();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + inSec + t); o.stop(ctx.currentTime + inSec + t + 0.15);
      rest.nodes.push(o);
    });
  } catch { /* audio is optional */ }
}
/** If the app is in the background when rest ends, a notification (where the phone allows it). */
function scheduleNotify(inSec) {
  clearTimeout(rest.notifyAt);
  rest.notifyAt = setTimeout(async () => {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { (await navigator.serviceWorker?.ready)?.showNotification('Rest over', { body: 'Time for your next set.', tag: 'rest', renotify: true, silent: false, vibrate: [200, 100, 200], icon: '/icons/icon-192.png', data: { url: '/#/train' } }); } catch { /* optional */ }
  }, inSec * 1000);
}
function startRest(seconds) {
  const el = restBar();
  rest.end = Date.now() + seconds * 1000;
  clearInterval(rest.timer);
  const arm = () => { const left = (rest.end - Date.now()) / 1000; scheduleBeep(left); scheduleNotify(left); };
  arm();
  const draw = () => {
    const left = Math.ceil((rest.end - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(rest.timer);
      el.replaceChildren(h('span', { class: 'num', style: 'font-size:28px' }, 'Go'), h('span', {}, 'Next set'));
      navigator.vibrate?.([200, 100, 200]); // the beep was already scheduled
      setTimeout(() => el.classList.remove('show'), 2500);
      return;
    }
    el.replaceChildren(
      h('span', {}, 'Rest'),
      h('span', { class: 'num', style: 'font-size:30px' }, mmss(left)),
      h('button', { onclick: () => { rest.end += 15000; arm(); draw(); } }, '+15 s'),
      h('button', { onclick: stopRest }, 'Skip'));
  };
  el.classList.add('show');
  draw();
  rest.timer = setInterval(draw, 250);
}

const CHANGE = { 'add weight': 'Add weight', 'add reps': 'Add a rep', repeat: 'Match last time' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const isSuperFirst = (e) => /^Superset: go straight/.test(e?.note ?? '');
const restLabel = (s) => (s % 60 ? mmss(s) : `${s / 60} min`);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = [6, 0, 1, 2, 3, 4, 5]; // Saturday first
const isBodyweight = (b) => b.timed || (b.equip === 'bodyweight' && !(b.inc > 0));
const amount = (b, kg, reps) => (b.timed ? `${reps} sec` : isBodyweight(b) || kg === 0 ? `${reps} reps` : `${fmt1(kg)} kg × ${reps}`);

// ---------------------------------------------------------------- Train screen
export async function trainView() {
  const main = paint('train', loading());
  const today = localDate();
  const date = state.trainDate ?? today;
  const run = () => guard(main, async () => {
    const d = await api('GET', `/api/train?date=${date}`);
    main.replaceChildren(...build(d, { date, today, reload: run }));
    if (date === today && d.dayName) keepAwake();
  }, run);
  await run();
}

function pickDate(dt, today) { state.trainDate = dt === today ? null : dt; trainView(); }

function build(d, ctx) {
  const { date, today } = ctx;
  const head = h('div', {},
    h('h1', { class: 'title', style: 'margin-bottom:2px' }, d.dayName ?? (d.restDay ? 'Rest day' : 'Train')),
    h('p', { class: 'sub' }, `${date === today ? 'Today' : fmtDate(date, { weekday: 'long' })} · ${fmtDate(date, { day: 'numeric', month: 'long' })}${d.focus ? ` · ${d.focus}` : ''}${d.minutes ? ` · about ${d.minutes} min` : ''}`),
    weekBar(d, ctx),
    d.hasPlan ? screenTip('train', 'How training works', 'Each set shows what to lift. Tap the check when a set is done (the rest timer starts), tap the numbers to change them, ▶ shows the form. Check in with a gym photo for 15 points.') : null);

  if (!d.hasPlan && !d.blocks.length) {
    return [head, d.hasPending
      ? emptyState('Your training plan is being checked', 'It is drafted and waiting for the admin to approve it.')
      : emptyState('No training plan yet', 'Fill in your training details and a coach-style plan is made for you.', h('button', { class: 'btn', onclick: () => navigate('/onboarding?edit=1') }, 'Set up my training')),
    footerLinks()];
  }

  // Live state the cards share: progress and points update without reloading the page.
  const live = { d, ctx, prs: 0, refresh: () => {} };
  const progress = progressCard(live);
  const wasDone = sessionComplete(d);
  live.refresh = () => {
    progress.update();
    // The moment the last planned set is ticked today: a short summary of the session.
    if (!wasDone && sessionComplete(d) && ctx.date === ctx.today && local.get('sessionDone') !== ctx.date) {
      local.set('sessionDone', ctx.date);
      setTimeout(() => sessionSheet(live), 700);
    }
  };

  const blocks = d.blocks.map((b, i) => exerciseCard(b, i, live));
  return [
    head,
    d.offline ? h('p', { class: 'notice', style: 'margin-top:12px' }, 'Offline: showing the last copy on this phone. Ticks are saved and sync when you are back online.') : null,
    d.cycle?.deload && !(d.restDay && !d.blocks.length) ? h('div', { class: 'strip', 'data-tone': 'muted', style: 'margin-top:12px' }, h('span', { class: 'ico' }, icon('info', 22)), h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Deload week'), h('span', { class: 'sub' }, 'Half the sets, lighter weights, more in reserve. You recover and come back stronger. Next week brings fresh exercise variations.'))) : null,
    d.restDay && !d.blocks.length ? restCard(d, ctx) : null,
    checkinCard(d, ctx),
    d.restDay && !d.blocks.length ? null : progress.el,
    d.warmup.length ? warmupSection(d) : null,
    ...blocks,
    d.cardioPlan || d.cardio.length ? cardioCard(d, ctx) : null,
    h('p', { style: 'margin-top:16px;display:flex;gap:20px;flex-wrap:wrap' },
      h('button', { class: 'link', onclick: () => extraExercise(live) }, d.restDay ? 'Log a workout anyway' : 'Add an extra exercise'),
      d.cardioPlan ? null : h('button', { class: 'link', onclick: () => cardioSheet(ctx) }, 'Log cardio')),
    footerLinks(),
  ];
}

const footerLinks = () => h('div', { class: 'section' },
  h('button', { class: 'list-row', onclick: () => navigate('/train/plan') }, icon('plan', 22), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'My training plan'), h('span', { class: 'sub' }, 'The whole week, how to read it, change your days')), icon('chevR', 20)),
  h('button', { class: 'list-row', onclick: () => navigate('/history') }, icon('progress', 22), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'History and records')), icon('chevR', 20)));

// ---------------------------------------------------------------- attendance week
function weekBar(d, { date, today }) {
  const first = d.week[0].date;
  const nav = (n) => { const target = shiftDate(first, n * 7); pickDate(target > today ? today : target, today); };
  return h('div', { class: 'gymweek' },
    h('div', { class: 'gymweek-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous week', onclick: () => nav(-1) }, icon('chevL', 20)),
      h('span', { class: 'sub' }, `${d.week.filter((x) => x.checkin === 'approved').length} of ${d.week.filter((x) => x.planned).length} sessions checked in`),
      h('button', { class: 'icon-btn', 'aria-label': 'Next week', disabled: d.week[6].date >= today ? true : null, onclick: () => nav(1) }, icon('chevR', 20))),
    h('div', { class: 'week', role: 'group', 'aria-label': 'This training week' }, d.week.map((x) => {
      const st = x.checkin === 'approved' ? 'in' : x.checkin === 'pending' ? 'wait' : x.planned ? (x.date < today ? 'missed' : 'planned') : 'rest';
      return h('button', {
        class: `day gday ${x.date === today ? 'today' : ''}`, 'data-st': st, 'aria-pressed': String(x.date === date), disabled: x.date > today ? true : null,
        'aria-label': `${fmtDate(x.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${x.name ?? 'rest'}${x.checkin ? `, check-in ${x.checkin}` : ''}`,
        onclick: () => pickDate(x.date, today),
      }, h('span', { class: 'dw' }, fmtDate(x.date, { weekday: 'narrow' })), h('span', { class: 'dn' }, Number(x.date.slice(8))),
      h('span', { class: 'gmark' }, st === 'in' ? icon('check', 12) : null));
    })));
}

// ---------------------------------------------------------------- check-in
function checkinCard(d, ctx) {
  const ci = d.checkin;
  const isToday = ctx.date === ctx.today;
  if (!isToday && !ci) return d.restDay ? null : h('div', { class: 'strip', 'data-tone': 'muted' }, h('span', { class: 'ico' }, icon('camera', 22)), h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'No gym check-in'), h('span', { class: 'sub' }, 'Check-ins can only be sent on the day.')));
  if (ci?.status === 'approved') return h('div', { class: 'strip done' }, h('span', { class: 'ico' }, icon('check', 22)), h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Checked in at the gym'), h('span', { class: 'sub' }, '+15 training points')));
  // 'pending' only exists on check-ins sent before photos were auto-approved.
  if (ci?.status === 'pending') return h('div', { class: 'strip', 'data-tone': 'warn' }, h('span', { class: 'ico' }, icon('clock', 22)), h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Check-in sent'), h('span', { class: 'sub' }, 'Waiting for the admin.')));
  if (!isToday) return h('div', { class: 'strip', 'data-tone': 'bad' }, h('span', { class: 'ico' }, icon('close', 22)), h('span', { class: 'grow' }, h('span', { class: 'h3' }, 'Check-in revoked'), h('span', { class: 'sub' }, ci.reason || 'The admin removed this check-in. Ask them if this looks wrong.')));
  if (d.restDay && !ci) return h('p', { class: 'sub', style: 'margin-top:12px' }, 'Trained anyway? ', h('button', { class: 'link', onclick: () => capture(ctx) }, 'Check in at the gym'));

  const rejected = ci?.status === 'rejected';
  return h('div', { class: `checkin ${rejected ? 'rejected' : ''}` },
    h('div', { class: 'grow' },
      h('span', { class: 'h3' }, rejected ? 'Check-in revoked' : 'Check in at the gym'),
      h('span', { class: 'sub' }, rejected ? `${ci.reason ? `${ci.reason}. ` : 'The admin removed this photo. '}Send a new photo taken at the gym today.` : 'Snap a photo at the gym: a selfie, the machines or the rack. It counts straight away for 15 points.')),
    h('button', { class: 'btn', onclick: (e) => capture(ctx, e.currentTarget) }, icon('camera', 20), rejected ? 'Try again' : 'Check in'));
}

/** Opens the camera, shrinks the photo, sends it. It is approved at once; admins can revoke fakes. */
function capture(ctx, btn) {
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sr-only', 'aria-hidden': 'true' });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files[0]; input.remove();
    if (!file) return;
    const label = btn?.lastChild; const before = label?.textContent;
    try {
      if (btn) { btn.disabled = true; btn.classList.add('busy'); if (label) label.textContent = 'Sending…'; }
      const image = await shrink(file, { max: 720, quality: 0.7, maxBytes: 150_000 });
      const ahash = await averageHash(image);
      const r = await api('POST', '/api/checkins', { date: ctx.today, image, ahash });
      toast(r.status === 'approved' ? 'Checked in. +15 points' : 'Check-in sent');
      ctx.reload();
    } catch (e) {
      toast(e.message, 'bad');
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); if (label) label.textContent = before; }
    }
  }, { once: true });
  input.click();
}

// ---------------------------------------------------------------- progress and points
function progressCard(live) {
  const el = h('section', { class: 'section tprog' });
  const update = () => {
    const { d } = live;
    const planned = d.blocks.reduce((a, b) => a + (b.plan?.sets ?? 0), 0);
    const done = d.blocks.reduce((a, b) => a + b.sets.length, 0);
    const completion = planned ? Math.min(1, done / planned) : 0;
    const pts = (d.checkin?.status === 'approved' ? 15 : 0) + Math.round(15 * completion * 10) / 10;
    el.replaceChildren(
      h('div', { class: 'spread' },
        h('span', {}, h('span', { class: 'num', style: 'font-size:36px' }, done), h('span', { class: 'sub' }, planned ? ` of ${planned} sets` : ' sets')),
        h('span', { class: 'sub', style: 'text-align:right' }, h('b', { class: 'num', style: 'font-size:22px;color:var(--ink)' }, fmt1(pts)), ' / 30 training points')),
      h('div', { class: 'tbar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(completion * 100), 'aria-label': 'Sets done' }, h('i', { style: `transform:scaleX(${completion})` })),
      h('p', { class: 'meta', style: 'padding:8px 0 10px' }, completion >= 1 ? (d.checkin?.status === 'approved' ? 'Session complete. Great work.' : 'All sets done. Check in at the gym for the other 15 points.') : 'Tap the check when a set is done. Tap the numbers to change them.'));
  };
  update();
  return { el, update };
}

// ---------------------------------------------------------------- warm-up
function warmupSection(d) {
  return h('details', { class: 'section warm' },
    h('summary', { class: 'section-head' }, h('span', { class: 'grow' }, h('h2', { class: 'h2' }, 'Warm-up'), h('span', { class: 'sub' }, `${d.warmup.length} pre-activation moves · about 5 min`)), icon('chevR', 20)),
    h('div', { style: 'padding-bottom:8px' },
      d.warmup.map((w) => h('div', { class: 'list-row', style: 'cursor:default' },
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, w.name), h('span', { class: 'sub' }, `${w.sets} × ${w.repMin}–${w.repMax}${w.timed ? ' sec' : ''}`)),
        videoBtn(w))),
      h('p', { class: 'meta', style: 'padding:10px 0' }, 'Then do 1–2 lighter ramp-up sets before your first exercise.')));
}

/** youtube.com/watch?v=ID&t=30s -> privacy-enhanced embed URL; null for search links. */
export function embedUrl(url) {
  try {
    const u = new URL(url);
    const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v');
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const t = parseInt(u.searchParams.get('t') ?? '0', 10);
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1${t ? `&start=${t}` : ''}`;
  } catch { return null; }
}
/** The demo plays in a sheet so the workout stays on screen; search links still open YouTube. */
export function videoSheet(x) {
  const src = embedUrl(x.video);
  if (!src) { window.open(x.video, '_blank', 'noopener'); return; }
  sheet(x.name, () => h('div', { class: 'stack' },
    h('div', { class: 'video' }, h('iframe', { src, title: `${x.name} demo`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' })),
    x.notes ? h('div', { class: 'cue' }, h('span', { class: 'h3' }, 'Form cues'), h('p', { class: 'sub' }, x.notes)) : null,
    h('a', { class: 'meta', href: x.video, target: '_blank', rel: 'noopener' }, 'Open in YouTube')));
}
const videoBtn = (x) => h('button', { class: 'vbtn', type: 'button', 'aria-label': `Watch how to do ${x.name}`, onclick: () => videoSheet(x) }, icon('play', 18));

// ---------------------------------------------------------------- exercise card
function exerciseCard(b, index, live) {
  const { ctx } = live;
  const el = h('section', { class: 'section ex' });
  let open = null; // null = automatic (collapsed once every planned set is done)

  // What the next tap logs: the last logged set's numbers, otherwise today's suggestion.
  const next = () => {
    const lastLogged = [...b.sets].sort((x, y) => y.setNo - x.setNo)[0];
    if (lastLogged) return { weightKg: lastLogged.weightKg, reps: lastLogged.reps };
    return { weightKg: isBodyweight(b) ? 0 : b.suggested?.weightKg ?? null, reps: b.suggested?.reps ?? b.plan?.repMin ?? 10 };
  };

  const log = async (setNo, kg, reps, { silent = false } = {}) => {
    const r = await send('POST', '/api/train/set', { date: ctx.date, today: ctx.today, exerciseId: b.exerciseId, setNo, weightKg: isBodyweight(b) ? 0 : kg, reps });
    b.sets = [...b.sets.filter((s) => s.setNo !== setNo), { setNo, weightKg: isBodyweight(b) ? 0 : kg, reps }];
    if (!silent && r.pr) { live.prs++; prMoment(b, kg, reps, r.e1rm); }
    if (ctx.date === ctx.today && b.plan && !silent) startRest(b.plan.restSec ?? 90);
    navigator.vibrate?.(15);
  };

  const remove = async (setNo) => {
    const old = b.sets.find((s) => s.setNo === setNo);
    await send('POST', '/api/train/set/remove', { date: ctx.date, exerciseId: b.exerciseId, setNo });
    b.sets = b.sets.filter((s) => s.setNo !== setNo);
    draw(); live.refresh();
    toast(`Set ${setNo} removed`, '', { label: 'Undo', run: async () => { try { await log(setNo, old.weightKg, old.reps, { silent: true }); draw(); live.refresh(); } catch (e) { toast(e.message, 'bad'); } } });
  };

  const tick = async (setNo, btn) => {
    const v = next();
    if (v.weightKg === null) { setSheet(b, setNo, v, save); return; } // first time: pick the weight
    btn.disabled = true;
    try { await log(setNo, v.weightKg, v.reps); draw(); live.refresh(); } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
  };

  const save = async (setNo, kg, reps) => { await log(setNo, kg, reps); draw(); live.refresh(); };

  const doneAsPlanned = async () => {
    const v = next();
    if (v.weightKg === null) { setSheet(b, firstOpen(), v, async (setNo, kg, reps) => { await log(setNo, kg, reps, { silent: true }); await completeRest(kg, reps); }, 'Weight for all sets'); return; }
    await completeRest(v.weightKg, v.reps);
  };
  const completeRest = async (kg, reps) => {
    try {
      const r = await send('POST', '/api/train/exercise/complete', { date: ctx.date, today: ctx.today, exerciseId: b.exerciseId, weightKg: isBodyweight(b) ? 0 : kg, reps, sets: b.plan?.sets });
      const have = new Set(b.sets.map((s) => s.setNo));
      for (let s = 1; s <= (b.plan?.sets ?? 0); s++) if (!have.has(s)) b.sets.push({ setNo: s, weightKg: isBodyweight(b) ? 0 : kg, reps });
      if (r.pr) { live.prs++; prMoment(b, kg, reps, r.e1rm); }
      open = null; draw(); live.refresh();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const plannedSets = () => Math.max(b.plan?.sets ?? 0, ...b.sets.map((s) => s.setNo), b.plan ? 0 : 1);
  let extra = 0;
  const firstOpen = () => { for (let s = 1; s <= plannedSets() + extra; s++) if (!b.sets.some((x) => x.setNo === s)) return s; return plannedSets() + extra + 1; };

  const draw = () => {
    const total = plannedSets() + extra;
    const doneCount = b.sets.length;
    const complete = b.plan ? doneCount >= b.plan.sets : false;
    const expanded = open ?? !complete;
    const p = b.plan;
    const head = h('div', { class: 'ex-head' },
      h('span', { class: `ex-no ${complete ? 'done' : ''}` }, complete ? icon('check', 16) : index + 1),
      h('button', { class: 'ex-title', 'aria-expanded': String(expanded), onclick: () => { open = !expanded; draw(); } },
        h('span', { class: 'h3' }, b.name),
        h('span', { class: 'sub' }, !expanded ? (complete ? summary(b) : `${doneCount} of ${total} sets`) : `${cap(b.muscle)}${b.equip ? ` · ${b.equip}` : ''}${p ? '' : ' · extra'}`)),
      videoBtn(b),
      h('button', { class: 'icon-btn', 'aria-label': `More for ${b.name}`, onclick: () => exerciseMenu(b, live) }, icon('dots', 20)));
    if (!expanded) { el.replaceChildren(head); el.dataset.complete = 'true'; return; }
    delete el.dataset.complete;

    const v = next();
    const targetLine = b.target
      ? h('p', { class: 'target' }, h('b', {}, `${CHANGE[b.target.change]}: ${amount(b, b.target.weightKg, b.target.reps)}`), h('span', { class: 'sub' }, ` · last time ${b.last.sets.map((s) => (isBodyweight(b) || s.weightKg === 0 ? s.reps : `${fmt1(s.weightKg)}×${s.reps}`)).join(', ')}`))
      : b.last ? h('p', { class: 'target sub' }, `Last time (${fmtDate(b.last.date, { day: 'numeric', month: 'short' })}): ${b.last.sets.map((s) => amount(b, s.weightKg, s.reps)).join(', ')}`)
        : p && !isBodyweight(b) ? h('p', { class: 'target sub' }, `First time: pick a weight where rep ${p.repMax} is hard but clean${p.rir ? `, with ${p.rir} more in the tank` : ''}.`) : null;

    const rows = [];
    for (let s = 1; s <= total; s++) {
      const got = b.sets.find((x) => x.setNo === s);
      const show = got ?? v;
      const isNext = !got && s === firstOpen();
      const check = h('button', { class: 'setcheck', role: 'checkbox', 'aria-checked': String(Boolean(got)), 'aria-label': got ? `Set ${s} done, ${amount(b, got.weightKg, got.reps)}. Tap to undo` : `Log set ${s}` }, icon('check', 22));
      check.addEventListener('click', () => (got ? remove(s) : tick(s, check)));
      rows.push(h('div', { class: 'srow', 'data-done': String(Boolean(got)), 'data-next': String(isNext) },
        h('span', { class: 'setno' }, s),
        h('button', { class: 'sval', 'aria-label': `Set ${s}: ${show.weightKg === null ? 'choose weight' : amount(b, show.weightKg, show.reps)}. Tap to change`, onclick: () => setSheet(b, s, got ?? v, save, null, got ? () => remove(s) : null) },
          show.weightKg === null && !isBodyweight(b) ? (isNext ? h('span', { class: 'sval-empty' }, `Choose weight × ${show.reps}`) : h('span', { class: 'num muted' }, `– kg × ${show.reps}`)) : h('span', { class: `num ${got || isNext ? '' : 'muted'}` }, amount(b, show.weightKg, show.reps))),
        check));
    }
    el.replaceChildren(
      head,
      p ? h('div', { class: 'rx', role: 'list' },
        h('button', { class: 'rxc', role: 'listitem', onclick: guideSheet }, `${p.repMin}–${p.repMax}${b.timed ? ' sec' : ' reps'}`),
        p.rir !== null ? h('button', { class: 'rxc', role: 'listitem', onclick: guideSheet }, `RIR ${p.rir}`) : null,
        h('button', { class: 'rxc', role: 'listitem', onclick: guideSheet }, isSuperFirst(p) ? 'Superset ↓' : `Rest ${restLabel(p.restSec)}`),
        p.tempo && p.tempo !== '2-0-1-0' ? h('button', { class: 'rxc', role: 'listitem', onclick: guideSheet }, `Tempo ${p.tempo}`) : null) : null,
      p?.note ? h('p', { class: 'sub', style: 'margin-top:6px' }, p.note) : null,
      targetLine,
      h('div', { class: 'srows' }, rows),
      h('div', { class: 'ex-foot' },
        h('button', { class: 'textbtn', onclick: () => { extra++; draw(); } }, icon('plus', 18), 'Add a set'),
        !complete && b.plan && doneCount < b.plan.sets ? h('button', { class: 'btn small ghost', onclick: doneAsPlanned }, doneCount ? 'Finish as planned' : 'Done as planned') : null));
  };
  draw();
  return el;
}

const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : '');

const sessionComplete = (d) => {
  const planned = d.blocks.reduce((a, b) => a + (b.plan?.sets ?? 0), 0);
  return planned > 0 && d.blocks.every((b) => !b.plan || b.sets.length >= b.plan.sets);
};

/** Personal record: a proper moment, not a toast. */
function prMoment(b, kg, reps, est) {
  celebrate({
    icon: 'flame', kind: 'pr', title: 'New personal record', stat: amount(b, isBodyweight(b) ? 0 : kg, reps),
    text: `${b.name}${est > 0 && !isBodyweight(b) ? ` · estimated max ${fmt1(est)} kg` : ''}. Posted to the crew.`,
  });
}

/** Session summary: what was done, records, points, and the check-in if it is still missing. */
function sessionSheet(live) {
  const { d, ctx } = live;
  const sets = d.blocks.reduce((a, b) => a + b.sets.length, 0);
  const volume = d.blocks.reduce((a, b) => a + b.sets.reduce((x, s) => x + s.weightKg * s.reps, 0), 0);
  const checked = d.checkin?.status === 'approved';
  stopRest();
  sheet('Session done', (close) => h('div', { class: 'stack' },
    h('div', { class: 'done-hero' }, h('span', { class: 'ic' }, icon('check', 30)), h('h3', {}, d.dayName ?? 'Workout'), h('p', { class: 'sub' }, 'Every planned set ticked. Nice work.')),
    h('div', { class: 'recap-stats' },
      h('div', {}, h('b', {}, sets), h('span', {}, 'sets')),
      h('div', {}, h('b', {}, volume >= 1000 ? `${fmt1(volume / 1000)} t` : `${fmt(volume)}`), h('span', {}, volume >= 1000 ? 'lifted' : 'kg lifted')),
      h('div', {}, h('b', {}, live.prs), h('span', {}, live.prs === 1 ? 'record' : 'records'))),
    h('p', { class: 'sub' }, checked ? 'Training points: 30 of 30 for today.' : 'Training points: 15 of 30. Check in at the gym for the other 15.'),
    checked ? null : h('button', { class: 'btn block', onclick: (e) => { close(); capture(ctx, null); } }, icon('camera', 20), 'Check in now'),
    h('button', { class: `btn ${checked ? '' : 'ghost'} block`, onclick: () => { close(); navigate('/group'); } }, 'See the crew')));
}
const summary = (b) => b.sets.length ? [...b.sets].sort((x, y) => x.setNo - y.setNo).map((s) => (isBodyweight(b) || s.weightKg === 0 ? `${s.reps}` : `${fmt1(s.weightKg)}×${s.reps}`)).join(' · ') : '';

/** Weight and reps stepper for one set. onSave(setNo, kg, reps) */
function setSheet(b, setNo, start, onSave, title = null, onRemove = null) {
  sheet(title ?? `${b.name} · set ${setNo}`, (close) => {
    const step = b.inc > 0 ? b.inc : 2.5;
    const bw = isBodyweight(b);
    const kg = numInput(start.weightKg ?? '', { min: 0, max: 600, 'aria-label': 'Weight in kilograms', class: 'big-input' });
    const reps = numInput(start.reps ?? '', { min: 1, max: 500, inputmode: 'numeric', 'aria-label': b.timed ? 'Seconds' : 'Reps', class: 'big-input' });
    const stepper = (input, delta, label) => h('div', { class: 'stepper' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Less ${label}`, onclick: () => { input.value = String(Math.max(0, Math.round((Number(input.value || 0) - delta) * 100) / 100)); } }, icon('minus', 22)),
      input,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `More ${label}`, onclick: () => { input.value = String(Math.round((Number(input.value || 0) + delta) * 100) / 100); } }, icon('plus', 22)));
    const go = h('button', { class: 'btn block', onclick: async () => {
      if (!reps.value || Number(reps.value) < 1) { toast(b.timed ? 'Enter the seconds' : 'Enter the reps', 'bad'); return; }
      if (!bw && kg.value === '') { toast('Enter the weight (0 for bodyweight)', 'bad'); return; }
      go.disabled = true;
      try { await onSave(setNo, bw ? 0 : Number(kg.value), Math.round(Number(reps.value))); close(); } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
    } }, 'Save set');
    setTimeout(() => (bw ? reps : kg).focus(), 250);
    return h('div', { class: 'stack' },
      b.plan ? h('p', { class: 'sub' }, `Plan: ${b.plan.repMin}–${b.plan.repMax} ${b.timed ? 'sec' : 'reps'}${b.plan.rir !== null ? `, stop with ${b.plan.rir} rep${b.plan.rir === 1 ? '' : 's'} in the tank` : ''}.`) : null,
      bw ? null : h('div', { class: 'field' }, h('span', {}, `Weight (kg) · steps of ${fmt1(step)}`), stepper(kg, step, 'weight')),
      h('div', { class: 'field' }, h('span', {}, b.timed ? 'Seconds' : 'Reps'), stepper(reps, b.timed ? 5 : 1, b.timed ? 'seconds' : 'reps')),
      go,
      onRemove ? h('button', { class: 'btn ghost block', onclick: () => { close(); onRemove(); } }, 'Remove this set') : null);
  });
}

function exerciseMenu(b, live) {
  sheet(b.name, (close) => h('div', {},
    b.notes ? h('div', { class: 'cue' }, h('span', { class: 'h3' }, 'How to do it'), h('p', { class: 'sub' }, b.notes)) : null,
    h('button', { class: 'list-row', onclick: () => { close(); videoSheet(b); } }, icon('play', 22), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Watch the demo video')), icon('chevR', 20)),
    h('button', { class: 'list-row', onclick: () => { close(); navigate(`/history/${encodeURIComponent(b.exerciseId)}`); } }, icon('chart', 22), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Progress on this exercise'), h('span', { class: 'sub' }, 'Best set and estimated max over time')), icon('chevR', 20)),
    b.plan ? h('button', { class: 'list-row', onclick: () => { close(); swapSheet(b, live); } }, icon('swap', 22), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Swap for another exercise'), h('span', { class: 'sub' }, 'Machine taken or missing? Same muscles, same sets')), icon('chevR', 20)) : null,
    b.sets.length ? h('button', { class: 'list-row', onclick: () => { close(); confirmSheet('Clear these sets?', `All ${b.sets.length} logged sets of ${b.name} on this day are removed.`, 'Clear sets', async () => { try { await api('POST', '/api/train/exercise/clear', { date: live.ctx.date, exerciseId: b.exerciseId }); live.ctx.reload(); } catch (e) { toast(e.message, 'bad'); } }, true); } }, icon('trash', 22), h('span', { class: 'grow' }, h('span', { class: 'strong' }, 'Clear logged sets')), icon('chevR', 20)) : null));
}

function swapSheet(b, live) {
  sheet(`Swap ${b.name}`, (close) => {
    const list = h('div', {}, h('p', { class: 'muted pad' }, 'Loading options…'));
    const wd = new Date(`${live.ctx.date}T00:00:00Z`).getUTCDay();
    api('GET', `/api/exercises/${encodeURIComponent(b.exerciseId)}/alternatives`).then(({ options }) => {
      list.replaceChildren(...(options.length ? options.map((o) => h('div', { class: 'list-row' },
        h('button', { class: 'grow plain-btn', onclick: async () => {
          try { await api('POST', '/api/workout-plan/swap', { exerciseId: b.exerciseId, toId: o.id, weekday: wd }); close(); toast(`${o.name} is in your plan now`); live.ctx.reload(); } catch (e) { toast(e.message, 'bad'); }
        } }, h('span', { class: 'strong' }, o.name), h('span', { class: 'sub' }, `${o.equip} · ${o.muscle}`)),
        videoBtn(o))) : [h('p', { class: 'muted pad' }, 'No like-for-like swap in the library. Ask the admin to add one.')]));
    }).catch((e) => list.replaceChildren(h('p', { class: 'error' }, e.message)));
    return h('div', { class: 'stack' }, h('p', { class: 'sub' }, `Changes ${WEEKDAYS[wd]}'s session from now on. Sets, reps and rest stay the same.`), list);
  });
}

function extraExercise(live) {
  sheet('Add an extra exercise', (close) => exercisePicker((e) => {
    close();
    const b = { exerciseId: e.id, name: e.name, muscle: e.muscle, notes: e.notes, video: e.video, timed: e.timed, equip: e.equip, inc: e.inc, plan: null, sets: [], last: null, target: null, suggested: { weightKg: e.equip === 'bodyweight' ? 0 : null, reps: 10 } };
    live.d.blocks.push(b);
    const card = exerciseCard(b, live.d.blocks.length - 1, live);
    const anchor = document.querySelector('main .cardio') ?? document.querySelector('main .section:last-of-type');
    anchor?.before(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

/** How to read the plan, like the first page of the coaches' PDFs. */
export function guideSheet() {
  sheet('How to read your plan', () => h('div', { class: 'guide' },
    [['Sets', 'How many hard working sets to do. Warm-up and ramp-up sets do not count.'],
      ['Reps', 'The rep range for every set, for example 8–10. Use a weight that lets you land inside it.'],
      ['RIR', 'Reps in reserve: stop when you could still do that many good reps. RIR 1 means one rep left in the tank; RIR 0 means the last rep you can do with good form.'],
      ['Rest', 'Time between sets. Big lifts need longer. The timer starts when you tick a set.'],
      ['Tempo', '2-0-1-0 = 2 seconds lowering, no pause at the bottom, 1 second lifting, no pause at the top.'],
      ['Progress', 'When every set reaches the top of the range, add weight next time and start at the bottom of the range again. The app tells you when.']]
      .map(([k, v]) => h('div', { class: 'guide-row' }, h('span', { class: 'rxc static' }, k), h('p', {}, v)))));
}

// ---------------------------------------------------------------- cardio
function cardioCard(d, ctx) {
  const c = d.cardioPlan;
  const planned = c ? d.cardio.find((x) => x.notes === c.label) : null; // the planned session, once ticked
  const others = d.cardio.filter((x) => x !== planned);
  return h('section', { class: 'section cardio' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Cardio'), c ? h('span', { class: 'sub' }, c.when) : null),
    c ? h('div', { class: 'item', 'data-state': planned ? 'eaten' : '' },
      h('button', { class: 'rowbtn', 'aria-pressed': String(Boolean(planned)), onclick: async () => {
        try {
          if (planned) await api('POST', '/api/train/cardio/remove', { id: planned.id });
          else await api('POST', '/api/train/cardio', { date: ctx.date, today: ctx.today, kind: c.kind, minutes: c.minutes, notes: c.label });
          ctx.reload();
        } catch (e) { toast(e.message, 'bad'); }
      } }, h('span', { class: 'tick' }, icon('check', 16)),
      h('span', { class: 'item-main' }, h('span', { class: 'item-name' }, `${c.label} · ${c.minutes} min`), h('span', { class: 'item-amt' }, c.note)))) : null,
    others.map((x) => h('div', { class: 'item', 'data-state': 'eaten' },
      h('span', { class: 'item-main', style: 'padding-left:2px' }, h('span', { class: 'item-name' }, x.notes || x.kind), h('span', { class: 'item-amt' }, `${fmt1(x.minutes)} min${x.distanceKm ? ` · ${fmt1(x.distanceKm)} km` : ''}${x.avgHr ? ` · ${x.avgHr} bpm` : ''}`)),
      h('button', { class: 'icon-btn', 'aria-label': `Remove ${x.kind}`, onclick: async () => { try { await api('POST', '/api/train/cardio/remove', { id: x.id }); ctx.reload(); } catch (e) { toast(e.message, 'bad'); } } }, icon('trash', 20)))),
    h('button', { class: 'add-row', onclick: () => cardioSheet(ctx) }, icon('plus', 22), c ? 'Log different cardio' : 'Log cardio'));
}

function cardioSheet(ctx) {
  sheet('Log cardio', (close) => {
    const kind = h('select', { 'aria-label': 'Type' }, ['Walk', 'Run', 'Cycle', 'Row', 'Swim', 'Elliptical', 'Stairs', 'Other'].map((k) => h('option', { value: k }, k)));
    const i = { minutes: numInput('', { min: 1, max: 600, inputmode: 'numeric' }), km: numInput('', { min: 0, max: 500 }), hr: numInput('', { min: 40, max: 230, inputmode: 'numeric' }) };
    return h('div', { class: 'stack' },
      field('Type', kind),
      h('div', { class: 'grid3' }, field('Minutes', i.minutes), field('Km', i.km), field('Avg bpm', i.hr)),
      h('button', { class: 'btn block', onclick: async () => {
        if (!i.minutes.value) { toast('Enter the minutes', 'bad'); return; }
        try { await api('POST', '/api/train/cardio', { date: ctx.date, today: ctx.today, kind: kind.value, minutes: Number(i.minutes.value), distanceKm: i.km.value || undefined, avgHr: i.hr.value || undefined }); close(); toast('Cardio saved'); ctx.reload(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Save cardio'));
  });
}

function restCard(d, ctx) {
  const next = d.week.find((x) => x.date > ctx.date && x.planned);
  return h('section', { class: 'section' },
    h('p', { class: 'sub' }, 'Recovery is where you grow. Walk, sleep 7–9 hours, hit your protein.'),
    next ? h('p', { style: 'margin:12px 0 14px' }, h('span', { class: 'sub' }, 'Next session '), h('b', {}, `${next.name}, ${next.date === shiftDate(ctx.today, 1) ? 'tomorrow' : fmtDate(next.date, { weekday: 'long' })}`)) : h('p', { style: 'height:12px' }));
}

// ---------------------------------------------------------------- the whole week
export async function weekPlanView() {
  const main = paint('train', loading());
  const run = () => guard(main, async () => {
    const { plan, hasPending } = await api('GET', '/api/workout-plan');
    const back = h('p', { style: 'margin:0 0 10px -4px' }, h('button', { class: 'link', style: 'text-decoration:none;font-weight:600', onclick: () => navigate('/train') }, '‹ Train'));
    if (!plan) { main.replaceChildren(back, emptyState(hasPending ? 'Your training plan is being checked' : 'No training plan yet', hasPending ? 'The admin will approve it soon.' : 'Fill in your training details to get one.')); return; }
    const byDay = new Map(plan.days.map((d) => [d.weekday, d]));
    main.replaceChildren(
      back,
      h('h1', { class: 'title' }, 'My training plan'),
      h('p', { class: 'sub' }, `${plan.split} · ${plan.daysPerWeek} sessions a week${plan.intensity ? ` · ${plan.intensity}` : ''}${plan.startDate ? ` · since ${fmtDate(plan.startDate, { day: 'numeric', month: 'long' })}` : ''}`),
      h('div', { class: 'row-flex', style: 'margin-top:14px' },
        h('button', { class: 'btn small ghost', onclick: guideSheet }, icon('info', 18), 'How to read it'),
        h('button', { class: 'btn small ghost', onclick: () => trainingSheet(run, plan) }, 'Change split or days')),
      plan.splitChoice?.reason ? h('section', { class: 'section why' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Why this split'), h('span', { class: 'meta' }, plan.splitChoice.by === 'ai' ? 'Picked by the AI coach' : plan.splitChoice.by === 'member' ? 'Your choice' : 'Picked by the coach rules')),
        h('p', { class: 'sub', style: 'padding-bottom:12px' }, plan.splitChoice.reason)) : null,
      WEEK.map((wd) => {
        const d = byDay.get(wd);
        if (!d) return h('div', { class: 'restline' }, h('span', { class: 'strong' }, WEEKDAYS[wd]), h('span', { class: 'sub' }, 'Rest'));
        return h('details', { class: 'section wday' },
          h('summary', { class: 'section-head' }, h('span', { class: 'grow' }, h('span', { class: 'meta' }, WEEKDAYS[wd].toUpperCase()), h('h2', { class: 'h2' }, d.name), h('span', { class: 'sub' }, `${d.exercises.length} exercises${d.minutes ? ` · about ${d.minutes} min` : ''}${d.focus ? ` · ${d.focus}` : ''}`)), icon('chevR', 20)),
          h('div', { style: 'padding-bottom:6px' }, d.exercises.map((e, i) => h('div', { class: 'list-row', style: 'cursor:default' },
            h('span', { class: 'ex-no' }, i + 1),
            h('span', { class: 'grow' }, h('span', { class: 'strong' }, e.name), h('span', { class: 'sub' }, `${e.sets} × ${e.repMin}–${e.repMax}${e.rir !== undefined ? ` · RIR ${e.rir}` : ''}${isSuperFirst(e) ? ' · superset with the next' : e.restSec ? ` · rest ${restLabel(e.restSec)}` : ''}`)),
            videoBtn(e)))));
      }),
      plan.cardio ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Cardio'), h('span', { class: 'sub' }, plan.cardio.when)), h('p', { style: 'padding-bottom:12px' }, h('b', {}, `${plan.cardio.label}, ${plan.cardio.minutes} min. `), h('span', { class: 'sub' }, plan.cardio.note))) : null,
      plan.notes?.length ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Coach notes')), h('ul', { class: 'notes' }, plan.notes.map((n) => h('li', {}, n)))) : null);
  }, run);
  await run();
}

/** Training days, experience and equipment. Saving makes a new plan (reviewed like any other). */
function trainingSheet(done, plan = null) {
  const p = state.me?.profile ?? {};
  sheet('Training details', (close) => {
    const picked = new Set(p.trainDays ?? plan?.days.map((d) => d.weekday) ?? []);
    const split = h('select', { 'aria-label': 'Training split' }, SPLIT_CHOICES.map(([id, name, , d]) => h('option', { value: id, selected: (p.split ?? 'auto') === id ? true : null }, `${name} (${id === 'auto' ? '2–6' : d.join(' or ')} days)`)));
    const chips = h('div', { class: 'chips' });
    const count = h('p', { class: 'sub' });
    const drawChips = () => {
      chips.replaceChildren(...WEEK.map((wd) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(picked.has(wd)), onclick: () => { if (picked.has(wd)) picked.delete(wd); else picked.add(wd); drawChips(); } }, WEEKDAYS[wd].slice(0, 3))));
      const allowed = SPLIT_CHOICES.find((x) => x[0] === (split?.value ?? p.split ?? 'auto'))?.[3] ?? [2, 3, 4, 5, 6];
      const ok = allowed.includes(picked.size);
      count.textContent = ok ? `${picked.size} sessions a week` : `Pick ${allowed.join(' or ')} days for this split (${picked.size} picked)`;
      count.style.color = ok ? '' : 'var(--warn)';
    };
    drawChips();
    split.addEventListener('change', drawChips);
    const intensity = h('select', { 'aria-label': 'Intensity' }, INTENSITY_CHOICES.map(([v, l, about]) => h('option', { value: v, selected: (p.intensity ?? 'moderate') === v ? true : null }, `${l}: ${about.split('.')[0]}`)));
    const exp = h('select', { 'aria-label': 'Experience' }, [['beginner', 'Beginner (under 1 year)'], ['intermediate', 'Intermediate (1–3 years)'], ['advanced', 'Advanced (3+ years)']].map(([v, l]) => h('option', { value: v, selected: p.experience === v ? true : null }, l)));
    const eq = h('select', { 'aria-label': 'Equipment' }, [['gym', 'Full gym'], ['mixed', 'Gym and home'], ['home', 'Home (dumbbells)']].map(([v, l]) => h('option', { value: v, selected: p.equipment === v ? true : null }, l)));
    const go = h('button', { class: 'btn block', onclick: async () => {
      const allowed = SPLIT_CHOICES.find((x) => x[0] === split.value)[3];
      if (!allowed.includes(picked.size)) { toast(`Pick ${allowed.join(' or ')} training days for this split`, 'bad'); return; }
      go.disabled = true;
      try {
        const r = await api('POST', '/api/profile/training', { split: split.value, intensity: intensity.value, trainDays: [...picked], experience: exp.value, equipment: eq.value });
        state.me.profile = { ...state.me.profile, ...r.profile };
        close(); toast(r.status === 'active' ? 'Your new training plan is live' : 'New plan sent to the admin for a check'); done();
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
    } }, 'Make my new plan');
    return h('div', { class: 'stack' },
      field('Intensity', intensity, 'Sets, number of exercises and how close to failure.'),
      field('Training split', split),
      h('div', { class: 'field' }, h('span', {}, 'Which days do you train?'), chips, count),
      h('div', { class: 'grid2' }, field('Experience', exp), field('Equipment', eq)),
      h('p', { class: 'sub' }, 'A fresh plan is made for these days. Today’s logged sets are kept.'),
      go);
  });
}

// ---------------------------------------------------------------- history & records
const backTo = (path, label) => h('p', { style: 'margin:0 0 10px -4px' }, h('button', { class: 'link', style: 'text-decoration:none;font-weight:600', onclick: () => navigate(path) }, `‹ ${label}`));
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const delta = (a, b) => {
  const p = pct(a, b);
  if (p === null) return h('span', { class: 'delta up' }, 'new');
  return h('span', { class: `delta ${p > 0 ? 'up' : p < 0 ? 'down' : ''}` }, p === 0 ? 'same' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`);
};

export async function historyView() {
  const main = paint('train', loading());
  const run = () => guard(main, async () => {
    const h_ = await api('GET', `/api/train/history?today=${localDate()}`);
    const a7 = h_.attendance.last7; const a28 = h_.attendance.last28;
    const w = h_.week;
    const top = Math.max(1, ...h_.muscles.map((m) => Math.max(m.this, m.last)));
    main.replaceChildren(
      backTo('/train', 'Train'),
      h('h1', { class: 'title' }, 'History'),
      // This week vs last week: the three numbers that show whether training is moving.
      w ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'This week'), h('span', { class: 'sub' }, 'vs the same days last week')),
        h('div', { class: 'wk-grid' },
          [['Sessions', w.this.sessions, w.last.sessions, (x) => x], ['Sets', w.this.sets, w.last.sets, (x) => x], ['Volume', w.this.volume, w.last.volume, (x) => (x >= 1000 ? `${fmt1(x / 1000)} t` : `${fmt(x)} kg`)]]
            .map(([k, a, b, f]) => h('div', {}, h('span', { class: 'sub' }, k), h('b', { class: 'num' }, f(a)), h('span', { class: 'meta' }, `was ${f(b)}`), b > 0 || a > 0 ? delta(a, b) : null)))) : null,
      // Weekly hard sets per muscle: what coaches use to judge volume (10-20 is the usual range).
      h_.muscles.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Sets per muscle'), h('span', { class: 'sub' }, 'this week vs last')),
        h('div', { class: 'mus' }, h_.muscles.slice(0, 12).map((m) => h('div', { class: 'mus-row' },
          h('span', { class: 'mus-name' }, cap(m.muscle)),
          h('span', { class: 'mus-bars', 'aria-label': `${m.muscle}: ${m.this} sets this week, ${m.last} last week` },
            h('i', { class: 'now', style: `width:${(m.this / top) * 100}%` }), h('i', { class: 'prev', style: `width:${(m.last / top) * 100}%` })),
          h('span', { class: 'num mus-n' }, m.this)))),
        h('p', { class: 'meta', style: 'padding:6px 0 10px' }, h('span', { class: 'key now' }), ' this week  ', h('span', { class: 'key prev' }), ' last week. Most people grow on 10–20 hard sets per muscle a week.')) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Gym attendance')),
        h('div', { class: 'grid2', style: 'padding:6px 0 14px' },
          h('div', {}, h('span', { class: 'num', style: 'font-size:40px' }, `${a7.attended}`), h('span', { class: 'sub' }, ` / ${a7.planned}`), h('p', { class: 'sub' }, 'Last 7 days')),
          h('div', {}, h('span', { class: 'num', style: 'font-size:40px' }, `${a28.attended}`), h('span', { class: 'sub' }, ` / ${a28.planned}`), h('p', { class: 'sub' }, 'Last 4 weeks')))),
      // Personal bests lead with the best set (what people remember); the estimate is second.
      h_.records.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Personal bests'), h('span', { class: 'sub' }, 'Tap for the chart')),
        h_.records.slice(0, 40).map((r, i) => h('button', { class: 'list-row', hidden: i >= 10, onclick: () => navigate(`/history/${encodeURIComponent(r.exerciseId)}`) },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, r.name), h('span', { class: 'sub' }, `${r.e1rm > 0 && r.weightKg > 0 ? `Estimated max ${fmt1(r.e1rm)} kg · ` : ''}${fmtDate(r.date, { day: 'numeric', month: 'short' })}`)),
          h('span', { class: 'num pb' }, r.weightKg > 0 ? `${fmt1(r.weightKg)}×${r.reps}` : r.timed ? `${r.reps} s` : `${r.reps} reps`),
          icon('chevR', 18))),
        h_.records.length > 10 ? h('button', { class: 'link', style: 'width:100%', onclick: (e) => { e.currentTarget.parentElement.querySelectorAll('.list-row[hidden]').forEach((x) => { x.hidden = false; }); e.currentTarget.remove(); } }, `Show all ${Math.min(40, h_.records.length)}`) : null) : null,
      h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Sessions')),
        h_.sessions.length ? h_.sessions.map((s) => h('button', { class: 'list-row', onclick: () => { state.trainDate = s.date === localDate() ? null : s.date; navigate('/train'); } },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, fmtDate(s.date)), h('span', { class: 'sub' }, `${s.exercises} exercises · ${s.sets} sets · ${fmt(s.volume)} kg lifted`)),
          s.checkin === 'approved' ? h('span', { class: 'status ok' }, 'Checked in') : null, icon('chevR', 20)))
          : h('p', { class: 'muted', style: 'padding:14px 0' }, 'Tick off your first workout and it appears here.')),
      h_.cardio.length ? h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Cardio')),
        h_.cardio.map((c) => h('div', { class: 'list-row', style: 'cursor:default' },
          h('span', { class: 'grow' }, h('span', { class: 'strong' }, c.kind), h('span', { class: 'sub' }, fmtDate(c.date))),
          h('span', { class: 'sub' }, `${fmt1(c.minutes)} min${c.distanceKm ? ` · ${fmt1(c.distanceKm)} km` : ''}`)))) : null);
  }, run);
  await run();
}

// ---------------------------------------------------------------- one exercise over time
export async function exerciseHistoryView({ id }) {
  const main = paint('train', loading());
  const run = () => guard(main, async () => {
    const { exercise: ex, sessions } = await api('GET', `/api/train/exercise/${encodeURIComponent(id)}/history`);
    const weighted = sessions.some((s) => s.e1rm);
    const best = sessions.reduce((b, s) => (!b || (weighted ? s.e1rm > b.e1rm : s.best.reps > b.best.reps) ? s : b), null);
    const first = sessions[0]; const last = sessions.at(-1);
    main.replaceChildren(
      backTo('/history', 'History'),
      h('h1', { class: 'title', style: 'margin-bottom:2px' }, ex.name),
      h('p', { class: 'sub', style: 'margin-bottom:12px' }, `${cap(ex.muscle)}${ex.equip ? ` · ${ex.equip}` : ''}`),
      !sessions.length ? emptyState('No sets yet', 'Tick this exercise in a workout and your progress shows up here.') : h('div', {},
        h('section', { class: 'section' },
          h('div', { class: 'wk-grid', style: 'padding-top:12px' },
            h('div', {}, h('span', { class: 'sub' }, 'Best set'), h('b', { class: 'num' }, best.best.weightKg > 0 ? `${fmt1(best.best.weightKg)}×${best.best.reps}` : `${best.best.reps}`), h('span', { class: 'meta' }, fmtDate(best.date, { day: 'numeric', month: 'short' }))),
            h('div', {}, h('span', { class: 'sub' }, weighted ? 'Est. max' : 'Sessions'), h('b', { class: 'num' }, weighted ? fmt1(best.e1rm) : sessions.length), h('span', { class: 'meta' }, weighted ? 'kg, 1 rep' : 'logged')),
            h('div', {}, h('span', { class: 'sub' }, 'Since start'), h('b', { class: 'num' }, weighted && first !== last ? `${last.e1rm - first.e1rm >= 0 ? '+' : ''}${fmt1(last.e1rm - first.e1rm)}` : '–'), h('span', { class: 'meta' }, weighted ? 'kg est. max' : ''))),
          sessions.length > 1 ? lineChart(sessions.map((s) => ({ date: s.date, y: weighted ? s.e1rm : s.best.reps })), weighted ? 'Estimated max (kg)' : 'Best reps') : h('p', { class: 'meta', style: 'padding:8px 0 12px' }, 'One session so far. The chart appears after the next one.')),
        h('section', { class: 'section' },
          h('div', { class: 'section-head' }, h('h2', { class: 'h2' }, 'Sessions')),
          [...sessions].reverse().map((s) => h('div', { class: 'list-row', style: 'cursor:default' },
            h('span', { class: 'grow' }, h('span', { class: 'strong' }, fmtDate(s.date)), h('span', { class: 'sub' }, s.sets.map((x) => (x.weightKg > 0 ? `${fmt1(x.weightKg)}×${x.reps}` : `${x.reps}`)).join(' · '))),
            s === best ? h('span', { class: 'status ok' }, 'Best') : null)))),
      h('p', { style: 'margin-top:12px' }, h('button', { class: 'link', onclick: () => videoSheet(ex) }, 'Watch the demo')));
  }, run);
  await run();
}

/** Small responsive SVG line chart with dots, first/last labels and min/max gridlines. */
function lineChart(points, label) {
  const W = 340; const H = 150; const P = { l: 34, r: 10, t: 12, b: 22 };
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys); let hi = Math.max(...ys);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const t0 = Date.parse(points[0].date); const t1 = Date.parse(points.at(-1).date) || t0 + 1;
  const x = (d) => P.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const area = `${path}L${x(points.at(-1).date).toFixed(1)},${H - P.b}L${x(points[0].date).toFixed(1)},${H - P.b}Z`;
  const grid = [hi - pad, lo + pad];
  return h('figure', { class: 'lchart' },
    h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label}: from ${fmt1(points[0].y)} to ${fmt1(points.at(-1).y)} over ${points.length} sessions` },
      ...grid.map((g) => [h('line', { x1: P.l, x2: W - P.r, y1: y(g), y2: y(g), class: 'grid' }), h('text', { x: P.l - 6, y: y(g) + 4, 'text-anchor': 'end', class: 'axis' }, fmt1(g))]).flat(),
      h('path', { d: area, class: 'area' }),
      h('path', { d: path, class: 'line' }),
      ...points.map((p) => h('circle', { cx: x(p.date), cy: y(p.y), r: 3.5, class: 'pt' })),
      h('text', { x: P.l, y: H - 4, class: 'axis' }, fmtDate(points[0].date, { day: 'numeric', month: 'short' })),
      h('text', { x: W - P.r, y: H - 4, 'text-anchor': 'end', class: 'axis' }, fmtDate(points.at(-1).date, { day: 'numeric', month: 'short' }))),
    h('figcaption', { class: 'meta' }, label));
}
