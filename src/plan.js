// Diet plan generator (v2).
//
// Pipeline:  menu  ->  portions  ->  checks
//   1. MENU: which foods go in each meal. Chosen from real meal TEMPLATES (this file), or
//      proposed by an AI model (src/plan-ai.js) and then validated against the food DB.
//   2. PORTIONS: one bounded least-squares solve over the WHOLE DAY sizes every item so the
//      day hits kcal/protein/carbs/fat, while each meal stays near its calorie share and each
//      item stays inside a realistic [min, max] portion (no more 490 g bulgur or 1 g oil).
//   3. CHECKS: grams snap to serving steps, a discrete pass fixes the rounding error, and the
//      best of several menu attempts is kept. The admin still approves every plan.

import { FOODS } from './foods-seed.js';

// ---------- meal structure ----------
// Plans follow how Egyptian coaches write them: ONE daily plan, meals named around training,
// a few items per meal, exact grams. Variety comes from swapping items (src/exchange.js) or a
// whole meal (mealOptions), not from a different menu every day.
//
// The day follows how people in Egypt eat: breakfast, LUNCH as the one cooked meal of the day
// (where molokhia, mahshi, stews and koshari belong) and a LIGHT dinner (eggs, cheese, ful, a
// tuna or chicken sandwich, yogurt). Evening trainers eat lunch, a small pre-workout snack and a
// post-workout dinner (protein + carbs, not a second cooked dish).
// Each meal: [name, kind, share of daily kcal]. kind selects the template list.
const STRUCTURES = {
  evening: {
    3: [['Breakfast', 'bf', 0.30], ['Lunch', 'lunch', 0.38], ['Post-workout dinner', 'post', 0.32]],
    4: [['Breakfast', 'bf', 0.27], ['Lunch', 'lunch', 0.33], ['Pre-workout snack', 'pre-light', 0.12], ['Post-workout dinner', 'post', 0.28]],
    5: [['Breakfast', 'bf', 0.23], ['Snack', 'snack', 0.10], ['Lunch', 'lunch', 0.30], ['Pre-workout snack', 'pre-light', 0.10], ['Post-workout dinner', 'post', 0.27]],
  },
  morning: {
    3: [['Pre-workout breakfast', 'bf', 0.30], ['Lunch', 'lunch', 0.40], ['Dinner', 'dinner', 0.30]],
    4: [['Pre-workout', 'pre-light', 0.13], ['Post-workout breakfast', 'bf', 0.27], ['Lunch', 'lunch', 0.35], ['Dinner', 'dinner', 0.25]],
    5: [['Pre-workout', 'pre-light', 0.10], ['Post-workout breakfast', 'bf', 0.25], ['Lunch', 'lunch', 0.32], ['Snack', 'snack', 0.11], ['Dinner', 'dinner', 0.22]],
  },
  none: {
    3: [['Breakfast', 'bf', 0.30], ['Lunch', 'lunch', 0.40], ['Dinner', 'dinner', 0.30]],
    4: [['Breakfast', 'bf', 0.27], ['Lunch', 'lunch', 0.36], ['Snack', 'snack', 0.12], ['Dinner', 'dinner', 0.25]],
    5: [['Breakfast', 'bf', 0.23], ['Snack', 'snack', 0.10], ['Lunch', 'lunch', 0.32], ['Snack 2', 'snack', 0.10], ['Dinner', 'dinner', 0.25]],
  },
};
STRUCTURES.afternoon = STRUCTURES.evening;
export const TRAIN_TIMES = ['morning', 'afternoon', 'evening', 'none'];

export function mealStructure(prefs = {}) {
  const t = STRUCTURES[prefs.trainTime] ?? STRUCTURES.evening;
  return t[prefs.mealsPerDay] ?? t[4];
}

// ---------- realistic portions ----------
// [min, typical, max] grams per serving come from the food itself (foods-seed.js `portion`);
// these role defaults cover foods the admin adds without one.
const ROLE_PORTIONS = {
  mainProtein: [120, 160, 250], vegMain: [150, 250, 350], bfProtein: [100, 150, 250],
  carb: [100, 180, 300], bfCarb: [45, 90, 135], veg: [100, 150, 250], fruit: [80, 130, 200],
  fat: [5, 12, 25], snack: [100, 200, 300], boost: [0, 30, 40], dish: [250, 350, 450], side: [200, 250, 350], sweet: [10, 20, 40],
};
const CAT_ROLE = { protein: 'mainProtein', dairy: 'snack', carb: 'carb', fruit: 'fruit', veg: 'veg', fat: 'fat', legume: 'vegMain', dish: 'dish', sweet: 'sweet', snack: 'snack' };

const HALF_UNITS = new Set(['loaf', 'bowl', 'cup']);

/** Portion bounds for a food. */
export function portionOf(food, role) {
  const base = food.portion ?? ROLE_PORTIONS[role] ?? ROLE_PORTIONS[food.roles?.[0]] ?? ROLE_PORTIONS[CAT_ROLE[food.cat]] ?? [50, 100, 200];
  const cap = food.max ?? 500;
  // Countable foods come in whole units ("2 eggs", "1 banana", "3 taameya"), never "2½ pieces".
  // Bread and bowls may be halved ("½ loaf", "1½ bowls").
  if (food.unit?.g) {
    const u = food.unit.g;
    const step = HALF_UNITS.has(food.unit.name) ? u / 2 : u;
    const up = (g) => Math.max(step, Math.round(g / step) * step);
    const max = Math.max(step, Math.floor(Math.min(base[2], cap) / step) * step);
    const min = Math.min(up(base[0]), max);
    const typ = Math.min(Math.max(up(base[1]), min), max);
    return { min, typ, max, step };
  }
  const step = food.step ?? 5;
  const max = Math.min(base[2], cap);
  const min = Math.min(base[0], max);
  const typ = Math.min(Math.max(base[1], min), max);
  return { min, typ, max, step };
}

