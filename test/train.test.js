import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../src/db.js';
import { createServer } from '../server.js';

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-FitCrew': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return {
      get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), del: (p) => call('DELETE', p),
      raw: async (p) => { const r = await fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; },
    };
  };
  return { db, base, client, close: () => server.close() };
}

const profile = {
  sex: 'male', age: 25, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
  experience: 'beginner', daysPerWeek: 3, equipment: 'gym', injuries: 'tight left shoulder',
  measurements: {}, prefs: { mealsPerDay: 3, likedIds: [], dislikedIds: [], allergies: [], vegetarian: false },
};

// 2026-09-28 is a Monday. A 3-day plan trains Saturday, Monday and Wednesday (Friday is rest).
const MON = '2026-09-28'; const TUE = '2026-09-29'; const WED = '2026-09-30'; const MON2 = '2026-10-05';

test('training flow: draft, approve, log, progress, records, score', async (t) => {
  const app = await boot();
  setSetting(app.db, 'aiAutoApprove', false); // these tests cover the manual admin flow
  t.after(app.close);
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'h@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 'sam@example.com', password: 'sam-password-1' });
  const saved = await sam.put('/api/profile', { profile });
  assert.equal(saved.status, 200);
  const samId = (await sam.get('/api/me')).body.user.id;

  // a workout draft exists, hidden from Sam until approved
  const t0 = (await sam.get(`/api/train?date=${MON}`)).body;
  assert.equal(t0.hasPlan, false);
  assert.equal(t0.hasPending, true);
  const list = (await admin.get('/api/admin/users')).body.users.find((u) => u.id === samId);
  assert.ok(list.pendingWorkoutPlanId);

  const draft = (await admin.get(`/api/admin/workout-plans/${list.pendingWorkoutPlanId}`)).body.plan;
  assert.equal(draft.days.length, 3);
  assert.deepEqual(draft.days.map((d) => d.weekday).sort(), [1, 3, 6]);
  assert.ok(draft.warnings.some((w) => w.includes('tight left shoulder')));

  // validation on edit
  const bad1 = structuredClone(draft); bad1.days[1].weekday = bad1.days[0].weekday;
  assert.equal((await admin.put(`/api/admin/workout-plans/${draft.id}`, bad1)).status, 400, 'same weekday twice');
  const bad2 = structuredClone(draft); bad2.days[0].exercises[0].exerciseId = 'nope';
  assert.equal((await admin.put(`/api/admin/workout-plans/${draft.id}`, bad2)).status, 400, 'unknown exercise');
  const edit = structuredClone(draft); edit.days.find((d) => d.weekday === 1).exercises[0].sets = 4;
  assert.equal((await admin.put(`/api/admin/workout-plans/${draft.id}`, edit)).status, 200);
  assert.equal((await sam.get(`/api/admin/workout-plans/${draft.id}`)).status, 403);
  assert.equal((await admin.post(`/api/admin/workout-plans/${draft.id}/approve`, { startDate: MON })).status, 200);
  assert.equal((await admin.post(`/api/admin/plans/${list.pendingPlanId}/approve`, { startDate: MON })).status, 200);

  // Monday is a training day, Tuesday is rest
  const mon = (await sam.get(`/api/train?date=${MON}`)).body;
  assert.equal(mon.hasPlan, true);
  assert.ok(mon.dayName);
  assert.ok(mon.blocks.length >= 5);
  assert.equal(mon.blocks[0].plan.sets, 4, 'admin edit reached the user');
  assert.equal(mon.blocks[0].target, null, 'no history, no target');
  assert.equal((await sam.get(`/api/train?date=${TUE}`)).body.restDay, true);

  // log every planned set at modest weights
  const ex = mon.blocks[0]; const exId = ex.exerciseId;
  for (const b of mon.blocks) {
    for (let s = 1; s <= b.plan.sets; s++) {
      const r = await sam.post('/api/train/set', { date: MON, today: MON, exerciseId: b.exerciseId, setNo: s, weightKg: b.exerciseId === exId ? 60 : 20, reps: b.plan.repMin + 1 });
      assert.equal(r.status, 200);
      assert.equal(r.body.pr, false, 'a first session cannot be a record');
    }
  }
  assert.equal((await sam.post('/api/train/set', { date: MON, today: MON, exerciseId: 'nope', setNo: 1, weightKg: 1, reps: 1 })).status, 400);
  assert.equal((await sam.post('/api/train/set', { date: MON, today: MON, exerciseId: exId, setNo: 1, weightKg: 60, reps: 0 })).status, 400);

  // every set ticked = half the training points; the gym check-in earns the other half
  let adh = (await sam.get(`/api/adherence?days=7&today=${MON}`)).body;
  assert.equal(adh.scores.find((s) => s.date === MON).parts.workout, 15);
  assert.equal((await admin.post(`/api/admin/users/${samId}/checkins`, { date: MON })).status, 200);
  adh = (await sam.get(`/api/adherence?days=7&today=${MON}`)).body;
  assert.equal(adh.scores.find((s) => s.date === MON).parts.workout, 30);
  const monAgain = (await sam.get(`/api/train?date=${MON}`)).body;
  assert.equal(monAgain.checkin.status, 'approved');
  assert.equal(monAgain.week.length, 7);
  assert.equal(monAgain.week.find((d) => d.date === MON).checkin, 'approved');

  // next Monday: suggestion is one more rep at the same weight
  const next = (await sam.get(`/api/train?date=${MON2}`)).body;
  const nb = next.blocks.find((b) => b.exerciseId === exId);
  assert.ok(nb, 'same exercise on the next Monday');
  assert.equal(nb.last.date, MON);
  assert.equal(nb.target.weightKg, 60);
  assert.equal(nb.target.change, 'add reps');

  // beating last time is flagged as a record; matching it is not
  const heavy = await sam.post('/api/train/set', { date: MON2, today: MON2, exerciseId: exId, setNo: 1, weightKg: 65, reps: 10 });
  assert.equal(heavy.body.pr, true);
  const same = await sam.post('/api/train/set', { date: MON2, today: MON2, exerciseId: exId, setNo: 2, weightKg: 60, reps: ex.plan.repMin + 1 });
  assert.equal(same.body.pr, false);
  await sam.post('/api/train/set/remove', { date: MON2, exerciseId: exId, setNo: 2 });
  assert.equal((await sam.get(`/api/train?date=${MON2}`)).body.blocks.find((b) => b.exerciseId === exId).sets.length, 1);

  // an exercise outside the plan still shows up once logged
  await sam.post('/api/train/set', { date: TUE, today: TUE, exerciseId: 'plank', setNo: 1, weightKg: 0, reps: 45 });
  const tue = (await sam.get(`/api/train?date=${TUE}`)).body;
  assert.equal(tue.restDay, true);
  assert.equal(tue.blocks[0].exerciseId, 'plank');

  // cardio
  const c = await sam.post('/api/train/cardio', { date: TUE, today: TUE, kind: 'Run', minutes: 30, distanceKm: 4.5, avgHr: 150 });
  assert.equal(c.status, 200);
  assert.equal((await sam.post('/api/train/cardio', { date: TUE, kind: 'Skydive', minutes: 10 })).status, 400);
  assert.equal((await sam.get(`/api/train?date=${TUE}`)).body.cardio[0].distanceKm, 4.5);
  await sam.post('/api/train/cardio/remove', { id: c.body.id });
  assert.equal((await sam.get(`/api/train?date=${TUE}`)).body.cardio.length, 0);

  // history and records
  const hist = (await sam.get('/api/train/history')).body;
  assert.ok(hist.sessions.length >= 2);
  const rec = hist.records.find((r) => r.exerciseId === exId);
  assert.equal(rec.weightKg, 65);

  // admin can fix a set for Sam, and it is audited
  assert.equal((await admin.post('/api/train/set', { userId: samId, date: MON2, today: MON2, exerciseId: exId, setNo: 3, weightKg: 62.5, reps: 8 })).status, 200);
  assert.ok((await admin.get('/api/admin/audit')).body.entries.some((e) => e.action === 'set.edited_by_admin'));

  // exercise library: members read, admin edits
  assert.ok((await sam.get('/api/exercises?q=squat')).body.exercises.length >= 3);
  assert.equal((await sam.post('/api/admin/exercises', { name: 'X', muscle: 'chest', equip: 'cable', pattern: 'fly' })).status, 403);
  const made = await admin.post('/api/admin/exercises', { name: 'Svend press', muscle: 'chest', equip: 'dumbbell', pattern: 'fly', inc: 2 });
  assert.equal(made.status, 200);
  assert.equal((await admin.post('/api/admin/exercises', { name: 'Bad', muscle: 'toes', equip: 'cable', pattern: 'fly' })).status, 400);
  assert.equal((await admin.del(`/api/admin/exercises/${made.body.id}`)).status, 200);
});

