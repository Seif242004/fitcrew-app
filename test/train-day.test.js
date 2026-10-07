// Rest / training day switch and check-in-only training points, through the API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../server.js';

const SAT = '2026-10-03'; // the crew's week runs Saturday to Friday
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const profile = {
  sex: 'male', age: 25, heightCm: 180, weightKg: 82, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
  experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', injuries: '', measurements: {},
  prefs: { mealsPerDay: 4, likedIds: [], dislikedIds: [], allergies: [], vegetarian: false },
};

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/setup', { name: 'Seif', email: 'seif@example.com', password: 'a-good-password' });
  await call('PUT', '/api/profile', { profile });
  const uid = db.prepare('SELECT id FROM users').get().id;
  // Plans started a week before, so the whole test week is covered.
  db.prepare("UPDATE workout_plans SET start_date = ? WHERE status = 'active'").run(addDays(SAT, -7));
  db.prepare("UPDATE plans SET start_date = ? WHERE status = 'active'").run(addDays(SAT, -7));
  const plan = (await call('GET', '/api/workout-plan')).body.plan;
  const days = Array.from({ length: 7 }, (_, i) => addDays(SAT, i));
  const trainDays = days.filter((d) => plan.days.some((x) => x.weekday === weekdayOf(d)));
  const restDays = days.filter((d) => !trainDays.includes(d));
  /** Log every planned food of a day, so a rest day has something logged. */
  const eat = async (d) => { const t = (await call('GET', `/api/today?date=${d}`)).body; for (const m of t.meals) for (const it of m.items) await call('POST', '/api/log', { date: d, today: d, ref: it.key, status: 'eaten' }); };
  const parts = async (d) => (await call('GET', `/api/adherence?days=7&today=${addDays(SAT, 6)}`)).body.scores.find((s) => s.date === d)?.parts;
  // Training points: the workout part plus the +10 for training on a rest day.
  const workout = async (d) => { const p = await parts(d); return p && p.workout + p.bonus; };
  return { db, uid, call, plan, trainDays, restDays, eat, workout, close: () => server.close() };
}

test('switch a training day to rest and a rest day to training', async (t) => {
  const app = await boot();
  t.after(app.close);
  const [t1] = app.trainDays; const [r1] = app.restDays;
  assert.equal(app.trainDays.length, 4);

  // Training day -> rest day: the Train screen shows a rest day and says what was planned.
  let r = await app.call('POST', '/api/train/day', { date: t1, today: t1, kind: 'rest' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.restDay, true);
  let tr = (await app.call('GET', `/api/train?date=${t1}`)).body;
  assert.equal(tr.restDay, true);
  assert.equal(tr.override, 'rest');
  assert.ok(tr.plannedSession, 'the planned session name is still known');
  assert.equal(tr.week.find((w) => w.date === t1).planned, false);

  // Rest day -> training day: does the next session of the week by default, or the one picked.
  r = await app.call('POST', '/api/train/day', { date: r1, today: r1, kind: 'train' });
  assert.equal(r.body.restDay, false);
  tr = (await app.call('GET', `/api/train?date=${r1}`)).body;
  assert.equal(tr.override, 'train');
  assert.ok(tr.blocks.length > 0, 'the session exercises are shown');
  const other = app.plan.days.find((d) => d.weekday !== tr.sessionWeekday);
  r = await app.call('POST', '/api/train/day', { date: r1, today: r1, kind: 'train', weekday: other.weekday });
  assert.equal(r.body.dayName, other.name);
  assert.equal((await app.call('POST', '/api/train/day', { date: r1, today: r1, kind: 'train', weekday: 9 })).status, 400);

  // Back to the plan clears it; a planned day "switched" to its own session stores nothing.
  await app.call('POST', '/api/train/day', { date: t1, today: t1, kind: 'plan' });
  assert.equal((await app.call('GET', `/api/train?date=${t1}`)).body.override, null);
  await app.call('POST', '/api/train/day', { date: t1, today: t1, kind: 'train' });
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM day_overrides WHERE date = ?').get(t1).n, 0);

  // Only today and the next 6 days; not after checking in.
  assert.equal((await app.call('POST', '/api/train/day', { date: t1, today: addDays(t1, 1), kind: 'rest' })).status, 400, 'past day');
  assert.equal((await app.call('POST', '/api/train/day', { date: addDays(t1, 7), today: t1, kind: 'rest' })).status, 400, 'too far ahead');
  await app.call('POST', `/api/admin/users/${app.uid}/checkins`, { date: t1 });
  assert.equal((await app.call('POST', '/api/train/day', { date: t1, today: t1, kind: 'rest' })).status, 400, 'checked in = trained');
});

test('training points come from the check-in; rest days count up to the plan\'s rest days', async (t) => {
  const app = await boot();
  t.after(app.close);
  const { trainDays, restDays } = app;
  for (const d of [...trainDays, ...restDays]) await app.eat(d);

  // Planned rest days (3 with a 4-day plan): 20 each. Training days without a check-in: 0.
  for (const d of restDays) assert.equal(await app.workout(d), 20, `rest ${d}`);
  for (const d of trainDays) assert.equal(await app.workout(d), 0, `no check-in ${d}`);

  // A check-in earns all 30, sets or not (CrossFit counts).
  await app.call('POST', `/api/admin/users/${app.uid}/checkins`, { date: trainDays[0] });
  assert.equal(await app.workout(trainDays[0]), 30);

  // Turning a training day into a 4th rest day: over the allowance, so 0 for that day...
  const last = trainDays.at(-1);
  app.db.prepare("INSERT INTO day_overrides (user_id, date, kind) VALUES (?, ?, 'rest')").run(app.uid, last);
  const extra = (await app.call('GET', `/api/train?date=${last}`)).body.rest;
  const ordered = [...restDays, last].sort();
  const extraDay = ordered.at(-1); // the allowance is used in date order
  assert.equal(await app.workout(extraDay), 0, 'the 4th rest day of the week earns nothing');
  assert.ok(extra.allowed === 3);
  // ...unless they train on one of the rest days instead (a check-in never uses up a rest day).
  await app.call('POST', `/api/admin/users/${app.uid}/checkins`, { date: restDays[0] });
  assert.equal(await app.workout(restDays[0]), 30);
  assert.equal(await app.workout(extraDay), 20, 'swapped: still 3 rest days');
});