// ---------- meal templates (how people in Egypt actually eat, coach-style) ----------
// A slot is { role } (any allowed food with that role) or { ids: [...] } (first allowed of
// these, rotated). `optional` slots are skipped when nothing fits and may be sized to 0.
// Day-level tags keep a day sensible:
//   base     the meal's staple (rice, bread, pasta, potato...): lunch and dinner use different ones
//   protein  the main protein family: chicken at lunch means fish, meat, eggs or cheese at dinner
//   cooked   a cooked Egyptian dish (molokhia, mahshi, a stew, koshari): at most one per day
const LEAN = ['chicken-breast', 'turkey-breast', 'tilapia', 'tuna-canned', 'sea-bream', 'shrimp', 'beef-steak'];
const RICE = ['white-rice', 'basmati', 'vermicelli-rice', 'brown-rice'];
const TEMPLATES = {
  bf: [
    { name: 'Eggs, toast and cheese', base: 'bread', protein: 'egg', slots: [{ ids: ['eggs', 'omelette'] }, { ids: ['toast-brown', 'baladi-bread', 'tortilla-ww', 'rice-cakes'] }, { ids: ['white-cheese-light', 'areesh', 'cottage-cheese', 'smoked-turkey'] }, { ids: ['cucumber', 'tomato', 'salata-baladi'] }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Ful, eggs and baladi', base: 'bread', protein: 'legume', slots: [{ ids: ['ful-medames'] }, { ids: ['eggs', 'egg-whites'] }, { ids: ['baladi-bread', 'toast-brown', 'rice-cakes'] }, { ids: ['salata-baladi', 'tomato', 'cucumber'] }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Egg and turkey wrap', base: 'wrap', protein: 'egg', slots: [{ ids: ['tortilla', 'tortilla-ww'] }, { ids: ['eggs', 'omelette'] }, { ids: ['smoked-turkey'] }, { ids: ['tomato', 'bell-pepper', 'salad-greens'] }] },
    { name: 'Areesh and toast', base: 'bread', protein: 'dairy', slots: [{ ids: ['areesh', 'cottage-cheese'] }, { ids: ['toast-brown', 'baladi-bread'] }, { ids: ['eggs', 'egg-whites'], optional: true }, { ids: ['tomato', 'cucumber'] }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Oats and Greek yogurt', base: 'oats', protein: 'dairy', slots: [{ ids: ['oats'] }, { ids: ['greek-yogurt', 'greek-yogurt-2', 'milk-skim'] }, { ids: ['whey'], optional: true }, { ids: ['banana', 'strawberries', 'dates', 'mango'] }] },
    { name: 'Eggs and potatoes', base: 'potato', protein: 'egg', slots: [{ ids: ['eggs', 'omelette'] }, { ids: ['potato', 'sweet-potato', 'potato-baked'] }, { ids: ['tomato', 'bell-pepper', 'salata-baladi'] }, { ids: ['avocado', 'olive-oil'], optional: true }] },
    { name: 'Taameya and eggs', base: 'bread', protein: 'legume', slots: [{ ids: ['taameya'] }, { ids: ['baladi-bread'] }, { ids: ['eggs', 'egg-whites'], optional: true }, { ids: ['salata-baladi', 'tomato'] }] },
  ],
  'pre-light': [
    { name: 'Dates and yogurt', slots: [{ ids: ['dates', 'banana'] }, { ids: ['greek-yogurt', 'plain-yogurt'] }] },
    { name: 'Toast and honey', slots: [{ ids: ['toast-brown', 'toast-white'] }, { ids: ['honey', 'jam'] }, { ids: ['egg-whites'], optional: true }] },
    { name: 'Banana and peanut butter', slots: [{ ids: ['banana'] }, { ids: ['rice-cakes', 'toast-brown'] }, { ids: ['peanut-butter', 'tahini'] }] },
  ],
  // Lunch: the cooked meal of the day. Egyptian home dishes live here, each a complete plate.
  lunch: [
    { name: 'Grilled chicken, rice and salad', base: 'rice', protein: 'chicken', slots: [{ ids: ['chicken-breast', 'chicken-thigh', 'shish-tawook', 'turkey-breast'] }, { ids: RICE }, { role: 'veg' }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Molokhia with chicken and rice', base: 'rice', protein: 'chicken', cooked: true, slots: [{ ids: ['molokhia'] }, { ids: ['chicken-breast', 'chicken-thigh'] }, { ids: ['white-rice', 'vermicelli-rice'] }] },
    { name: 'Mahshi with grilled chicken', base: 'mahshi', protein: 'chicken', cooked: true, slots: [{ ids: ['mahshi'] }, { ids: ['chicken-breast', 'chicken-thigh', 'kofta', 'turkey-breast'] }, { ids: ['salata-baladi', 'plain-yogurt'] }] },
    { name: 'Fish, rice and salad', base: 'rice', protein: 'fish', slots: [{ ids: ['tilapia', 'sea-bream', 'mackerel', 'shrimp'] }, { ids: ['white-rice', 'basmati'] }, { ids: ['salata-baladi'] }, { ids: ['tahini-salad'], optional: true }] },
    { name: 'Kofta with potatoes and salad', base: 'potato', protein: 'meat', slots: [{ ids: ['kofta', 'beef-steak', 'beef-lean'] }, { ids: ['potato-baked', 'potato', 'sweet-potato'] }, { ids: ['salata-baladi', 'tomato'] }, { ids: ['tahini-salad'], optional: true }] },
    { name: 'Green beans stew with meat and rice', base: 'rice', protein: 'meat', cooked: true, slots: [{ ids: ['green-beans-stew'] }, { ids: ['beef-lean', 'chicken-breast'] }, { ids: ['white-rice', 'vermicelli-rice'] }] },
    { name: 'Peas and carrots with chicken and rice', base: 'rice', protein: 'chicken', cooked: true, slots: [{ ids: ['peas-stew'] }, { ids: ['chicken-breast', 'chicken-thigh'] }, { ids: ['white-rice', 'vermicelli-rice'] }] },
    { name: 'Okra with meat and rice', base: 'rice', protein: 'meat', cooked: true, slots: [{ ids: ['okra-stew'] }, { ids: ['beef-lean', 'chicken-breast'] }, { ids: ['white-rice', 'vermicelli-rice'] }] },
    { name: 'Chicken pasta', base: 'pasta', protein: 'chicken', slots: [{ ids: ['chicken-breast', 'shrimp', 'tuna-canned'] }, { ids: ['pasta', 'pasta-ww'] }, { ids: ['tomato', 'bell-pepper', 'mushrooms'] }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Koshari with yogurt', base: 'koshari', protein: 'dairy', cooked: true, veg: true, slots: [{ ids: ['koshari'] }, { ids: ['greek-yogurt', 'greek-yogurt-2', 'plain-yogurt'] }, { ids: ['salata-baladi'] }] },
    { name: 'Lentil soup and bread', veg: true, fallback: true, base: 'bread', protein: 'legume', slots: [{ ids: ['lentil-soup', 'lentils'] }, { ids: ['baladi-bread', 'toast-brown'] }, { ids: ['salata-baladi'] }, { ids: ['eggs', 'greek-yogurt', 'tofu'], optional: true }] },
    { name: 'Chickpeas, rice and vegetables', veg: true, fallback: true, base: 'rice', protein: 'legume', slots: [{ ids: ['chickpeas'] }, { ids: ['white-rice', 'bulgur'] }, { ids: ['zucchini', 'carrot', 'broccoli'] }, { ids: ['greek-yogurt', 'egg-whites', 'tofu'], optional: true }, { ids: ['tahini', 'olive-oil'], optional: true }] },
  ],
  // Dinner: light, the Egyptian "عشا خفيف". No cooked dishes, no second plate of rice.
  dinner: [
    { name: 'Grilled chicken, potatoes and salad', base: 'potato', protein: 'chicken', slots: [{ ids: ['chicken-breast', 'chicken-thigh', 'shish-tawook', 'turkey-breast'] }, { ids: ['potato', 'potato-baked', 'sweet-potato'] }, { ids: ['salad-greens', 'salata-baladi', 'cucumber'] }] },
    { name: 'Kofta sandwich and salad', base: 'bread', protein: 'meat', slots: [{ ids: ['kofta', 'beef-steak', 'beef-lean'] }, { ids: ['baladi-bread', 'shami-bread', 'tortilla'] }, { ids: ['salata-baladi', 'tomato'] }, { ids: ['tahini-salad'], optional: true }] },
    { name: 'Grilled fish, salad and baladi', base: 'bread', protein: 'fish', slots: [{ ids: ['tilapia', 'sea-bream', 'mackerel', 'shrimp'] }, { ids: ['baladi-bread', 'toast-brown'] }, { ids: ['salata-baladi', 'salad-greens'] }, { ids: ['tahini-salad'], optional: true }] },
    { name: 'Tuna sandwich and salad', base: 'bread', protein: 'fish', slots: [{ ids: ['tuna-canned', 'tuna-oil'] }, { ids: ['baladi-bread', 'toast-brown', 'tortilla'] }, { ids: ['salad-greens', 'tomato', 'cucumber'] }] },
    { name: 'Eggs, cheese and baladi', veg: true, base: 'bread', protein: 'egg', slots: [{ ids: ['eggs', 'omelette'] }, { ids: ['white-cheese-light', 'areesh', 'cottage-cheese'] }, { ids: ['baladi-bread', 'toast-brown'] }, { ids: ['cucumber', 'tomato'] }] },
    { name: 'Chicken wrap', base: 'wrap', protein: 'chicken', slots: [{ ids: ['chicken-breast', 'shish-tawook', 'turkey-breast'] }, { ids: ['tortilla-ww', 'tortilla', 'baladi-bread'] }, { ids: ['salad-greens', 'tomato', 'cucumber'] }, { ids: ['tahini-salad'], optional: true }] },
    { name: 'Greek yogurt, oats and fruit', veg: true, base: 'oats', protein: 'dairy', slots: [{ ids: ['greek-yogurt', 'greek-yogurt-2'] }, { ids: ['oats', 'granola'] }, { ids: ['banana', 'strawberries', 'apple', 'mango'] }, { ids: ['peanuts', 'almonds', 'walnuts'], optional: true }] },
    { name: 'Areesh salad and toast', veg: true, base: 'bread', protein: 'dairy', slots: [{ ids: ['areesh', 'cottage-cheese'] }, { ids: ['toast-brown', 'baladi-bread'] }, { ids: ['tomato', 'cucumber', 'bell-pepper'] }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Turkey and cheese sandwich', base: 'bread', protein: 'deli', slots: [{ ids: ['smoked-turkey'] }, { ids: ['toast-brown', 'fino'] }, { ids: ['white-cheese-light', 'mozzarella'] }, { ids: ['tomato', 'salad-greens'] }] },
    { name: 'Ful sandwich and eggs', veg: true, base: 'bread', protein: 'legume', slots: [{ ids: ['ful-medames'] }, { ids: ['baladi-bread'] }, { ids: ['eggs', 'egg-whites'], optional: true }, { ids: ['salata-baladi', 'tomato'] }] },
    { name: 'Lentil soup and toast', veg: true, fallback: true, base: 'bread', protein: 'legume', slots: [{ ids: ['lentil-soup'] }, { ids: ['toast-brown', 'baladi-bread'] }, { ids: ['salad-greens', 'salata-baladi'] }, { ids: ['eggs', 'greek-yogurt', 'tofu'], optional: true }] },
  ],
  // After an evening workout: protein + carbs, home-style, never a second cooked dish.
  post: [
    { name: 'Chicken, potatoes and salad', base: 'potato', protein: 'chicken', slots: [{ ids: ['chicken-breast', 'chicken-thigh', 'turkey-breast'] }, { ids: ['potato', 'sweet-potato', 'potato-baked'] }, { role: 'veg' }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Fish and rice', base: 'rice', protein: 'fish', slots: [{ ids: ['tilapia', 'sea-bream', 'salmon', 'shrimp'] }, { ids: ['white-rice', 'basmati', 'brown-rice'] }, { ids: ['salata-baladi', 'salad-greens'] }, { ids: ['tahini-salad', 'olive-oil'], optional: true }] },
    { name: 'Meat and potatoes', base: 'potato', protein: 'meat', slots: [{ ids: ['beef-steak', 'beef-lean', 'kofta', 'minced-beef'] }, { ids: ['potato', 'potato-baked', 'sweet-potato'] }, { role: 'veg' }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Chicken wrap', base: 'wrap', protein: 'chicken', slots: [{ ids: ['chicken-breast', 'shish-tawook', 'turkey-breast'] }, { ids: ['tortilla-ww', 'tortilla', 'baladi-bread'] }, { ids: ['salad-greens', 'tomato', 'cucumber'] }, { ids: ['banana', 'dates'], optional: true }] },
    { name: 'Tuna pasta', base: 'pasta', protein: 'fish', slots: [{ ids: ['tuna-canned', 'chicken-breast', 'shrimp'] }, { ids: ['pasta', 'pasta-ww'] }, { ids: ['tomato', 'bell-pepper'] }, { ids: ['olive-oil'], optional: true }] },
    { name: 'Eggs, toast and fruit', veg: true, base: 'bread', protein: 'egg', slots: [{ ids: ['eggs', 'omelette'] }, { ids: ['toast-brown', 'baladi-bread'] }, { ids: ['egg-whites', 'white-cheese-light', 'areesh'], optional: true }, { ids: ['banana', 'dates', 'orange'] }] },
  ],
  snack: [
    { name: 'Greek yogurt, fruit and nuts', slots: [{ ids: ['greek-yogurt', 'greek-yogurt-2', 'plain-yogurt'] }, { role: 'fruit' }, { ids: ['peanuts', 'almonds', 'walnuts'], optional: true }] },
    { name: 'Lupini and fruit', slots: [{ ids: ['lupini'] }, { ids: ['orange', 'apple', 'guava'] }] },
    { name: 'Protein shake', slots: [{ ids: ['whey'] }, { ids: ['milk-skim', 'milk'] }, { ids: ['banana', 'dates'] }] },
    { name: 'Areesh and cucumber', slots: [{ ids: ['areesh', 'cottage-cheese'] }, { ids: ['cucumber', 'tomato'] }, { ids: ['rice-cakes', 'toast-brown'], optional: true }] },
    { name: 'Rice cakes and peanut butter', slots: [{ ids: ['rice-cakes'] }, { ids: ['peanut-butter', 'tahini'] }, { ids: ['banana', 'apple'], optional: true }] },
  ],
};
// Old plans and AI menus name meals but carry no kind: map the name back to its template list.
export function kindOf(meal) {
  if (meal?.kind && TEMPLATES[meal.kind]) return meal.kind;
  const n = String(meal?.name ?? '').toLowerCase();
  if (n.includes('breakfast')) return 'bf';
  if (n.includes('lunch')) return 'lunch';
  if (n.includes('post-workout')) return 'post';
  if (n.includes('pre-workout') && n.includes('snack')) return 'pre-light';
  if (n === 'pre-workout') return meal?.totals?.kcal > 450 ? 'lunch' : 'pre-light';
  if (n.includes('dinner')) return 'dinner';
  return 'snack';
}

// A meal's title describes what is actually in it. The template's name is kept only when its
// first slot got its first choice (e.g. "Tuna pasta" really has tuna); otherwise it is built from
// the two main items ("Chicken breast with pasta").
// Everyday names for titles: "Grilled chicken with potatoes", not "Chicken breast, grilled with potato, boiled".
const SHORT = {
  'chicken-breast': 'Grilled chicken', 'chicken-thigh': 'Chicken thighs', 'beef-lean': 'Beef', 'tuna-canned': 'Tuna', 'tuna-oil': 'Tuna',
  'white-rice': 'Rice', basmati: 'Basmati rice', 'vermicelli-rice': 'Rice with vermicelli', potato: 'Potatoes', 'potato-baked': 'Oven potatoes',
  'baladi-bread': 'Baladi bread', 'toast-brown': 'Brown toast', tilapia: 'Grilled bolti', 'sea-bream': 'Grilled denis', omelette: 'Omelette',
  'white-cheese-light': 'Light white cheese', 'greek-yogurt': 'Greek yogurt', 'smoked-turkey': 'Smoked turkey', 'tortilla-ww': 'Tortilla',
};
const short = (f) => SHORT[f.id] ?? f.name.split(/[,(]/)[0].trim();
export function mealTitle(tpl, items) {
  const byId = new Set(items.map((i) => i.food.id));
  const canonical = tpl.slots.filter((sl) => !sl.optional).every((sl) => sl.ids && byId.has(sl.ids[0]));
  if (canonical) return tpl.name;
  const main = items.filter((i) => !['veg', 'fat'].includes(i.food.cat)).slice(0, 2).map((i) => i.food);
  if (main.length < 2) return tpl.name;
  return `${short(main[0])} with ${short(main[1]).toLowerCase()}`;
}

// ---------- food filtering ----------
export function filterFoods(foods, prefs = {}) {
  const disliked = new Set(prefs.dislikedIds ?? []);
  // Supplements are only planned for people who said they have them (nobody should have to buy
  // whey to follow the plan). They can still log it if they take it.
  if (prefs.hasWhey !== true && !(prefs.likedIds ?? []).includes('whey')) disliked.add('whey');
  const banned = new Set((prefs.allergies ?? []).map((s) => s.toLowerCase()));
  // A tight budget leaves out the expensive foods (salmon, shrimp, steak, avocado, nuts...).
  if (prefs.budget === 'low') banned.add('pricey');
  return foods.filter(
    (f) => !disliked.has(f.id) && !f.tags.some((t) => banned.has(t)) && !(prefs.vegetarian && !f.veg),
  );
}

// Deterministic PRNG so the same inputs give the same plan (tests, re-runs), but `seed` varies it.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
}

// Staples that are fine twice a day (bread at breakfast and dinner, salad with both meals).
const NO_REPEAT_LIMIT = new Set(['veg']);

// Pick a food for a slot. Liked foods first; rotation index gives day-to-day variety.
function fillSlot(slot, poolById, pool, liked, rot, vegetarian, dayUsed = new Set()) {
  let cands;
  if (slot.ids) cands = slot.ids.map((id) => poolById.get(id)).filter(Boolean);
  else {
    cands = pool.filter((f) => f.roles.includes(slot.role));
    // Vegetarians (or people who like a veg main) can use vegMain foods as the main protein.
    if (slot.role === 'mainProtein') {
      const vegMains = pool.filter((f) => f.roles.includes('vegMain') && (vegetarian || liked.has(f.id)));
      cands = vegetarian ? vegMains.concat(cands) : cands.concat(vegMains);
    }
  }
  if (!cands.length) return null;
  // A food already served earlier today goes to the back (no eggs at breakfast AND dinner);
  // an optional slot simply skips it.
  const fresh = cands.filter((f) => !dayUsed.has(f.id));
  if (slot.optional && !fresh.length && !NO_REPEAT_LIMIT.has(cands[0].cat)) return null;
  if (fresh.length) cands = fresh.concat(cands.filter((f) => dayUsed.has(f.id)));
  // Listed foods are in order of preference: the first one the person eats wins (ful comes with
  // baladi; rice cakes only when bread is excluded). Liked foods still jump the queue.
  if (slot.ids) return cands.find((f) => liked.has(f.id)) ?? cands[0];
  const fav = cands.filter((f) => liked.has(f.id));
  const list = fav.length ? fav.concat(cands.filter((f) => !liked.has(f.id)).slice(0, fav.length >= 2 ? 0 : 2)) : cands;
  return list[rot % list.length];
}

// Big eaters (3,000+ kcal) need bigger servings than the standard ones, or no plan can reach
// their target. Max and typical portions grow with the target, up to 1.5x.
function scaled(p, k = 1) {
  if (k <= 1 || p.noScale) return p;
  const r = (g) => Math.round(g / p.step) * p.step;
  return { ...p, max: r(p.max * k), typ: r(p.typ * Math.min(k, 1.25)) };
}

/** Build one meal's items from a template, or null if a required slot cannot be filled. */
function buildMeal(tpl, ctx, rot, dayUsed = new Set(), reuse = null) {
  const items = [];
  const used = new Set();
  for (const [i, slot] of tpl.slots.entries()) {
    // Lunch's chicken / meat / fish is the first choice for the same slot at dinner (same pot).
    const again = reuse && slot.ids ? slot.ids.find((id) => reuse.has(id) && ctx.poolById.has(id) && !used.has(id)) : null;
    const food = again ? ctx.poolById.get(again) : fillSlot(slot, ctx.poolById, ctx.pool, ctx.liked, rot + i, ctx.vegetarian, dayUsed);
    if (!food || used.has(food.id)) {
      if (slot.optional) continue;
      return null;
    }
    used.add(food.id);
    const role = slot.role ?? food.roles[0];
    const p = scaled({ ...portionOf(food, role), noScale: food.cat === 'fruit' || food.cat === 'fat' }, ctx.scale);
    // Small eaters (under ~1,800 kcal, often on 4-5 meals) may go below the standard minimum
    // serving, down to 60% of it, never below one unit or step (1 egg, ½ loaf, 10 g).
    const base = p.min || Math.round(p.typ / 2 / p.step) * p.step;
    const min = slot.optional ? 0 : ctx.small < 1 ? Math.max(p.step, Math.round((base * Math.max(0.6, ctx.small)) / p.step) * p.step) : base;
    items.push({ food, ...p, min, grams: p.typ });
  }
  return items;
}

// ---------- portion solver ----------
const MACROS = ['kcal', 'p', 'c', 'f'];
const W = { kcal: 4, p: 3, c: 0.8, f: 1.2 };       // relative importance of each daily target
const W_MEAL = 0.6;                                  // keep each meal near its kcal share
const W_TYP = 0.05;                                  // gentle pull toward typical portions
const per = (food, m) => (m === 'kcal' ? food.kcal : food[m]) / 100;

/**
 * Size every item of a day so totals hit the targets.
 * Objective (all terms normalised, so units don't matter):
 *   sum_m W_m ((A x)_m - T_m)^2 / T_m^2
 * + W_MEAL sum_meals (kcal_meal - share*T_kcal)^2 / T_kcal^2
 * + W_TYP  sum_i ((x_i - typ_i) / range_i)^2
 * subject to min_i <= x_i <= max_i. Convex quadratic with box constraints, solved by
 * projected coordinate descent (exact 1-D minimiser per item, then clamp).
 */
export function solveDay(meals, targets, shares) {
  const T = { kcal: targets.kcal, p: targets.proteinG, c: targets.carbsG, f: targets.fatG };
  const items = meals.flatMap((m, mi) => m.items.map((it) => ((it.meal = mi), it)));
  const total = (m) => items.reduce((a, it) => a + per(it.food, m) * it.grams, 0);
  const mealKcal = (mi) => items.reduce((a, it) => a + (it.meal === mi ? per(it.food, 'kcal') * it.grams : 0), 0);

  for (let sweep = 0; sweep < 60; sweep++) {
    let moved = 0;
    for (const it of items) {
      // Quadratic in x = it.grams: a x^2 + b x + const. Collect a and b from every term.
      let a = 0, b = 0;
      for (const m of MACROS) {
        const k = per(it.food, m), rest = total(m) - k * it.grams;
        a += W[m] * k * k / (T[m] * T[m]);
        b += 2 * W[m] * k * (rest - T[m]) / (T[m] * T[m]);
      }
      const kk = per(it.food, 'kcal'), restMeal = mealKcal(it.meal) - kk * it.grams, goal = shares[it.meal] * T.kcal;
      a += W_MEAL * kk * kk / (T.kcal * T.kcal);
      b += 2 * W_MEAL * kk * (restMeal - goal) / (T.kcal * T.kcal);
      const range = Math.max(it.max - it.min, 1);
      a += W_TYP / (range * range);
      b += -2 * W_TYP * it.typ / (range * range);
      const x = Math.min(it.max, Math.max(it.min, -b / (2 * a)));
      moved += Math.abs(x - it.grams);
      it.grams = x;
    }
    if (moved < 0.5) break;
  }

  // Snap to serving steps, then a greedy discrete pass: try +/- one step on any item while it
  // lowers the error. Fixes the drift that rounding introduces.
  const snap = (it, g) => Math.min(it.max, Math.max(it.min, Math.round(g / it.step) * it.step));
  for (const it of items) it.grams = snap(it, it.grams);
  const err = () => {
    let e = 0;
    for (const m of MACROS) e += W[m] * ((total(m) - T[m]) / T[m]) ** 2;
    meals.forEach((_, mi) => { e += W_MEAL * ((mealKcal(mi) - shares[mi] * T.kcal) / T.kcal) ** 2; });
    return e;
  };
  // Optional top-ups that ended up tiny (e.g. "whey 5 g") are dropped and the day re-solved.
  const tiny = items.filter((it) => it.min === 0 && it.grams > 0 && it.grams < it.typ / 2);
  if (tiny.length) {
    for (const it of tiny) { it.max = 0; it.grams = 0; }
    return solveDay(meals, targets, shares);
  }
  let best = err();
  for (let pass = 0; pass < 30; pass++) {
    let improved = false;
    for (const it of items) for (const d of [it.step, -it.step]) {
      const g = it.grams + d;
      if (g < it.min || g > it.max || (it.min === 0 && g < it.typ / 2)) continue; // no token top-ups
      const old = it.grams; it.grams = g;
      const e = err();
      if (e < best - 1e-9) { best = e; improved = true; } else it.grams = old;
    }
    if (!improved) break;
  }
  return best;
}

// ---------- output helpers ----------
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
  if (i.food.unit) {
    const n = g / i.food.unit.g;
    o.label = `${n} ${i.food.unit.name}${n === 1 ? '' : 's'}`;
  }
  return o;
}

export function itemFor(food, grams) {
  return toItem({ food, grams });
}

export function totalsOf(items) {
  const t = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  return { kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) };
}

/** Turn solved meals into the stored plan-day shape. */
export function finishDay(dayNo, meals) {
  const out = meals.map((m) => {
    const items = m.items.filter((i) => i.grams > 0).map(toItem);
    return { name: m.name, ...(m.kind ? { kind: m.kind } : {}), ...(m.tpl ? { tpl: m.tpl } : {}), title: m.title, items, totals: totalsOf(items) };
  });
  return { day: dayNo, meals: out, totals: totalsOf(out.flatMap((m) => m.items)) };
}

/** Context shared by the template and AI paths. */
export function planContext({ prefs = {}, foods = FOODS }) {
  // Foods with no meal roles (fried eggs, cheddar, pears...) are for logging and swaps only:
  // the plan generator, AI menus and "Change meal" never build a meal from them.
  const pool = filterFoods(foods, prefs).filter((f) => f.roles.length);
  return {
    pool,
    poolById: new Map(pool.map((f) => [f.id, f])),
    liked: new Set(prefs.likedIds ?? []),
    vegetarian: Boolean(prefs.vegetarian),
    split: mealStructure(prefs),
    scale: 1,
    small: 1,
  };
}

// Kinds whose meals are a savoury plate (protein + staple): vegetarians get the veg templates.
const SAVOURY = new Set(['lunch', 'dinner', 'post']);

/**
 * Templates for a meal kind in preference order for this person.
 * Vegetarians: only vegetarian templates (the veg lunches as a fallback for dinner/post).
 * Meat eaters: everything except `fallback` templates first (lentil soup only when nothing else fits).
 * Returns { list, span }: the first `span` entries are the normal rotation, the rest fallbacks.
 */
function templatesFor(kind, ctx) {
  const savoury = SAVOURY.has(kind);
  const own = TEMPLATES[kind].filter((t) => !ctx.vegetarian || t.veg || !savoury);
  const extra = kind === 'post' ? TEMPLATES.lunch.filter((t) => t.veg && !t.cooked && !own.includes(t)) : [];
  if (ctx.vegetarian || !savoury) return { list: [...own, ...extra], span: own.length || extra.length };
  const normal = own.filter((t) => !t.fallback);
  return { list: [...normal, ...own.filter((t) => t.fallback), ...extra], span: normal.length || own.length };
}

/**
 * How well a template fits the rest of the day: lower is better.
 *   a second cooked dish in one day is ruled out (Infinity)
 *   the same staple (rice at lunch AND dinner) or protein family costs 1 each
 */
function dayPenalty(tpl, day, kind = 'lunch') {
  if (tpl.cooked && day.cooked) return Infinity;
  // Cook once, eat twice: at home the protein cooked for lunch is what dinner is made of too
  // (grilled chicken with rice at lunch -> chicken with potatoes or a chicken wrap at dinner).
  // Dietitians write it the same way. A different protein at dinner costs 1; a different staple is
  // preferred (rice at lunch, potatoes or bread at dinner).
  const otherProtein = SAVOURY.has(kind) && day.mainProtein && tpl.protein && tpl.protein !== day.mainProtein ? 1 : 0;
  return (tpl.base && day.bases.has(tpl.base) ? 1 : 0) + otherProtein;
}
// Foods that count as "the same thing again" in one day: eggs and an omelette, two yogurts.
const FAMILY = { omelette: 'eggs', 'egg-whites': 'eggs', 'greek-yogurt-2': 'greek-yogurt', 'plain-yogurt': 'greek-yogurt', 'cottage-cheese': 'areesh', 'tuna-oil': 'tuna-canned', 'white-cheese-light': 'white-cheese', 'milk-skim': 'milk' };
const family = (id) => FAMILY[id] ?? id;
const newDayState = () => ({ cooked: false, bases: new Set(), mainProtein: null, reuse: new Set(), foods: new Set() });
function markDay(day, tpl, items, kind = 'lunch') {
  if (tpl.cooked) day.cooked = true;
  // Staple and protein variety matter between the main meals; bread at breakfast AND dinner is normal.
  if (tpl.base && (SAVOURY.has(kind) || tpl.base !== 'bread')) day.bases.add(tpl.base);
  // The first main meal (lunch) sets the day's protein; its meat, chicken or fish may come back at dinner.
  if (SAVOURY.has(kind) && !day.mainProtein && tpl.protein) {
    day.mainProtein = tpl.protein;
    for (const it of items) if (it.food.roles.includes('mainProtein')) day.reuse.add(it.food.id);
  }
  for (const it of items) if (it.food.cat !== 'fat') day.foods.add(it.food.id);
}

/** Build a day from templates: try several template combinations, keep the best-fitting one. */
function templateDay(ctx, targets, d, rand, warnings, seed = 0) {
  const shares = ctx.split.map((s) => s[2]);
  let best = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const meals = [];
    let ok = true;
    const perDay = {};
    for (const [, kind] of ctx.split) perDay[kind] = (perDay[kind] ?? 0) + 1;
    const seen = {};
    const usedTpl = new Set(); // never serve the same meal twice in one day
    const day = newDayState();
    // Lunch is planned first: it is the day's main cooked meal, and dinner adapts to it.
    const order = [...ctx.split.keys()].sort((a, b) => Number(ctx.split[b][1] === 'lunch') - Number(ctx.split[a][1] === 'lunch'));
    const out = [];
    let pen = 0; // how far the day strays from the variety rules (repeated staple / protein)
    for (const mi of order) {
      const [name, kind] = ctx.split[mi];
      const nth = (seen[kind] = (seen[kind] ?? -1) + 1);
      const { list, span } = templatesFor(kind, ctx);
      // The seed picks the starting template (a regenerate gives a different plan); meals of the
      // same kind start one apart; retries start at random.
      const start = attempt === 0 ? (seed + d * perDay[kind] + nth) % span : Math.floor(rand() * span);
      const rotation = [...Array(span).keys()].map((k) => list[(start + k) % span]).concat(list.slice(span));
      // Stable sort by how well each template fits the day so far (no second cooked dish,
      // a different staple and protein from lunch), rotation order breaks ties.
      const likes = (t) => t.slots.some((sl) => sl.ids?.some((id) => ctx.liked.has(id) && ctx.poolById.has(id)));
      const ranked = rotation.map((t, i) => [t, dayPenalty(t, day, kind) + (t.fallback && !ctx.vegetarian ? 5 : 0) - (likes(t) ? 0.5 : 0), i]).filter(([, p]) => p !== Infinity)
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([t]) => t);
      // A meal that would serve a main food again (ful at breakfast AND dinner) is kept only as a
      // last resort; the first meal without repeats wins.
      let items = null, tpl = null, spare = null;
      for (let k = 0; k < ranked.length && !items; k++) {
        tpl = ranked[k];
        if (usedTpl.has(tpl) && k < ranked.length - 1) continue;
        const savoury = SAVOURY.has(kind);
        const got = buildMeal(tpl, ctx, d + mi + attempt, day.foods, savoury && tpl.protein === day.mainProtein ? day.reuse : null);
        if (!got) continue;
        const fams = new Set([...day.foods].map(family));
        const again = (it) => fams.has(family(it.food.id)) && !['veg', 'fat', 'carb'].includes(it.food.cat) && !(savoury && day.reuse.has(it.food.id));
        if (got.some(again)) { spare ??= [tpl, got]; continue; }
        items = got;
      }
      if (!items && spare) [tpl, items] = spare;
      if (!items) { ok = false; warnings.add(`No allowed foods for a ${name.toLowerCase()}; check the dislikes and allergies.`); break; }
      usedTpl.add(tpl);
      pen += dayPenalty(tpl, day, kind);
      markDay(day, tpl, items, kind);
      out[mi] = { name, kind, title: mealTitle(tpl, items), tpl: tpl.name, items };
    }
    if (!ok) continue;
    meals.push(...out);
    // Fit to the numbers first; each broken variety rule costs about as much as 1.5% error.
    const e = solveDay(meals, targets, shares) + pen * 0.002;
    if (!best || e < best.e) best = { e, meals };
    if (e < 0.004) break; // good enough: about 3% overall error and no repeats
  }
  return best?.meals ?? null;
}

/**
 * Whole-meal alternatives ("change this meal"): other meals of the same kind that fit the rest
 * of the day, each sized to the SAME calories and macros as the current meal so the day's
 * numbers do not move. Swapping mahshi + chicken gives other complete lunches (grilled chicken
 * and rice, molokhia, fish...), never a lone dish from another cuisine.
 *   meal       the current meal { name, kind?, title, items: [{ foodId, grams }] }
 *   others     the day's other meals (same shape), used for the no-repeat and one-cooked-dish rules
 *   prefs      the person's food preferences (allergies, dislikes, vegetarian...)
 * Returns [{ key, title, kind, items: [{ food, grams }], kcal, p, c, f, error }] best first.
 */
export function mealOptions({ meal, others = [], prefs = {}, foods = FOODS, targets = null, limit = 8 }) {
  const ctx = planContext({ prefs, foods });
  const byId = new Map(foods.map((f) => [f.id, f]));
  const kind = kindOf(meal);
  const cur = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const it of meal.items) {
    const f = byId.get(it.foodId); if (!f) continue;
    for (const k of ['kcal', 'p', 'c', 'f']) cur[k] += ((k === 'kcal' ? f.kcal : f[k]) * it.grams) / 100;
  }
  if (cur.kcal < 50) return [];
  ctx.scale = Math.min(1.5, Math.max(1, (targets?.kcal ?? cur.kcal * 3.5) / 2400));
  ctx.small = Math.min(1, (targets?.kcal ?? 2000) / 1800);
  // What the rest of the day already has, judged by the templates those meals came from.
  const day = newDayState();
  for (const o of others) {
    const tpl = Object.values(TEMPLATES).flat().find((t) => t.name === o.tpl || t.name === o.title);
    const oItems = o.items.map((it) => ({ food: byId.get(it.foodId) })).filter((it) => it.food);
    if (tpl) markDay(day, tpl, oItems, kindOf(o));
    for (const it of oItems) if (it.food.cat !== 'fat') day.foods.add(it.food.id);
    // Cooked dishes in the day without a known template still count (old plans, AI menus).
    if (o.items.some((it) => ['dish', 'side'].some((r) => byId.get(it.foodId)?.roles?.includes(r)) || it.foodId === 'mahshi')) day.cooked = true;
  }
  const goal = { kcal: cur.kcal, proteinG: Math.max(cur.p, 1), carbsG: Math.max(cur.c, 1), fatG: Math.max(cur.f, 1) };
  const curIds = new Set(meal.items.map((i) => i.foodId));
  const out = [];
  const { list } = templatesFor(kind, ctx);
  for (const [ti, tpl] of list.entries()) {
    if (dayPenalty(tpl, day, kind) === Infinity) continue;
    const items = buildMeal(tpl, ctx, ti, day.foods, SAVOURY.has(kind) && tpl.protein === day.mainProtein ? day.reuse : null);
    if (!items) continue;
    // The same foods as now is not an alternative.
    const ids = items.map((i) => i.food.id);
    if (ids.length === curIds.size && ids.every((id) => curIds.has(id))) continue;
    const m = { items };
    const err = solveDay([m], goal, [1]);
    const tot = { kcal: 0, p: 0, c: 0, f: 0 };
    for (const it of items) for (const k of ['kcal', 'p', 'c', 'f']) tot[k] += ((k === 'kcal' ? it.food.kcal : it.food[k]) * it.grams) / 100;
    // Far off the current meal's calories or protein means the day would drift: leave it out.
    if (Math.abs(tot.kcal - cur.kcal) > Math.max(60, cur.kcal * 0.1) || tot.p < cur.p * 0.85 - 3) continue;
    const kept = items.filter((i) => i.grams > 0);
    out.push({
      key: tpl.name, title: mealTitle(tpl, kept), tpl: tpl.name, kind, items: kept.map((i) => ({ food: i.food, grams: i.grams })),
      kcal: Math.round(tot.kcal), p: Math.round(tot.p), c: Math.round(tot.c), f: Math.round(tot.f),
      error: err + dayPenalty(tpl, day, kind) * 0.01, cooked: Boolean(tpl.cooked),
    });
  }
  // Best fit first; titles stay unique.
  out.sort((a, b) => a.error - b.error);
  const seenTitles = new Set([meal.title]);
  return out.filter((o) => (seenTitles.has(o.title) ? false : seenTitles.add(o.title))).slice(0, limit);
}

/**
 * targets: { kcal, proteinG, carbsG, fatG }
 * prefs: { mealsPerDay, likedIds[], dislikedIds[], allergies[], vegetarian }
 * menu (optional): AI-proposed [{ meals: [{ title, foodIds[] }] }] per day; validated, else templates.
 */
export function generatePlan({ targets, prefs = {}, foods = FOODS, days = 1, seed = 1, menu = null }) {
  const ctx = planContext({ prefs, foods });
  ctx.scale = Math.min(1.5, Math.max(1, targets.kcal / 2400));
  ctx.small = Math.min(1, targets.kcal / 1800);
  const warnings = new Set();
  const rand = rng(seed);
  const shares = ctx.split.map((s) => s[2]);
  const outDays = [];
  let aiDays = 0;

  for (let d = 0; d < days; d++) {
    let meals = menu?.[d] ? mealsFromMenu(menu[d], ctx) : null;
    if (meals) {
      const e = solveDay(meals, targets, shares);
      // The AI menu could not hit the targets, or makes no sense for a normal day: use templates.
      const byId = new Map(ctx.pool.map((f) => [f.id, f]));
      if (e > 0.02 || dayLogicIssues({ meals: meals.map((m) => ({ ...m, items: m.items.map((i) => ({ foodId: i.food.id, grams: i.grams })) })) }, byId).length) meals = null;
      else aiDays++;
    }
    if (!meals) meals = templateDay(ctx, targets, d, rand, warnings, seed);
    if (!meals) {
      warnings.add('Could not build a day from the allowed foods.');
      outDays.push({ day: d + 1, meals: [], totals: { kcal: 0, p: 0, c: 0, f: 0 } });
      continue;
    }
    const day = finishDay(d + 1, meals);
    if (day.totals.p < targets.proteinG * 0.9) warnings.add('Protein is more than 10% under target on some days with these food choices.');
    if (Math.abs(day.totals.kcal - targets.kcal) > targets.kcal * 0.05) warnings.add('Calories are more than 5% off target on some days with these food choices.');
    outDays.push(day);
  }

  const avg = (k) => Math.round(outDays.reduce((a, x) => a + x.totals[k], 0) / Math.max(outDays.length, 1));
  return {
    targets,
    prefs,
    source: menu ? (aiDays === days ? 'ai' : aiDays ? 'ai+templates' : 'templates') : 'templates',
    days: outDays,
    summary: { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f') },
    warnings: [...warnings],
  };
}

/** A cooked Egyptian dish or stew (molokhia, mahshi, okra, koshari...). */
export const isCookedDish = (f) => f.cat === 'dish' && !['hawawshi', 'chicken-shawarma', 'liver-sandwich'].includes(f.id);

// What each light meal may contain, by food role. Potatoes are a normal breakfast (eggs and potatoes).
const LIGHT_ROLES = {
  bf: new Set(['bfProtein', 'bfCarb', 'veg', 'fat', 'fruit', 'snack', 'boost', 'sweet']),
  snack: new Set(['snack', 'fruit', 'boost', 'fat', 'bfCarb', 'veg', 'bfProtein', 'sweet']),
  'pre-light': new Set(['snack', 'fruit', 'boost', 'fat', 'bfCarb', 'veg', 'bfProtein', 'sweet']),
};
const BREAKFAST_OK = new Set(['potato', 'sweet-potato', 'potato-baked']);

/**
 * Common-sense rules for one plan day, the way a person (or their mother) would judge it.
 * Used by the AI admin review and to reject AI menus. Returns a list of problems (empty = fine).
 *   - one cooked Egyptian dish a day at most, and never at a light dinner
 *   - breakfast and snacks hold breakfast / snack foods (no kofta and rice at breakfast)
 *   - nothing served more than once a day, except staples, vegetables, fats and lunch's
 *     protein coming back once at dinner (cook once, eat twice)
 */
export function dayLogicIssues(day, foodsById) {
  const issues = [];
  const get = (id) => (foodsById instanceof Map ? foodsById.get(id) : foodsById[id]);
  const short = (f) => f.name.split(/[,(]/)[0].trim().toLowerCase();
  const cooked = [];
  const count = new Map();
  for (const m of day.meals ?? []) {
    const kind = kindOf(m);
    for (const it of m.items) {
      const f = get(it.foodId);
      if (!f || !(it.grams > 0)) continue;
      if (isCookedDish(f)) {
        cooked.push(`${short(f)} at ${m.name.toLowerCase()}`);
        if (kind === 'dinner') issues.push(`${m.name} has ${short(f)}: dinner is a light meal, the cooked dish belongs at lunch.`);
      }
      const allowed = LIGHT_ROLES[kind];
      if (allowed && !BREAKFAST_OK.has(f.id) && !(f.roles ?? []).some((r) => allowed.has(r))) issues.push(`${m.name} has ${short(f)}, which is not a ${kind === 'bf' ? 'breakfast' : 'snack'} food.`);
      if (!['carb', 'veg', 'fat'].includes(f.cat)) count.set(f.id, (count.get(f.id) ?? 0) + 1);
    }
  }
  if (cooked.length > 1) issues.push(`Two cooked dishes in one day (${cooked.join(', ')}): at home one dish is cooked a day.`);
  for (const [id, n] of count) {
    const f = get(id);
    const limit = f?.roles?.includes('mainProtein') ? 2 : 1;
    if (n > limit) issues.push(`${f ? short(f) : id} is served ${n} times in one day.`);
  }
  return issues;
}

/**
 * Validate an AI-proposed day against the allowed food pool and turn it into solver input.
 * Returns null (fall back to templates) if anything is off: wrong meal count, unknown or
 * disallowed food, duplicate food in a meal, or a meal that is not 2-5 foods.
 */
export function mealsFromMenu(day, ctx) {
  if (!day || !Array.isArray(day.meals) || day.meals.length !== ctx.split.length) return null;
  const meals = [];
  let cookedSeen = false;
  for (const [mi, m] of day.meals.entries()) {
    const ids = Array.isArray(m?.foodIds) ? m.foodIds : null;
    if (!ids || ids.length < 2 || ids.length > 5 || new Set(ids).size !== ids.length) return null;
    const items = [];
    for (const id of ids) {
      const food = ctx.poolById.get(id);
      if (!food) return null;
      const p = portionOf(food, food.roles[0]);
      items.push({ food, ...p, grams: p.typ });
    }
    // Egyptian day rules: one cooked dish a day, and never at a light dinner.
    const cooked = items.some((it) => isCookedDish(it.food));
    if (cooked && (cookedSeen || ctx.split[mi][1] === 'dinner')) return null;
    if (cooked) cookedSeen = true;
    const title = typeof m.title === 'string' ? m.title.slice(0, 60) : undefined;
    meals.push({ name: ctx.split[mi][0], kind: ctx.split[mi][1], title, items });
  }
  return meals;
}

/**
 * Re-size the remaining items of a day so the day lands back on target, changing as little as
 * possible (the solver pulls every portion toward its current size).
 *   meals     the day's meals: [{ items: [{ foodId, grams }] }]
 *   targets   { kcal, proteinG, carbsG, fatG }
 *   consumed  macros already eaten that are not part of `meals` items being solved (logged items, extras)
 *   fixed     Set of "mi-ii" keys whose grams must not change (just swapped)
 *   skip      Set of "mi-ii" keys to leave out entirely (already logged)
 *   direction -1: portions may only shrink, +1: only grow, 0: either (a weekly check-in that
 *             cuts 150 kcal should never hand out a bigger portion of anything)
 * Returns { grams: Map("mi-ii" -> grams), projected: { kcal, p, c, f } }.
 */
export function rebalanceDay({ meals, foodsById, targets, consumed = { kcal: 0, p: 0, c: 0, f: 0 }, fixed = new Set(), skip = new Set(), direction = 0 }) {
  const solveMeals = [];
  const keys = [];
  meals.forEach((m, mi) => {
    const items = [];
    m.items.forEach((it, ii) => {
      const key = `${mi}-${ii}`;
      const food = foodsById.get(it.foodId);
      if (skip.has(key) || !food) return;
      const p = portionOf(food);
      const lock = fixed.has(key);
      const min = lock || direction > 0 ? it.grams : Math.min(p.min, it.grams);
      const max = lock || direction < 0 ? it.grams : Math.max(p.max, it.grams);
      items.push({ food, step: p.step, typ: it.grams, min, max, grams: it.grams });
      keys.push([key, items[items.length - 1]]);
    });
    if (items.length) solveMeals.push({ items });
  });
  if (!keys.length) return { grams: new Map(), projected: consumed };
  const rest = {
    kcal: Math.max(targets.kcal - consumed.kcal, 1), proteinG: Math.max(targets.proteinG - consumed.p, 1),
    carbsG: Math.max(targets.carbsG - consumed.c, 1), fatG: Math.max(targets.fatG - consumed.f, 1),
  };
  const kcalOf = (m) => m.items.reduce((a, it) => a + (it.food.kcal * it.grams) / 100, 0);
  const total = solveMeals.reduce((a, m) => a + kcalOf(m), 0) || 1;
  solveDay(solveMeals, rest, solveMeals.map((m) => kcalOf(m) / total));
  const grams = new Map(keys.map(([k, it]) => [k, it.grams]));
  const projected = { ...consumed };
  for (const [, it] of keys) for (const k of ['kcal', 'p', 'c', 'f']) projected[k] += ((k === 'kcal' ? it.food.kcal : it.food[k]) * it.grams) / 100;
  return { grams, projected };
}