test('a missed planned session scores zero for training; a rest day is not penalised', async (t) => {
  const app = await boot();
  setSetting(app.db, 'aiAutoApprove', false); // these tests cover the manual admin flow
  t.after(app.close);
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'h@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 'sam@example.com', password: 'sam-password-1' });
  await sam.put('/api/profile', { profile });
  const samId = (await sam.get('/api/me')).body.user.id;
  const u = (await admin.get('/api/admin/users')).body.users.find((x) => x.id === samId);
  await admin.post(`/api/admin/workout-plans/${(await admin.get(`/api/admin/workout-plans/${(await admin.get('/api/admin/users')).body.users.find((x) => x.id === samId).pendingWorkoutPlanId}`)).body.plan.id}/approve`, { startDate: MON });
  await admin.post(`/api/admin/plans/${u.pendingPlanId}/approve`, { startDate: MON });
  const today = (await sam.get(`/api/today?date=${MON}`)).body;
  for (const m of today.meals) for (const it of m.items) await sam.post('/api/log', { date: MON, today: MON, ref: it.key, status: 'eaten' });
  for (const d of [TUE, WED]) {
    const day = (await sam.get(`/api/today?date=${d}`)).body;
    for (const m of day.meals) for (const it of m.items) await sam.post('/api/log', { date: d, today: d, ref: it.key, status: 'eaten' });
  }
  const scores = (await sam.get(`/api/adherence?days=7&today=${WED}`)).body.scores;
  const by = Object.fromEntries(scores.map((s) => [s.date, s]));
  assert.equal(by[MON].parts.workout, 0, 'planned Monday session was skipped');
  assert.equal(by[TUE].parts.workout, 30, 'Tuesday is a rest day, full marks');
  assert.equal(by[WED].parts.workout, 0, 'planned Wednesday session was skipped');
  assert.ok(by[TUE].total > by[MON].total);
});

test('admin can download a backup; members cannot', async (t) => {
  const app = await boot();
  setSetting(app.db, 'aiAutoApprove', false); // these tests cover the manual admin flow
  t.after(app.close);
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'h@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 'sam@example.com', password: 'sam-password-1' });
  assert.equal((await sam.raw('/api/admin/backup')).status, 403);
  const b = await admin.raw('/api/admin/backup');
  assert.equal(b.status, 200);
  const dump = JSON.parse(b.buf.toString());
  assert.equal(dump.app, 'fitcrew');
  assert.equal(dump.tables.users.length, 2);
  assert.ok(dump.tables.foods.length > 100, 'all tables are included');
  assert.ok(!JSON.stringify(dump.tables.users).includes('a-good-password'), 'only password hashes are stored');
});
