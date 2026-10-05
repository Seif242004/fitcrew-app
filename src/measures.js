// Household measures: how people in Egypt actually say what they ate.
//
// Nobody weighs a second egg or a plate of koshari. Every food can be logged in grams, and most
// also in a natural unit: eggs, loaves, cups of cooked rice, a plate of ful, a piece of mahshi,
// a handful of nuts. The plan still sizes portions in grams (that is how dietitians write it);
// these measures are for LOGGING ("I ate 3 eggs") and for a friendly hint next to the grams
// ("260 g cooked rice · about 1½ cups").
//
// Each entry: [name, plural, grams per one, half] — `half` allows ½ steps (½ loaf, 1½ cups).
// A food's own `unit` (foods-seed.js, e.g. 1 egg = 50 g) always comes first; these add to it.
// Grams are cooked / as-eaten weight, the same basis as the food's macros.

const M = (name, plural, g, half = true) => ({ name, plural, g, half });

import { OFFPLAN_MEASURES } from './offplan-foods.js';

export const MEASURES = {
  // protein
  'chicken-breast': [M('fillet', 'fillets', 150)],
  'chicken-thigh': [M('thigh', 'thighs', 90, false)],
  'shish-tawook': [M('skewer', 'skewers', 100)],
  'turkey-breast': [M('slice', 'slices', 30, false)],
  'smoked-turkey': [M('slice', 'slices', 20, false)],
  'beef-steak': [M('steak', 'steaks', 170)],
  kofta: [M('kofta finger', 'kofta fingers', 40, false)],
  'beef-liver': [M('sandwich portion', 'sandwich portions', 75)],
  tilapia: [M('fillet', 'fillets', 120)],
  'sea-bream': [M('fish', 'fish', 220)],
  salmon: [M('fillet', 'fillets', 150)],
  mackerel: [M('fish', 'fish', 150)],
  'tuna-canned': [M('can', 'cans', 120)],
  'tuna-oil': [M('can', 'cans', 120)],
  sardines: [M('can', 'cans', 90)],
  shrimp: [M('cup', 'cups', 140)],
  omelette: [M('egg omelette', 'egg omelette', 55, false)],
  // dairy
  areesh: [M('tbsp', 'tbsp', 25, false), M('cup', 'cups', 220)],
  'cottage-cheese': [M('tbsp', 'tbsp', 25, false), M('cup', 'cups', 220)],
  'white-cheese': [M('slice', 'slices', 30, false)],
  'white-cheese-light': [M('slice', 'slices', 30, false)],
  mozzarella: [M('slice', 'slices', 20, false)],
  roumy: [M('slice', 'slices', 20, false)],
  labneh: [M('tbsp', 'tbsp', 25, false)],
  'greek-yogurt': [M('cup', 'cups', 170)],
  'greek-yogurt-2': [M('cup', 'cups', 170)],
  milk: [M('cup', 'cups', 240)],
  'milk-skim': [M('cup', 'cups', 240)],
  // legumes
  'ful-medames': [M('plate', 'plates', 200), M('ladle', 'ladles', 100, false)],
  lentils: [M('cup', 'cups', 200)],
  chickpeas: [M('cup', 'cups', 160)],
  hummus: [M('tbsp', 'tbsp', 15, false)],
  lupini: [M('cup', 'cups', 150)],
  tofu: [M('block', 'blocks', 200)],
  // grains (cooked)
  oats: [M('cup', 'cups', 80), M('tbsp', 'tbsp', 10, false)],
  'corn-flakes': [M('cup', 'cups', 30)],
  granola: [M('cup', 'cups', 60)],
  feteer: [M('slice', 'slices', 80)],
  'white-rice': [M('cup', 'cups', 160)],
  basmati: [M('cup', 'cups', 160)],
  'brown-rice': [M('cup', 'cups', 160)],
  'vermicelli-rice': [M('cup', 'cups', 160)],
  pasta: [M('cup', 'cups', 140)],
  'pasta-ww': [M('cup', 'cups', 140)],
  bulgur: [M('cup', 'cups', 180)],
  freekeh: [M('cup', 'cups', 160)],
  quinoa: [M('cup', 'cups', 185)],
  potato: [M('medium potato', 'medium potatoes', 170)],
  'potato-baked': [M('cup', 'cups', 120)],
  'sweet-potato': [M('medium sweet potato', 'medium sweet potatoes', 150)],
  // Egyptian dishes
  koshari: [M('plate', 'plates', 350)],
  molokhia: [],
  mahshi: [M('piece', 'pieces', 50, false)],
  fattah: [M('plate', 'plates', 350)],
  'macarona-bechamel': [M('piece', 'pieces', 200)],
  'okra-stew': [M('bowl', 'bowls', 250)],
  // vegetables
  'salata-baladi': [M('plate', 'plates', 150)],
  cucumber: [M('cucumber', 'cucumbers', 100)],
  tomato: [M('tomato', 'tomatoes', 120)],
  'salad-greens': [M('plate', 'plates', 120)],
  'bell-pepper': [M('pepper', 'peppers', 150)],
  broccoli: [M('cup', 'cups', 150)],
  zucchini: [M('cup', 'cups', 150)],
  carrot: [M('carrot', 'carrots', 70)],
  'green-beans': [M('cup', 'cups', 150)],
  eggplant: [M('cup', 'cups', 150)],
  spinach: [M('cup', 'cups', 180)],
  cauliflower: [M('cup', 'cups', 150)],
  mushrooms: [M('cup', 'cups', 100)],
  'baba-ghanoush': [M('tbsp', 'tbsp', 20, false)],
  'tahini-salad': [M('tbsp', 'tbsp', 20, false)],
  pickles: [M('piece', 'pieces', 20, false)],
  // fruit
  mango: [M('mango', 'mangoes', 200)],
  guava: [M('guava', 'guavas', 100)],
  watermelon: [M('slice', 'slices', 300)],
  cantaloupe: [M('slice', 'slices', 150)],
  strawberries: [M('cup', 'cups', 150)],
  grapes: [M('cup', 'cups', 150)],
  figs: [M('fig', 'figs', 50, false)],
  pomegranate: [M('cup', 'cups', 170)],
  peach: [M('peach', 'peaches', 150)],
  raisins: [M('tbsp', 'tbsp', 10, false)],
  'dried-apricot': [M('piece', 'pieces', 8, false)],
  'orange-juice': [M('glass', 'glasses', 250)],
  // fats
  ghee: [M('tsp', 'tsp', 5, false)],
  butter: [M('tsp', 'tsp', 5, false)],
  almonds: [M('handful', 'handfuls', 25)],
  walnuts: [M('handful', 'handfuls', 25)],
  cashews: [M('handful', 'handfuls', 25)],
  peanuts: [M('handful', 'handfuls', 25)],
  'sunflower-seeds': [M('handful', 'handfuls', 25)],
  avocado: [M('avocado', 'avocados', 140)],
  // sweets
  molasses: [M('tbsp', 'tbsp', 20, false)],
  jam: [M('tbsp', 'tbsp', 20, false)],
  halawa: [M('tbsp', 'tbsp', 20, false)],
  'chocolate-spread': [M('tbsp', 'tbsp', 20, false)],
  'dark-chocolate': [M('square', 'squares', 10, false)],
  basbousa: [M('piece', 'pieces', 70, false)],
  konafa: [M('piece', 'pieces', 100)],
  'om-ali': [M('bowl', 'bowls', 200)],
  popcorn: [M('cup', 'cups', 8)],
  sugar: [M('tbsp', 'tbsp', 12, false)],
  honey: [M('tsp', 'tsp', 7, false)],
  // everyday foods (logging and swaps)
  'eggs-scrambled': [M('plate (3 eggs)', 'plates', 180)],
  cheddar: [M('tbsp grated', 'tbsp grated', 7, false)],
  feta: [M('cube', 'cubes', 10, false), M('slice', 'slices', 30, false)],
  parmesan: [M('tbsp', 'tbsp', 5, false)],
  rayeb: [M('cup', 'cups', 240)],
  'white-beans': [M('cup', 'cups', 180)],
  'black-eyed-peas': [M('cup', 'cups', 170)],
  couscous: [M('cup', 'cups', 157)],
  corn: [M('cup', 'cups', 145), M('cob', 'cobs', 100)],
  peas: [M('cup', 'cups', 160)],
  okra: [M('cup', 'cups', 160)],
  cherries: [M('cup', 'cups', 140)],
  pineapple: [M('slice', 'slices', 85)],
  blueberries: [M('cup', 'cups', 148)],
  pistachios: [M('handful', 'handfuls', 25)],
  hazelnuts: [M('handful', 'handfuls', 25)],
  'pumpkin-seeds': [M('handful', 'handfuls', 25)],
  chia: [M('tbsp', 'tbsp', 12, false)],
  'chicken-roast': [M('quarter chicken', 'quarter chickens', 250)],
  kebab: [M('skewer', 'skewers', 80)],
  basa: [M('fillet', 'fillets', 150)],
  bouri: [M('fish', 'fish', 250)],
};

