// Logging food the way people report it (POST /api/log/foods): meals, units, plan matching,
// repeats, extras inside meals, and the points rules (plan food only, over-target penalty,
// extra-session bonus).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, loadFoods } from '../src/db.js';
import { createServer } from '../server.js';
import { itemFor, totalsOf } from '../src/plan.js';
import { mealIndex, resolveUnit, amountFor, canStandIn } from '../src/food-log.js';
import { dayScore, overPenalty } from '../src/adherence.js';
import { describeAmount } from '../src/exchange.js';
import { formatQty } from '../src/measures.js';
import { runTool, coachTurn, actionLabel, replyLanguage } from '../src/coach.js';

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

test('units and meals the way people say them', () => {
  const db = openDb(':memory:');
  const f = new Map(loadFoods(db, { offplan: true }).map((x) => [x.id, x]));
  const meals = [{ name: 'Breakfast' }, { name: 'Snack' }, { name: 'Lunch' }, { name: 'Post-workout' }, { name: 'Dinner' }, { name: 'Night snack' }];
  assert.equal(mealIndex(meals, 'breakfast'), 0);
  assert.equal(mealIndex(meals, 'for lunch'), 2);
  assert.equal(mealIndex(meals, 'الغدا'), 2);
  assert.equal(mealIndex(meals, 'after the gym'), 3);
  assert.equal(mealIndex(meals, 'snack'), 1, 'snack is the day snack, not the night snack');
  assert.equal(mealIndex(meals, 'night snack'), 5);
  assert.equal(mealIndex(meals, 4), 4);
  assert.equal(mealIndex(meals, 9), null);
  assert.equal(mealIndex(meals, 'brunch'), null);
  // Units by name, plural, generic household amounts.
  assert.equal(amountFor(f.get('eggs'), { qty: 2, unit: 'eggs' }).grams, 100);
  assert.equal(amountFor(f.get('baladi-bread'), { qty: 1, unit: 'loaf' }).amount, '1 loaf');
  assert.equal(amountFor(f.get('baladi-bread'), { qty: 100, unit: 'gm' }).grams, 100);
  assert.equal(amountFor(f.get('sugar'), { qty: 3, unit: 'tbsp' }).grams, 36);
  assert.equal(amountFor(f.get('milk'), { qty: 100, unit: 'ml' }).grams, 100);
  assert.equal(amountFor(f.get('milk'), { qty: 100, unit: 'ml' }).amount, '100 ml');
  assert.equal(amountFor(f.get('nescafe-3in1'), {}).amount, '1 sachet', 'no amount: one of its unit');
  assert.equal(amountFor(f.get('white-rice'), { qty: 70, unit: 'g dry' }).grams, Math.round(70 * f.get('white-rice').raw * 10) / 10);
  assert.ok(resolveUnit(f.get('pizza-margherita'), 'slices'));
  assert.throws(() => amountFor(f.get('eggs'), { qty: 2, unit: 'parsecs' }), /not a measure/);
  assert.throws(() => amountFor(f.get('eggs'), { qty: 0, unit: 'egg' }), /more than 0/);
  // Stand-ins: same kind and group only.
  assert.ok(canStandIn(f.get('eggs-scrambled'), f.get('eggs')));
  assert.ok(canStandIn(f.get('cheddar'), f.get('white-cheese')));
  assert.ok(canStandIn(f.get('shami-bread'), f.get('baladi-bread')));
  assert.ok(!canStandIn(f.get('milk'), f.get('eggs')), 'milk in coffee is not the eggs');
  assert.ok(!canStandIn(f.get('milk'), f.get('white-cheese-light'), { ateG: 100, plannedG: 60 }), 'nor the cheese');
  assert.ok(canStandIn(f.get('eggs-scrambled'), f.get('eggs'), { ateG: 240, plannedG: 100 }), 'four scrambled eggs are the two planned, eaten bigger');
  assert.ok(!canStandIn(f.get('cheddar'), f.get('white-cheese'), { ateG: 10, plannedG: 30 }), 'a sprinkle of cheddar is not the cheese portion');
  assert.ok(!canStandIn(f.get('pizza-margherita'), f.get('baladi-bread')), 'off-plan never stands in');
  assert.ok(!canStandIn(f.get('sugar'), f.get('honey')), 'sweets are never swaps');
});

