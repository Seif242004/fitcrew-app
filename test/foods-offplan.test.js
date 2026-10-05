// Food search (search.js) and off-plan foods (offplan-foods.js): searchable and loggable, but
// never part of plans, swaps, meal changes or the coach's plan suggestions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, loadFoods } from '../src/db.js';
import { createServer } from '../server.js';
import { searchFoods, norm } from '../src/search.js';
import { generatePlan, filterFoods } from '../src/plan.js';
import { OFFPLAN_FOODS } from '../src/offplan-foods.js';
import { unitsFor } from '../src/measures.js';

const db = openDb(':memory:');
const all = loadFoods(db, { offplan: true });
const first = (q) => searchFoods(all, q)[0]?.id;

test('search: word order, partial words, spellings, plurals, Arabic variants', () => {
  assert.equal(first('grilled chicken'), 'chicken-breast');
  assert.equal(first('chicken grilled'), 'chicken-breast');
  assert.equal(first('chick gril'), 'chicken-breast');
  assert.equal(first('koshary'), 'koshari');
  assert.equal(first('foul'), 'ful-medames');
  assert.equal(first('tamia'), 'taameya');
  assert.equal(first('yoghurt')?.includes('yogurt'), true);
  assert.equal(first('eggs'), 'eggs');
  assert.equal(first('nuggets'), 'chicken-nuggets');
  assert.equal(first('عيش بلدى'), 'baladi-bread');
  assert.equal(first('بيتزا')?.startsWith('pizza'), true);
  assert.equal(first('  Bread  '), 'baladi-bread');
  assert.equal(norm('أحمد'), 'احمد');
  assert.deepEqual(searchFoods(all, ''), []);
  assert.deepEqual(searchFoods(all, 'zzqq'), []);
});

test('search: relevance first, and plan foods before eating-out foods', () => {
  const egg = searchFoods(all, 'egg').map((f) => f.id);
  assert.ok(egg.indexOf('eggplant') > egg.indexOf('eggs'), 'eggs before eggplant');
  const ful = searchFoods(all, 'ful').map((f) => f.id);
  assert.equal(ful[0], 'ful-medames', 'ful medames before full-fat milk');
  const choc = searchFoods(all, 'chocolate', 20);
  const lastDiet = choc.map((f) => f.offplan).lastIndexOf(false);
  const firstOff = choc.map((f) => f.offplan).indexOf(true);
  assert.ok(lastDiet >= 0 && firstOff > lastDiet, 'dark chocolate (diet) before chocolate bars (off-plan)');
});

test('off-plan foods: never in the plan pool, generated plans or swap pools', () => {
  const diet = loadFoods(db);
  assert.equal(diet.some((f) => f.offplan), false, 'loadFoods() hides them by default');
  assert.equal(all.filter((f) => f.offplan).length, OFFPLAN_FOODS.length);
  for (const f of OFFPLAN_FOODS) assert.deepEqual(f.roles, [], `${f.id} has no meal roles`);
  const offIds = new Set(OFFPLAN_FOODS.map((f) => f.id));
  // Even if someone "likes" a pizza, the generator only draws from the diet pool.
  const prefs = { mealsPerDay: 4, likedIds: ['pizza-margherita', 'fries'], dislikedIds: [], allergies: [], vegetarian: false };
  for (let seed = 1; seed <= 5; seed++) {
    const plan = generatePlan({ targets: { kcal: 2400, proteinG: 160, carbsG: 270, fatG: 70 }, prefs, foods: filterFoods(diet, prefs), seed });
    for (const d of plan.days) for (const m of d.meals) for (const it of m.items) assert.equal(offIds.has(it.foodId), false, `${it.foodId} in a plan`);
  }
});

