import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
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


const D = new Date().toISOString().slice(0, 10); // plans start on the server's today
const profile = {
  sex: 'male', age: 25, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
  experience: 'beginner', daysPerWeek: 3, equipment: 'gym', injuries: '', measurements: {},
  prefs: { mealsPerDay: 4, trainTime: 'evening', likedIds: [], dislikedIds: ['tilapia'], allergies: ['seafood'], vegetarian: false },
};

test('swaps: equivalents, exclusions, today vs every day', async (t) => {
  const app = await boot(); t.after(app.close);
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Admin', email: 'a@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 's@example.com', password: 'sam-password-1' });
  const saved = await sam.put('/api/profile', { profile });
  await admin.post(`/api/admin/plans/${saved.body.pendingPlanId}/approve`, { startDate: D });

  const day = (await sam.get(`/api/today?date=${D}`)).body;
  // find a protein item to swap
  const all = day.meals.flatMap((m) => m.items);
  const alts0 = await Promise.all(all.map((it) => sam.get(`/api/plan/alternatives?date=${D}&ref=${it.key}`)));
  const k = alts0.findIndex((r) => r.body.group === 'protein' && r.body.options.length > 3);
  assert.ok(k >= 0, 'some item has protein alternatives');
  const item = all[k]; const alts = alts0[k].body;
  const ids = alts.options.map((o) => o.foodId);
  assert.ok(!ids.includes('tilapia'), 'disliked food is not offered');
  assert.ok(!ids.includes('shrimp') && !ids.includes('calamari'), 'excluded group is not offered');

  // a food the person excluded cannot be forced through the API
  assert.equal((await sam.post('/api/plan/swap', { date: D, ref: item.key, foodId: 'shrimp', scope: 'today' })).status, 400);

  // today only: the item changes today, the plan does not; ticking it logs the swapped food
  const pick = alts.options[0];
  const r = await sam.post('/api/plan/swap', { date: D, ref: item.key, foodId: pick.foodId, scope: 'today', grams: 99999 });
  assert.equal(r.status, 200);
  assert.equal(r.body.grams, pick.grams, 'server computes the equivalent amount, not the client');
  const after = (await sam.get(`/api/today?date=${D}`)).body.meals.flatMap((m) => m.items).find((i) => i.key === item.key);
  assert.equal(after.foodId, pick.foodId);
  assert.equal(after.swappedFrom, item.name);
  await sam.post('/api/log', { date: D, today: D, ref: item.key, status: 'eaten' });
  const logged = (await sam.get(`/api/today?date=${D}`)).body.meals.flatMap((m) => m.items).find((i) => i.key === item.key);
  assert.equal(logged.log.foodId, pick.foodId, 'eaten log records the swapped food');
  const plan = (await sam.get('/api/plan')).body.plan;
  assert.ok(plan.days[0].meals.flatMap((m) => m.items).some((i) => i.foodId === item.foodId), 'plan unchanged by a today-only swap');

  // every day: the plan item itself changes
  const pick2 = alts.options[1];
  assert.equal((await sam.post('/api/plan/swap', { date: D, ref: item.key, foodId: pick2.foodId, scope: 'always' })).status, 200);
  const plan2 = (await sam.get('/api/plan')).body.plan;
  const [_, mi, ii] = item.key.split('-').map(Number);
  assert.equal(plan2.days[0].meals[mi].items[ii].foodId, pick2.foodId);
  assert.ok(Math.abs(plan2.days[0].totals.kcal - plan.days[0].totals.kcal) < 120, 'equivalent swap keeps the day close to target');
});

test('AI admin: safe plans are approved instantly, unsafe ones go to the admin with reasons', async (t) => {
  const app = await boot(); t.after(app.close);
  const admin = app.client(); const sam = app.client(); const kim = app.client();
  await admin.post('/api/setup', { name: 'Admin', email: 'a@example.com', password: 'a-good-password' });
  for (const [c, name] of [[sam, 'Sam'], [kim, 'Kim']]) {
    const { code } = (await admin.post('/api/admin/invites', {})).body;
    await c.post('/api/register', { code, name, email: `${name}@example.com`, password: 'a-password-123' });
  }
  // Sam: normal profile -> diet and training plans live immediately, no admin needed
  await sam.put('/api/profile', { profile: { ...profile, prefs: { ...profile.prefs, dislikedIds: [], allergies: [] } } });
  const plan = (await sam.get('/api/plan')).body.plan;
  assert.ok(plan, 'diet plan is active straight after onboarding');
  assert.deepEqual(plan.review.issues, []);
  assert.equal((await sam.get(`/api/train?date=${D}`)).body.hasPlan, true, 'training plan is active too');
  const log = (await admin.get('/api/admin/audit')).body;
  assert.ok(JSON.stringify(log).includes('plan.auto_approved'));

  // Kim: an injury -> the training plan waits for a human, with the reason
  await kim.put('/api/profile', { profile: { ...profile, injuries: 'bad lower back' } });
  const users = (await admin.get('/api/admin/users')).body.users;
  const k = users.find((u) => u.name === 'Kim');
  assert.ok(k.pendingWorkoutPlanId, 'injury plan is held for the admin');
  const held = (await admin.get(`/api/admin/workout-plans/${k.pendingWorkoutPlanId}`)).body.plan;
  assert.ok(held.review.issues.some((i) => i.includes('bad lower back')));
});

