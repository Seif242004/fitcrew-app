// The bigger food database (session 13): diet staples for plans and swaps, and everyday /
// eating-out foods for logging. Checks the data itself, search, and that plans stay diet-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, loadFoods } from '../src/db.js';
import { createServer } from '../server.js';
import { searchFoods, findFood } from '../src/search.js';
import { generatePlan, filterFoods, dayLogicIssues } from '../src/plan.js';
import { alternatives } from '../src/exchange.js';
import { unitsFor, formatQty } from '../src/measures.js';
import { FOODS } from '../src/foods-seed.js';
import { OFFPLAN_FOODS } from '../src/offplan-foods.js';
import { MORE_DIET_FOODS } from '../src/foods-more.js';
import { MORE_OFFPLAN_FOODS, SEARCH_KEYWORDS } from '../src/offplan-more.js';

const db = openDb(':memory:');
const all = loadFoods(db, { offplan: true });
const ids = (q, n = 20) => searchFoods(all, q, n).map((f) => f.id);

// Foods whose label carbs include a lot of fibre, so 4/4/9 overshoots their calories.
const HIGH_FIBRE = new Set(['dried-apricot', 'corn', 'corn-on-cob', 'lemon-juice']); // lemon: citric acid, not sugar

test('food database: much bigger, no duplicates, numbers that add up', () => {
  assert.ok(FOODS.length >= 280, `diet foods: ${FOODS.length}`);
  assert.ok(OFFPLAN_FOODS.length >= 340, `everyday and eating-out foods: ${OFFPLAN_FOODS.length}`);
  const seen = { id: new Set(), name: new Set(), ar: new Set() };
  for (const f of [...FOODS, ...OFFPLAN_FOODS]) {
    for (const k of ['id', 'name', 'ar']) {
      const v = k === 'name' ? f[k].toLowerCase() : f[k];
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${v}`);
      seen[k].add(v);
    }
    assert.ok(f.kcal >= 0 && f.kcal <= 900 && f.p >= 0 && f.c >= 0 && f.f >= 0, `${f.id} has sane numbers`);
    assert.ok(f.p + f.c + f.f <= 101, `${f.id}: macros fit in 100 g`);
    const atwater = f.p * 4 + f.c * 4 + f.f * 9;
    // Vegetables and fruit: label carbs include fibre, so allow more.
    const tol = ['veg', 'fruit'].includes(f.cat) ? 0.3 : 0.12;
    if (!HIGH_FIBRE.has(f.id)) assert.ok(f.kcal < 10 ? Math.abs(atwater - f.kcal) < 3 : Math.abs(atwater - f.kcal) <= Math.max(5, f.kcal * tol), `${f.id}: ${f.kcal} kcal vs ${Math.round(atwater)} from macros`);
    assert.ok(unitsFor(f).length >= 1, `${f.id} can be logged`);
  }
});

test('new diet foods are real staples: no niche foods, roles only where a plan can use them', () => {
  const NICHE = /tofu|tempeh|seitan|edamame|kimchi|natto|miso|spirulina|jackfruit|kombucha/i;
  for (const f of MORE_DIET_FOODS) {
    assert.ok(!NICHE.test(`${f.id} ${f.name}`), `${f.id} is not niche`);
    assert.ok(!f.offplan, `${f.id} is a diet food`);
    if (f.roles.length) assert.ok(f.portion, `${f.id} has a plan portion`);
  }
  for (const f of MORE_OFFPLAN_FOODS) assert.deepEqual(f.roles, [], `${f.id} never goes in a plan`);
  for (const id of Object.keys(SEARCH_KEYWORDS)) assert.ok(all.some((f) => f.id === id), `keywords for a real food: ${id}`);
});

test('search finds what people type: chains, brands, street food', () => {
  assert.equal(ids('nuggets')[0], 'chicken-nuggets');
  assert.ok(ids('nuggets').includes('nuggets-frozen'));
  assert.equal(ids('big mac')[0], 'big-mac-style');
  assert.equal(ids('zinger')[0], 'zinger');
  assert.equal(ids('whopper')[0], 'whopper-style');
  assert.ok(ids('kfc').includes('kfc-original') && ids('kfc').includes('twister'));
  assert.ok(ids('mcdonalds', 30).includes('quarter-pounder'));
  assert.equal(ids('nutella')[0], 'chocolate-spread');
  assert.equal(ids('red bull')[0], 'energy-drink');
  assert.equal(ids('sprite')[0], 'fizzy-drink');
  assert.deepEqual(ids('pepsi'), ['cola', 'diet-cola'], 'an alias never matches inside another word (cola in chocolate)');
  assert.ok(ids('feteer').length >= 5);
  assert.ok(ids('pizza', 40).length >= 15);
  assert.ok(ids('فطير').length >= 4, 'Arabic too');
  assert.equal(findFood(all, 'a big mac')?.id, 'big-mac-style');
  assert.equal(findFood(all, '6 nuggets from mcdonalds')?.id, 'chicken-nuggets');
});

test('new units read naturally', () => {
  const u = (id) => unitsFor(all.find((f) => f.id === id));
  assert.equal(formatQty(u('cherry-tomatoes')[0], 2), '2 tomatoes');
  assert.equal(formatQty(u('pizza-bbq-chicken').find((x) => x.name === 'medium pizza'), 1), '1 medium pizza');
  assert.equal(formatQty(u('feteer-cheese').find((x) => x.name === 'whole feteer'), 0.5), '½ whole feteer');
  assert.equal(formatQty(u('popcorn-chicken')[0], 2), '2 regular boxes');
  assert.equal(formatQty(u('bran-baladi')[0], 1.5), '1½ loaves');
});

test('new diet foods show up as swaps ("بدائل") of the same kind', () => {
  const diet = loadFoods(db);
  const by = new Map(diet.map((f) => [f.id, f]));
  const alt = (id, g) => alternatives(by.get(id), g, diet).map((a) => a.food.id);
  assert.ok(alt('tilapia', 200).includes('white-fish'));
  assert.ok(alt('baladi-bread', 90).includes('bran-baladi'));
  assert.ok(alt('chicken-breast', 170).includes('chicken-breast-boiled'));
  assert.ok(alt('greek-yogurt', 170).includes('cottage-light'));
  assert.ok(alt('cucumber', 150).includes('arugula'));
  for (const id of ['tilapia', 'baladi-bread', 'chicken-breast', 'white-rice', 'eggs']) {
    assert.equal(alt(id, 150).some((x) => all.find((f) => f.id === x)?.offplan), false, `${id}: swaps stay diet-only`);
  }
});

test('plans still make sense with the bigger database, and can use the new staples', () => {
  const diet = loadFoods(db);
  const offIds = new Set(OFFPLAN_FOODS.map((f) => f.id));
  const used = new Set();
  const personas = [
    { kcal: 1800, proteinG: 150, carbsG: 170, fatG: 55, prefs: { mealsPerDay: 3, trainTime: 'morning' } },
    { kcal: 2400, proteinG: 170, carbsG: 270, fatG: 70, prefs: { mealsPerDay: 4, trainTime: 'evening' } },
    { kcal: 3000, proteinG: 190, carbsG: 360, fatG: 85, prefs: { mealsPerDay: 5, trainTime: 'none' } },
    // Someone who does not eat the usual first choices gets the new staples instead.
    { kcal: 2200, proteinG: 165, carbsG: 240, fatG: 65, prefs: { mealsPerDay: 4, trainTime: 'evening', dislikedIds: ['tilapia', 'sea-bream', 'baladi-bread', 'toast-brown', 'chicken-breast', 'areesh'] } },
  ];
  for (const { prefs: p, ...targets } of personas) {
    const prefs = { likedIds: [], dislikedIds: [], allergies: [], vegetarian: false, ...p };
    for (let seed = 1; seed <= 4; seed++) {
      const plan = generatePlan({ targets, prefs, foods: filterFoods(diet, prefs), seed });
      for (const d of plan.days) {
        assert.deepEqual(dayLogicIssues(d, diet), [], `day logic, seed ${seed}`);
        const kcal = d.meals.reduce((a, m) => a + m.items.reduce((b, it) => b + it.kcal, 0), 0);
        assert.ok(Math.abs(kcal / targets.kcal - 1) <= 0.07, `kcal ${Math.round(kcal)} vs ${targets.kcal}`);
        for (const m of d.meals) for (const it of m.items) { assert.ok(!offIds.has(it.foodId)); used.add(it.foodId); }
      }
    }
  }
  const fresh = MORE_DIET_FOODS.filter((f) => used.has(f.id)).map((f) => f.id);
  assert.ok(fresh.length >= 3, `new staples used in plans: ${fresh.join(', ')}`);
});

test('API: an eating-out search still reaches fast food when diet foods also match', async (t) => {
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
  const chicken = (await call('GET', '/api/foods?q=chicken&offplan=1')).body.foods;
  assert.ok(chicken.some((f) => !f.offplan) && chicken.some((f) => f.id === 'chicken-nuggets') && chicken.some((f) => f.id === 'zinger'));
  assert.ok(chicken.findIndex((f) => f.offplan) > chicken.findLastIndex((f) => !f.offplan), 'diet foods first');
  const nuggets = (await call('GET', '/api/foods?q=nuggets&offplan=1')).body.foods;
  assert.equal(nuggets[0].id, 'chicken-nuggets');
  assert.ok(nuggets[0].units.some((u) => u.name === '6-piece box'));
});