test('amounts read back as people count: no "1 loaves", grams when between counts', () => {
  const bread = { id: 'baladi-bread', unit: { g: 90, name: 'loaf' } };
  assert.equal(describeAmount(bread, 90), '1 loaf');
  assert.equal(describeAmount(bread, 135), '1½ loaves');
  assert.equal(describeAmount(bread, 100), '100 g (about 1 loaf)');
  assert.equal(formatQty({ name: 'loaf', plural: 'loaves' }, 1.1), '1 loaf');
  assert.equal(formatQty({ name: 'egg', plural: 'eggs' }, 2), '2 eggs');
});

test('a detailed breakfast report lands in breakfast, matched to the plan, and asking twice adds nothing', async (t) => {
  const app = await boot(); t.after(app.close);
  // Z's report: "scrambled eggs sandwich (100 gm bread, 2 eggs, 10 gm shredded cheddar), nescafe 3 in 1 with 100 ml milk, 3 tbsp sugar"
  const items = [
    { foodId: 'baladi-bread', grams: 100 }, { name: 'scrambled eggs', qty: 2, unit: 'eggs' }, { name: 'shredded chedder', qty: 10, unit: 'gm' },
    { name: 'nescafe 3 in 1', qty: 1, unit: 'sachet' }, { foodId: 'milk', qty: 100, unit: 'ml' }, { foodId: 'sugar', qty: 3, unit: 'tbsp' },
  ];
  const r = await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 'breakfast', items });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.results.map((x) => [x.name, x]));
  assert.equal(r.body.mealName, 'Breakfast');
  assert.equal(by['Baladi bread'].as, 'adjusted', 'the planned loaf, eaten at 100 g');
  assert.equal(by['Eggs, scrambled'].as, 'swapped', 'scrambled eggs instead of the boiled eggs');
  assert.equal(by['Eggs, scrambled'].amount, '2 eggs');
  assert.equal(by['Cheddar cheese'].as, 'extra', '10 g of cheddar is not the 30 g of white cheese on the plan (too small to replace it)');
  for (const n of ['Coffee mix 3-in-1 (Nescafé type)', 'Milk, full-fat', 'Sugar']) assert.equal(by[n].as, 'extra', n);
  // A full slice of cheddar is a fair stand-in for the planned white cheese.
  const slice = await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 0, items: [{ foodId: 'cheddar', qty: 1, unit: 'slice' }] });
  assert.equal(slice.body.results[0].as, 'swapped');
  await app.call('POST', '/api/log/remove', { date: D, ref: slice.body.results[0].ref });
  assert.equal(by.Sugar.kcal, Math.round(36 * 3.87), '3 tbsp, not 3 tsp or 3 x 100 g');

  let day = await app.today();
  const bf = day.meals[0];
  assert.deepEqual(bf.extras.map((e) => e.name).sort(), ['Cheddar cheese', 'Coffee mix 3-in-1 (Nescafé type)', 'Milk, full-fat', 'Sugar']);
  assert.equal(day.extras.length, 0, 'nothing left in Other food');
  assert.equal(bf.items.find((i) => i.foodId === 'cucumber').log, null, 'the cucumber was not eaten');
  const kcal = day.consumed.kcal;

  // "Can you log that?" twice: nothing new.
  for (let k = 0; k < 2; k++) {
    const again = await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 'breakfast', items });
    assert.ok(again.body.results.every((x) => x.as === 'repeat'), JSON.stringify(again.body.results));
  }
  day = await app.today();
  assert.equal(day.consumed.kcal, kcal, 'no double counting');
  assert.equal(day.meals[0].extras.length, 4);
});

test('"2 eggs for breakfast and 1 balady bread" after ticking breakfast: no duplicates', async (t) => {
  const app = await boot(); t.after(app.close);
  let day = await app.today();
  for (const it of day.meals[0].items.slice(0, 2)) await app.call('POST', '/api/log', { date: D, today: D, ref: it.key, status: 'eaten' });
  const before = (await app.today()).consumed.kcal;
  const r = await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 'breakfast', items: [{ foodId: 'eggs', qty: 2, unit: 'egg' }, { name: 'balady bread', qty: 1, unit: 'loaf' }] });
  assert.deepEqual(r.body.results.map((x) => x.as), ['repeat', 'repeat']);
  day = await app.today();
  assert.equal(day.consumed.kcal, before);
  // "Actually it was 3 eggs": corrects the planned eggs instead of adding 3 more.
  const r2 = await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 'breakfast', items: [{ foodId: 'eggs', qty: 3, unit: 'egg' }] });
  assert.equal(r2.body.results[0].as, 'adjusted');
  day = await app.today();
  assert.equal(day.meals[0].items[0].log.amount, '3 eggs');
  assert.equal(day.meals[0].extras.length, 0);
});

