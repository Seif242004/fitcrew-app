// Food search shared by the app (GET /api/foods) and the AI coach (search_foods).
//
// What it handles, because this is how people actually type:
//   - any word order and partial words: "grilled chicken" = "chicken grilled" = "chick gril"
//   - Egyptian spellings in English: koshary / koshari, foul / ful, ta3meya / taameya / falafel
//   - plurals: "eggs", "nuggets", "fries"
//   - Arabic with or without hamza, ta marbuta, alef maqsura and tashkeel: "عيش بلدى" = "عيش بلدي"
// Ranking (best first): exact name, name starts with the query, every word starts a word in the
// name, then words found inside the Arabic name, the id or other words. Diet foods always come
// before off-plan foods (pizza, burgers, sweets) so the plan's own foods are never pushed down.

const AR_NORMAL = [[/[\u064B-\u0652\u0640]/g, ''], [/[أإآ]/g, 'ا'], [/ة/g, 'ه'], [/ى/g, 'ي'], [/ؤ/g, 'و'], [/ئ/g, 'ي']];

/** Lower case, Arabic letter variants folded, accents and punctuation removed, single spaces. */
export function norm(s) {
  let t = String(s ?? '').toLowerCase().trim();
  for (const [re, to] of AR_NORMAL) t = t.replace(re, to); // before NFD, which would split أ into ا + a mark
  t = t.normalize('NFD').replace(/[\u0300-\u036f\u0654\u0655]/g, ''); // accents and split-off hamza marks
  return t.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Common ways the crew spells Egyptian and everyday foods, mapped to the word in the food list.
const ALIASES = {
  koshary: 'koshari', koshery: 'koshari', kushari: 'koshari', koshry: 'koshari',
  foul: 'ful', fool: 'ful', foule: 'ful',
  tamia: 'taameya', taamia: 'taameya', tameya: 'taameya', ta3meya: 'taameya', ta3mya: 'taameya', falafel: 'taameya',
  yoghurt: 'yogurt', yougurt: 'yogurt', yoghourt: 'yogurt', zabady: 'zabadi',
  molokheya: 'molokhia', mulukhiyah: 'molokhia', molokheyya: 'molokhia',
  mahshy: 'mahshi', fetir: 'feteer', fiteer: 'feteer', hawawshy: 'hawawshi',
  shawerma: 'shawarma', shawrma: 'shawarma', chawarma: 'shawarma',
  aish: 'baladi', eish: 'baladi', tahina: 'tahini', halva: 'halawa',
  doughnut: 'donut', choco: 'chocolate', hamburger: 'burger', burgers: 'burger',
  soda: 'fizzy', pepsi: 'cola', coke: 'cola', crisps: 'chips', chipsy: 'chips',
  icecream: 'ice', gelato: 'ice', frappuccino: 'frappe', frapp: 'frappe', capuccino: 'cappuccino',
  macaroni: 'pasta', tona: 'tuna',
  balady: 'baladi', beledi: 'baladi', baladi: 'baladi', balade: 'baladi', shamy: 'shami',
  chedder: 'cheddar', chedar: 'cheddar', cheder: 'cheddar', mozarella: 'mozzarella', mozzarela: 'mozzarella',
  cappucino: 'cappuccino', capucino: 'cappuccino', cappuchino: 'cappuccino', capuchino: 'cappuccino', cofee: 'coffee', coffe: 'coffee', kahwa: 'coffee', ahwa: 'coffee', qahwa: 'coffee', americano: 'coffee',
  nescafé: 'nescafe', nescaffe: 'nescafe', nes: 'nescafe', shai: 'tea', shay: 'tea', chai: 'tea',
  karkadeh: 'karkade', karkadé: 'karkade', sahleb: 'sahlab', oj: 'orange', orangejuice: 'orange',
  mayo: 'mayonnaise', ketchap: 'ketchup', catchup: 'ketchup', panee: 'pane', panne: 'pane', bane: 'pane',
  sogo: 'sausage', sogo2: 'sausage', sugu2: 'sausage', sausages: 'sausage', bastirma: 'basterma', pastirma: 'basterma',
  indomie: 'noodles', indomi: 'noodles', sandwitch: 'sandwich', sandwhich: 'sandwich', sandwech: 'sandwich',
  omlette: 'omelette', omelet: 'omelette', scrambeled: 'scrambled', scrambbled: 'scrambled', fryed: 'fried',
  mehalabia: 'mehalabeya', mahalabeya: 'mehalabeya', konafa: 'konafa', kunafa: 'konafa', kenafa: 'konafa',
  basboosa: 'basbousa', bassbousa: 'basbousa', kahk: 'kahk', ka7k: 'kahk', feteer: 'feteer',
};

// Everyday staples win ties ("bread" -> baladi bread first, "rice" -> white rice first).
const COMMON = new Set(['baladi-bread', 'eggs', 'white-rice', 'chicken-breast', 'ful-medames', 'taameya', 'white-cheese', 'pasta', 'potato', 'koshari', 'banana', 'apple', 'milk', 'coffee-black', 'tea', 'orange-juice', 'sugar', 'cappuccino']);

/** Word variants to try: the word itself, its alias, and the singular of a plural. */
function variants(w) {
  const out = new Set([w]);
  if (ALIASES[w]) out.add(ALIASES[w]);
  if (w.length > 3 && w.endsWith('ies')) out.add(`${w.slice(0, -3)}y`);
  else if (w.length > 3 && /(ch|sh|x|ss)es$/.test(w)) out.add(w.slice(0, -2));
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
  for (const v of [...out]) if (ALIASES[v]) out.add(ALIASES[v]);
  return [...out];
}

/** Search text for one food, prepared once per call. */
const prep = (f) => {
  const name = norm(f.name);
  const ar = norm(f.ar);
  const other = norm(`${String(f.id).replace(/-/g, ' ')} ${f.cat ?? ''}`);
  return { id: f.id, name, ar, nameWords: name.split(' '), arWords: ar ? ar.split(' ') : [], otherWords: other.split(' ') };
};

/**
 * Score one food for a normalized query (0 = no match). Every query word must match somewhere,
 * as the start of a word (or inside a word for words of 4+ letters, e.g. "pita" in "(white pita)").
 */
function score(p, q, words) {
  let total = 0;
  for (const w of words) {
    const vs = variants(w);
    const starts = (list) => list.some((x) => vs.some((v) => x.startsWith(v)));
    const inside = (list) => w.length >= 4 && list.some((x) => vs.some((v) => x.includes(v)));
    if (starts(p.nameWords)) total += 10;
    else if (starts(p.arWords)) total += 9;
    else if (starts(p.otherWords)) total += 5;
    else if (inside(p.nameWords) || inside(p.arWords)) total += 3;
    else return 0; // a word that matches nothing: not this food
  }
  if (p.name === q || p.ar === q) total += 100;
  else if (p.name.startsWith(q) || (p.ar && p.ar.startsWith(q))) total += 40;
  else if (p.nameWords[0] && variants(words[0]).some((v) => p.nameWords[0].startsWith(v))) total += 15; // first word leads
  return total + (COMMON.has(p.id) ? 2 : 0);
}

/**
 * Foods matching `query`, best first; diet foods before off-plan foods. limit: max results.
 * Empty query: [] (the caller decides what to show instead, e.g. recent foods).
 */
export function searchFoods(foods, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ').filter(Boolean);
  return foods
    .map((f) => ({ f, s: score(prep(f), q, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (Boolean(a.f.offplan) - Boolean(b.f.offplan)) || b.s - a.s || a.f.name.length - b.f.name.length || a.f.name.localeCompare(b.f.name))
    .slice(0, limit)
    .map((x) => x.f);
}

// Words that describe how a food was served rather than what it is ("shredded cheddar", "a hot
// cup of tea"); dropped when the full name finds nothing.
const FILLER = new Set(['a', 'an', 'the', 'of', 'with', 'some', 'my', 'little', 'bit', 'shredded', 'grated', 'sliced', 'chopped', 'fresh', 'homemade', 'home', 'made', 'hot', 'cold', 'iced', 'small', 'large', 'big', 'medium', 'piece', 'pieces', 'plate', 'cup', 'glass', 'mug', 'bowl', 'serving', 'portion', 'normal', 'regular', 'plain', 'warm']);

/**
 * The one food a spoken name most likely means ("balady bread", "shredded chedder", "nescafe 3 in 1"),
 * or null. Tries the full name, then without filler words, then shorter and shorter starts of it.
 */
export function findFood(foods, name) {
  const words = norm(name).split(' ').filter(Boolean);
  if (!words.length) return null;
  const tries = [words.join(' '), words.filter((w) => !FILLER.has(w)).join(' ')];
  const core = words.filter((w) => !FILLER.has(w));
  for (let n = core.length - 1; n >= 1; n--) tries.push(core.slice(0, n).join(' '), core.slice(-n).join(' '));
  for (const q of tries) {
    if (!q) continue;
    const hit = searchFoods(foods, q, 1)[0];
    if (hit) return hit;
  }
  return null;
}
