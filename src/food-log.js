// Logging food the way people report it: "2 eggs, a loaf of baladi and a Nescafé with 100 ml
// milk and 3 tbsp sugar, for breakfast". Pure helpers used by POST /api/log/foods, which both
// the Add food sheet and the AI coach call, so the server (not the model) does the maths:
//   - which meal the food belongs to ("breakfast", "الغدا", or the meal index)
//   - the amount in grams from whatever unit was said (egg, loaf, slice, tbsp, ml, cup, g)
//   - whether a reported food IS a planned item (mark it eaten / adjusted / swapped) or an extra

import { unitsFor, formatQty, niceCount } from './measures.js';
import { exchangeGroup } from './exchange.js';
import { norm } from './search.js';

// Meal names as people say them, English and Egyptian Arabic, matched against the plan's meal names.
const MEAL_SAYINGS = [
  [/^(breakfast|brekkie|morning|فطار|فطور|الفطار|الفطور)/, /breakfast/i],
  [/^(lunch|غدا|غداء|الغدا|الغداء)/, /lunch/i],
  [/^(dinner|supper|عشا|عشاء|العشا|العشاء)/, /dinner/i],
  [/^(pre ?workout|before (the )?(gym|workout|training)|قبل التمرين)/, /pre-workout/i],
  [/^(post ?workout|after (the )?(gym|workout|training)|بعد التمرين)/, /post-workout/i],
  [/^(night snack|late snack|before bed)/, /night snack/i],
  [/^(snack|سناك|تصبيرة)/, /snack/i],
];

/**
 * Index of the meal a person means, or null. `meal` is a number (index), or words.
 * "snack" picks the first snack that is not a night snack when there are several.
 */
export function mealIndex(meals, meal) {
  if (meal === null || meal === undefined || meal === '') return null;
  if (typeof meal === 'number' || /^\d+$/.test(String(meal))) {
    const i = Number(meal);
    return Number.isInteger(i) && i >= 0 && i < meals.length ? i : null;
  }
  const t = norm(meal).replace(/^(my|the|for|at|in) /, '');
  const exact = meals.findIndex((m) => norm(m.name) === t);
  if (exact >= 0) return exact;
  for (const [say, name] of MEAL_SAYINGS) {
    if (!say.test(t)) continue;
    const i = meals.findIndex((m) => name.test(m.name) && !(name.source === 'snack' && /night/i.test(m.name)));
    if (i >= 0) return i;
    const any = meals.findIndex((m) => name.test(m.name));
    if (any >= 0) return any;
  }
  return null;
}

// Household words that work for any food when it has no measure of its own (grams, as eaten).
const GENERIC = {
  ml: 1, milliliter: 1, millilitre: 1, l: 1000, liter: 1000, litre: 1000,
  tsp: 5, teaspoon: 5, tbsp: 15, tablespoon: 15, spoon: 15,
  cup: 240, glass: 250, mug: 300, kg: 1000,
};
const WORD = { teaspoons: 'teaspoon', tablespoons: 'tablespoon', spoons: 'spoon', cups: 'cup', glasses: 'glass', mugs: 'mug', grams: 'g', gram: 'g', gm: 'g', gms: 'g', gr: 'g', liters: 'liter', litres: 'litre', milliliters: 'milliliter', millilitres: 'millilitre' };

/**
 * One of the food's units for a key ("u", "m0", "dry", "g") or a spoken name ("egg", "loaves",
 * "slice", "tbsp", "ml", "cup"). Falls back to the food's own unit for "piece"/"pcs", and to the
 * generic household amounts above. Returns { key, name, plural, g, grams? } or null.
 */
export function resolveUnit(food, unit) {
  const us = unitsFor(food);
  if (unit === undefined || unit === null || unit === '') return null;
  const raw = norm(unit);
  const byKey = us.find((u) => u.key === unit);
  if (byKey) return byKey;
  const w = WORD[raw] ?? raw;
  if (w === 'g') return us.find((u) => u.key === 'g');
  if (/^(g )?dry$|^dry g$|^raw$/.test(w)) return us.find((u) => u.key === 'dry') ?? us.find((u) => u.key === 'g');
  const named = us.find((u) => !u.grams && (norm(u.name) === w || norm(u.plural) === w || norm(u.name).split(' ').includes(w) || (w.endsWith('s') && norm(u.name) === w.slice(0, -1))));
  if (named) return named;
  if (/^(piece|pieces|pc|pcs|one|serving|servings|portion|portions|unit|units)$/.test(w)) return us.find((u) => !u.grams) ?? null;
  const g = GENERIC[w] ?? GENERIC[w.replace(/s$/, '')];
  if (g) return { key: `x:${w}`, name: w, plural: w, g, generic: true, step: 0.5 };
  return null;
}