test('drinks and extras go in a meal, can be moved, and the coach logs through the same route', async (t) => {
  const app = await boot(); t.after(app.close);
  // From the Add food sheet: an orange juice with lunch.
  let r = await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'orange-juice', unit: 'glass', qty: 1, meal: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'cappuccino', unit: 'u', qty: 1 });
  let day = await app.today();
  assert.equal(day.meals[2].extras[0].name, 'Orange juice, fresh');
  assert.equal(day.extras.length, 1, 'the cappuccino with no meal stays in Other food');
  // Move it to breakfast.
  r = await app.call('POST', '/api/log/meal', { date: D, ref: day.extras[0].ref, meal: 0 });
  assert.equal(r.status, 200);
  day = await app.today();
  assert.equal(day.meals[0].extras[0].name, 'Cappuccino, whole milk');
  assert.equal(day.extras.length, 0);
  assert.equal((await app.call('POST', '/api/log/meal', { date: D, ref: day.meals[0].items[0].key, meal: 1 })).status, 400, 'planned items stay in their meal');
  assert.equal((await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'tea', meal: 'brunch' })).status, 400);

  // The coach: log_foods tool, chip label without NaN, and the day summary shows meal extras.
  const res = await runTool(app.db, app.user, D, 'log_foods', { meal: 'dinner', items: [{ foodId: 'tuna-canned', qty: 1, unit: 'can' }, { name: 'tea with milk', qty: 1, unit: 'cup' }] });
  assert.equal(res.meal, 'Dinner');
  assert.equal(res.results[0].how, 'planned item, marked eaten');
  assert.equal(res.results[1].how, 'added to the meal');
  const foodsById = new Map(loadFoods(app.db, { includeInactive: true }).map((f) => [f.id, f]));
  const chip = actionLabel({ tool: 'log_foods', args: {}, result: res }, foodsById);
  assert.equal(chip, 'Dinner: 1 can tuna in water, 1 cup tea with milk');
  const legacy = await runTool(app.db, app.user, D, 'log_food', { foodId: 'eggs', qty: 2, unit: 'u', meal: 'snack' });
  assert.doesNotMatch(actionLabel({ tool: 'log_food', args: { foodId: 'eggs', qty: 2, unit: 'u' }, result: legacy }, foodsById), /NaN/);
  const sum = await runTool(app.db, app.user, D, 'get_day', {});
  assert.equal(sum.meals[3].added[0].food, 'Tea with milk, no sugar');
});

test('the coach logs a report it answered with no tool call, in the language of the message', async (t) => {
  const app = await boot(); t.after(app.close);
  const env = { FITCREW_AI_KEY: 'k', FITCREW_AI_BASE_URL: 'https://ai.example/v1', FITCREW_AI_MODEL: 'm' };
  const seen = [];
  const steps = [
    { role: 'assistant', content: 'Done.' }, // the failure the crew saw
    { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'log_foods', arguments: JSON.stringify({ meal: 'breakfast', items: [{ foodId: 'eggs', qty: 2, unit: 'egg' }, { foodId: 'baladi-bread', qty: 1, unit: 'loaf' }] }) } }] },
    { role: 'assistant', content: '' },
  ];
  let i = 0;
  const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: steps[i++] }] }) }; };
  const out = await coachTurn({ db: app.db, user: app.user, text: 'I ate 2 eggs for breakfast and 1 balady bread', today: D, clock: '09:30', env, fetchImpl });
  assert.equal(seen.length, 3, 'nudged once after "Done." with nothing logged');
  assert.match(seen[1].messages.at(-1).content, /Nothing was logged/);
  assert.match(seen[0].messages[0].content, /REPLY LANGUAGE for this message: English/);
  assert.match(seen[0].messages[0].content, /LOCAL TIME NOW: 09:30/);
  assert.match(out.reply, /Breakfast: 2 eggs, 1 loaf baladi bread/, 'an empty reply says what was done, never a bare "Done."');
  const day = await app.today();
  assert.equal(day.meals[0].items[0].log.status, 'eaten');
  assert.equal(day.extras.length + day.meals[0].extras.length, 0, 'matched to the plan, not added again');
  assert.equal(replyLanguage('اكلت ٢ بيض'), 'Egyptian Arabic');
  assert.equal(replyLanguage('I had فول for breakfast'), 'English');
  // A question is not nudged into logging.
  i = 0; seen.length = 0; steps[0] = { role: 'assistant', content: 'About 150 g cooked.' };
  await coachTurn({ db: app.db, user: app.user, text: 'how much rice can I have at lunch?', today: D, env, fetchImpl });
  assert.equal(seen.length, 1);
});

