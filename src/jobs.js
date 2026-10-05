// Daily rhythm: the coach checks in at set local times, in the app and as a phone notification.
//   08:00 morning brief      what today looks like (targets, meals, workout, water)
//   14:00 nudge              only if nothing is logged yet
//   21:00 evening recap      what is left today, with one concrete, plan-compatible fix
//   22:00 crew update        the group's day, positive only (no one is called out)
//   Fri 12:00 weekly review  the week in numbers
// Messages are written by code, not the AI, so they always arrive and are always correct.
// Each job runs at most once per person per day (jobs_run), and is skipped if the server was
// off for more than 3 hours past its time (no stale "good morning" at midnight).

import { callAs } from './api.js';
import { loadFoods, getSetting } from './db.js';
import { filterFoods } from './plan.js';
import { describeAmount } from './exchange.js';
import { pushToUser } from './push.js';

export const JOBS = [
  { id: 'morning', at: '08:00' },
  { id: 'nudge', at: '14:00' },
  { id: 'evening', at: '21:00' },
  { id: 'crew', at: '22:00' },
  { id: 'weekly', at: '12:00', weekday: 5 }, // Friday
];

/** Local date, minutes since midnight and weekday in the crew's time zone. */
export function localClock(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: wd };
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const TIPS = [
  'Weigh rice, pasta and oats dry; chicken and meat cooked.',
  'Vegetables and salad are free. Hungry at night? A big salad and water.',
  'Missed a meal? Eat its protein later and skip its carbs.',
  'Tea and coffee are fine with up to 100 ml skimmed milk.',
  'A full bottle of water before each meal makes the water target easy.',
  'Craving sweets? Strawberries, watermelon or cantaloupe, then wait 30 minutes.',
  'Consistency beats perfection. One off meal is not an off week.',
];

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const liters = (ml) => `${(ml / 1000).toFixed(ml % 1000 ? (ml % 500 ? 2 : 1) : 0)} L`;

function store(db, uid, kind, content, data = null) {
  db.prepare('INSERT INTO coach_messages (user_id, role, kind, content, data) VALUES (?, ?, ?, ?, ?)').run(uid, 'assistant', kind, content, data ? JSON.stringify(data) : null);
}

// ---------------------------------------------------------------- message builders
async function morning(db, user, date) {
  const d = await callAs(db, user, 'GET', `/api/today?date=${date}`);
  if (!d.meals) return null;
  const w = await callAs(db, user, 'GET', `/api/train?date=${date}`).catch(() => null);
  const workout = !w?.hasPlan ? '' : w.restDay ? ' Rest day for training.' : ` Training: ${w.dayName}, ${w.blocks.length} exercises.`;
  const tip = TIPS[Number(date.replaceAll('-', '')) % TIPS.length];
  const first = user.name.split(' ')[0];
  return {
    text: `Good morning ${first}. Today is ${fmt(d.targets.kcal)} kcal with ${d.targets.proteinG} g protein over ${d.meals.length} meals, starting with ${d.meals[0].name.toLowerCase()}.${workout} Water goal: ${liters(d.water.target)}.\n\nTip: ${tip}`,
    push: { title: `Good morning ${first}`, body: `${fmt(d.targets.kcal)} kcal · ${d.targets.proteinG} g protein${w?.hasPlan ? (w.restDay ? ' · rest day' : ` · ${w.dayName}`) : ''}`, url: '/#/today', tag: 'morning' },
  };
}

async function nudge(db, user, date) {
  const d = await callAs(db, user, 'GET', `/api/today?date=${date}`);
  if (!d.meals) return null;
  const anything = d.meals.some((m) => m.items.some((i) => i.log)) || d.extras.length;
  if (anything) return null;
  return {
    text: 'Nothing logged yet today. Tap "Log all" after a meal, or just tell me what you ate and I will log it.',
    push: { title: 'Quick check-in', body: 'Nothing logged yet today. Tell the coach what you ate.', url: '/#/today', tag: 'nudge' },
  };
}

/** The highest-protein food the person eats that fits a gap, as "200 g Greek yogurt". */
function proteinFix(db, user, gapG) {
  const prof = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(user.id);
  const prefs = prof ? JSON.parse(prof.data).prefs : {};
  const pool = filterFoods(loadFoods(db), prefs);
  const picks = ['greek-yogurt', 'tuna-canned', 'chicken-breast', 'areesh', 'egg-whites', 'whey', 'lupini', 'cottage-cheese'];
  const f = picks.map((id) => pool.find((x) => x.id === id)).find(Boolean);
  if (!f) return null;
  const grams = Math.round(((gapG / f.p) * 100) / 10) * 10;
  return `${describeAmount(f, Math.min(grams, (f.portion?.[2] ?? 300)))} of ${f.name.split(/[,(]/)[0].trim().toLowerCase()}`;
}