/**
 * Grams eaten and how it reads back, from { qty, unit } or { grams }. With nothing given: one of
 * the food's natural unit (a coffee, a slice of pizza), else its usual portion, else 100 g.
 * Throws a plain Error (message for the person) when the unit makes no sense for the food.
 */
export function amountFor(food, { qty, unit, grams } = {}) {
  const q = qty === undefined || qty === null || qty === '' ? null : Number(qty);
  if (q !== null && !(q > 0)) throw new Error(`How much ${food.name.toLowerCase()}? The amount must be more than 0`);
  if (unit) {
    const u = resolveUnit(food, unit);
    if (!u) throw new Error(`"${unit}" is not a measure I know for ${food.name}`);
    const n = q ?? 1;
    const g = Math.round(n * u.g * 10) / 10;
    if (u.generic) {
      const count = Number.isInteger(n * 2) ? niceCount(n) : String(Math.round(n * 10) / 10);
      const plural = n > 1 && !['ml', 'l', 'kg', 'tsp', 'tbsp'].includes(u.name) ? `${u.name}${u.name.endsWith('s') ? 'es' : 's'}` : u.name;
      return { grams: g, amount: `${count} ${plural}` };
    }
    return { grams: g, amount: formatQty(u, n) };
  }
  if (grams !== undefined && grams !== null && grams !== '') {
    const g = Number(grams);
    if (!(g > 0)) throw new Error('The amount must be more than 0 g');
    return { grams: Math.round(g * 10) / 10, amount: null };
  }
  const own = unitsFor(food).find((u) => !u.grams);
  if (q !== null && own) return { grams: Math.round(q * own.g * 10) / 10, amount: formatQty(own, q) };
  if (own) return { grams: own.g, amount: formatQty(own, 1) };
  return { grams: food.portion?.[1] ?? 100, amount: null };
}

/**
 * Could `ate` stand in for the planned food `planned` (a swap rather than an extra)? Same food,
 * or two diet foods of the same kind and exchange group: scrambled eggs for boiled eggs, shami
 * for baladi bread, cheddar for white cheese. Never sweets or off-plan foods, and never across
 * kinds (milk in coffee is not the breakfast's eggs).
 */
// Drinks are logged as themselves, never as a stand-in for a planned food (or the other way round).
const DRINKS = new Set(['milk', 'milk-skim', 'rayeb', 'protein-yogurt-drink', 'orange-juice']);

export function canStandIn(ate, planned, { ateG = null, plannedG = null } = {}) {
  if (!ate || !planned) return false;
  if (ate.id === planned.id) return true;
  if (ate.offplan || planned.offplan) return false;
  if (DRINKS.has(ate.id) || DRINKS.has(planned.id)) return false; // milk in a coffee is not the cheese
  const g = exchangeGroup(ate);
  if (g === 'sweet' || ate.cat !== planned.cat || g !== exchangeGroup(planned)) return false;
  // A real replacement is at least most of the portion: 10 g of cheddar in a sandwich is not the
  // 30 g of white cheese on the plan, but a loaf of bread can be the planned oats (both ~270 kcal),
  // and 4 scrambled eggs are the 2 planned eggs, eaten bigger.
  if (ateG && plannedG) {
    const a = (ate.kcal * ateG) / 100; const b = (planned.kcal * plannedG) / 100;
    if (b > 0 && (a < b * 0.65 || a > b * 3)) return false; // a bigger portion is still that item, eaten bigger
  }
  return true;
}

/**
 * A treat or eating out (pizza, sweets, fried food): the coach asks kindly whether it replaced a
 * meal. Everyday logging-only foods (coffee, tea, juice, sauces, bread) are just logged.
 */
export const EVERYDAY_CATS = new Set(['drinks', 'basics', 'bakery']);
export const isTreat = (food) => Boolean(food?.offplan) && !EVERYDAY_CATS.has(food.cat);