test('points: only plan food earns, going over costs points when cutting or maintaining, extra sessions add 10', async (t) => {
  // Pure scoring.
  const targets = { kcal: 2000, proteinG: 150, goal: 'cut' };
  const all = (kcal, p) => ({ kcal, p, c: 0, f: 0 });
  const onPlan = dayScore({ targets, consumed: all(2000, 150), planConsumed: all(2000, 150), itemsTotal: 10, itemsDone: 10, loggedSameDay: true });
  assert.equal(onPlan.total, 100);
  // Same calories from pizza and sweets instead of the plan: no calorie, protein or plan points.
  const offPlan = dayScore({ targets, consumed: all(2000, 60), planConsumed: all(0, 0), itemsTotal: 10, itemsDone: 0, loggedSameDay: true });
  assert.equal(offPlan.parts.calories, 0);
  assert.equal(offPlan.parts.protein, 0);
  assert.equal(offPlan.total, 0, 'no plan food: nothing earned, not even logging');
  const coffeeOnly = dayScore({ targets, consumed: all(80, 1), planConsumed: all(0, 0), itemsTotal: 10, itemsDone: 0, loggedSameDay: true, workout: { planned: false, checkin: null } });
  assert.equal(coffeeOnly.total, 0, 'a coffee on a rest day does not earn the rest-day 30');
  // The whole plan plus 500 kcal of extras: cutting loses 20 (25% over, 5% allowed).
  const over = dayScore({ targets, consumed: all(2500, 150), planConsumed: all(2000, 150), itemsTotal: 10, itemsDone: 10, loggedSameDay: true });
  assert.equal(over.parts.over, -20);
  assert.equal(over.total, 80);
  assert.equal(overPenalty('maintain', 2500, 2000), 15);
  assert.equal(overPenalty('bulk', 3000, 2000), 0, 'bulking: no penalty');
  assert.equal(overPenalty('cut', 2090, 2000), 0, 'within the margin');
  assert.equal(overPenalty('cut', 5000, 2000), 30, 'capped');
  const bonus = dayScore({ targets, consumed: all(2000, 150), planConsumed: all(2000, 150), itemsTotal: 10, itemsDone: 10, loggedSameDay: true, workout: { planned: false, checkin: 'approved', extraSession: true } });
  assert.equal(bonus.parts.bonus, 10);
  assert.equal(bonus.total, 110);
  assert.equal(dayScore({ targets, consumed: all(6000, 0), planConsumed: all(0, 0), itemsTotal: 10, itemsDone: 0, loggedSameDay: false, workout: { planned: true, checkin: null } }).total, 0, 'never below 0');

  // Through the API: extras do not raise the score, a swap to an off-plan food is not plan food.
  const app = await boot(); t.after(app.close);
  const score = async () => (await app.today()).score;
  let day = await app.today();
  for (const it of day.meals[0].items) await app.call('POST', '/api/log', { date: D, today: D, ref: it.key, status: 'eaten' });
  const base = await score();
  await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'cappuccino', qty: 1, unit: 'u', meal: 0 });
  const withExtra = await score();
  assert.equal(withExtra.parts.calories, base.parts.calories, 'extras earn no calorie points');
  assert.equal(withExtra.parts.protein, base.parts.protein, 'extras earn no protein points');
  day = await app.today();
  const lunchMain = day.meals[1].items[0];
  await app.call('POST', '/api/log', { date: D, today: D, ref: lunchMain.key, status: 'swapped', foodId: 'beef-burger', unit: 'u', qty: 1 });
  assert.equal((await score()).parts.meals, base.parts.meals, 'a burger instead of the chicken is not a plan item');
  await app.call('POST', '/api/log', { date: D, today: D, ref: lunchMain.key, status: 'swapped', foodId: 'tilapia', grams: 200 });
  assert.ok((await score()).parts.meals > base.parts.meals, 'fish instead of the chicken is');
  // A cut day 30% over target loses points.
  await app.call('POST', '/api/log/extra', { date: D, today: D, foodId: 'pizza-pepperoni', qty: 8, unit: 'u' });
  assert.ok((await score()).parts.over < 0);
});