// Plural forms of the seed units (foods-seed.js `unit.name`).
const PLURAL = { glass: 'glasses', loaf: 'loaves', sandwich: 'sandwiches', hawawshi: 'hawawshi', tbsp: 'tbsp', tsp: 'tsp', white: 'whites', bowl: 'bowls', cup: 'cups' };
const plural = (name) => PLURAL[name] ?? `${name}s`;
// Seed units that may be halved (half a loaf, 1½ bowls). Eggs, slices, pieces... are whole.
const HALF = new Set(['loaf', 'bowl', 'cup', 'tbsp', 'banana', 'apple', 'orange', 'bottle', 'sandwich', 'hawawshi']);

/**
 * Every way this food can be measured, natural units first, grams last.
 * [{ key, name, plural, g, step }] where step is the smallest count (1 or 0.5).
 * `key` is stable for the API: 'u' = the food's own unit, 'm0'.. = household measures, 'g' = grams,
 * 'dry' = grams weighed dry (rice, pasta, lentils).
 */
export function unitsFor(food) {
  const out = [];
  if (food?.unit?.g) out.push({ key: 'u', name: food.unit.name, plural: plural(food.unit.name), g: food.unit.g, step: HALF.has(food.unit.name) ? 0.5 : 1 });
  (MEASURES[food?.id] ?? OFFPLAN_MEASURES[food?.id] ?? []).forEach((m, i) => {
    if (out.some((u) => u.name === m.name)) return;
    out.push({ key: `m${i}`, name: m.name, plural: m.plural, g: m.g, step: m.half ? 0.5 : 1 });
  });
  if (food?.raw) out.push({ key: 'dry', name: 'g dry', plural: 'g dry', g: food.raw, step: 5, grams: true });
  out.push({ key: 'g', name: 'g', plural: 'g', g: 1, step: food?.step && food.step <= 10 ? food.step : 5, grams: true });
  return out;
}