async function evening(db, user, date) {
  const d = await callAs(db, user, 'GET', `/api/today?date=${date}`);
  if (!d.meals) return null;
  const w = await callAs(db, user, 'GET', `/api/train?date=${date}`).catch(() => null);
  const unlogged = d.meals.filter((m) => m.items.every((i) => !i.log)).map((m) => m.name.toLowerCase());
  const pGap = Math.round(d.targets.proteinG - d.consumed.p);
  const waterGap = d.water.target - d.water.ml;
  const lines = [];
  if (unlogged.length) lines.push(`Not logged: ${unlogged.join(', ')}.`);
  if (pGap > 15) { const fix = proteinFix(db, user, pGap); lines.push(`${pGap} g protein to go${fix ? `; about ${fix} covers it` : ''}.`); }
  if (waterGap > 500) lines.push(`${liters(waterGap)} of water left.`);
  if (w?.hasPlan && !w.restDay && !w.state?.done) lines.push(`${w.dayName} is not logged yet.`);
  const first = user.name.split(' ')[0];
  if (!lines.length) {
    return { text: `Strong day, ${first}. Everything is in. Sleep well; tomorrow's plan is ready when you are.`, push: { title: 'Day complete', body: 'Everything is logged. Nice work.', url: '/#/today', tag: 'evening' } };
  }
  return {
    text: `Evening check, ${first}:\n${lines.map((l) => `• ${l}`).join('\n')}\nIf you already ate, tell me and I will log it.`,
    push: { title: 'Evening check', body: lines[0], url: '/#/today', tag: 'evening' },
  };
}

async function crew(db, user, date) {
  const g = await callAs(db, user, 'GET', `/api/group?today=${date}`);
  const board = (g.board ?? []).filter((b) => !b.hidden || b.isMe);
  const strong = board.filter((b) => (b.today ?? 0) >= 70).map((b) => (b.isMe ? 'you' : b.name.split(' ')[0]));
  const streak = [...board].sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0))[0];
  if (!strong.length && !(streak?.streak > 1)) return null;
  const parts = [];
  if (strong.length) parts.push(`${strong.length === board.length ? 'Everyone' : strong.join(', ')} hit 70+ today.`);
  if (streak?.streak > 1) parts.push(`Longest streak: ${streak.isMe ? 'you' : streak.name.split(' ')[0]}, ${streak.streak} days.`);
  return { text: `Crew update: ${parts.join(' ')}`, push: { title: 'Crew update', body: parts.join(' '), url: '/#/group', tag: 'crew' } };
}

// Friday: the weekly recap (points, rank, gym, best lift, weight, one thing to improve).
async function weekly(db, user, date) {
  const { recap: r } = await callAs(db, user, 'GET', `/api/recap?today=${date}`);
  if (!r) return null;
  const first = user.name.split(' ')[0];
  // The adaptive weekly check-in opens today: point to it (it needs this morning's weigh-in).
  let ci = null;
  try { ({ checkin: ci } = await callAs(db, user, 'GET', `/api/checkin/weekly?today=${date}`)); } catch { /* no check-in: skip the line */ }
  const ciLine = !ci || ci.status === 'off' || ci.status === 'closed' ? ''
    : ci.kind === 'needs_weight' ? 'Weigh in and open Today for your weekly check-in.'
      : ci.kind === 'proposed' && ci.status === 'open' ? `Weekly check-in: ${ci.text} Open Today to update your plan.`
        : ci.kind === 'learning' ? '' : `Weekly check-in: ${ci.text}`;
  const lines = [
    `${fmt(r.points)} points this week (${r.avg} a day), #${r.rank} of ${r.of} in the crew.`,
    `${r.days70} day${r.days70 === 1 ? '' : 's'} at 70+${r.gym.planned ? `, gym ${r.gym.attended} of ${r.gym.planned}` : ''}.`,
    r.bestLift ? `Best lift: ${r.bestLift.name}, ${r.bestLift.weightKg > 0 ? `${r.bestLift.weightKg} kg × ${r.bestLift.reps}` : `${r.bestLift.reps} reps`}${r.prs ? ` · ${r.prs} new PR${r.prs > 1 ? 's' : ''}` : ''}.` : '',
    r.weightChange !== null ? `Weight ${r.weightChange > 0 ? '+' : ''}${r.weightChange} kg.` : 'Weigh in this morning to see your trend.',
    ciLine,
    r.tip,
  ].filter(Boolean);
  return { text: `Your week, ${first}:\n${lines.map((l) => `• ${l}`).join('\n')}`, push: { title: 'Your week', body: `${fmt(r.points)} points · #${r.rank} of ${r.of}`, url: '/#/today', tag: 'weekly' } };
}

const BUILDERS = { morning, nudge, evening, crew, weekly };

/** Run whatever is due. Safe to call every minute. Returns what was sent (for logs and tests). */
export async function runDueJobs(db, now = new Date(), { push = pushToUser } = {}) {
  const tz = getSetting(db, 'timezone', 'Africa/Cairo');
  const clock = localClock(now, tz);
  const users = db.prepare('SELECT u.* FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.active = 1').all();
  const done = [];
  for (const job of JOBS) {
    if (job.weekday !== undefined && job.weekday !== clock.weekday) continue;
    const due = toMin(job.at);
    if (clock.minutes < due || clock.minutes > due + 180) continue;
    for (const user of users) {
      const prefs = JSON.parse(db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(user.id).data).notify ?? {};
      if (prefs[job.id] === false) continue;
      const claimed = db.prepare('INSERT OR IGNORE INTO jobs_run (job, user_id, day) VALUES (?, ?, ?)').run(job.id, user.id, clock.date).changes;
      if (!claimed) continue;
      try {
        const msg = await BUILDERS[job.id](db, user, clock.date);
        if (!msg) continue;
        store(db, user.id, 'checkin', msg.text, { job: job.id });
        await push(db, user.id, msg.push);
        done.push({ job: job.id, user: user.name });
      } catch (e) { console.warn(`[jobs] ${job.id} for ${user.name}:`, e.message); }
    }
  }
  return done;
}

/** Start the scheduler (server only; tests call runDueJobs directly). */
export function startScheduler(db) {
  const tick = () => runDueJobs(db).catch((e) => console.warn('[jobs]', e.message));
  setTimeout(tick, 5_000);
  return setInterval(tick, 60_000);
}
