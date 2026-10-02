// Diet plan generator. Turns daily targets and food preferences into a draft
// 7-day plan in exact grams. The admin reviews and approves every draft.

import { FOODS } from './foods-seed.js';

const SPLITS = {
  3: [['Breakfast', 'bf', 0.30], ['Lunch', 'main', 0.40], ['Dinner', 'main', 0.30]],
  4: [['Breakfast', 'bf', 0.25], ['Lunch', 'main', 0.35], ['Snack', 'snack', 0.15], ['Dinner', 'main', 0.25]],
  5: [['Breakfast', 'bf', 0.25], ['Snack 1', 'snack', 0.10], ['Lunch', 'main', 0.30], ['Snack 2', 'snack', 0.10], ['Dinner', 'main', 0.25]],
};

const TEMPLATES = {
  bf: [{ role: 'bfProtein', macro: 'p' }, { role: 'bfCarb', macro: 'c' }, { role: 'fruit', fixedKcal: 70 }],
  main: [{ role: 'mainProtein', macro: 'p' }, { role: 'carb', macro: 'c' }, { role: 'veg', fixed: 180 }, { role: 'fat', macro: 'f' }],
  snack: [{ role: 'snack', macro: 'p' }, { role: 'fruit', fixedKcal: 70 }],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const quant = (item, g) => {
  const step = item.food.step ?? 5;
  return clamp(Math.round(g / step) * step, 0, item.food.max ?? 500);
};

export function filterFoods(foods, prefs = {}) {
  const disliked = new Set(prefs.dislikedIds ?? []);
  const banned = new Set((prefs.allergies ?? []).map((s) => s.toLowerCase()));
  return foods.filter(
    (f) => !disliked.has(f.id) && !f.tags.some((t) => banned.has(t)) && !(prefs.vegetarian && !f.veg),
  );
}

function pick(pool, role, liked, idx, vegetarian = false) {
  const cands = pool.filter(
    (f) =>
      f.roles.includes(role) ||
      (role === 'mainProtein' && f.roles.includes('vegMain') && (vegetarian || liked.has(f.id))),
  );
  if (!cands.length) return null;
  const fav = cands.filter((f) => liked.has(f.id));
  const rest = cands.filter((f) => !liked.has(f.id));
  const list = fav.length >= 3 ? fav : [...fav, ...rest];
  return list[idx % list.length];
}

function solveMeal(items, tgt) {
  for (let it = 0; it < 8; it++) {
    for (const key of ['p', 'c', 'f']) {
      const slot = items.find((s) => s.macro === key);
      if (!slot) continue;
      const per = slot.food[key];
      if (per <= 0.5) continue;
      const others = items.filter((s) => s !== slot).reduce((a, s) => a + (s.food[key] * s.grams) / 100, 0);
      slot.grams = quant(slot, ((tgt[key] - others) / per) * 100);
    }
  }
}

const itemKcal = (i) => (i.food.kcal * i.grams) / 100;
const dayKcal = (meals) => meals.reduce((a, m) => a + m.items.reduce((b, i) => b + itemKcal(i), 0), 0);

function calibrate(meals, targetKcal) {
  for (let k = 0; k < 6; k++) {
    const diff = targetKcal - dayKcal(meals);
    if (Math.abs(diff) <= targetKcal * 0.015) return;
    const carbs = meals.flatMap((m) => m.items).filter((i) => i.macro === 'c' && i.grams > 0);
    if (!carbs.length) return;
    let moved = false;
    for (const it of carbs) {
      const before = it.grams;
      it.grams = quant(it, it.grams + diff / carbs.length / it.food.kcal * 100);
      if (it.grams !== before) moved = true;
    }
    if (!moved) return;
  }
}

function toItem(i) {
  const g = i.grams;
  const o = {
    foodId: i.food.id,
    name: i.food.name,
    grams: g,
    kcal: Math.round((i.food.kcal * g) / 100),
    p: Math.round((i.food.p * g) / 10) / 10,
    c: Math.round((i.food.c * g) / 10) / 10,
    f: Math.round((i.food.f * g) / 10) / 10,
  };
  if (i.food.unit) o.label = `${g / i.food.unit.g} ${i.food.unit.name}${g / i.food.unit.g === 1 ? '' : 's'}`;
  return o;
}

export function itemFor(food, grams) {
  return toItem({ food, grams });
}

export function totalsOf(items) {
  const t = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  return { kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) };
}

/**
 * targets: { kcal, proteinG, carbsG, fatG }
 * prefs: { mealsPerDay, likedIds[], dislikedIds[], allergies[], vegetarian }
 */
export function generatePlan({ targets, prefs = {}, foods = FOODS, days = 7 }) {
  const pool = filterFoods(foods, prefs);
  const liked = new Set(prefs.likedIds ?? []);
  const split = SPLITS[prefs.mealsPerDay ?? 3] ?? SPLITS[3];
  const warnings = new Set();
  const outDays = [];

  for (let d = 0; d < days; d++) {
    const raw = split.map(([name, type, share], mi) => {
      const tgt = { p: targets.proteinG * share, c: targets.carbsG * share, f: targets.fatG * share };
      const items = [];
      TEMPLATES[type].forEach((slot) => {
        const food = pick(pool, slot.role, liked, d + mi + (slot.macro === 'c' ? 2 : 0), Boolean(prefs.vegetarian));
        if (!food) {
          warnings.add(`No allowed food available for ${slot.role}; that slot was left empty.`);
          return;
        }
        const item = { food, macro: slot.macro, grams: slot.fixed ?? 100 };
        if (slot.fixedKcal) item.grams = quant(item, (slot.fixedKcal / food.kcal) * 100);
        items.push(item);
      });
      solveMeal(items, tgt);

      // Boost: top up protein when the main source could not reach the target (common for vegetarian meals).
      const got = items.reduce((a, i) => a + (i.food.p * i.grams) / 100, 0);
      if (tgt.p - got > 8) {
        const boost = pick(pool, 'boost', liked, d);
        if (boost) {
          const it = { food: boost, macro: null, grams: 0 };
          it.grams = quant(it, ((tgt.p - got) / boost.p) * 100);
          if (it.grams > 0) items.push(it);
        }
      }
      return { name, items };
    });

    calibrate(raw, targets.kcal);

    const meals = raw.map((m) => {
      const items = m.items.filter((i) => i.grams > 0).map(toItem);
      return { name: m.name, items, totals: totalsOf(items) };
    });
    const totals = totalsOf(meals.flatMap((m) => m.items));
    if (totals.p < targets.proteinG * 0.9) warnings.add('Protein is more than 10% under target on some days with these food choices.');
    outDays.push({ day: d + 1, meals, totals });
  }

  const avg = (k) => Math.round(outDays.reduce((a, x) => a + x.totals[k], 0) / outDays.length);
  return {
    targets,
    prefs,
    days: outDays,
    summary: { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f') },
    warnings: [...warnings],
  };
}
