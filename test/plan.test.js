import test from 'node:test';
import assert from 'node:assert/strict';
import { FOODS } from '../src/foods-seed.js';
import { generatePlan, portionOf, planContext, mealsFromMenu } from '../src/plan.js';
import { computeTargets } from '../src/calc.js';

const targets = computeTargets({
  sex: 'male', weightKg: 80, heightCm: 180, age: 25,
  activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
});
const t = { kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG };
const byId = Object.fromEntries(FOODS.map((f) => [f.id, f]));

const within = (v, target, pct) => Math.abs(v - target) <= target * pct;

test('every day lands within 5% of calories and 10% of protein', () => {
  for (const meals of [3, 4, 5]) {
    const plan = generatePlan({ targets: t, prefs: { mealsPerDay: meals } });
    assert.equal(plan.days.length, 1);
    for (const d of plan.days) {
      assert.ok(within(d.totals.kcal, t.kcal, 0.05), `${meals} meals, day ${d.day}: ${d.totals.kcal} vs ${t.kcal}`);
      assert.ok(within(d.totals.p, t.proteinG, 0.10), `${meals} meals, day ${d.day}: protein ${d.totals.p} vs ${t.proteinG}`);
    }
  }
});

test('meal counts match the request', () => {
  for (const meals of [3, 4, 5]) {
    const plan = generatePlan({ targets: t, prefs: { mealsPerDay: meals } });
    assert.ok(plan.days.every((d) => d.meals.length === meals));
  }
});

test('disliked foods never appear', () => {
  const plan = generatePlan({ targets: t, prefs: { dislikedIds: ['chicken-breast', 'white-rice', 'oats'] } });
  const used = plan.days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.foodId)));
  for (const bad of ['chicken-breast', 'white-rice', 'oats']) assert.ok(!used.includes(bad), `${bad} was used`);
});

test('allergies exclude every tagged food', () => {
  const plan = generatePlan({ targets: t, prefs: { allergies: ['egg', 'dairy', 'gluten'] } });
  for (const d of plan.days) for (const m of d.meals) for (const i of m.items) {
    const tags = byId[i.foodId].tags;
    assert.ok(!tags.some((x) => ['egg', 'dairy', 'gluten'].includes(x)), `${i.foodId} has a banned tag`);
  }
});

test('vegetarian plans contain no meat or fish', () => {
  const plan = generatePlan({ targets: t, prefs: { vegetarian: true } });
  for (const d of plan.days) for (const m of d.meals) for (const i of m.items) {
    assert.ok(byId[i.foodId].veg, `${i.foodId} is not vegetarian`);
  }
});

test('liked foods win their slot', () => {
  const plan = generatePlan({ targets: t, prefs: { mealsPerDay: 4, likedIds: ['salmon', 'tortilla'] }, seed: 1 });
  const used = plan.days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.foodId)));
  assert.ok(used.includes('salmon') || used.includes('tortilla'), used.join(','));
});

test('egg portions are whole eggs', () => {
  const plan = generatePlan({ targets: t, prefs: {} });
  for (const d of plan.days) for (const m of d.meals) for (const i of m.items) {
    if (i.foodId === 'eggs') assert.equal(i.grams % 50, 0);
  }
});

test('regenerating with a new seed gives a different plan', () => {
  const titles = new Set([1, 2, 3, 4].map((seed) => generatePlan({ targets: t, prefs: { mealsPerDay: 4 }, seed }).days[0].meals.map((m) => m.title).join('|')));
  assert.ok(titles.size >= 3, `only ${titles.size} distinct plans`);
});

test('meals are named around training time', () => {
  const ev = generatePlan({ targets: t, prefs: { mealsPerDay: 4, trainTime: 'evening' } }).days[0].meals.map((m) => m.name);
  assert.deepEqual(ev, ['Breakfast', 'Lunch', 'Pre-workout snack', 'Post-workout dinner']);
  const none = generatePlan({ targets: t, prefs: { mealsPerDay: 3, trainTime: 'none' } }).days[0].meals.map((m) => m.name);
  assert.deepEqual(none, ['Breakfast', 'Lunch', 'Dinner']);
});

test('gluten-free and dairy-free still gets a full day', () => {
  const plan = generatePlan({ targets: t, prefs: { mealsPerDay: 4, allergies: ['gluten', 'dairy'] } });
  assert.equal(plan.days[0].meals.length, 4);
  assert.ok(within(plan.days[0].totals.kcal, t.kcal, 0.05));
});

test('impossible preferences produce warnings, not crashes', () => {
  // Only vegetables left: no meal template can be completed.
  const plan = generatePlan({ targets: t, prefs: { dislikedIds: FOODS.filter((f) => f.cat !== 'veg').map((f) => f.id) } });
  assert.ok(plan.warnings.length > 0);
  assert.equal(plan.days.length, 1);
});

