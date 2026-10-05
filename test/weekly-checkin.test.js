// Adaptive weekly check-in through the API: proposal, accept (same foods, new portions, review),
// keep, the admin's manual override, and that learned maintenance survives profile edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../server.js';

const WEEK = '2026-10-09'; // a Friday
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const profile = {
  sex: 'male', age: 25, heightCm: 180, weightKg: 85, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
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
  assert.equal((await call('PUT', '/api/profile', { profile, today: addDays(WEEK, -30) })).status, 200);
  const uid = db.prepare('SELECT id FROM users').get().id;
  // The plan was approved a month ago, so three weeks of logs count.
  db.prepare("UPDATE plans SET start_date = ? WHERE user_id = ? AND status = 'active'").run(addDays(WEEK, -30), uid);
  return { db, uid, call, close: () => server.close() };
}

/** Three weeks of fully logged days at `kcal`, and weekly weigh-ins moving `rate` kg a week. */
function history(db, uid, { kcal, rate }) {
  const ins = db.prepare("INSERT INTO logs (user_id, date, ref, status, name, grams, kcal, p, c, f, logged_on) VALUES (?, ?, ?, 'eaten', 'Day', 0, ?, 150, 200, 60, ?)");
  for (let i = 1; i <= 21; i++) { const d = addDays(WEEK, -i); ins.run(uid, d, `extra:t${i}`, kcal, d); }
  db.prepare('DELETE FROM body_metrics WHERE user_id = ?').run(uid);
  const w = db.prepare("INSERT INTO body_metrics (user_id, date, weight_kg, measurements, notes) VALUES (?, ?, ?, '{}', '')");
  for (const d of [-28, -21, -14, -7, 0]) w.run(uid, addDays(WEEK, d), Math.round((85 + (rate * (d + 28)) / 7) * 10) / 10);
}

const foodsOf = (plan) => plan.days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.foodId))).sort();