/** Nice count: 1, 1½, ½, 2. */
export function niceCount(n) {
  const half = Math.round(n * 2) / 2;
  if (Number.isInteger(half)) return String(half);
  return half < 1 ? '½' : `${Math.floor(half)}½`;
}

/** "3 eggs", "1½ cups", "120 g". qty is in the unit's own count. */
export function formatQty(unit, qty) {
  if (unit.grams) return unit.key === 'dry' ? `${Math.round(qty)} g dry` : `${Math.round(qty)} g`;
  // Singular or plural from the count as shown: 1.1 loaves reads "1 loaf", never "1 loaves".
  return `${niceCount(qty)} ${Math.round(qty * 2) / 2 <= 1 ? unit.name : unit.plural}`;
}

/** Convert a logged amount { qty, unit key } to grams as eaten. Returns null for an unknown unit. */
export function gramsFrom(food, qty, key) {
  const u = unitsFor(food).find((x) => x.key === key);
  if (!u) return null;
  return Math.round(qty * u.g * 10) / 10;
}

/**
 * A friendly household hint for a gram amount, when one reads naturally (within 15% of a
 * half-step): 260 g cooked rice -> "about 1½ cups". Null when no measure fits or the food is
 * already counted in its own unit.
 */
export function householdHint(food, grams) {
  if (!food || food.unit?.g) return null;
  for (const m of MEASURES[food.id] ?? []) {
    const n = grams / m.g;
    const step = m.half ? 0.5 : 1;
    const r = Math.round(n / step) * step;
    if (r < step || r > 8) continue;
    if (Math.abs(n - r) / r <= 0.15) return `about ${niceCount(r)} ${r <= 1 ? m.name : m.plural}`;
  }
  return null;
}