test('a gym check-in on a planned rest day adds 10, unless a session was moved to it', async (t) => {
  const app = await boot(); t.after(app.close);
  const plan = (await app.call('GET', '/api/workout-plan')).body.plan;
  const sat = addDays(D, -1); // Saturday
  const week = Array.from({ length: 7 }, (_, i) => addDays(sat, i));
  const rest = week.filter((d) => !plan.days.some((x) => x.weekday === weekdayOf(d)));
  const train = week.filter((d) => !rest.includes(d));
  const scoreOn = async (d) => (await app.call('GET', `/api/adherence?days=14&today=${week.at(-1)}`)).body.scores.find((s) => s.date === d);
  await app.call('POST', '/api/log/foods', { date: rest[0], today: rest[0], meal: 'lunch', items: [{ foodId: 'chicken-breast', grams: 170 }] });
  await app.call('POST', `/api/admin/users/${app.user.id}/checkins`, { date: rest[0] });
  assert.equal((await scoreOn(rest[0])).parts.bonus, 10);
  // A training day switched to rest earlier in the week: training on a rest day is the moved session.
  const laterRest = rest.find((d) => d > train[0]);
  app.db.prepare("INSERT INTO day_overrides (user_id, date, kind) VALUES (?, ?, 'rest')").run(app.user.id, train[0]);
  await app.call('POST', '/api/log/foods', { date: laterRest, today: laterRest, meal: 'lunch', items: [{ foodId: 'chicken-breast', grams: 170 }] });
  await app.call('POST', `/api/admin/users/${app.user.id}/checkins`, { date: laterRest });
  assert.equal((await scoreOn(laterRest)).parts.bonus, 0);
  // A check-in on a planned training day is the normal 30, no bonus.
  const t2 = train.find((d) => d !== train[0]);
  await app.call('POST', `/api/admin/users/${app.user.id}/checkins`, { date: t2 });
  assert.equal((await scoreOn(t2)).parts.bonus, 0);
});

test('meal match: each meal scores by how close its diet food came to the plan', async (t) => {
  const { mealMatch } = await import('../src/adherence.js');
  const plan = { kcal: 600, p: 40, c: 60, f: 20 };
  assert.equal(mealMatch(plan, plan), 1);
  assert.equal(mealMatch(plan, { kcal: 560, p: 37, c: 64, f: 19 }), 1, 'within 10% on everything: full marks');
  assert.ok(Math.abs(mealMatch(plan, { kcal: 300, p: 20, c: 30, f: 10 }) - 0.6) < 1e-9, 'half of everything: 60%');
  assert.equal(mealMatch(plan, { kcal: 1300, p: 90, c: 130, f: 45 }), 0, 'more than double: 0');
  assert.equal(mealMatch(plan, { kcal: 0, p: 0, c: 0, f: 0 }), 0);
  assert.equal(mealMatch({ kcal: 100, p: 1, c: 25, f: 0.3 }, { kcal: 100, p: 0, c: 25, f: 0 }), 1, 'tiny macros are left out');

  const app = await boot(); t.after(app.close);
  const score = async () => (await app.today()).score;
  // Breakfast is not what was planned but the same kind of meal: scrambled eggs, shami bread,
  // feta and a tomato instead of boiled eggs, baladi, white cheese and cucumber. It still earns.
  await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 'breakfast', items: [
    { foodId: 'eggs-scrambled', qty: 2, unit: 'egg' }, { foodId: 'shami-bread', qty: 1.5, unit: 'loaf' }, { foodId: 'feta', grams: 30 }, { foodId: 'tomato', grams: 100 }] });
  let s = await score();
  const bf = s.meals.find((m) => m.name === 'Breakfast');
  assert.ok(bf.match >= 70, `similar breakfast matched ${bf.match}%`);
  assert.equal(s.meals.find((m) => m.name === 'Lunch').match, null, 'nothing logged at lunch yet');
  const share = 20 * (bf.match / 100) * (s.meals.length ? 1 : 0);
  assert.ok(s.parts.meals > 0 && s.parts.meals < share, 'breakfast is part of the day, weighted by its size');
  // A pizza for lunch is logging-only: lunch matches 0 however close its calories are.
  await app.call('POST', '/api/log/foods', { date: D, today: D, meal: 'lunch', items: [{ foodId: 'pizza-margherita', qty: 2, unit: 'slice' }] });
  s = await score();
  assert.equal(s.meals.find((m) => m.name === 'Lunch').match, 0);
  // Eating lunch exactly as planned: 100% for that meal.
  const day = await app.today();
  for (const it of day.meals[1].items) await app.call('POST', '/api/log', { date: D, today: D, ref: it.key, status: 'eaten' });
  s = await score();
  assert.equal(s.meals.find((m) => m.name === 'Lunch').match, 100, 'the pizza on top is logging-only: it does not spoil or help the match (the over-target penalty handles it)');
});
