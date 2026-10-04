// Food exchanges ("بدائل"): the way Egyptian coaches give variety. Any item in a plan can be
// replaced by an equivalent amount of another food from the same group, e.g.
//   100 g chicken = 100 g bolti = 4 eggs = 200 g areesh        (same protein)
//   rice = brown toast slices = tortillas = potatoes             (same carbs)
//   olive oil = almonds = peanut butter                         (same fat)
// Equivalence is computed from macros, so the day's numbers stay the same and a swap never
// needs approval.

import { unitsFor, formatQty, householdHint } from './measures.js';

// Ful and taameya: the Egyptian breakfast mains. Swapped like-for-like on calories (taameya ->
// eggs or ful), since their protein is too low to match gram-for-gram.
const isBreakfastLegume = (f) => f.cat === 'legume' && (f.roles ?? []).includes('bfProtein');

/** Which exchange group a food belongs to, judged by where its calories come from. */
export function exchangeGroup(food) {
  if (food.cat === 'veg' && food.kcal < 60) return 'veg';
  if (food.cat === 'fruit') return 'fruit';
  if (food.cat === 'sweet') return 'sweet';
  // Stews served WITH rice and a protein (molokhia, bamya, fasolia, besella) swap with each other;
  // complete plates (koshari, fattah, a sandwich) swap with other complete plates. Mahshi is the
  // carb of its meal (rice + vegetables), so it sits with rice, pasta and bread below.
  if (food.roles?.includes('side')) return 'stew';
  if (food.roles?.includes('dish')) return 'dish';
  const kcal = Math.max(food.kcal, 1);
  const pShare = (food.p * 4) / kcal;
  const fShare = (food.f * 9) / kcal;
  const cShare = (food.c * 4) / kcal;
  const roles = food.roles ?? [];
  if (isBreakfastLegume(food)) return 'protein'; // ful and taameya sit with eggs and cheese, not bread
  // Role first, like a coach's table: eggs, kofta and mackerel are protein even though fatty.
  if (roles.some((r) => r === 'mainProtein' || r === 'bfProtein' || r === 'boost') && pShare >= 0.25) return 'protein';
  if (roles.some((r) => r === 'carb' || r === 'bfCarb' || r === 'vegMain') && cShare >= 0.35) return 'carb';
  if (food.cat === 'dairy' && fShare >= 0.5) return 'cheese';
  if (pShare >= 0.38) return 'protein';
  if (fShare >= 0.55) return 'fat';
  if (cShare >= 0.55) return 'carb';
  return pShare >= cShare * 0.6 ? 'protein' : 'carb';
}

// The macro each group is matched on.
const KEY = { protein: 'p', carb: 'c', fruit: 'c', fat: 'f', cheese: 'kcal', sweet: 'kcal', dish: 'kcal', stew: 'kcal', veg: 'kcal' };
export const GROUP_LABEL = { protein: 'Protein', carb: 'Carbs', fruit: 'Fruit', fat: 'Healthy fats', cheese: 'Cheese', sweet: 'Sweets', dish: 'Dishes', stew: 'Cooked vegetables', veg: 'Vegetables' };

const per100 = (food, k) => (k === 'kcal' ? food.kcal : food[k]);

/** Snap grams to something you can actually measure: whole units (eggs, slices) or the step. */
export function snapGrams(food, grams) {
  if (food.unit?.g) {
    const n = Math.max(1, Math.round(grams / food.unit.g * 2) / 2); // half units allowed (half a loaf)
    const whole = ['egg', 'white', 'slice', 'tortilla', 'cake', 'bar', 'bottle', 'can', 'scoop', 'piece', 'date', 'kiwi'].includes(food.unit.name);
    return (whole ? Math.max(1, Math.round(grams / food.unit.g)) : n) * food.unit.g;
  }
  const step = food.step || 5;
  return Math.max(step, Math.round(grams / step) * step);
}

/** Grams of `to` equivalent to `grams` of `from`, matched on the group's key macro. */
export function equivalentGrams(from, grams, to) {
  const k = isBreakfastLegume(from) || isBreakfastLegume(to) ? 'kcal' : KEY[exchangeGroup(from)];
  const amount = (per100(from, k) * grams) / 100;
  const per = per100(to, k);
  if (!per) return null;
  return snapGrams(to, (amount / per) * 100);
}

/**
 * Alternatives for one plan item, best first. Only foods in the same group that the person
 * eats (pool), with sane portions (no "900 g of cucumber"), and the calorie difference shown.
 */
export function alternatives(from, grams, pool, { limit = 40 } = {}) {
  const g = exchangeGroup(from);
  if (g === 'veg') {
    // Vegetables are "free": offer other vegetables at the same weight.
    return pool.filter((f) => f.id !== from.id && exchangeGroup(f) === 'veg')
      .map((f) => ({ food: f, grams: snapGrams(f, grams), kcalDiff: Math.round(((f.kcal - from.kcal) * grams) / 100) })).slice(0, limit);
  }
  const baseKcal = (from.kcal * grams) / 100;
  const out = [];
  for (const f of pool) {
    if (f.id === from.id || exchangeGroup(f) !== g) continue;
    if (isBreakfastLegume(from) && !(f.roles ?? []).includes('bfProtein')) continue; // taameya -> breakfast foods, not chicken
    const eq = equivalentGrams(from, grams, f);
    if (!eq) continue;
    const cap = (f.portion?.[2] ?? f.max ?? 500) * 1.6;
    if (eq > cap) continue; // would be an unrealistic amount of this food
    const kcal = (f.kcal * eq) / 100;
    // Same key macro but a very different calorie load is not a fair swap (e.g. koshari -> hawawshi).
    // Mahshi carries its cooking oil, so plain rice with the same carbs is a little lighter.
    if (Math.abs(kcal - baseKcal) > Math.max(60, baseKcal * (from.cat === 'dish' ? 0.35 : 0.3))) continue;
    out.push({ food: f, grams: eq, kcalDiff: Math.round(kcal - baseKcal) });
  }
  // Foods that play the same role come first (toast -> other breads before lentils; rice ->
  // pasta/bulgur before oats), then the closest in calories so the day stays on target.
  const roles = new Set(from.roles ?? []);
  const primary = from.roles?.[0];
  const sameRole = (f) => (f.roles?.[0] === primary ? 0 : (f.roles ?? []).some((r) => roles.has(r)) ? 1 : 2);
  const sameCat = (f) => (f.cat === from.cat ? 0 : 1);
  out.sort((a, b) => sameRole(a.food) - sameRole(b.food) || sameCat(a.food) - sameCat(b.food) || Math.abs(a.kcalDiff) - Math.abs(b.kcalDiff));
  return out.slice(0, limit);
}

/** Human amount: "3 eggs", "2 slices", "70 g raw (≈ 196 g cooked)". */
export function describeAmount(food, grams) {
  if (food.unit?.g) {
    const u = unitsFor(food)[0];
    return formatQty(u, grams / food.unit.g);
  }
  if (food.raw) return `${Math.round(grams / food.raw / 5) * 5} g dry (≈ ${grams} g cooked)`;
  return `${grams} g`;
}

/** Household hint next to grams: "about 1½ cups cooked", "about 2 pieces". Null when none fits. */
export function amountHint(food, grams) {
  const h = householdHint(food, grams);
  return h && food.raw ? `${h} cooked` : h;
}