// ---------- v2: realistic portions ----------
const PROFILES = [
  { kcal: 1300, proteinG: 95, carbsG: 120, fatG: 45, mealsPerDay: 3 },
  { kcal: 1600, proteinG: 108, carbsG: 150, fatG: 55, mealsPerDay: 4 },
  { kcal: 2200, proteinG: 176, carbsG: 200, fatG: 75, mealsPerDay: 3 },
  { kcal: 3200, proteinG: 162, carbsG: 420, fatG: 95, mealsPerDay: 5 },
];

test('every portion stays inside its realistic bounds', () => {
  for (const { mealsPerDay, ...tg } of PROFILES) for (const vegetarian of [false, true]) {
    const plan = generatePlan({ targets: tg, prefs: { mealsPerDay, vegetarian } });
    for (const d of plan.days) for (const m of d.meals) for (const i of m.items) {
      const f = byId[i.foodId];
      const scale = ['fruit', 'fat'].includes(f.cat) ? 1 : Math.min(1.5, Math.max(1, tg.kcal / 2400)); // big eaters get bigger servings
      const { max, step } = portionOf(f);
      assert.ok(i.grams <= Math.round(max * scale / step) * step, `${i.foodId} ${i.grams} g > ${max} g x ${scale}`);
      assert.ok(i.grams >= 5, `${i.foodId} has a token ${i.grams} g portion`);
    }
  }
});

test('no single meal takes more than half the day', () => {
  for (const { mealsPerDay, ...tg } of PROFILES) {
    const plan = generatePlan({ targets: tg, prefs: { mealsPerDay } });
    for (const d of plan.days) for (const m of d.meals) assert.ok(m.totals.kcal <= tg.kcal * 0.5, `${m.name} ${m.totals.kcal} kcal`);
  }
});

test('lunch and dinner use different meals', () => {
  const plan = generatePlan({ targets: t, prefs: { mealsPerDay: 3 } });
  for (const d of plan.days) assert.notEqual(d.meals[1].title, d.meals[2].title);
});

test('AI menus are validated: unknown, disallowed or malformed foods are rejected', () => {
  const ctx = planContext({ prefs: { mealsPerDay: 3, allergies: ['fish'] } });
  const good = { meals: [{ foodIds: ['eggs', 'baladi-bread', 'tomato'] }, { foodIds: ['chicken-breast', 'white-rice', 'broccoli'] }, { foodIds: ['beef-lean', 'potato', 'salad-greens'] }] };
  assert.ok(mealsFromMenu(good, ctx));
  const cases = [
    { meals: good.meals.slice(0, 2) },                                                     // wrong meal count
    { meals: [...good.meals.slice(0, 2), { foodIds: ['pizza', 'white-rice'] }] },          // unknown food
    { meals: [...good.meals.slice(0, 2), { foodIds: ['salmon', 'white-rice'] }] },         // allergy
    { meals: [...good.meals.slice(0, 2), { foodIds: ['potato'] }] },                       // too few foods
    { meals: [...good.meals.slice(0, 2), { foodIds: ['potato', 'potato', 'tomato'] }] },   // duplicate
  ];
  for (const c of cases) assert.equal(mealsFromMenu(c, ctx), null);
});

test('a valid AI menu is used and sized to the targets', () => {
  const day = { meals: [
    { title: 'Ful breakfast', foodIds: ['ful-medames', 'eggs', 'baladi-bread', 'tomato'] },
    { title: 'Chicken and rice', foodIds: ['chicken-breast', 'white-rice', 'broccoli', 'olive-oil'] },
    { title: 'Beef and potatoes', foodIds: ['beef-lean', 'potato', 'salad-greens', 'tahini'] },
  ] };
  const plan = generatePlan({ targets: t, prefs: { mealsPerDay: 3 }, days: 2, menu: [day, day] });
  assert.equal(plan.source, 'ai');
  assert.equal(plan.days[0].meals[1].title, 'Chicken and rice');
  for (const d of plan.days) assert.ok(within(d.totals.kcal, t.kcal, 0.05), `${d.totals.kcal}`);
});