test('weekly check-in: losing too slowly → proposal → accept re-sizes the same plan', async (t) => {
  const app = await boot();
  t.after(app.close);
  const me = (await app.call('GET', '/api/me')).body;
  const before = me.targets;
  assert.equal(before.tdeeAdjust, 0);
  const planBefore = (await app.call('GET', '/api/plan')).body.plan;

  // Eating the plan, losing only 0.1 kg a week against a 0.5 goal.
  history(app.db, app.uid, { kcal: before.kcal, rate: -0.1 });
  // Monday to Thursday nothing new opens.
  assert.equal((await app.call('GET', `/api/checkin/weekly?today=${addDays(WEEK, -1)}`)).body.checkin.status, 'closed');
  const ci = (await app.call('GET', `/api/checkin/weekly?today=${WEEK}`)).body.checkin;
  assert.equal(ci.status, 'open');
  assert.equal(ci.kind, 'proposed');
  assert.equal(ci.kcal.from, before.kcal);
  assert.equal(ci.kcal.from - ci.kcal.to, 150);
  assert.equal(ci.days, 21);
  assert.match(ci.text, /less a day/);
  // The same week gives the same stored check-in (not recomputed on every open).
  assert.deepEqual((await app.call('GET', `/api/checkin/weekly?today=${addDays(WEEK, 1)}`)).body.checkin.kcal, ci.kcal);

  const r = await app.call('POST', '/api/checkin/weekly/answer', { today: WEEK, answer: 'accept' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const res = r.body.checkin.result;
  assert.equal(r.body.checkin.status, 'accepted');
  assert.ok(Math.abs(res.kcal.to - ci.kcal.to) <= 30, `target ${res.kcal.to} vs proposed ${ci.kcal.to}`);
  assert.equal(res.planStatus, 'active', 'the re-sized plan passed the review');
  assert.equal(res.newMenu, false);
  assert.ok(res.changes.length > 0, 'portions changed');

  const after = (await app.call('GET', '/api/me')).body;
  assert.equal(after.targets.kcal, res.kcal.to);
  assert.ok(after.targets.tdeeAdjust < 0, 'learned: burns less than the formula says');
  assert.equal(after.profile.weightKg, ci.trendKg, 'profile weight follows the trend');
  const planAfter = (await app.call('GET', '/api/plan')).body.plan;
  assert.notEqual(planAfter.id, planBefore.id);
  assert.deepEqual(foodsOf(planAfter), foodsOf(planBefore), 'same foods, only portions moved');
  assert.ok(Math.abs(planAfter.days[0].totals.kcal - res.kcal.to) <= res.kcal.to * 0.05);

  // Answered once per week.
  assert.equal((await app.call('POST', '/api/checkin/weekly/answer', { today: WEEK, answer: 'accept' })).status, 400);
  // A later profile edit keeps what the check-in learned.
  await app.call('PUT', '/api/profile', { profile: { ...after.profile, activityLevel: 'moderate' } });
  assert.equal((await app.call('GET', '/api/me')).body.targets.tdeeAdjust, after.targets.tdeeAdjust);
  // The admin sees the history.
  const adminView = (await app.call('GET', `/api/admin/users/${app.uid}`)).body;
  assert.equal(adminView.dietCheckins[0].status, 'accepted');
});

test('weekly check-in: keep, on-track dismiss, and the manual override switches it off', async (t) => {
  const app = await boot();
  t.after(app.close);
  const target = (await app.call('GET', '/api/me')).body.targets.kcal;
  history(app.db, app.uid, { kcal: target, rate: -1.0 }); // losing too fast: eat more
  const ci = (await app.call('GET', `/api/checkin/weekly?today=${WEEK}`)).body.checkin;
  assert.equal(ci.kind, 'proposed');
  assert.ok(ci.kcal.to > ci.kcal.from);
  const kept = await app.call('POST', '/api/checkin/weekly/answer', { today: WEEK, answer: 'keep' });
  assert.equal(kept.body.checkin.status, 'kept');
  assert.equal((await app.call('GET', '/api/me')).body.targets.kcal, target, 'keeping changes nothing');
  assert.equal((await app.call('POST', '/api/checkin/weekly/answer', { today: WEEK, answer: 'bogus' })).status, 400);

  // Next week: on pace → on track, which can be dismissed but not "accepted".
  const next = addDays(WEEK, 7);
  app.db.prepare('DELETE FROM logs').run();
  const ins = app.db.prepare("INSERT INTO logs (user_id, date, ref, status, name, grams, kcal, p, c, f, logged_on) VALUES (?, ?, ?, 'eaten', 'Day', 0, ?, 150, 200, 60, ?)");
  for (let i = 1; i <= 21; i++) { const d = addDays(next, -i); ins.run(app.uid, d, `extra:n${i}`, target, d); }
  app.db.prepare('DELETE FROM body_metrics').run();
  const w = app.db.prepare("INSERT INTO body_metrics (user_id, date, weight_kg, measurements, notes) VALUES (?, ?, ?, '{}', '')");
  for (const d of [-28, -21, -14, -7, 0]) w.run(app.uid, addDays(next, d), Math.round((85 - (0.5 * (d + 28)) / 7) * 10) / 10);
  const on = (await app.call('GET', `/api/checkin/weekly?today=${next}`)).body.checkin;
  assert.equal(on.kind, 'on_track', on.text);
  assert.equal((await app.call('POST', '/api/checkin/weekly/answer', { today: next, answer: 'accept' })).status, 400);
  assert.equal((await app.call('POST', '/api/checkin/weekly/answer', { today: next, answer: 'dismiss' })).body.checkin.status, 'dismissed');

  // A proposal whose targets changed before it was answered is retired, not applied.
  const later = addDays(next, 7);
  app.db.prepare('DELETE FROM logs').run();
  for (let i = 1; i <= 21; i++) { const d = addDays(later, -i); ins.run(app.uid, d, `extra:l${i}`, target, d); }
  app.db.prepare('DELETE FROM body_metrics').run();
  for (const d of [-28, -21, -14, -7, 0]) w.run(app.uid, addDays(later, d), Math.round((85 - (0.1 * (d + 28)) / 7) * 10) / 10);
  const stale = (await app.call('GET', `/api/checkin/weekly?today=${later}`)).body.checkin;
  assert.equal(stale.kind, 'proposed');
  await app.call('POST', '/api/profile/goal', { weeklyRateKg: 0.25 });
  const retired = (await app.call('GET', `/api/checkin/weekly?today=${addDays(later, 1)}`)).body.checkin;
  assert.equal(retired.status, 'kept');
  assert.equal((await app.call('POST', '/api/checkin/weekly/answer', { today: addDays(later, 1), answer: 'accept' })).status, 400);

  // Seif sets targets by hand: check-ins are off for that person.
  await app.call('PUT', `/api/admin/users/${app.uid}/targets`, { override: { kcal: 2100, proteinG: 170, carbsG: 200, fatG: 65 } });
  const off = (await app.call('GET', `/api/checkin/weekly?today=${addDays(later, 7)}`)).body.checkin;
  assert.equal(off.status, 'off');
  assert.equal(off.reason, 'override');
  assert.equal((await app.call('POST', '/api/checkin/weekly/answer', { today: addDays(later, 7), answer: 'accept' })).status, 400);
});

test('weekly check-in: needs a weigh-in, then learns before it changes anything', async (t) => {
  const app = await boot();
  t.after(app.close);
  // Only the onboarding weight, a month old: weigh in first.
  const first = (await app.call('GET', `/api/checkin/weekly?today=${WEEK}`)).body.checkin;
  assert.equal(first.status, 'live');
  assert.equal(first.kind, 'needs_weight');
  await app.call('POST', '/api/metrics', { date: WEEK, weightKg: 84.6 });
  const learning = (await app.call('GET', `/api/checkin/weekly?today=${WEEK}`)).body.checkin;
  assert.equal(learning.kind, 'learning');
  assert.equal(learning.status, 'live', 'not stored: it updates as data comes in');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM diet_checkins').get().n, 0);
});