test('calories stay on target: repeated swaps and eating off-plan', async (t) => {
  const app = await boot(); t.after(app.close);
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Admin', email: 'a@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 's@example.com', password: 'sam-password-1' });
  await sam.put('/api/profile', { profile: { ...profile, prefs: { ...profile.prefs, dislikedIds: [], allergies: [] } } });
  const target = (await sam.get('/api/me')).body.targets.kcal;

  // Three "every day" swaps, each picking the option that adds the most calories.
  for (let n = 0; n < 3; n++) {
    const day = (await sam.get(`/api/today?date=${D}`)).body;
    const items = day.meals.flatMap((m) => m.items);
    for (const it of items) {
      const alts = (await sam.get(`/api/plan/alternatives?date=${D}&ref=${it.key}`)).body.options;
      const worst = alts.filter((o) => o.kcalDiff > 0).sort((a, b) => b.kcalDiff - a.kcalDiff)[0];
      if (worst) { await sam.post('/api/plan/swap', { date: D, ref: it.key, foodId: worst.foodId, scope: 'always' }); break; }
    }
  }
  const plan = (await sam.get('/api/plan')).body.plan;
  assert.ok(Math.abs(plan.days[0].totals.kcal - target) <= target * 0.04, `plan ${plan.days[0].totals.kcal} vs target ${target}`);

  // Off-plan: a 700 kcal shawarma at lunch, breakfast eaten as planned.
  const day = (await sam.get(`/api/today?date=${D}`)).body;
  for (const it of day.meals[0].items) await sam.post('/api/log', { date: D, today: D, ref: it.key, status: 'eaten' });
  await sam.post('/api/log/extra', { date: D, today: D, name: 'Shawarma', kcal: 700, p: 35, c: 60, f: 30 });
  const over = (await sam.get(`/api/today?date=${D}`)).body;
  assert.ok(over.projectedKcal > target * 1.05, 'the day is projected over');
  const r = (await sam.post('/api/today/rebalance', { date: D })).body;
  assert.ok(r.after < r.before, 'rebalancing trims the rest of the day');
  const fixed = (await sam.get(`/api/today?date=${D}`)).body;
  assert.equal(fixed.projectedKcal, Math.round(fixed.projectedKcal));
  assert.ok(fixed.projectedKcal <= target * 1.05 || r.stillOver, 'either on target or honestly reported as still over');
  assert.ok(fixed.meals[0].items.every((i) => !i.resizedFrom), 'logged items never change');
});

// ---------- v4: natural units and whole-meal swaps ----------
async function member(app) {
  const admin = app.client(); const sam = app.client();
  await admin.post('/api/setup', { name: 'Admin', email: 'a@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', {})).body;
  await sam.post('/api/register', { code, name: 'Sam', email: 's@example.com', password: 'sam-password-1' });
  const saved = await sam.put('/api/profile', { profile: { ...profile, prefs: { ...profile.prefs, trainTime: 'none', mealsPerDay: 3 } } });
  await admin.post(`/api/admin/plans/${saved.body.pendingPlanId}/approve`, { startDate: D });
  return sam;
}