test('countable foods come in whole units and nothing but staples repeats in a day', () => {
  for (const { mealsPerDay, ...tg } of PROFILES) for (const trainTime of ['evening', 'morning', 'none']) for (const seed of [1, 2, 3]) {
    const plan = generatePlan({ targets: tg, prefs: { mealsPerDay, trainTime }, seed });
    const count = new Map();
    for (const m of plan.days[0].meals) for (const i of m.items) {
      const f = byId[i.foodId];
      if (f.unit && !['loaf', 'bowl', 'cup'].includes(f.unit.name)) assert.equal(i.grams % f.unit.g, 0, `${i.foodId} ${i.grams} g is not whole ${f.unit.name}s`);
      if (!['carb', 'veg', 'fat'].includes(f.cat)) count.set(f.id, (count.get(f.id) ?? 0) + 1);
    }
    // Cook once, eat twice: lunch's chicken / meat / fish may come back once at dinner.
    for (const [id, n] of count) assert.ok(n === 1 || (n === 2 && byId[id].roles.includes('mainProtein')), `${id} served ${n} times in one day (seed ${seed}, ${trainTime})`);
  }
});

test('whey is only planned for people who have it', () => {
  const tg = PROFILES[0];
  const ids = (prefs) => generatePlan({ targets: tg, prefs: { mealsPerDay: 5, ...prefs } }).days[0].meals.flatMap((m) => m.items.map((i) => i.foodId));
  for (const seed of [1, 2, 3, 4]) assert.ok(!ids({ seed }).includes('whey'));
});

// ---------- v4: the Egyptian day ----------
import { isCookedDish, mealOptions, dayLogicIssues } from '../src/plan.js';

test('one cooked Egyptian dish a day, at lunch, never at a light dinner', () => {
  for (const { mealsPerDay, ...tg } of PROFILES) for (const trainTime of ['evening', 'morning', 'none']) for (const seed of [1, 2, 3, 4, 5]) {
    const day = generatePlan({ targets: tg, prefs: { mealsPerDay, trainTime }, seed }).days[0];
    const cooked = day.meals.filter((m) => m.items.some((i) => isCookedDish(byId[i.foodId])));
    assert.ok(cooked.length <= 1, `${cooked.map((m) => m.title)} (seed ${seed}, ${trainTime})`);
    for (const m of cooked) assert.equal(m.kind, 'lunch', `${m.title} is a ${m.kind}`);
    assert.deepEqual(dayLogicIssues(day, byId), [], `seed ${seed}, ${trainTime}`);
  }
});

test('dinner is made from what was cooked for lunch most of the time', () => {
  let same = 0, total = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) for (const trainTime of ['none', 'evening']) {
    const day = generatePlan({ targets: t, prefs: { mealsPerDay: 4, trainTime }, seed }).days[0];
    const prot = (m) => m.items.map((i) => byId[i.foodId]).find((f) => f.roles.includes('mainProtein'))?.id;
    const lunch = day.meals.find((m) => m.kind === 'lunch');
    const dinner = day.meals.find((m) => m.kind === 'dinner' || m.kind === 'post');
    if (!prot(lunch)) continue;
    total++; if (prot(lunch) === prot(dinner)) same++;
  }
  assert.ok(same / total >= 0.6, `only ${same} of ${total} dinners reuse lunch's protein`);
});

test('whole-meal alternatives keep the calories and fit the day', () => {
  const day = generatePlan({ targets: t, prefs: { mealsPerDay: 3, trainTime: 'none' }, seed: 2 }).days[0];
  const li = day.meals.findIndex((m) => m.kind === 'lunch');
  const opts = mealOptions({ meal: day.meals[li], others: day.meals.filter((_, i) => i !== li), targets: t });
  assert.ok(opts.length >= 3, `${opts.length} options`);
  for (const o of opts) {
    assert.ok(Math.abs(o.kcal - day.meals[li].totals.kcal) <= Math.max(60, day.meals[li].totals.kcal * 0.1), `${o.title} ${o.kcal}`);
    assert.notEqual(o.title, day.meals[li].title);
  }
  // A light dinner is never offered a cooked dish.
  const di = day.meals.findIndex((m) => m.kind === 'dinner');
  const dOpts = mealOptions({ meal: day.meals[di], others: day.meals.filter((_, i) => i !== di), targets: t });
  assert.ok(dOpts.length >= 2);
  for (const o of dOpts) assert.ok(!o.items.some((i) => isCookedDish(i.food)), o.title);
});

test('the plan checker flags days no person would eat', () => {
  const it = (foodId, grams = 150) => ({ foodId, grams });
  const odd = { meals: [
    { name: 'Breakfast', kind: 'bf', items: [it('kofta'), it('white-rice')] },
    { name: 'Lunch', kind: 'lunch', items: [it('molokhia', 250), it('chicken-breast'), it('white-rice')] },
    { name: 'Dinner', kind: 'dinner', items: [it('mahshi', 250), it('chicken-breast')] },
  ] };
  const issues = dayLogicIssues(odd, byId);
  assert.ok(issues.some((x) => /two cooked/i.test(x)), issues.join(' | '));
  assert.ok(issues.some((x) => /breakfast/i.test(x)), issues.join(' | '));
});
