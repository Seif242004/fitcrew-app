// Training cycles (deload week, automatic variation rotation) and the training progress views
// (this week vs last week, sets per muscle, one exercise over time).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../server.js';
import { generateWorkoutPlan, planWeek, isDeloadWeek, deloadSets, deloadWeight, CYCLE_WEEKS } from '../src/workout.js';

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-FitCrew': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b) };
  };
  return { db, client, close: () => server.close() };
}
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = new Date().toISOString().slice(0, 10);
const profile = { sex: 'male', age: 27, heightCm: 178, weightKg: 82, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5, experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', injuries: '', measurements: {}, prefs: { mealsPerDay: 4 }, split: 'upperlower' };

async function member(app) {
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Seif', email: 'seif@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 'sam@example.com', password: 'Sam-password-1' });
  // Train every day of the week so "today" is always a training day in these tests.
  const p = { ...profile, daysPerWeek: 6, split: 'auto' };
  await sam.put('/api/profile', { profile: p });
  return { admin, sam };
}
/** First date from `from` onwards that is a training day in the active plan. */
async function trainingDay(sam, from) {
  for (let i = 0; i < 7; i++) { const d = addDays(from, i); const t = (await sam.get(`/api/train?date=${d}`)).body; if (t.dayName) return { d, t }; }
  throw new Error('no training day');
}

test('cycle helpers', () => {
  assert.equal(planWeek('2026-10-03', '2026-10-03'), 1);
  assert.equal(planWeek('2026-10-03', '2026-10-09'), 1);
  assert.equal(planWeek('2026-10-03', '2026-10-10'), 2);
  assert.equal(isDeloadWeek('2026-08-15', addDays('2026-08-15', (CYCLE_WEEKS - 1) * 7)), true);
  assert.equal(isDeloadWeek('2026-08-15', addDays('2026-08-15', (CYCLE_WEEKS - 1) * 7 - 1)), false);
  assert.equal(deloadSets(4), 2); assert.equal(deloadSets(3), 2); assert.equal(deloadSets(1), 1);
  assert.equal(deloadWeight(100, 2.5), 90); assert.equal(deloadWeight(0), 0);
  // Rotation changes exercise variations but keeps the split and the number of sessions.
  const p = { ...profile, daysPerWeek: 4, split: 'upperlower' };
  const a = generateWorkoutPlan({ profile: p }); const b = generateWorkoutPlan({ profile: p, rotation: 1 });
  assert.equal(a.split, b.split);
  assert.equal(a.days.length, b.days.length);
  const ids = (x) => x.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)).join();
  assert.notEqual(ids(a), ids(b));
});

test('deload week: half the sets, more in reserve, lighter weights, scored on the lighter plan', async (t) => {
  const app = await boot(); t.after(app.close);
  const { sam } = await member(app);
  const { d, t: normal } = await trainingDay(sam, today);
  const ex = normal.blocks[0];
  await sam.post('/api/train/set', { date: addDays(d, -7), today: addDays(d, -7), exerciseId: ex.exerciseId, setNo: 1, weightKg: 100, reps: ex.plan.repMax });
  // Move the plan start back so `d` falls in week 7.
  app.db.prepare("UPDATE workout_plans SET start_date = ? WHERE status = 'active'").run(addDays(d, -(CYCLE_WEEKS - 1) * 7));
  const dl = (await sam.get(`/api/train?date=${d}`)).body;
  assert.equal(dl.cycle.deload, true);
  assert.equal(dl.cycle.week, CYCLE_WEEKS);
  const b = dl.blocks.find((x) => x.exerciseId === ex.exerciseId);
  assert.equal(b.plan.sets, deloadSets(ex.plan.sets));
  assert.equal(b.plan.rir, Math.min(4, (ex.plan.rir ?? 1) + 2));
  assert.equal(b.target, null, 'no progression in a deload week');
  assert.equal(b.suggested.weightKg, 90);
  // Ticking every deload set completes the session.
  for (const x of dl.blocks) for (let s = 1; s <= x.plan.sets; s++) await sam.post('/api/train/set', { date: d, today: d, exerciseId: x.exerciseId, setNo: s, weightKg: 20, reps: 10 });
  assert.equal((await sam.get(`/api/train?date=${d}`)).body.state.completion, 1);
});

test('after the deload a new cycle is drafted once, with the same split and new variations', async (t) => {
  const app = await boot(); t.after(app.close);
  const { sam } = await member(app);
  const before = (await sam.get('/api/workout-plan')).body.plan;
  app.db.prepare("UPDATE workout_plans SET start_date = ? WHERE status = 'active'").run(addDays(today, -CYCLE_WEEKS * 7 - 1));
  await sam.get(`/api/train?date=${today}`);
  await sam.get(`/api/train?date=${today}`);
  const rows = app.db.prepare('SELECT status, data, note FROM workout_plans ORDER BY version').all();
  assert.equal(rows.length, 2, 'one new plan, not one per visit');
  const next = JSON.parse(rows[1].data);
  assert.equal(next.rotation, 1);
  assert.equal(next.split, before.split);
  assert.match(rows[1].note, /New cycle 2/);
  const now = (await sam.get(`/api/train?date=${today}`)).body;
  if (rows[1].status === 'active') assert.equal(now.cycle.week, 1);
  else assert.equal(now.hasPending, true);
});

test('training history: this week vs last week, sets per muscle, one exercise over time', async (t) => {
  const app = await boot(); t.after(app.close);
  const { sam } = await member(app);
  const ws = (await sam.get(`/api/train?date=${today}`)).body.week[0].date; // Saturday
  app.db.prepare("UPDATE workout_plans SET start_date = ?").run(addDays(ws, -7));
  await sam.post('/api/train/set', { date: addDays(ws, -5), today: addDays(ws, -5), exerciseId: 'leg-press', setNo: 1, weightKg: 100, reps: 10 });
  await sam.post('/api/train/set', { date: addDays(ws, -5), today: addDays(ws, -5), exerciseId: 'leg-press', setNo: 2, weightKg: 110, reps: 8 });
  await sam.post('/api/train/set', { date: ws, today: ws, exerciseId: 'leg-press', setNo: 1, weightKg: 120, reps: 8 });
  const h = (await sam.get(`/api/train/history?today=${addDays(ws, 2)}`)).body; // Monday: last week counts up to last Monday
  assert.deepEqual(h.week.this, { sets: 1, volume: 960, sessions: 1 });
  assert.deepEqual(h.week.last, { sets: 2, volume: 1880, sessions: 1 });
  const quads = h.muscles.find((m) => m.this || m.last);
  assert.equal(quads.this, 1); assert.equal(quads.last, 2);
  const ex = (await sam.get('/api/train/exercise/leg-press/history')).body;
  assert.equal(ex.exercise.id, 'leg-press');
  assert.equal(ex.sessions.length, 2);
  assert.deepEqual(ex.sessions[0].best, { weightKg: 110, reps: 8 }, 'best set by estimated max, oldest session first');
  assert.equal(ex.sessions[1].best.weightKg, 120);
  assert.ok(ex.sessions[1].e1rm > ex.sessions[0].e1rm);
  assert.equal((await sam.get('/api/train/exercise/nope/history')).status, 404);
});