test('logging in natural units: "3 eggs", "1 plate", grams dry', async (t) => {
  const app = await boot(); t.after(app.close);
  const sam = await member(app);
  const day = (await sam.get(`/api/today?date=${D}`)).body;
  const items = day.meals.flatMap((m) => m.items);
  for (const it of items) assert.ok(it.units?.length >= 1 && it.units.at(-1).key === 'g', `${it.foodId} has units ending in grams`);
  // An item with a natural unit (eggs, loaves, cups...) logged as one step more than planned.
  const counted = items.find((i) => !i.units[0].grams);
  assert.ok(counted, 'the plan has an item with a natural unit');
  const u = counted.units[0];
  const qty = Math.round(counted.grams / u.g / u.step) * u.step + u.step;
  const r = await sam.post('/api/log', { date: D, ref: counted.key, status: 'adjusted', unit: u.key, qty });
  assert.equal(r.status, 200);
  const after = (await sam.get(`/api/today?date=${D}`)).body.meals.flatMap((m) => m.items).find((i) => i.key === counted.key);
  assert.equal(after.log.grams, Math.round(qty * u.g * 10) / 10);
  assert.ok(after.log.amount.endsWith(qty <= 1 ? u.name : u.plural), after.log.amount);
  // Unknown units and silly amounts are refused.
  assert.equal((await sam.post('/api/log', { date: D, ref: counted.key, status: 'adjusted', unit: 'bucket', qty: 1 })).status, 400);
  assert.equal((await sam.post('/api/log', { date: D, ref: counted.key, status: 'adjusted', unit: counted.units[0].key, qty: 500 })).status, 400);
  // Extras by household measure: a plate of koshari is 350 g.
  const k = await sam.post('/api/log/extra', { date: D, foodId: 'koshari', unit: 'm0', qty: 1 });
  assert.equal(k.status, 200);
  const extra = (await sam.get(`/api/today?date=${D}`)).body.extras.find((e) => e.ref === k.body.ref);
  assert.equal(extra.grams, 350); assert.equal(extra.amount, '1 plate');
  // Rice logged dry: 70 g dry white rice = 196 g cooked.
  const rice = await sam.post('/api/log/extra', { date: D, foodId: 'white-rice', unit: 'dry', qty: 70 });
  assert.equal((await sam.get(`/api/today?date=${D}`)).body.extras.find((e) => e.ref === rice.body.ref).grams, 196);
  // The food search carries the units too, and finds Arabic names.
  const foods = (await sam.get('/api/foods?q=' + encodeURIComponent('بيض'))).body.foods;
  assert.ok(foods.some((f) => f.id === 'eggs' && f.units[0].name === 'egg'));
});

test('whole-meal swap: today only, every day, and back', async (t) => {
  const app = await boot(); t.after(app.close);
  const sam = await member(app);
  const day0 = (await sam.get(`/api/today?date=${D}`)).body;
  const li = day0.meals.findIndex((m) => m.name === 'Lunch');
  const opts = (await sam.get(`/api/plan/meal-options?date=${D}&meal=${li}`)).body;
  assert.ok(opts.options.length >= 3, `${opts.options.length} options`);
  const kcal0 = day0.meals[li].items.reduce((a, i) => a + i.kcal, 0);
  for (const o of opts.options) assert.ok(Math.abs(o.kcal - kcal0) <= Math.max(60, kcal0 * 0.1), `${o.title}: ${o.kcal} vs ${kcal0}`);
  // Tick an item, then change the meal for today: the tick goes with the old meal.
  await sam.post('/api/log', { date: D, ref: day0.meals[li].items[0].key, status: 'eaten' });
  const pick = opts.options[0];
  assert.equal((await sam.post('/api/plan/meal-swap', { date: D, meal: li, key: pick.key, scope: 'today' })).status, 200);
  const day1 = (await sam.get(`/api/today?date=${D}`)).body;
  assert.equal(day1.meals[li].title, pick.title);
  assert.ok(day1.meals[li].mealSwappedFrom);
  assert.ok(day1.meals[li].items.every((i) => !i.log), 'old ticks are cleared');
  // The new items can be logged like any other.
  assert.equal((await sam.post('/api/log', { date: D, ref: day1.meals[li].items[0].key, status: 'eaten' })).status, 200);
  // The plan itself is unchanged.
  const plan = (await sam.get('/api/plan')).body.plan;
  assert.equal(plan.days[0].meals[li].title, day0.meals[li].title);
  // An item swap "every day" inside a today-only meal is refused with a clear reason.
  const alt = (await sam.get(`/api/plan/alternatives?date=${D}&ref=${day1.meals[li].items[0].key}`)).body.options[0];
  if (alt) assert.equal((await sam.post('/api/plan/swap', { date: D, ref: day1.meals[li].items[0].key, foodId: alt.foodId, scope: 'always' })).status, 400);
  // Put it back.
  assert.equal((await sam.post('/api/plan/meal-swap', { date: D, meal: li, scope: 'reset' })).status, 200);
  assert.equal((await sam.get(`/api/today?date=${D}`)).body.meals[li].title, day0.meals[li].title);
  // Every day: the plan changes.
  const again = (await sam.get(`/api/plan/meal-options?date=${D}&meal=${li}`)).body.options[1];
  assert.equal((await sam.post('/api/plan/meal-swap', { date: D, meal: li, key: again.key, scope: 'always' })).status, 200);
  assert.equal((await sam.get('/api/plan')).body.plan.days[0].meals[li].title, again.title);
  // Stale or made-up options are refused.
  assert.equal((await sam.post('/api/plan/meal-swap', { date: D, meal: li, key: 'Pizza night', scope: 'today' })).status, 400);
});
