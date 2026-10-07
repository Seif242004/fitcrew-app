// Points rules added in session 13: water earns points (5 at the target, a small diminishing
// bonus above it), rest days earn 20 (+10 for a gym check-in on one, so training always earns
// 30), and eating-out food logged in a meal counts when the meal still matches its plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, loadFoods } from '../src/db.js';
import { createServer } from '../server.js';
import { itemFor, totalsOf } from '../src/plan.js';
import { dayScore, waterPoints, WATER_POINTS, WATER_BONUS } from '../src/adherence.js';

const D = '2026-10-04';
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const profile = (goal = 'cut') => ({
  sex: 'male', age: 25, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goal, weeklyRateKg: goal === 'maintain' ? 0 : 0.5,
  experience: 'beginner', daysPerWeek: 3, equipment: 'gym', injuries: '', measurements: {},
  prefs: { mealsPerDay: 4, trainTime: 'evening', likedIds: [], dislikedIds: [], allergies: [], vegetarian: false },
});

/** A server with one person whose plan has a known breakfast: 2 eggs, a loaf of baladi, white cheese, cucumber. */
async function boot(goal = 'cut') {
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
  await call('PUT', '/api/profile', { profile: profile(goal) });
  const foods = new Map(loadFoods(db).map((f) => [f.id, f]));
  const meal = (name, list) => { const items = list.map(([id, g]) => itemFor(foods.get(id), g)); return { name, items, totals: totalsOf(items) }; };
  const day = { meals: [
    meal('Breakfast', [['eggs', 100], ['baladi-bread', 90], ['white-cheese', 30], ['cucumber', 100]]),
    meal('Lunch', [['chicken-breast', 170], ['white-rice', 200], ['salata-baladi', 150]]),
    meal('Snack', [['greek-yogurt', 170], ['banana', 120]]),
    meal('Dinner', [['tuna-canned', 120], ['toast-brown', 60], ['salad-greens', 120]]),
  ] };
  const plan = db.prepare("SELECT * FROM plans WHERE status = 'active'").get();
  db.prepare('UPDATE plans SET data = ?, start_date = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(plan.data), days: [day] }), addDays(D, -14), plan.id);
  db.prepare("UPDATE workout_plans SET start_date = ? WHERE status = 'active'").run(addDays(D, -14));
  const user = db.prepare('SELECT * FROM users').get();
  const today = async (d = D) => (await call('GET', `/api/today?date=${d}`)).body;
  return { db, user, call, today, close: () => server.close() };
}


const isoToday = () => new Date().toISOString().slice(0, 10);
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

test('water: 5 points at the target, a shrinking bonus above it, never more than 7', () => {
  assert.equal(waterPoints(0, 3000), 0);
  assert.equal(waterPoints(1500, 3000), 2.5, 'half the target: half the points');
  assert.equal(waterPoints(3000, 3000), WATER_POINTS);
  const at = (l) => waterPoints(l * 1000, 3000);
  assert.ok(near(at(6), 7), `6 L on a 3 L target is 7 (got ${at(6)})`);
  assert.ok(at(4) > 5.9 && at(4) < 6.2, '1 L over: about +1');
  // Each extra litre is worth less than the one before.
  assert.ok(at(4) - at(3) > at(5) - at(4) && at(5) - at(4) > at(6) - at(5));
  assert.equal(at(10), WATER_POINTS + WATER_BONUS, 'capped: drinking far past the target is not rewarded');
  assert.ok(near(waterPoints(4500, 2500), at(5)), 'the bonus follows the litres over the person\'s own target');
});

test('water points add to the day, even with no food logged', () => {
  const targets = { kcal: 2000, proteinG: 150, goal: 'cut' };
  const all = (kcal, p) => ({ kcal, p, c: 0, f: 0 });
  const full = dayScore({ targets, consumed: all(2000, 150), planConsumed: all(2000, 150), itemsTotal: 10, itemsDone: 10, loggedSameDay: true, workout: { planned: true, checkin: 'approved' }, water: { ml: 6000, target: 3000 } });
  assert.equal(full.parts.water, 7);
  assert.equal(full.total, 107);
  const waterOnly = dayScore({ targets, consumed: all(0, 0), planConsumed: all(0, 0), itemsTotal: 10, itemsDone: 0, loggedSameDay: false, workout: { planned: true, checkin: null }, water: { ml: 3000, target: 3000 } });
  assert.equal(waterOnly.total, 5);
  const noWorkoutPlan = dayScore({ targets, consumed: all(2000, 150), planConsumed: all(2000, 150), itemsTotal: 10, itemsDone: 10, loggedSameDay: true, water: { ml: 3000, target: 3000 } });
  assert.equal(noWorkoutPlan.total, 105, 'not rescaled with the diet points');
});

test('rest day 20, gym on a rest day 20 + 10, training day 30', () => {
  const targets = { kcal: 2000, proteinG: 150, goal: 'cut' };
  const all = (kcal, p) => ({ kcal, p, c: 0, f: 0 });
  const day = (workout) => dayScore({ targets, consumed: all(2000, 150), planConsumed: all(2000, 150), itemsTotal: 10, itemsDone: 10, loggedSameDay: true, workout });
  assert.equal(day({ planned: false, checkin: null }).total, 90, 'a rest day');
  assert.equal(day({ planned: false, checkin: 'approved' }).total, 100, 'gym on a rest day');
  assert.equal(day({ planned: true, checkin: 'approved' }).total, 100, 'gym on a training day');
  assert.equal(day({ planned: true, checkin: null }).total, 70, 'skipped training');
  assert.equal(dayScore({ targets, consumed: all(0, 0), planConsumed: all(0, 0), itemsTotal: 10, itemsDone: 0, loggedSameDay: false, workout: { planned: false, checkin: 'approved' } }).total, 30, 'the check-in counts on its own');
});

test('API: water counts in today\'s score, only for today or yesterday', async (t) => {
  const app = await boot(); t.after(app.close);
  const today = isoToday();
  const score = async () => (await app.today(today)).score;
  assert.equal((await score()).parts.water, 0);
  const target = (await app.today(today)).water.target;
  await app.call('POST', '/api/water', { date: today, add: target });
  assert.equal((await score()).parts.water, 5);
  await app.call('POST', '/api/water', { date: today, add: 3000 });
  assert.equal((await score()).parts.water, 7);
  assert.equal((await app.call('POST', '/api/water', { date: addDays(today, -1), add: 250 })).status, 200, 'yesterday is fine');
  const old = await app.call('POST', '/api/water', { date: addDays(today, -3), add: 3000 });
  assert.equal(old.status, 400, 'no backfilling old days for points');
});

test('eating out in a meal counts when the meal still matches its plan', async (t) => {
  const app = await boot(); t.after(app.close);
  const score = async () => (await app.today()).score;
  const day = await app.today();
  for (const it of day.meals[0].items) await app.call('POST', '/api/log', { date: D, today: D, ref: it.key, status: 'eaten' });
  const base = await score();
  // Lunch from a restaurant: 1½ grilled chicken sandwiches, about lunch's calories and protein.
  await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'chicken-sandwich-grilled', qty: 1.5, unit: 'u', meal: 1 });
  const lunchOut = await score();
  assert.ok(lunchOut.parts.meals > base.parts.meals, 'the matching meal earns');
  assert.equal(lunchOut.meals[1].offCounted, true);
  // Dinner as four slices of pepperoni pizza: nothing like the plan, so it earns nothing.
  await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'pizza-pepperoni', qty: 4, unit: 'u', meal: 3 });
  const pizza = await score();
  assert.equal(pizza.meals[3].offCounted, false);
  assert.equal(pizza.meals[3].match, 0);
  assert.equal(pizza.parts.meals, lunchOut.parts.meals, 'a far-off cheat meal adds no meal points');
  // A coffee added to a breakfast that was already on plan never costs meal points.
  await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'cappuccino', qty: 1, unit: 'u', meal: 0 });
  assert.equal((await score()).parts.meals, pizza.parts.meals);
});