test('off-plan foods: natural units and sane numbers', () => {
  for (const f of OFFPLAN_FOODS) {
    const u = unitsFor(f);
    assert.ok(u[0].key === 'u' && u[0].g > 0, `${f.id} logs in ${f.unit.name}`);
    // Near-zero drinks (black coffee, diet cola) are checked in absolute kcal, the rest relative.
    const diff = Math.abs(f.p * 4 + f.c * 4 + f.f * 9 - f.kcal);
    assert.ok(f.kcal < 10 ? diff < 3 : diff / f.kcal < 0.12, `${f.id} macros add up`);
  }
  const fries = unitsFor(all.find((f) => f.id === 'fries')).map((u) => u.name);
  assert.deepEqual(fries.slice(0, 3), ['medium portion', 'small portion', 'large portion']);
});

test('API: search, logging, recent foods, and swaps stay diet-only', async (t) => {
  const app = openDb(':memory:');
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  await call('POST', '/api/setup', { name: 'Seif', email: 'seif@example.com', password: 'a-good-password' });
  await call('PUT', '/api/profile', { profile: { sex: 'male', age: 25, heightCm: 180, weightKg: 85, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5, experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', injuries: '', measurements: {}, prefs: { mealsPerDay: 4, likedIds: [], dislikedIds: [], allergies: [], vegetarian: false } } });
  const today = new Date().toISOString().slice(0, 10);

  // The full list (onboarding, admin editor) and plain search have no off-plan foods.
  assert.equal((await call('GET', '/api/foods')).body.foods.some((f) => f.offplan), false);
  assert.equal((await call('GET', '/api/foods?q=pizza')).body.foods.length, 0, 'swap / editor search: no pizza');
  const s = (await call('GET', '/api/foods?q=pizza&offplan=1')).body.foods;
  assert.ok(s.length >= 3 && s.every((f) => f.offplan));
  assert.equal((await call('GET', '/api/foods?q=&offplan=1')).body.foods.length, 0, 'empty search without recent: nothing');

  // Log 2 slices of pizza as an extra; it shows up as recent.
  const r = await call('POST', '/api/log/extra', { date: today, today, foodId: 'pizza-margherita', unit: 'u', qty: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const day = (await call('GET', `/api/today?date=${today}`)).body;
  const extra = day.extras.find((e) => e.name.startsWith('Pizza'));
  assert.equal(extra.amount, '2 slices');
  assert.equal(extra.kcal, Math.round((266 * 214) / 100));
  const rec = (await call('GET', '/api/foods?q=&offplan=1&recent=1')).body;
  assert.equal(rec.recent, true);
  assert.equal(rec.foods[0].id, 'pizza-margherita');

  // "Ate something else instead" of a plan item can be a burger; the plan itself does not change.
  const item = day.meals[1].items[0];
  assert.equal((await call('POST', '/api/log', { date: today, today, ref: item.key, status: 'swapped', foodId: 'beef-burger', unit: 'u', qty: 1 })).status, 200);
  const planAfter = (await call('GET', '/api/plan')).body.plan;
  assert.equal(planAfter.days[0].meals[1].items[0].foodId, item.foodId, 'plan unchanged');

  // Equivalent swaps and whole-meal options never offer off-plan foods.
  const offIds = new Set(OFFPLAN_FOODS.map((f) => f.id));
  const ids = (obj) => [...JSON.stringify(obj).matchAll(/"(?:foodId|id)":"([^"]+)"/g)].map((m) => m[1]);
  for (const m of day.meals) for (const it of m.items) {
    const alts = (await call('GET', `/api/plan/alternatives?date=${today}&ref=${it.key}`)).body;
    assert.equal(ids(alts.options ?? []).some((x) => offIds.has(x)), false, `swaps for ${it.name}`);
  }
  let optionCount = 0;
  for (let mi = 0; mi < day.meals.length; mi++) {
    const opts = (await call('GET', `/api/plan/meal-options?date=${today}&meal=${mi}`)).body;
    const found = ids(opts);
    optionCount += found.length;
    assert.equal(found.some((x) => offIds.has(x)), false, `meal options for meal ${mi}`);
  }
  assert.ok(optionCount > 0, 'meal options were actually checked');

  // Rebalance after the pizza trims the rest of today.
  const rb = await call('POST', '/api/today/rebalance', { date: today });
  assert.equal(rb.status, 200);
  assert.ok(rb.body.after <= rb.body.before);
});
