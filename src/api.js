// FitCrew JSON API. No framework: a small route table over node:http.
import crypto from 'node:crypto';
import { computeTargets, navyBodyFat, ACTIVITY } from './calc.js';
import { generatePlan, itemFor, totalsOf, filterFoods, TRAIN_TIMES, rebalanceDay, mealOptions, kindOf } from './plan.js';
import { alternatives, equivalentGrams, exchangeGroup, describeAmount, amountHint, GROUP_LABEL } from './exchange.js';
import { unitsFor, formatQty } from './measures.js';
import { generatePlanSmart, aiConfig, DEFAULT_MODEL, BENCH_PRIORITY } from './plan-ai.js';
import { autoReview } from './review.js';
import { getSetting, setSetting } from './db.js';
import { coachTurn, actionLabel, chat as aiChat } from './coach.js';
import { vapidKeys, pushToUser } from './push.js';
import { ALLERGEN_TAGS } from './foods-seed.js';
import { loadFoods, rowToFood, offplanIds, touchCatalog } from './db.js';
import { hashPassword, verifyPassword, newToken, hashToken, newInviteCode, checkPasswordStrength } from './auth.js';
import { dayScore, streak, mealMatch, waterPoints, OFFPLAN_MEAL_MATCH } from './adherence.js';
import { registerTrain, workoutState, attendance, weekStart } from './api-train.js';
import { registerSocial } from './social.js';
import { registerCheckin } from './api-checkin.js';
import { norm, searchFoods, findFood } from './search.js';
import { mealIndex, amountFor, canStandIn, resolveUnit, isTreat } from './food-log.js';
import { normalizeToolCalls } from './tool-calls.js';
import { SPLITS, splitDaysError, INTENSITY } from './workout.js';

let makePendingWorkoutPlan; // assigned when the training routes are registered, below
let dayChanged = () => {}; // crew feed: posts 70+ days and streak milestones (set below)

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'Not allowed') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

// ---------- validation ----------
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const needDate = (s, name = 'date') => { if (!isDate(s)) throw bad(`${name} must be YYYY-MM-DD`); return s; };
const num = (v, min, max, name) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number between ${min} and ${max}`);
  return n;
};
const optNum = (v, min, max, name) => (v === undefined || v === null || v === '' ? undefined : num(v, min, max, name));
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`); return v; };
const str = (v, max, name, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} is too long (max ${max})`);
  return s;
};
const email = (v) => {
  const s = str(v, 200, 'email', true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Enter a valid email address');
  return s;
};

const MEASURE_KEYS = ['neckCm', 'chestCm', 'waistCm', 'hipCm', 'armCm', 'thighCm', 'calfCm'];
const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const dayIndex = (start, date, len) => (daysBetween(start, date) >= 0 ? daysBetween(start, date) % len : 0);

function cleanMeasurements(m) {
  const out = {};
  for (const k of MEASURE_KEYS) { const v = optNum(m?.[k], 10, 250, k); if (v !== undefined) out[k] = v; }
  return out;
}

function cleanProfile(p, foodIds) {
  if (!p || typeof p !== 'object') throw bad('Profile is required');
  const age = num(p.age, 1, 120, 'age');
  if (age < 18) throw bad('This app is for adults (18+).');
  const goal = oneOf(p.goal, ['cut', 'maintain', 'bulk'], 'goal');
  const out = {
    sex: oneOf(p.sex, ['male', 'female'], 'sex'),
    age,
    heightCm: num(p.heightCm, 120, 230, 'heightCm'),
    weightKg: num(p.weightKg, 35, 300, 'weightKg'),
    activityLevel: oneOf(p.activityLevel, Object.keys(ACTIVITY), 'activityLevel'),
    goal,
    weeklyRateKg: goal === 'maintain' ? 0 : num(p.weeklyRateKg ?? (goal === 'cut' ? 0.5 : 0.25), 0, 1.5, 'weeklyRateKg'),
    experience: oneOf(p.experience ?? 'beginner', ['beginner', 'intermediate', 'advanced'], 'experience'),
    daysPerWeek: Math.round(num(p.daysPerWeek ?? 4, 1, 7, 'daysPerWeek')),
    equipment: oneOf(p.equipment ?? 'gym', ['gym', 'home', 'mixed'], 'equipment'),
    split: oneOf(p.split ?? 'auto', Object.keys(SPLITS), 'split'),
    intensity: oneOf(p.intensity ?? 'moderate', Object.keys(INTENSITY), 'intensity'),
    injuries: str(p.injuries, 500, 'injuries'),
    measurements: cleanMeasurements(p.measurements),
    hideFromLeaderboard: Boolean(p.hideFromLeaderboard),
    notify: Object.fromEntries(['morning', 'nudge', 'evening', 'crew', 'weekly'].map((k) => [k, p.notify?.[k] !== false])),
  };
  const splitErr = splitDaysError(out.split, out.daysPerWeek);
  if (splitErr) throw bad(splitErr);
  const bf = optNum(p.bodyFatPct, 3, 60, 'bodyFatPct');
  if (bf !== undefined && p.bodyFatSource !== 'photos') out.bodyFatPct = bf; // typed only (photo estimates were removed)
  if (Array.isArray(p.trainDays)) {
    const days = [...new Set(p.trainDays.map((d) => Math.round(num(d, 0, 6, 'weekday'))))];
    if (days.length === out.daysPerWeek) out.trainDays = days;
  }
  const pr = p.prefs ?? {};
  const ids = (a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && foodIds.has(x)))].slice(0, 100);
  out.prefs = {
    mealsPerDay: Math.round(num(pr.mealsPerDay ?? 4, 3, 5, 'mealsPerDay')),
    trainTime: oneOf(pr.trainTime ?? 'evening', TRAIN_TIMES, 'trainTime'),
    likedIds: ids(pr.likedIds),
    dislikedIds: ids(pr.dislikedIds).slice(0, 200),
    allergies: [...new Set((Array.isArray(pr.allergies) ? pr.allergies : []).filter((a) => ALLERGEN_TAGS.includes(a)))],
    vegetarian: Boolean(pr.vegetarian),
    hasWhey: pr.hasWhey === true,
    budget: oneOf(pr.budget ?? 'normal', ['low', 'normal', 'high'], 'budget'),
    note: str(pr.note, 500, 'note'),
  };
  return out;
}

// tdeeAdjust: maintenance learned by the weekly check-ins (kcal over the formula), kept across edits.
function targetsFor(data, tdeeAdjust = 0) {
  // Body fat from the removed photo AI is ignored; a typed value or the tape estimate is used.
  let bf = data.bodyFatSource === 'photos' ? undefined : data.bodyFatPct;
  let estimated = false;
  if (bf === undefined) {
    const m = data.measurements ?? {};
    if (m.neckCm && m.waistCm && (data.sex === 'male' || m.hipCm)) {
      const est = navyBodyFat({ sex: data.sex, heightCm: data.heightCm, neckCm: m.neckCm, waistCm: m.waistCm, hipCm: m.hipCm });
      if (est !== null) { bf = est; estimated = true; }
    }
  }
  const t = computeTargets({ ...data, bodyFatPct: bf }, { tdeeAdjust });
  const source = bf !== undefined && !estimated ? 'typed' : estimated ? 'tape' : null;
  return { ...t, bodyFatPct: bf ?? null, bodyFatEstimated: estimated, bodyFatSource: source, engine: ENGINE };
}

/** The check-in's learned maintenance offset stored with a profile's targets (0 if none). */
const learnedAdjust = (row) => (row ? JSON.parse(row.targets).tdeeAdjust ?? 0 : 0);

const effectiveTargets = (row) => {
  if (!row) return null;
  const base = JSON.parse(row.targets);
  const o = row.targets_override ? JSON.parse(row.targets_override) : null;
  return o ? { ...base, ...o, overridden: true } : base;
};

// ---------- plans ----------
function normalizePlan(data, foodsById) {
  if (!data || !Array.isArray(data.days) || data.days.length < 1 || data.days.length > 14) throw bad('Plan must have 1 to 14 days');
  const days = data.days.map((d, di) => {
    if (!Array.isArray(d.meals) || d.meals.length < 1 || d.meals.length > 8) throw bad(`Day ${di + 1}: invalid meals`);
    const meals = d.meals.map((m) => {
      if (!Array.isArray(m.items) || m.items.length > 20) throw bad('Invalid meal items');
      const items = m.items.map((it) => {
        const food = foodsById.get(it.foodId);
        if (!food) throw bad(`Unknown food: ${String(it.foodId).slice(0, 50)}`);
        return itemFor(food, num(it.grams, 0, 2000, 'grams'));
      });
      return { name: str(m.name, 40, 'meal name', true), title: m.title ? str(m.title, 60, 'meal title') : undefined, items, totals: totalsOf(items) };
    });
    return { day: di + 1, meals, totals: totalsOf(meals.flatMap((m) => m.items)) };
  });
  const avg = (k) => Math.round(days.reduce((a, d) => a + d.totals[k], 0) / days.length);
  return { ...data, days, summary: { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f') } };
}

const planRow = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);
const activePlan = (db, uid) => planRow(db.prepare("SELECT * FROM plans WHERE user_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(uid));
/**
 * The meals of the plan day for `date` as they stand: the plan's meals with any "just today"
 * whole-meal swap applied (meal_swaps). Item refs stay `${idx}-${mi}-${ii}` either way.
 * Returns { idx, meals }.
 */
function dayMeals(db, uid, plan, date) {
  const idx = dayIndex(plan.start_date, date, plan.data.days.length);
  const rows = db.prepare('SELECT * FROM meal_swaps WHERE user_id = ? AND date = ?').all(uid, date);
  const by = new Map(rows.map((r) => [r.meal_idx, r]));
  const meals = plan.data.days[idx].meals.map((m, mi) => {
    const r = by.get(mi);
    if (!r) return m;
    const items = JSON.parse(r.items);
    return { ...m, tpl: r.tpl ?? undefined, title: r.title ?? m.title, items, totals: totalsOf(items), mealSwappedFrom: m.title ?? m.name };
  });
  return { idx, meals };
}
const planForDate = (db, uid, date) => planRow(db.prepare("SELECT * FROM plans WHERE user_id = ? AND status IN ('active','archived') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY version DESC LIMIT 1").get(uid, date, date));

// Builds a draft plan for admin review. `ai: true` asks the AI for the menu (slow, async);
// otherwise the instant template engine is used (onboarding must not wait on a network call).
function planInputs(db, uid) {
  const prof = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  if (!prof) throw bad('This user has not completed their profile yet');
  const data = JSON.parse(prof.data);
  const t = effectiveTargets(prof);
  return {
    targets: { kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG },
    prefs: data.prefs,
    foods: loadFoods(db),
    seed: Date.now() % 100000, // a new draft each time the admin regenerates
  };
}

function savePendingPlan(db, uid, plan, note) {
  // A newer draft replaces an unreviewed one: delete it instead of piling up old plans.
  db.prepare("DELETE FROM plans WHERE user_id = ? AND status = 'pending'").run(uid);
  const version = (db.prepare('SELECT MAX(version) v FROM plans WHERE user_id = ?').get(uid).v ?? 0) + 1;
  const r = db.prepare("INSERT INTO plans (user_id, version, status, data, note) VALUES (?, ?, 'pending', ?, ?)").run(uid, version, JSON.stringify(plan), note);
  const id = Number(r.lastInsertRowid);
  autoReview(db, 'plans', id); // the AI admin approves it now if it passes the safety rules
  return id;
}

// Plan engine version. v4 (Oct 2026): Egyptian day shape (see plan.js STRUCTURES). v3: protein dosed on reference weight, whole units, no repeated foods,
// budget and whey preferences. Older AI-approved plans are rebuilt once (see upgradePlan).
const ENGINE = 4; // v4: lunch is the one cooked meal, light dinners, whole-meal swaps

/**
 * Bring a person's targets and plan up to the current engine, once. Only when the AI made the
 * plan (nothing a human admin set by hand) and nothing is logged today, so a day in progress is
 * never reshuffled; otherwise it waits for a fresh day.
 */
function upgradePlan(db, uid, today) {
  const prof = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  if (!prof || prof.targets_override) return false;
  if ((JSON.parse(prof.targets).engine ?? 1) >= ENGINE) return false;
  const plan = activePlan(db, uid);
  if (plan && plan.approved_by != null) return false; // a person approved this plan: leave it
  if (db.prepare('SELECT 1 FROM logs WHERE user_id = ? AND date = ? LIMIT 1').get(uid, today)) return false;
  const data = JSON.parse(prof.data);
  db.prepare('UPDATE profiles SET targets = ? WHERE user_id = ?').run(JSON.stringify(targetsFor(data, learnedAdjust(prof))), uid);
  if (plan) makePendingPlan(db, uid, 'Rebuilt with the improved plan engine');
  return true;
}

function makePendingPlan(db, uid, note = null) {
  return savePendingPlan(db, uid, generatePlan(planInputs(db, uid)), note);
}

async function makePendingPlanAI(db, uid, note = null) {
  const plan = await generatePlanSmart(planInputs(db, uid));
  return savePendingPlan(db, uid, plan, note);
}

// ---------- logs & scoring ----------
const sumLogs = (logs) => logs.filter((l) => l.status !== 'skipped').reduce((a, l) => ({ kcal: a.kcal + l.kcal, p: a.p + l.p, c: a.c + l.c, f: a.f + l.f }), { kcal: 0, p: 0, c: 0, f: 0 });
const r1 = (n) => Math.round(n * 10) / 10;
const roundMacros = (m) => ({ kcal: Math.round(m.kcal), p: r1(m.p), c: r1(m.c), f: r1(m.f) });

/**
 * Diet food vs everything else. Diet food (planned items eaten, adjusted or swapped for a diet
 * food, plus diet foods added to a meal) earns the calorie, protein and meal-match points;
 * logging-only foods (pizza, a latte, sauces) and custom entries count toward the day's total,
 * and so toward the over-target penalty, but never earn points.
 */
const isPlanLog = (l, off) => !l.ref.startsWith('extra:') && l.status !== 'skipped' && !(l.status === 'swapped' && off.has(l.food_id));
const isDietExtra = (l, off) => l.ref.startsWith('extra:') && l.food_id && !off.has(l.food_id);

// Eating-out food (pizza, a shawarma, a latte) eaten IN a meal counts like diet food when the meal,
// with it, still matches its plan (OFFPLAN_MEAL_MATCH); otherwise it only counts toward calories.
const isOffMealLog = (l, off) => Boolean(l.food_id) && off.has(l.food_id) && (l.ref.startsWith('extra:') || l.status === 'swapped');
const addMacros = (to, l) => { for (const k of ['kcal', 'p', 'c', 'f']) to[k] += l[k]; };

/**
 * Each meal's plan (after "just today" swaps and trims) and the food that counts for it: diet food,
 * plus eating-out food logged in the meal when the meal still matches its plan.
 * Returns [{ name, planned: {kcal,p,c,f}, eaten: {kcal,p,c,f}, logged, offLogs, offCounted }].
 */
function mealTotals(db, uid, plan, date, logs, off) {
  const { idx, meals } = dayMeals(db, uid, plan, date);
  const swaps = new Map(db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ?').all(uid, date).map((r) => [r.ref, r]));
  const foods = swaps.size ? new Map(loadFoods(db, { includeInactive: true }).map((f) => [f.id, f])) : null;
  const byRef = new Map(logs.map((l) => [l.ref, l]));
  return meals.map((m, mi) => {
    const planned = { kcal: 0, p: 0, c: 0, f: 0 }; const eaten = { kcal: 0, p: 0, c: 0, f: 0 };
    const offLogs = [];
    let logged = false;
    m.items.forEach((it, ii) => {
      const ref = `${idx}-${mi}-${ii}`;
      const sw = swaps.get(ref); const sf = sw && foods.get(sw.food_id);
      const item = sf ? itemFor(sf, sw.grams) : it;
      addMacros(planned, item);
      const l = byRef.get(ref);
      if (l) logged = true;
      if (l && isPlanLog(l, off)) addMacros(eaten, l);
      else if (l && isOffMealLog(l, off)) offLogs.push(l); // "ate a pizza instead" of this item
    });
    for (const l of logs) {
      if (l.meal !== mi || !l.ref.startsWith('extra:')) continue;
      logged = true;
      if (isDietExtra(l, off)) addMacros(eaten, l);
      else if (isOffMealLog(l, off)) offLogs.push(l);
    }
    let offCounted = false;
    if (offLogs.length) {
      const withOff = { ...eaten };
      for (const l of offLogs) addMacros(withOff, l);
      // Counted only when it helps: a latte on top of a full breakfast never costs meal points
      // (eating over the day's target is what the over-target penalty is for).
      const m = mealMatch(planned, withOff) ?? 0;
      if (m >= OFFPLAN_MEAL_MATCH && m >= (mealMatch(planned, eaten) ?? 0)) { offCounted = true; Object.assign(eaten, withOff); }
    }
    return { name: m.name, planned, eaten, logged, offLogs, offCounted };
  });
}

function scoreDay(db, uid, date, plan, targets) {
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date);
  const consumed = sumLogs(logs);
  const off = offplanIds(db);
  const meals = mealTotals(db, uid, plan, date, logs, off);
  // Diet food, plus eating-out food in meals that still matched their plan.
  const dietLogs = [...logs.filter((l) => isPlanLog(l, off) || isDietExtra(l, off)), ...meals.flatMap((m) => (m.offCounted ? m.offLogs : []))];
  const itemsDone = logs.filter((l) => isPlanLog(l, off)).length;
  const goal = targets.goal ?? (JSON.parse(db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(uid)?.data ?? '{}').goal);
  const s = dayScore({ targets: { kcal: targets.kcal, proteinG: targets.proteinG, goal }, consumed, planConsumed: sumLogs(dietLogs), itemsTotal: 0, itemsDone, meals, loggedSameDay: logs.some((l) => l.logged_on === date), workout: workoutState(db, uid, date), water: waterFor(db, uid, date) });
  return {
    date, total: s.total, parts: s.parts, consumed: roundMacros(consumed),
    // Per meal: how close it came to its plan (null until something is logged in it), and whether
    // eating-out food in it counted (true), did not because the meal was too far off (false), or none was eaten (null).
    meals: meals.map((m) => ({ name: m.name, match: m.logged ? Math.round((mealMatch(m.planned, m.eaten) ?? 0) * 100) : null, offCounted: m.offLogs.length ? m.offCounted : null })),
  };
}

function scoresBetween(db, uid, from, to) {
  const prof = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  if (!prof) return [];
  const targets = effectiveTargets(prof);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const plan = planForDate(db, uid, d);
    if (plan) out.push(scoreDay(db, uid, d, plan, targets));
  }
  return out;
}

const audit = (db, actor, action, targetUserId = null, detail = null) =>
  db.prepare('INSERT INTO audit (actor_id, action, target_user_id, detail) VALUES (?, ?, ?, ?)').run(actor, action, targetUserId, detail ? JSON.stringify(detail).slice(0, 4000) : null);

// ---------- context helpers ----------
function subjectId(ctx, src = {}) {
  const raw = src.userId ?? ctx.query.get('userId');
  if (raw === undefined || raw === null || raw === '') return ctx.user.id;
  if (ctx.user.role !== 'admin') throw forbidden('Admin only');
  const id = Number(raw);
  if (!ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound('User not found');
  return id;
}
// Profile picture URL, versioned so a new photo shows at once while the old one stays cached.
export const avatarUrl = (u) => (u?.avatar_at ? `/api/avatar/${u.id}?v=${encodeURIComponent(u.avatar_at)}` : null);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: Boolean(u.active), private: Boolean(u.private), avatar: avatarUrl(u) });

// ---------- routes ----------
const routes = [];
const route = (method, pattern, access, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, access, handler });
};

// --- public
route('GET', '/api/status', 'public', ({ db }) => ({ needsSetup: db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 }));

function createSession(ctx, userId) {
  const token = newToken();
  const days = 30;
  ctx.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, new Date(Date.now() + days * 86400000).toISOString());
  const secure = process.env.FITCREW_FORCE_HTTPS === '1' || ctx.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  ctx.setCookie = `fc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${secure}`;
}

function addUser(db, { name, mail, password, role }) {
  const pwErr = checkPasswordStrength(password);
  if (pwErr) throw bad(pwErr);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) throw bad('That email is already registered');
  const { salt, hash } = hashPassword(password);
  const r = db.prepare('INSERT INTO users (email, name, role, pass_salt, pass_hash) VALUES (?, ?, ?, ?, ?)').run(mail, name, role, salt, hash);
  return Number(r.lastInsertRowid);
}

route('POST', '/api/setup', 'public', (ctx) => {
  if (ctx.db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) throw forbidden('Setup is already done');
  const id = addUser(ctx.db, { name: str(ctx.body.name, 60, 'name', true), mail: email(ctx.body.email), password: ctx.body.password, role: 'admin' });
  audit(ctx.db, id, 'setup.admin_created', id);
  createSession(ctx, id);
  return { ok: true };
});

const attempts = new Map();
route('POST', '/api/login', 'public', (ctx) => {
  const mail = email(ctx.body.email);
  const key = `${ctx.req.socket.remoteAddress}|${mail}`;
  const a = attempts.get(key);
  if (a && a.resetAt > Date.now() && a.count >= 8) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const u = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  const ok = u && u.active && typeof ctx.body.password === 'string' && verifyPassword(ctx.body.password, u.pass_salt, u.pass_hash);
  if (!ok) {
    const cur = a && a.resetAt > Date.now() ? a : { count: 0, resetAt: Date.now() + 10 * 60000 };
    cur.count++;
    attempts.set(key, cur);
    throw new HttpError(401, 'Wrong email or password');
  }
  attempts.delete(key);
  createSession(ctx, u.id);
  return { ok: true };
});

route('POST', '/api/register', 'public', (ctx) => {
  const code = str(ctx.body.code, 40, 'invite code', true).toUpperCase();
  const inv = ctx.db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
  if (!inv || inv.used_by || inv.expires_at < new Date().toISOString()) throw bad('That invite code is invalid or has expired');
  const id = addUser(ctx.db, { name: str(ctx.body.name, 60, 'name', true), mail: email(ctx.body.email), password: ctx.body.password, role: 'user' });
  ctx.db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(id, code);
  if (inv.private) ctx.db.prepare('UPDATE users SET private = 1 WHERE id = ?').run(id); // private from the first second
  audit(ctx.db, id, 'user.registered', id, { code });
  createSession(ctx, id);
  return { ok: true };
});

// --- any signed-in user
route('POST', '/api/logout', 'user', (ctx) => {
  const tok = ctx.cookies.fc_session;
  if (tok) ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(tok));
  ctx.setCookie = 'fc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
  return { ok: true };
});

route('GET', '/api/me', 'user', (ctx) => {
  const uid = subjectId(ctx);
  if (uid === ctx.user.id) { try { upgradePlan(ctx.db, uid, isDate(ctx.query.get('today')) ? ctx.query.get('today') : todayUtc()); } catch (e) { console.warn('[upgrade]', e.message); } }
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const pending = ctx.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'pending'").get(uid);
  return {
    user: publicUser(ctx.user),
    profile: prof ? JSON.parse(prof.data) : null,
    targets: effectiveTargets(prof),
    hasActivePlan: Boolean(activePlan(ctx.db, uid)),
    hasPendingPlan: Boolean(pending),
    coachUnread: ctx.db.prepare('SELECT COUNT(*) n FROM coach_messages WHERE user_id = ? AND read_at IS NULL').get(ctx.user.id).n,
    // Changes when the admin runs "Start everyone over": phones clear their local tips and caches.
    freshStartAt: getSetting(ctx.db, 'freshStartAt', null),
  };
});

route('PUT', '/api/profile', 'user', async (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const foodIds = new Set(loadFoods(ctx.db).map((f) => f.id));
  const data = cleanProfile(ctx.body.profile, foodIds);
  const existing = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const targets = targetsFor(data, learnedAdjust(existing));
  if (existing) {
    ctx.db.prepare("UPDATE profiles SET data = ?, targets = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(JSON.stringify(data), JSON.stringify(targets), uid);
  } else {
    ctx.db.prepare('INSERT INTO profiles (user_id, data, targets) VALUES (?, ?, ?)').run(uid, JSON.stringify(data), JSON.stringify(targets));
  }
  // The setup weight is the first point on the weight trend (so Today does not ask again at once).
  if (!existing && data.weightKg) {
    const day = isDate(ctx.body.today) ? ctx.body.today : todayUtc();
    ctx.db.prepare("INSERT OR IGNORE INTO body_metrics (user_id, date, weight_kg, measurements, notes) VALUES (?, ?, ?, '{}', '')").run(uid, day, data.weightKg);
  }
  // Onboarding triggers a first draft for the admin to review. Later edits do not auto-replace plans.
  let planId = null;
  if (!existing && !activePlan(ctx.db, uid)) planId = makePendingPlan(ctx.db, uid, 'Auto-generated after onboarding');
  if (!existing && !ctx.db.prepare("SELECT 1 FROM workout_plans WHERE user_id = ? AND status IN ('active','pending')").get(uid)) await makePendingWorkoutPlan(ctx.db, uid, 'Auto-generated after onboarding');
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'profile.edited_by_admin', uid, data);
  return { ok: true, targets: effectiveTargets(ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid)), pendingPlanId: planId };
});

// Foods with the units each can be logged in (eggs, cups, slices, g).
//   no q             the whole list (onboarding likes, admin plan editor, admin foods)
//   q=...            search (search.js: Arabic + English, any word order, Egyptian spellings),
//                    best first; empty q with recent=1 gives the person's recent "other foods"
//   offplan=1        also off-plan foods (pizza, sweets), after the diet foods; only the
//                    "Add food" sheet and the admin list ask for them, never swaps
// Quick adds shown before typing: the everyday drinks and extras of an Egyptian day.
const POPULAR = ['tea-sugar', 'turkish-coffee-sugar', 'nescafe-3in1', 'nescafe-milk', 'cappuccino', 'orange-juice', 'milk', 'sugar', 'tea'];

route('GET', '/api/foods', 'user', (ctx) => {
  const withOff = ctx.query.get('offplan') === '1';
  const foods = loadFoods(ctx.db, { offplan: withOff });
  const out = (list) => list.map((f) => ({ ...f, units: unitsFor(f), treat: isTreat(f) }));
  if (!ctx.query.has('q')) return { foods: out(foods) };
  const q = ctx.query.get('q');
  // Diet foods first, but never so many that eating-out matches fall off the list ("chicken"
  // must still reach nuggets and shawarma): up to 20 diet foods and 40 others.
  if (norm(q)) {
    const hits = searchFoods(foods, q, 400);
    return { foods: out([...hits.filter((f) => !f.offplan).slice(0, 20), ...hits.filter((f) => f.offplan).slice(0, 40)]) };
  }
  // Empty search in Add food: recent foods, and the drinks people add all the time.
  const popular = withOff && ctx.query.get('popular') === '1'
    ? out(POPULAR.map((id) => foods.find((f) => f.id === id)).filter(Boolean)) : undefined;
  if (ctx.query.get('recent') !== '1') return { foods: [], popular };
  const uid = subjectId(ctx);
  const byId = new Map(foods.map((f) => [f.id, f]));
  const recent = ctx.db.prepare(`SELECT food_id, MAX(id) last FROM logs WHERE user_id = ? AND food_id IS NOT NULL
      AND (ref LIKE 'extra:%' OR status = 'swapped') AND date >= ? GROUP BY food_id ORDER BY last DESC LIMIT 12`).all(uid, addDays(todayUtc(), -30))
    .map((r) => byId.get(r.food_id)).filter(Boolean).slice(0, 8);
  const seen = new Set(recent.map((f) => f.id));
  return { foods: out(recent), recent: true, popular: popular?.filter((f) => !seen.has(f.id)) };
});

route('GET', '/api/plan', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const plan = activePlan(ctx.db, uid);
  const pending = ctx.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'pending'").get(uid);
  if (!plan) return { plan: null, hasPending: Boolean(pending) };
  // Each item gets a human amount ("3 eggs", "70 g dry ≈ 196 g cooked") and how many swaps exist.
  const all = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
  const pool = poolFor(ctx, uid);
  const idx = dayIndex(plan.start_date, todayUtc(), plan.data.days.length);
  const days = plan.data.days.map((d, di) => ({
    ...d,
    meals: d.meals.map((m, mi) => ({ ...m, items: m.items.map((it, ii) => {
      const f = all.get(it.foodId);
      return { ...it, ref: `${di}-${mi}-${ii}`, amount: f ? describeAmount(f, it.grams) : `${it.grams} g`, hint: f ? amountHint(f, it.grams) : null, alts: f ? alternatives(f, it.grams, pool).length : 0, ar: f?.ar ?? '' };
    }) })),
  }));
  return { plan: { id: plan.id, version: plan.version, startDate: plan.start_date, ...plan.data, days, todayIdx: idx }, hasPending: Boolean(pending) };
});

route('POST', '/api/plan/request-change', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const note = str(ctx.body.note, 600, 'note', true);
  ctx.db.prepare('INSERT INTO change_requests (user_id, note) VALUES (?, ?)').run(uid, note);
  return { ok: true };
});

route('GET', '/api/today', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const date = needDate(ctx.query.get('date'));
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const targets = effectiveTargets(prof);
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  if (!plan) {
    const pending = ctx.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'pending'").get(uid);
    return { date, plan: null, hasPending: Boolean(pending), targets };
  }
  const { idx, meals: planMeals } = dayMeals(ctx.db, uid, plan, date);
  const logs = ctx.db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date);
  const byRef = new Map(logs.map((l) => [l.ref, l]));
  const swaps = new Map(ctx.db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ?').all(uid, date).map((r) => [r.ref, r]));
  let foodsById = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
  const meals = planMeals.map((m, mi) => ({
    name: m.name,
    title: m.title,
    mealSwappedFrom: m.mealSwappedFrom,
    items: m.items.map((it0, ii) => {
      const key = `${idx}-${mi}-${ii}`;
      const sw = swaps.get(key);
      const it = sw && foodsById.get(sw.food_id)
        ? { ...itemFor(foodsById.get(sw.food_id), sw.grams), ...(sw.food_id !== it0.foodId ? { swappedFrom: it0.name } : { resizedFrom: it0.grams }) }
        : it0;
      const l = byRef.get(key);
      const fd = (foodsById ?? (foodsById = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f])))).get(it.foodId);
      const lf = l?.food_id ? foodsById.get(l.food_id) : null;
      return {
        key, ...it,
        amount: fd ? describeAmount(fd, it.grams) : `${it.grams} g`,
        hint: fd ? amountHint(fd, it.grams) : null,
        ar: fd?.ar ?? '',
        units: fd ? unitsFor(fd) : [{ key: 'g', name: 'g', plural: 'g', g: 1, step: 5, grams: true }],
        per100: fd ? { kcal: fd.kcal, p: fd.p, c: fd.c, f: fd.f } : null,
        log: l ? { status: l.status, foodId: l.food_id, name: l.name, grams: l.grams, kcal: l.kcal, p: l.p, c: l.c, f: l.f, amount: l.amount ?? (lf ? describeAmount(lf, l.grams) : `${l.grams} g`) } : null,
      };
    }),
  }));
  // Extra foods and drinks: inside the meal they were added to, or "Other food" when not placed
  // (older logs, or a meal that no longer exists after a plan change).
  const extraOf = (l) => {
    const lf = l.food_id ? foodsById.get(l.food_id) : null;
    return { ref: l.ref, name: l.name, foodId: l.food_id, grams: l.grams, offplan: Boolean(lf?.offplan), treat: isTreat(lf), meal: l.meal ?? null, amount: l.amount ?? (lf && l.grams ? describeAmount(lf, l.grams) : l.grams ? `${l.grams} g` : null), kcal: Math.round(l.kcal), p: r1(l.p), c: r1(l.c), f: r1(l.f) };
  };
  const allExtras = logs.filter((l) => l.ref.startsWith('extra:')).sort((a, b) => a.id - b.id).map(extraOf);
  meals.forEach((m, mi) => { m.extras = allExtras.filter((e) => e.meal === mi); });
  const extras = allExtras.filter((e) => e.meal === null || e.meal >= meals.length);
  return {
    date, dayIdx: idx, planId: plan.id, targets, meals, extras, water: waterFor(ctx.db, uid, date),
    // What the day adds up to if everything not yet logged is eaten as planned.
    projectedKcal: Math.round(sumLogs(logs).kcal + meals.flatMap((m) => m.items).filter((i) => !i.log).reduce((a, i) => a + i.kcal, 0)),
    consumed: roundMacros(sumLogs(logs)),
    score: scoreDay(ctx.db, uid, date, plan, targets),
  };
});

// ---------- AI coach ----------
const coachRow = (r) => ({ id: r.id, role: r.role, kind: r.kind, content: r.content, data: r.data ? JSON.parse(r.data) : null, at: r.created_at });

route('GET', '/api/coach', 'user', (ctx) => {
  const uid = ctx.user.id; // the coach is personal: admins do not read other people's chats
  const before = Number(ctx.query.get('before') ?? 0) || Number.MAX_SAFE_INTEGER;
  const rows = ctx.db.prepare('SELECT * FROM coach_messages WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 40').all(uid, before).reverse();
  ctx.db.prepare('UPDATE coach_messages SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').run(uid);
  return { messages: rows.map(coachRow), more: rows.length === 40 };
});

route('POST', '/api/coach', 'user', async (ctx) => {
  const uid = ctx.user.id;
  const text = str(ctx.body.text, 2000, 'message', true);
  const today = isDate(ctx.body.today) ? ctx.body.today : todayUtc();
  const history = ctx.db.prepare("SELECT role, content FROM coach_messages WHERE user_id = ? AND kind IN ('chat','checkin') ORDER BY id DESC LIMIT 16").all(uid).reverse();
  const ins = ctx.db.prepare('INSERT INTO coach_messages (user_id, role, kind, content, data, read_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
  const userMsgId = Number(ins.run(uid, 'user', 'chat', text, null).lastInsertRowid);
  let out;
  try {
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(ctx.body.clock ?? '')) ? ctx.body.clock : null;
    out = await coachTurn({ db: ctx.db, user: ctx.user, text, today, clock, history });
  } catch (e) {
    console.warn('[coach]', e.message, e.body ?? '');
    out = { reply: e.name === 'AbortError' ? 'That took too long on the AI side. Try again in a moment.' : 'I could not reach the AI right now. Try again in a minute; the rest of the app works as normal.', actions: [], failed: true };
  }
  const foodsById = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
  const labels = out.actions.map((a) => actionLabel(a, foodsById)).filter(Boolean);
  const changed = out.actions.some((a) => !a.result?.error && !['get_day', 'search_foods', 'list_alternatives', 'get_progress', 'get_workout', 'get_training_plan', 'exercise_alternatives', 'get_training_history', 'get_attendance', 'get_profile', 'get_plan', 'get_leaderboard', 'get_body', 'get_recap', 'get_feed'].includes(a.tool));
  const replyId = Number(ins.run(uid, 'assistant', 'chat', out.reply, JSON.stringify({ actions: labels, changed, failed: Boolean(out.failed) })).lastInsertRowid);
  const rows = ctx.db.prepare('SELECT * FROM coach_messages WHERE id IN (?, ?) ORDER BY id').all(userMsgId, replyId);
  return { messages: rows.map(coachRow), changed };
});

// ---------- phone notifications ----------
route('GET', '/api/push/key', 'user', (ctx) => ({ publicKey: vapidKeys(ctx.db).publicKey }));

route('POST', '/api/push/subscribe', 'user', (ctx) => {
  const endpoint = str(ctx.body.endpoint, 1000, 'endpoint', true);
  if (!/^https:\/\//.test(endpoint)) throw bad('Bad push endpoint');
  const p256dh = str(ctx.body.keys?.p256dh, 200, 'p256dh', true);
  const auth = str(ctx.body.keys?.auth, 100, 'auth', true);
  ctx.db.prepare('INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth').run(endpoint, ctx.user.id, p256dh, auth);
  return { ok: true };
});

route('POST', '/api/push/unsubscribe', 'user', (ctx) => {
  ctx.db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String(ctx.body.endpoint ?? ''), ctx.user.id);
  return { ok: true };
});

route('POST', '/api/push/test', 'user', async (ctx) => {
  const r = await pushToUser(ctx.db, ctx.user.id, { title: 'FitCrew', body: 'Notifications are on. Your coach will check in every morning and evening.', url: '/#/today', tag: 'test' });
  return { ok: true, ...r };
});

// ---------- AI admin settings ----------
route('GET', '/api/admin/settings', 'admin', (ctx) => ({
  aiAutoApprove: getSetting(ctx.db, 'aiAutoApprove', true),
  timezone: getSetting(ctx.db, 'timezone', 'Africa/Cairo'),
  competitionPrize: getSetting(ctx.db, 'competitionPrize', '') || null,
  aiConfigured: Boolean(process.env.FITCREW_AI_KEY?.trim()),
  aiModel: getSetting(ctx.db, 'aiModelPreferred', null) ?? getSetting(ctx.db, 'aiModelWorking', null) ?? process.env.FITCREW_AI_MODEL ?? DEFAULT_MODEL,
  aiLastError: getSetting(ctx.db, 'aiLastError', null),
  // Check-ins count at once; what needs a look is a photo flagged as a repeat that no admin has checked yet.
  pendingCheckins: ctx.db.prepare(`SELECT COUNT(*) n FROM checkins WHERE status <> 'rejected' AND (status = 'pending'
    OR (verdict LIKE '%"flag":true%' AND verdict NOT LIKE '%"admin":%'))`).get().n,
}));

// One real round trip to the AI, with tools, so the admin sees exactly what works.
route('POST', '/api/admin/ai-test', 'admin', async (ctx) => {
  const cfg = aiConfig();
  if (!cfg) return { ok: false, message: 'No FITCREW_AI_KEY is set on the server.' };
  const started = Date.now();
  try {
    const msg = await aiChat(cfg, [{ role: 'system', content: 'Reply with the single word: ready' }, { role: 'user', content: 'Are you there?' }], { db: ctx.db });
    setSetting(ctx.db, 'aiLastError', null);
    return { ok: true, model: getSetting(ctx.db, 'aiModelWorking', cfg.model), ms: Date.now() - started, reply: String(msg.content ?? '').slice(0, 120) };
  } catch (e) {
    return { ok: false, model: e.model ?? cfg.model, status: e.status ?? null, message: e.name === 'AbortError' ? 'Timed out after 60 s' : e.message, body: e.body ?? null, ms: Date.now() - started };
  }
});

// Benchmark: which models are available, how fast each answers a real tool-calling request,
// and whether it actually calls the tool. Runs in parallel, 30 s cap per model.
const BENCH_FAMILIES = /kimi|deepseek-v|glm|qwen3|llama-4|llama-3\.3|gpt-oss|mistral-(medium|large|small)|nemotron-(super|ultra|3)/i;
/** Featured models first (BENCH_PRIORITY), then the rest; models this account cannot use go last. */
/**
 * What is wrong with a benchmark answer, or null when it would log the breakfast right:
 * meal = breakfast, and 100 g bread, 2 scrambled eggs (120 g), 10 g cheddar, 1 sachet (18 g), 100 ml milk.
 */
export function benchProblem(args, foods) {
  if (mealIndex([{ name: 'Breakfast' }, { name: 'Lunch' }, { name: 'Dinner' }], args.meal ?? '') !== 0) return `meal was "${args.meal ?? 'missing'}"`;
  const items = Array.isArray(args.items) ? args.items : [];
  const want = [['baladi-bread', 100, 'bread 100 g'], ['eggs-scrambled', 120, '2 eggs'], ['cheddar', 10, 'cheddar 10 g'], ['nescafe-3in1', 18, '1 Nescafé sachet'], ['milk', 100, 'milk 100 ml']];
  for (const [id, grams, label] of want) {
    const hit = items.map((i) => {
      const food = foods.find((f) => f.id === i?.foodId) ?? (i?.name || i?.foodId ? findFood(foods, String(i.name ?? i.foodId)) : null);
      if (!food || (food.id !== id && !(id === 'baladi-bread' && food.cat === 'carb') && !(id === 'eggs-scrambled' && /^eggs/.test(food.id)))) return null;
      try { return amountFor(food, i).grams; } catch { return -1; }
    }).filter((g) => g !== null);
    if (!hit.length) return `missed ${label}`;
    if (!hit.some((g) => Math.abs(g - grams) <= grams * 0.05)) return `${label} logged as ${Math.round(hit[0])} g`;
  }
  return null;
}

export function benchOrder(ids, unavailable) {
  const rank = (id) => { const i = BENCH_PRIORITY.findIndex((re) => re.test(id)); return (unavailable.has(id) ? 100 : 0) + (i < 0 ? 50 : i); };
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
route('POST', '/api/admin/ai-benchmark', 'admin', async (ctx) => {
  const cfg = aiConfig();
  if (!cfg) return { ok: false, message: 'No FITCREW_AI_KEY is set on the server.' };
  let ids = [];
  try {
    const r = await fetch(`${cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${cfg.key}` } });
    ids = (await r.json()).data.map((m) => m.id).filter((id) => BENCH_FAMILIES.test(id) && !/coder|embed|vision|guard|reward|-vl|safety|retriever/i.test(id));
  } catch (e) { return { ok: false, message: `Could not list models: ${e.message}` }; }
  // Models that answered "not available on your account" last time are tried after the others.
  const unavailable = new Set(getSetting(ctx.db, 'aiUnavailable', []));
  ids = benchOrder(ids, unavailable);
  // The test is a real report from the crew: several foods, mixed units, one meal, in English.
  const tool = { type: 'function', function: { name: 'log_foods', description: 'Log what the person ate: one call per meal with every item, in their own amounts.', parameters: { type: 'object', properties: { meal: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { foodId: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, grams: { type: 'number' } } } } }, required: ['items'] } } };
  const benchFoods = loadFoods(ctx.db, { offplan: true });
  const one = async (model) => {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 30_000); const t0 = Date.now();
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model, max_tokens: 4096, temperature: 0, tools: [tool], tool_choice: 'auto', messages: [
          { role: 'system', content: 'You log food for the user with log_foods. Meals today: breakfast, lunch, dinner. Foods: baladi-bread (loaf = 90 g), eggs-scrambled (egg = 60 g), cheddar (slice = 20 g), nescafe-3in1 (sachet = 18 g), milk (ml), sugar (tsp, tbsp). Never convert amounts: pass what they said.' },
          { role: 'user', content: 'scrambled eggs sandwich for breakfast (100gm bread, 2 eggs, 10 gm cheddar) and a nescafe 3 in 1 with 100ml milk' }] }),
      });
      const ms = Date.now() - t0;
      if (!res.ok) return { model, ok: false, ms, error: res.status === 404 ? 'Not available on your NVIDIA account' : res.status === 429 ? 'Rate limited right now' : `HTTP ${res.status}` };
      const choice = (await res.json()).choices?.[0] ?? {};
      const msg = normalizeToolCalls(choice.message ?? {}, new Set(['log_foods']));
      const call = msg.tool_calls?.find((c) => c.function?.name === 'log_foods');
      let args = null;
      try { args = call ? JSON.parse(call.function.arguments || '{}') : null; } catch { args = null; }
      // Judged the way the app would log it (same food lookup and unit maths), so any valid way
      // of saying the amounts passes and the reason for a fail is shown.
      const problem = !call ? (choice.finish_reason === 'length' ? 'ran out of room while thinking' : `answered in text: "${String(msg.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 70)}"`)
        : !args ? 'tool call was not valid JSON' : benchProblem(args, benchFoods);
      return { model, ok: true, ms, toolCall: Boolean(call), correct: !problem, problem };
    } catch (e) { return { model, ok: false, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'Over 30 s (too slow or overloaded right now)' : e.message }; }
    finally { clearTimeout(timer); }
  };
  const results = await Promise.all(ids.slice(0, 16).map(one));
  setSetting(ctx.db, 'aiUnavailable', [...new Set([...unavailable, ...results.filter((x) => x.error?.startsWith('Not available')).map((x) => x.model)])]
    .filter((m) => !results.some((x) => x.model === m && x.ok)));
  // Usable = answered and called the tool correctly; fastest first.
  results.sort((a, b) => (b.correct - a.correct) || (b.ok - a.ok) || a.ms - b.ms);
  return { ok: true, current: getSetting(ctx.db, 'aiModelPreferred', null) ?? getSetting(ctx.db, 'aiModelWorking', null) ?? cfg.model, results };
});

route('PUT', '/api/admin/settings', 'admin', (ctx) => {
  if (ctx.body.aiAutoApprove !== undefined) setSetting(ctx.db, 'aiAutoApprove', Boolean(ctx.body.aiAutoApprove));
  if (ctx.body.aiModel !== undefined) setSetting(ctx.db, 'aiModelPreferred', ctx.body.aiModel ? str(ctx.body.aiModel, 120, 'aiModel') : null);
  if (ctx.body.timezone !== undefined) {
    const tz = str(ctx.body.timezone, 60, 'timezone', true);
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw bad('Unknown time zone'); }
    setSetting(ctx.db, 'timezone', tz);
  }
  audit(ctx.db, ctx.user.id, 'settings.updated', null, ctx.body);
  return { ok: true };
});

// ---------- water ----------
// Target: ~40 ml per kg of body weight, between 2.5 and 4.5 litres, rounded to 250 ml.
function waterFor(db, uid, date) {
  const prof = db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(uid);
  const kg = prof ? JSON.parse(prof.data).weightKg : 75;
  const target = Math.min(4500, Math.max(2500, Math.round((kg * 40) / 250) * 250));
  const ml = db.prepare('SELECT ml FROM water_logs WHERE user_id = ? AND date = ?').get(uid, date)?.ml ?? 0;
  // Points for this much water (5 at the target, up to 7), the same number the day's score uses.
  return { ml, target, points: Math.round(waterPoints(ml, target) * 10) / 10 };
}

route('POST', '/api/water', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  // Water earns points, so it is logged on the day (yesterday still allowed, for time zones and a
  // late-night glass), never added to older days or ahead.
  if (date < addDays(todayUtc(), -1) || date > addDays(todayUtc(), 1)) throw bad('Water can only be logged for today or yesterday.');
  const cur = waterFor(ctx.db, uid, date).ml;
  const ml = ctx.body.set !== undefined ? Math.round(num(ctx.body.set, 0, 10000, 'set')) : Math.max(0, cur + Math.round(num(ctx.body.add, -5000, 5000, 'add')));
  ctx.db.prepare('INSERT INTO water_logs (user_id, date, ml) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET ml = excluded.ml').run(uid, date, Math.min(ml, 10000));
  return { ok: true, water: waterFor(ctx.db, uid, date) };
});

// ---------- self-service plan changes (also used by the AI coach) ----------
// A new plan goes through the AI admin review: it is live at once if it passes the safety rules.
async function regenerate(ctx, uid, note) {
  const id = await makePendingPlanAI(ctx.db, uid, note);
  const row = ctx.db.prepare('SELECT status, data FROM plans WHERE id = ?').get(id);
  return { planId: id, status: row.status, issues: JSON.parse(row.data).review?.issues ?? [] };
}

route('POST', '/api/plan/regenerate', 'user', async (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const note = str(ctx.body.note, 300, 'note') || 'New plan requested';
  const out = await regenerate(ctx, uid, note);
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'plan.regenerated_by_admin', uid, out);
  return { ok: true, ...out };
});

// Change food preferences without resending the whole profile. Lists accept add/remove.
// If the active plan now contains something the person excluded, a new plan is made.
route('POST', '/api/profile/prefs', 'user', async (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const row = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  if (!row) throw bad('Finish setting up your profile first');
  const data = JSON.parse(row.data);
  const b = ctx.body;
  const edit = (list, add, remove) => [...new Set([...(list ?? []).filter((x) => !(remove ?? []).includes(x)), ...(add ?? [])])];
  const prefs = { ...data.prefs };
  prefs.allergies = edit(prefs.allergies, b.excludeGroups, b.includeGroups);
  prefs.dislikedIds = edit(prefs.dislikedIds, b.dislike, b.undislike);
  prefs.likedIds = edit(prefs.likedIds, b.like, b.unlike);
  if (b.vegetarian !== undefined) prefs.vegetarian = Boolean(b.vegetarian);
  if (b.mealsPerDay !== undefined) prefs.mealsPerDay = b.mealsPerDay;
  if (b.trainTime !== undefined) prefs.trainTime = b.trainTime;
  const foodIds = new Set(loadFoods(ctx.db, { includeInactive: true }).map((f) => f.id));
  const clean = cleanProfile({ ...data, prefs }, foodIds);
  ctx.db.prepare('UPDATE profiles SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(JSON.stringify(clean), uid);
  // Does the current plan still fit? Structure changes or newly excluded foods need a new plan.
  const plan = activePlan(ctx.db, uid);
  const pool = new Set(filterFoods(loadFoods(ctx.db), clean.prefs).map((f) => f.id));
  const structural = b.mealsPerDay !== undefined || b.trainTime !== undefined || b.vegetarian !== undefined;
  const conflict = plan && plan.data.days.some((d) => d.meals.some((m) => m.items.some((i) => !pool.has(i.foodId))));
  const regenerated = plan && (structural || conflict) ? await regenerate(ctx, uid, 'Food preferences changed') : null;
  return { ok: true, prefs: clean.prefs, regenerated };
});

// Change goal or pace. Targets are recomputed with the same safety rules as onboarding.
route('POST', '/api/profile/goal', 'user', async (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const row = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  if (!row) throw bad('Finish setting up your profile first');
  const data = JSON.parse(row.data);
  const next = { ...data };
  if (ctx.body.goal !== undefined) next.goal = ctx.body.goal;
  if (ctx.body.weeklyRateKg !== undefined) next.weeklyRateKg = ctx.body.weeklyRateKg;
  if (ctx.body.weightKg !== undefined) next.weightKg = ctx.body.weightKg;
  if (ctx.body.activityLevel !== undefined) next.activityLevel = ctx.body.activityLevel;
  const foodIds = new Set(loadFoods(ctx.db, { includeInactive: true }).map((f) => f.id));
  const clean = cleanProfile(next, foodIds);
  const targets = targetsFor(clean, learnedAdjust(row));
  ctx.db.prepare('UPDATE profiles SET data = ?, targets = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(JSON.stringify(clean), JSON.stringify(targets), uid);
  const regenerated = activePlan(ctx.db, uid) ? await regenerate(ctx, uid, 'Goal changed') : null;
  return { ok: true, targets: effectiveTargets(ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid)), regenerated };
});

// ---------- swaps (food exchanges) ----------
// Resolves a plan item for a date: { plan, idx, mi, ii, item, food } or throws.
function planItem(ctx, uid, date, ref) {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(String(ref ?? ''));
  if (!m) throw bad('Bad item reference');
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  if (!plan) throw bad('No active plan');
  const { idx, meals } = dayMeals(ctx.db, uid, plan, date);
  const [mi, ii] = [Number(m[2]), Number(m[3])];
  const item = meals[mi]?.items[ii];
  if (Number(m[1]) !== idx || !item) throw bad('That item is not part of the plan for this day');
  const food = loadFoods(ctx.db, { includeInactive: true }).find((f) => f.id === item.foodId);
  if (!food) throw bad('That food no longer exists');
  return { plan, idx, mi, ii, item, food, mealSwapped: Boolean(meals[mi].mealSwappedFrom) };
}

// The foods this person eats: everything minus excluded groups, disliked foods and (if set) non-vegetarian.
function poolFor(ctx, uid) {
  const prof = ctx.db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(uid);
  const prefs = prof ? JSON.parse(prof.data).prefs ?? {} : {};
  return filterFoods(loadFoods(ctx.db), prefs);
}

route('GET', '/api/plan/alternatives', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const date = needDate(ctx.query.get('date'));
  const { item, food } = planItem(ctx, uid, date, ctx.query.get('ref'));
  const options = alternatives(food, item.grams, poolFor(ctx, uid)).map((a) => ({
    ...itemFor(a.food, a.grams), ar: a.food.ar, amount: describeAmount(a.food, a.grams), kcalDiff: a.kcalDiff, est: a.food.est,
  }));
  const group = exchangeGroup(food);
  return { item: { ...item, amount: describeAmount(food, item.grams) }, group, groupLabel: GROUP_LABEL[group], options };
});

route('POST', '/api/plan/swap', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const scope = oneOf(ctx.body.scope, ['today', 'always', 'reset'], 'scope');
  const { plan, idx, mi, ii, item, food, mealSwapped } = planItem(ctx, uid, date, ctx.body.ref);
  const ref = `${idx}-${mi}-${ii}`;
  if (scope === 'always' && mealSwapped) throw bad('This meal is changed for today only. Swap it just for today, or change the whole meal for every day.');
  if (scope === 'reset') {
    ctx.db.prepare('DELETE FROM day_swaps WHERE user_id = ? AND date = ? AND ref = ?').run(uid, date, ref);
    return { ok: true };
  }
  const to = poolFor(ctx, uid).find((f) => f.id === ctx.body.foodId);
  if (!to) throw bad('That food is not available for you');
  // The server computes the equivalent amount; the client's number is never trusted.
  const grams = equivalentGrams(food, item.grams, to);
  if (!grams) throw bad('Those two foods cannot be swapped');
  if (scope === 'today') {
    ctx.db.prepare('INSERT INTO day_swaps (user_id, date, ref, food_id, grams) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, date, ref) DO UPDATE SET food_id = excluded.food_id, grams = excluded.grams').run(uid, date, ref, to.id, grams);
    ctx.db.prepare("DELETE FROM logs WHERE user_id = ? AND date = ? AND ref = ? AND status = 'eaten'").run(uid, date, ref);
  } else {
    const data = plan.data;
    const day = data.days[idx];
    day.meals[mi].items[ii] = itemFor(to, grams);
    // Re-size the other items so the day stays on target (swaps add up otherwise).
    const foodsById = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
    const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
    const { grams: sized } = rebalanceDay({ meals: day.meals, foodsById, targets: effectiveTargets(prof), fixed: new Set([`${mi}-${ii}`]) });
    day.meals.forEach((m, a) => { m.items = m.items.map((it, b) => { const g = sized.get(`${a}-${b}`); return g && g !== it.grams ? itemFor(foodsById.get(it.foodId), g) : it; }); m.totals = totalsOf(m.items); });
    day.totals = totalsOf(day.meals.flatMap((m) => m.items));
    ctx.db.prepare('UPDATE plans SET data = ? WHERE id = ?').run(JSON.stringify(data), plan.id);
    ctx.db.prepare('DELETE FROM day_swaps WHERE user_id = ? AND ref = ? AND date >= ?').run(uid, ref, date);
    audit(ctx.db, ctx.user.id, 'plan.item_swapped', uid, { planId: plan.id, from: food.id, to: to.id, grams });
  }
  return { ok: true, grams, amount: describeAmount(to, grams) };
});

// ---------- whole-meal swaps ----------
// "Change this meal": other complete meals of the same kind (lunch for lunch, a light dinner for
// dinner) sized to the same calories and macros, so the day's numbers stay put. Mahshi with chicken
// becomes grilled chicken with rice, molokhia, fish and rice... never a lone dish from elsewhere.
function mealChoices(ctx, uid, date, mi) {
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  if (!plan) throw bad('No active plan');
  const { idx, meals } = dayMeals(ctx.db, uid, plan, date);
  const meal = meals[mi];
  if (!meal) throw bad('That meal is not part of the plan for this day');
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const prefs = prof ? JSON.parse(prof.data).prefs ?? {} : {};
  const foods = loadFoods(ctx.db);
  // Today's single-item swaps count as what is in the meal now.
  const swaps = new Map(ctx.db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ?').all(uid, date).map((r) => [r.ref, r]));
  const cur = (m, a) => ({ ...m, items: m.items.map((it, b) => { const sw = swaps.get(`${idx}-${a}-${b}`); return sw ? { foodId: sw.food_id, grams: sw.grams } : it; }) });
  const options = mealOptions({ meal: { ...cur(meal, mi), kind: kindOf(meal) }, others: meals.map(cur).filter((_, a) => a !== mi), prefs, foods, targets: effectiveTargets(prof) });
  return { plan, idx, meal, options };
}

route('GET', '/api/plan/meal-options', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const date = needDate(ctx.query.get('date'));
  const mi = Math.round(num(ctx.query.get('meal'), 0, 7, 'meal'));
  const { idx, meal, options } = mealChoices(ctx, uid, date, mi);
  const logged = ctx.db.prepare("SELECT COUNT(*) n FROM logs WHERE user_id = ? AND date = ? AND ref LIKE ?").get(uid, date, `${idx}-${mi}-%`).n;
  return {
    meal: { name: meal.name, title: meal.title, totals: totalsOf(meal.items), swappedFrom: meal.mealSwappedFrom ?? null },
    logged,
    options: options.map((o) => ({
      key: o.key, title: o.title, cooked: o.cooked, kcal: o.kcal, p: o.p, c: o.c, f: o.f,
      items: o.items.map((i) => ({ foodId: i.food.id, name: i.food.name, ar: i.food.ar, grams: i.grams, amount: describeAmount(i.food, i.grams), kcal: Math.round((i.food.kcal * i.grams) / 100) })),
    })),
  };
});

route('POST', '/api/plan/meal-swap', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const mi = Math.round(num(ctx.body.meal, 0, 7, 'meal'));
  const scope = oneOf(ctx.body.scope, ['today', 'always', 'reset'], 'scope');
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  if (!plan) throw bad('No active plan');
  const idx = dayIndex(plan.start_date, date, plan.data.days.length);
  if (!plan.data.days[idx]?.meals[mi]) throw bad('That meal is not part of the plan for this day');
  // Whatever was ticked or swapped in this meal today belonged to the old items: start it fresh.
  const clearDay = () => {
    ctx.db.prepare('DELETE FROM logs WHERE user_id = ? AND date = ? AND ref LIKE ?').run(uid, date, `${idx}-${mi}-%`);
    ctx.db.prepare('DELETE FROM day_swaps WHERE user_id = ? AND date = ? AND ref LIKE ?').run(uid, date, `${idx}-${mi}-%`);
  };
  if (scope === 'reset') {
    ctx.db.prepare('DELETE FROM meal_swaps WHERE user_id = ? AND date = ? AND meal_idx = ?').run(uid, date, mi);
    clearDay();
    return { ok: true };
  }
  const key = str(ctx.body.key, 80, 'key', true);
  const { options } = mealChoices(ctx, uid, date, mi);
  const pick = options.find((o) => o.key === key);
  if (!pick) throw bad('That meal is no longer an option. Open the list again.');
  const items = pick.items.map((i) => itemFor(i.food, i.grams));
  clearDay();
  if (scope === 'today') {
    ctx.db.prepare(`INSERT INTO meal_swaps (user_id, date, meal_idx, tpl, title, items) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date, meal_idx) DO UPDATE SET tpl = excluded.tpl, title = excluded.title, items = excluded.items`).run(uid, date, mi, pick.tpl, pick.title, JSON.stringify(items));
  } else {
    const data = plan.data;
    const old = data.days[idx].meals[mi];
    data.days[idx].meals[mi] = { name: old.name, kind: kindOf(old), tpl: pick.tpl, title: pick.title, items, totals: totalsOf(items) };
    data.days[idx].totals = totalsOf(data.days[idx].meals.flatMap((m) => m.items));
    ctx.db.prepare('UPDATE plans SET data = ? WHERE id = ?').run(JSON.stringify(data), plan.id);
    ctx.db.prepare('DELETE FROM meal_swaps WHERE user_id = ? AND meal_idx = ? AND date >= ?').run(uid, mi, date);
    ctx.db.prepare('DELETE FROM day_swaps WHERE user_id = ? AND ref LIKE ? AND date >= ?').run(uid, `${idx}-${mi}-%`, date);
    audit(ctx.db, ctx.user.id, 'plan.meal_swapped', uid, { planId: plan.id, meal: mi, to: pick.tpl });
  }
  try { dayChanged(ctx.db, uid, date); } catch (e) { console.warn('[feed]', e.message); }
  return { ok: true, title: pick.title };
});

// Trim what is left of today so the day lands on target after eating off-plan. Only unlogged
// items change, within realistic portions; the result is stored as today-only adjustments.
route('POST', '/api/today/rebalance', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  if (!plan) throw bad('No active plan');
  const { idx, meals: dayPlan } = dayMeals(ctx.db, uid, plan, date);
  const foodsById = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
  const swaps = new Map(ctx.db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ?').all(uid, date).map((r) => [r.ref, r]));
  const logs = ctx.db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date);
  const logged = new Set(logs.map((l) => l.ref));
  // Today's items as they stand (with today's swaps), and which ones are already logged.
  const meals = dayPlan.map((m, mi) => ({ items: m.items.map((it, ii) => { const sw = swaps.get(`${idx}-${mi}-${ii}`); return sw ? { foodId: sw.food_id, grams: sw.grams } : { foodId: it.foodId, grams: it.grams }; }) }));
  const skip = new Set(); meals.forEach((m, mi) => m.items.forEach((_, ii) => { if (logged.has(`${idx}-${mi}-${ii}`)) skip.add(`${mi}-${ii}`); }));
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const targets = effectiveTargets(prof);
  const consumed = sumLogs(logs);
  const before = Math.round(consumed.kcal + meals.flatMap((m, mi) => m.items.map((it, ii) => (skip.has(`${mi}-${ii}`) ? 0 : (foodsById.get(it.foodId).kcal * it.grams) / 100))).reduce((a, b) => a + b, 0));
  const { grams, projected } = rebalanceDay({ meals, foodsById, targets, consumed, skip });
  const up = ctx.db.prepare('INSERT INTO day_swaps (user_id, date, ref, food_id, grams) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, date, ref) DO UPDATE SET grams = excluded.grams, food_id = excluded.food_id');
  let changed = 0;
  for (const [key, g] of grams) {
    const [mi, ii] = key.split('-').map(Number);
    const cur = meals[mi].items[ii];
    if (g === cur.grams) continue;
    up.run(uid, date, `${idx}-${mi}-${ii}`, cur.foodId, g); changed++;
  }
  const after = Math.round(projected.kcal);
  return { ok: true, before, after, target: targets.kcal, changed, stillOver: after > targets.kcal * 1.05 };
});

const STATUSES = ['eaten', 'adjusted', 'swapped', 'skipped'];
function upsertLog(db, uid, { date, ref, status, foodId, name, grams, macros, loggedOn, amount = null, meal = null }) {
  db.prepare(`INSERT INTO logs (user_id, date, ref, status, food_id, name, grams, kcal, p, c, f, logged_on, amount, meal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, date, ref) DO UPDATE SET status = excluded.status, food_id = excluded.food_id, name = excluded.name,
      grams = excluded.grams, kcal = excluded.kcal, p = excluded.p, c = excluded.c, f = excluded.f, logged_on = excluded.logged_on, amount = excluded.amount, meal = excluded.meal`)
    .run(uid, date, ref, status, foodId ?? null, name ?? null, grams, macros.kcal, macros.p, macros.c, macros.f, loggedOn, amount, meal);
}

/** The meal index an extra goes in: a valid index for that day's plan, or null (not placed). */
function extraMeal(db, uid, date, meal) {
  if (meal === undefined || meal === null || meal === '') return null;
  const plan = planForDate(db, uid, date) ?? activePlan(db, uid);
  if (!plan) return null;
  const i = mealIndex(dayMeals(db, uid, plan, date).meals, meal);
  if (i === null) throw bad('Unknown meal');
  return i;
}

/**
 * How much was eaten, from the request: either { qty, unit } in one of the food's units
 * ("3" eggs, "1.5" cups, "70" g dry) or plain { grams }. Returns { grams, amount } where amount
 * is the way it reads back ("3 eggs"). The server converts; the client's grams are not needed.
 */
function eatenAmount(food, body, { min = 0, max = 3000 } = {}) {
  if (body.unit !== undefined && body.unit !== null && body.unit !== '') {
    // A unit key ("u", "m0", "dry", "g") or what people call it ("glass", "slices", "ml").
    const u = resolveUnit(food, body.unit);
    if (!u) throw bad('Unknown unit for this food');
    const qty = num(body.qty, 0, u.grams || u.generic ? max : 50, 'amount');
    const grams = Math.round(qty * u.g * 10) / 10;
    if (grams < min || grams > max) throw bad(`That is more than ${max} g`);
    return { grams, amount: formatQty(u, qty) };
  }
  const grams = num(body.grams, min, max, 'grams');
  return { grams, amount: null };
}

route('POST', '/api/log', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const loggedOn = isDate(ctx.body.today) ? ctx.body.today : date;
  const status = oneOf(ctx.body.status, STATUSES, 'status');
  const ref = str(ctx.body.ref, 30, 'ref', true);
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(ref);
  if (!m) throw bad('Bad item reference');
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  if (!plan) throw bad('No active plan');
  const { idx, meals } = dayMeals(ctx.db, uid, plan, date);
  const item = meals[Number(m[2])]?.items[Number(m[3])];
  if (Number(m[1]) !== idx || !item) throw bad('That item is not part of the plan for this day');

  let macros = { kcal: 0, p: 0, c: 0, f: 0 };
  let grams = 0; let foodId = item.foodId; let name = item.name; let amount = null;
  if (status === 'eaten') {
    const sw = ctx.db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ? AND ref = ?').get(uid, date, ref);
    const swFood = sw && loadFoods(ctx.db, { includeInactive: true }).find((f) => f.id === sw.food_id);
    if (swFood) { const it = itemFor(swFood, sw.grams); grams = it.grams; macros = it; foodId = swFood.id; name = swFood.name; } else { grams = item.grams; macros = item; }
  }
  if (status === 'adjusted') {
    // The amount is of what is on the plan for this item today (a "just today" swap included).
    const sw = ctx.db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ? AND ref = ?').get(uid, date, ref);
    const all = loadFoods(ctx.db, { includeInactive: true });
    const food = (sw && all.find((f) => f.id === sw.food_id)) || all.find((f) => f.id === item.foodId);
    if (!food) throw bad('That food no longer exists');
    ({ grams, amount } = eatenAmount(food, ctx.body, { min: 0, max: 2000 }));
    macros = itemFor(food, grams); foodId = food.id; name = food.name;
  }
  if (status === 'swapped') {
    // Ate something else instead of this item: a log, not a plan change, so off-plan foods count too.
    const food = loadFoods(ctx.db, { offplan: true }).find((f) => f.id === ctx.body.foodId);
    if (!food) throw bad('Unknown food');
    ({ grams, amount } = eatenAmount(food, ctx.body, { min: 1, max: 2000 }));
    macros = itemFor(food, grams); foodId = food.id; name = food.name;
  }
  upsertLog(ctx.db, uid, { date, ref, status, foodId, name, grams, macros, loggedOn, amount });
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.edited_by_admin', uid, { date, ref, status });
  try { dayChanged(ctx.db, uid, date); } catch (e) { console.warn('[feed]', e.message); }
  return { ok: true };
});

route('POST', '/api/log/extra', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const loggedOn = isDate(ctx.body.today) ? ctx.body.today : date;
  let macros; let name; let foodId = null; let grams = 0; let amount = null;
  if (ctx.body.foodId) {
    // Any active food, off-plan ones included (pizza, sweets): logging what was eaten is always allowed.
    const food = loadFoods(ctx.db, { offplan: true }).find((f) => f.id === ctx.body.foodId);
    if (!food) throw bad('Unknown food');
    ({ grams, amount } = eatenAmount(food, ctx.body, { min: 1, max: 3000 }));
    macros = itemFor(food, grams); name = food.name; foodId = food.id;
  } else {
    name = str(ctx.body.name, 80, 'name', true);
    macros = { kcal: num(ctx.body.kcal, 0, 5000, 'kcal'), p: num(ctx.body.p ?? 0, 0, 500, 'p'), c: num(ctx.body.c ?? 0, 0, 800, 'c'), f: num(ctx.body.f ?? 0, 0, 500, 'f') };
  }
  const meal = extraMeal(ctx.db, uid, date, ctx.body.meal);
  const ref = `extra:${crypto.randomBytes(4).toString('hex')}`;
  upsertLog(ctx.db, uid, { date, ref, status: 'eaten', foodId, name, grams, macros, loggedOn, amount, meal });
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.extra_added_by_admin', uid, { date, name });
  try { dayChanged(ctx.db, uid, date); } catch (e) { console.warn('[feed]', e.message); }
  const food = foodId ? loadFoods(ctx.db, { includeInactive: true }).find((f) => f.id === foodId) : null;
  return { ok: true, ref, name, meal, kcal: Math.round(macros.kcal), amount: amount ?? (food && grams ? describeAmount(food, grams) : grams ? `${grams} g` : null) };
});

// Move an extra food or drink into a meal (or out of every meal with meal: null).
route('POST', '/api/log/meal', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const ref = str(ctx.body.ref, 30, 'ref', true);
  if (!ref.startsWith('extra:')) throw bad('Only added foods can be moved between meals');
  const meal = extraMeal(ctx.db, uid, date, ctx.body.meal);
  const r = ctx.db.prepare('UPDATE logs SET meal = ? WHERE user_id = ? AND date = ? AND ref = ?').run(meal, uid, date, ref);
  if (!r.changes) throw notFound('That food is not logged on this day');
  return { ok: true, meal };
});

/**
 * Log what someone ate, the way they say it, in one call (the coach and the Add food sheet).
 *   { date, today, meal: 0 | "breakfast" | null, items: [{ foodId | name, qty, unit, grams, kcal, p, c, f }] }
 * For each item the server finds the food (id, or the best search match for its name), works out
 * the grams from the unit said ("2 eggs", "100 ml", "3 tbsp"), then:
 *   - a planned item of that meal with the same food (or a stand-in: scrambled for boiled eggs,
 *     shami for baladi) is marked eaten, or adjusted / swapped when the amount or food differs;
 *   - anything else is added to that meal as an extra (extras never earn points);
 *   - the same food, amount and meal logged in the last 20 minutes is skipped as a repeat,
 *     so asking twice never logs twice.
 * Unknown foods need kcal (an estimate) and are logged as custom extras.
 * Returns { ok, meal, mealName, results: [{ name, amount, kcal, as, ref }], day: { kcal, target, left, protein } }.
 */
route('POST', '/api/log/foods', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const loggedOn = isDate(ctx.body.today) ? ctx.body.today : date;
  const items = Array.isArray(ctx.body.items) ? ctx.body.items.slice(0, 15) : [];
  if (!items.length) throw bad('Nothing to log');
  const plan = planForDate(ctx.db, uid, date) ?? activePlan(ctx.db, uid);
  const day = plan ? dayMeals(ctx.db, uid, plan, date) : { idx: 0, meals: [] };
  let meal = null;
  if (ctx.body.meal !== undefined && ctx.body.meal !== null && ctx.body.meal !== '') {
    meal = mealIndex(day.meals, ctx.body.meal);
    if (meal === null && day.meals.length) throw bad(`Unknown meal "${ctx.body.meal}". Meals today: ${day.meals.map((m) => m.name).join(', ')}`);
  }
  const all = loadFoods(ctx.db, { offplan: true });
  const byId = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
  const swaps = new Map(ctx.db.prepare('SELECT * FROM day_swaps WHERE user_id = ? AND date = ?').all(uid, date).map((r) => [r.ref, r]));
  const logged = new Map(ctx.db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date).map((l) => [l.ref, l]));
  // Planned items still open, in the chosen meal first, each with the food on the plan today.
  const open = [];
  day.meals.forEach((m, mi) => m.items.forEach((it, ii) => {
    const ref = `${day.idx}-${mi}-${ii}`;
    const sw = swaps.get(ref);
    open.push({ ref, mi, food: byId.get(sw?.food_id ?? it.foodId), grams: sw?.grams ?? it.grams, log: logged.get(ref) });
  }));
  const results = [];
  const used = new Set();
  for (const raw of items) {
    const it = raw && typeof raw === 'object' ? raw : {};
    const label = String(it.name ?? it.foodId ?? 'food').slice(0, 80);
    try {
      let food = it.foodId ? all.find((f) => f.id === it.foodId) : null;
      if (!food && it.name) food = findFood(all, String(it.name));
      if (!food) {
        // Not in the database: a custom extra with the estimate given.
        if (!(Number(it.kcal) >= 0) || it.kcal === undefined) throw bad(`"${label}" is not in the food list. Give an estimate (kcal, protein, carbs, fat) to log it as a custom food`);
        const macros = { kcal: num(it.kcal, 0, 5000, 'kcal'), p: num(it.p ?? 0, 0, 500, 'p'), c: num(it.c ?? 0, 0, 800, 'c'), f: num(it.f ?? 0, 0, 500, 'f') };
        const name = str(it.name, 80, 'name', true);
        const dup = ctx.db.prepare("SELECT ref FROM logs WHERE user_id = ? AND date = ? AND ref LIKE 'extra:%' AND food_id IS NULL AND name = ? AND ABS(kcal - ?) < 1 AND meal IS ? AND created_at >= datetime('now', '-20 minutes')").get(uid, date, name, macros.kcal, meal);
        if (dup) { results.push({ name, kcal: Math.round(macros.kcal), as: 'repeat', ref: dup.ref }); continue; }
        const ref = `extra:${crypto.randomBytes(4).toString('hex')}`;
        upsertLog(ctx.db, uid, { date, ref, status: 'eaten', foodId: null, name, grams: 0, macros, loggedOn, meal });
        results.push({ name, kcal: Math.round(macros.kcal), as: 'custom', ref });
        continue;
      }
      let amt;
      try { amt = amountFor(food, it); } catch (e) { throw bad(e.message); }
      if (amt.grams > 3000) throw bad(`${amt.grams} g of ${food.name} is more than one meal`);
      const macros = itemFor(food, amt.grams);
      const readback = amt.amount ?? describeAmount(food, amt.grams);
      // 1) A planned item: same food first, then a stand-in, in the chosen meal (any meal when
      //    no meal was given, same food only).
      const pool = open.filter((o) => !used.has(o.ref) && o.food && (meal === null || o.mi === meal));
      const isOpen = (o) => !o.log || o.log.status === 'skipped';
      const sameGrams = (o) => o.log && Math.abs(o.log.grams - amt.grams) <= Math.max(2, amt.grams * 0.05);
      // Already logged exactly like this (asked twice, or ticked in the app first): nothing to do.
      const already = pool.find((o) => !isOpen(o) && o.log.food_id === food.id && sameGrams(o));
      if (already) { used.add(already.ref); results.push({ name: food.name, amount: readback, kcal: Math.round(already.log.kcal), as: 'repeat', ref: already.ref }); continue; }
      // In a named meal, the same food on the plan is that item even when it was ticked already
      // ("I had 3 eggs at breakfast" corrects the 2 ticked eggs, it does not add 3 more).
      const match = pool.find((o) => o.food.id === food.id && isOpen(o))
        ?? (meal !== null ? pool.find((o) => o.food.id === food.id && o.log?.food_id === food.id) : null)
        ?? (meal !== null ? pool.find((o) => isOpen(o) && canStandIn(food, o.food, { ateG: amt.grams, plannedG: o.grams })) : null);
      if (match) {
        used.add(match.ref);
        const same = match.food.id === food.id;
        const asPlanned = same && Math.abs(amt.grams - match.grams) <= Math.max(3, match.grams * 0.1);
        const status = asPlanned ? 'eaten' : same ? 'adjusted' : 'swapped';
        const g = asPlanned ? match.grams : amt.grams;
        const m2 = asPlanned ? itemFor(food, g) : macros;
        upsertLog(ctx.db, uid, { date, ref: match.ref, status, foodId: food.id, name: food.name, grams: g, macros: m2, loggedOn, amount: asPlanned ? null : amt.amount });
        results.push({ name: food.name, amount: asPlanned ? (amt.amount ?? describeAmount(food, g)) : readback, kcal: Math.round(m2.kcal), as: status === 'eaten' ? 'planned' : status, ref: match.ref, ...(same ? {} : { instead: match.food.name }) });
        continue;
      }
      // 2) An extra in that meal, unless it is a repeat of one logged in the last 20 minutes.
      const dup = ctx.db.prepare("SELECT ref FROM logs WHERE user_id = ? AND date = ? AND ref LIKE 'extra:%' AND food_id = ? AND ABS(grams - ?) <= ? AND meal IS ? AND created_at >= datetime('now', '-20 minutes')").get(uid, date, food.id, amt.grams, Math.max(2, amt.grams * 0.05), meal);
      if (dup) { results.push({ name: food.name, amount: readback, kcal: Math.round(macros.kcal), as: 'repeat', ref: dup.ref }); continue; }
      const ref = `extra:${crypto.randomBytes(4).toString('hex')}`;
      upsertLog(ctx.db, uid, { date, ref, status: 'eaten', foodId: food.id, name: food.name, grams: amt.grams, macros, loggedOn, amount: amt.amount, meal });
      results.push({ name: food.name, amount: readback, kcal: Math.round(macros.kcal), as: 'extra', ref, ...(isTreat(food) ? { offPlan: true } : {}) });
    } catch (e) {
      results.push({ name: label, error: e.message });
    }
  }
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.foods_by_admin', uid, { date, n: results.length });
  try { dayChanged(ctx.db, uid, date); } catch (e) { console.warn('[feed]', e.message); }
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const t = effectiveTargets(prof);
  const eaten = sumLogs(ctx.db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date));
  return {
    ok: results.some((r) => !r.error), meal, mealName: meal !== null ? day.meals[meal]?.name ?? null : null, results,
    day: t ? { kcal: Math.round(eaten.kcal), target: t.kcal, left: Math.round(t.kcal - eaten.kcal), protein: Math.round(eaten.p), proteinTarget: t.proteinG } : null,
  };
});

route('POST', '/api/log/remove', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  ctx.db.prepare('DELETE FROM logs WHERE user_id = ? AND date = ? AND ref = ?').run(uid, needDate(ctx.body.date), str(ctx.body.ref, 30, 'ref', true));
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.removed_by_admin', uid, { date: ctx.body.date, ref: ctx.body.ref });
  return { ok: true };
});

// ---------- profile pictures ----------
// Small square JPEGs (the phone crops and shrinks them first). Visible to the crew, except a
// private member's picture, which only they and admins can load.
route('PUT', '/api/me/avatar', 'user', (ctx) => {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.image ?? ''));
  if (!m) throw bad('Send the picture as a JPEG');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 500 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('That file is not a valid JPEG');
  if (buf.length > 200_000) throw bad('That picture is too large');
  const at = new Date().toISOString();
  ctx.db.prepare('INSERT INTO avatars (user_id, image, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET image = excluded.image, updated_at = excluded.updated_at').run(ctx.user.id, buf, at);
  ctx.db.prepare('UPDATE users SET avatar_at = ? WHERE id = ?').run(at, ctx.user.id);
  return { ok: true, avatar: avatarUrl({ id: ctx.user.id, avatar_at: at }) };
});

route('DELETE', '/api/me/avatar', 'user', (ctx) => {
  ctx.db.prepare('DELETE FROM avatars WHERE user_id = ?').run(ctx.user.id);
  ctx.db.prepare('UPDATE users SET avatar_at = NULL WHERE id = ?').run(ctx.user.id);
  return { ok: true };
});

route('GET', '/api/avatar/:id', 'user', (ctx) => {
  const id = Number(ctx.params.id);
  const u = ctx.db.prepare('SELECT id, active, private FROM users WHERE id = ?').get(id);
  const allowed = u && (id === ctx.user.id || ctx.user.role === 'admin' || (u.active && !u.private));
  const row = allowed && ctx.db.prepare('SELECT image FROM avatars WHERE user_id = ?').get(id);
  if (!row) throw notFound('No picture');
  return { __raw: Buffer.from(row.image), headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=604800, immutable' } };
});

// ---------- progress photos (private: the owner and admins only) ----------
const POSES = ['front', 'side', 'back'];
const MAX_PHOTOS = 150;

route('GET', '/api/photos', 'user', (ctx) => {
  const uid = subjectId(ctx);
  return { photos: ctx.db.prepare('SELECT id, date, pose FROM photos WHERE user_id = ? ORDER BY date DESC, id DESC').all(uid) };
});

route('POST', '/api/photos', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const pose = oneOf(ctx.body.pose, POSES, 'pose');
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.image ?? ''));
  if (!m) throw bad('Send the photo as a JPEG');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('That file is not a valid JPEG');
  if (buf.length > 700_000) throw bad('That photo is too large');
  if (ctx.db.prepare('SELECT COUNT(*) n FROM photos WHERE user_id = ?').get(uid).n >= MAX_PHOTOS) throw bad(`You can keep up to ${MAX_PHOTOS} photos. Delete some old ones first.`);
  const r = ctx.db.prepare('INSERT INTO photos (user_id, date, pose, image) VALUES (?, ?, ?, ?)').run(uid, date, pose, buf);
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'photo.added', uid, { date, pose });
  return { ok: true, id: Number(r.lastInsertRowid) };
});

const photoFor = (ctx) => {
  const row = ctx.db.prepare('SELECT id, user_id, image FROM photos WHERE id = ?').get(Number(ctx.params.id));
  if (!row || (row.user_id !== ctx.user.id && ctx.user.role !== 'admin')) throw notFound('Photo not found');
  return row;
};

route('GET', '/api/photos/:id', 'user', (ctx) => {
  const row = photoFor(ctx);
  if (row.user_id !== ctx.user.id) audit(ctx.db, ctx.user.id, 'photo.viewed', row.user_id, { photoId: row.id });
  return { __raw: Buffer.from(row.image), headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } };
});

route('DELETE', '/api/photos/:id', 'user', (ctx) => {
  const row = photoFor(ctx);
  ctx.db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
  if (row.user_id !== ctx.user.id) audit(ctx.db, ctx.user.id, 'photo.deleted', row.user_id, { photoId: row.id });
  return { ok: true };
});

route('GET', '/api/metrics', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const rows = ctx.db.prepare('SELECT date, weight_kg, measurements, notes FROM body_metrics WHERE user_id = ? ORDER BY date').all(uid);
  return { metrics: rows.map((r) => ({ date: r.date, weightKg: r.weight_kg, measurements: JSON.parse(r.measurements), notes: r.notes })) };
});

route('POST', '/api/metrics', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const w = optNum(ctx.body.weightKg, 30, 400, 'weightKg');
  const meas = cleanMeasurements(ctx.body.measurements);
  if (w === undefined && !Object.keys(meas).length) throw bad('Enter a weight or at least one measurement');
  ctx.db.prepare(`INSERT INTO body_metrics (user_id, date, weight_kg, measurements, notes) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, date) DO UPDATE SET
      weight_kg = COALESCE(excluded.weight_kg, weight_kg),
      measurements = CASE WHEN excluded.measurements = '{}' THEN measurements ELSE excluded.measurements END,
      notes = COALESCE(NULLIF(excluded.notes, ''), notes)`)
    .run(uid, date, w ?? null, JSON.stringify(meas), str(ctx.body.notes, 300, 'notes'));
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'metrics.edited_by_admin', uid, { date });
  return { ok: true };
});

route('GET', '/api/adherence', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const today = needDate(ctx.query.get('today') ?? todayUtc(), 'today');
  const n = Math.min(60, Math.max(1, Number(ctx.query.get('days') ?? 14)));
  const scores = scoresBetween(ctx.db, uid, addDays(today, -(n - 1)), today);
  return { scores, streak: streak(scores, today) };
});

// --- admin
route('GET', '/api/admin/users', 'admin', (ctx) => {
  const today = needDate(ctx.query.get('today') ?? todayUtc(), 'today');
  const users = ctx.db.prepare('SELECT * FROM users ORDER BY created_at').all();
  return {
    users: users.map((u) => {
      const scores = scoresBetween(ctx.db, u.id, addDays(today, -7), addDays(today, -1));
      return {
        ...publicUser(u),
        hasProfile: Boolean(ctx.db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(u.id)),
        activePlanId: activePlan(ctx.db, u.id)?.id ?? null,
        pendingPlanId: ctx.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'pending'").get(u.id)?.id ?? null,
        pendingWorkoutPlanId: ctx.db.prepare("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'pending'").get(u.id)?.id ?? null,
        openRequests: ctx.db.prepare("SELECT COUNT(*) n FROM change_requests WHERE user_id = ? AND status = 'open'").get(u.id).n,
        pendingCheckins: ctx.db.prepare("SELECT COUNT(*) n FROM checkins WHERE user_id = ? AND status = 'pending'").get(u.id).n,
        avg7: scores.length ? Math.round(scores.reduce((a, s) => a + s.total, 0) / scores.length) : null,
      };
    }),
  };
});

route('GET', '/api/admin/users/:id', 'admin', (ctx) => {
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params.id));
  if (!u) throw notFound('User not found');
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(u.id);
  const today = needDate(ctx.query.get('today') ?? todayUtc(), 'today');
  return {
    user: publicUser(u),
    profile: prof ? JSON.parse(prof.data) : null,
    targets: effectiveTargets(prof),
    computedTargets: prof ? JSON.parse(prof.targets) : null,
    plans: ctx.db.prepare('SELECT id, version, status, start_date, created_at, note FROM plans WHERE user_id = ? ORDER BY version DESC').all(u.id),
    workoutPlans: ctx.db.prepare('SELECT id, version, status, start_date, created_at, note FROM workout_plans WHERE user_id = ? ORDER BY version DESC').all(u.id),
    requests: ctx.db.prepare('SELECT * FROM change_requests WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id),
    scores: scoresBetween(ctx.db, u.id, addDays(today, -13), today),
    attendance: attendance(ctx.db, u.id, addDays(today, -27), today),
    checkins: ctx.db.prepare('SELECT id, date, status, image IS NOT NULL hasPhoto FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 14').all(u.id).map((r) => ({ ...r, hasPhoto: Boolean(r.hasPhoto) })),
    photoCount: ctx.db.prepare('SELECT COUNT(*) n FROM photos WHERE user_id = ?').get(u.id).n,
    // Weekly check-ins, newest first: what was measured, proposed and answered.
    dietCheckins: ctx.db.prepare('SELECT * FROM diet_checkins WHERE user_id = ? ORDER BY week DESC LIMIT 8').all(u.id)
      .map((r) => ({ ...JSON.parse(r.data), status: r.status, result: r.result ? JSON.parse(r.result) : null, decidedAt: r.decided_at })),
  };
});

route('PUT', '/api/admin/users/:id', 'admin', (ctx) => {
  const id = Number(ctx.params.id);
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw notFound('User not found');
  const name = ctx.body.name === undefined ? u.name : str(ctx.body.name, 60, 'name', true);
  const role = ctx.body.role === undefined ? u.role : oneOf(ctx.body.role, ['admin', 'user'], 'role');
  const active = ctx.body.active === undefined ? u.active : ctx.body.active ? 1 : 0;
  // Private: only admins ever see this person (leaderboard, feed, champions, recaps, reactions).
  const priv = ctx.body.private === undefined ? u.private : ctx.body.private ? 1 : 0;
  if (id === ctx.user.id && (role !== 'admin' || !active)) throw bad('You cannot remove your own admin access or deactivate yourself');
  ctx.db.prepare('UPDATE users SET name = ?, role = ?, active = ?, private = ? WHERE id = ?').run(name, role, active, priv, id);
  if (!active) ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  // Going private takes their past posts and reactions out of everyone's feed.
  if (priv && !u.private) ctx.db.prepare('DELETE FROM reactions WHERE user_id = ?').run(id);
  audit(ctx.db, ctx.user.id, 'user.updated', id, { name, role, active, private: Boolean(priv) });
  return { ok: true };
});

route('POST', '/api/admin/users/:id/reset-password', 'admin', (ctx) => {
  const id = Number(ctx.params.id);
  const err = checkPasswordStrength(ctx.body.password);
  if (err) throw bad(err);
  if (!ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound('User not found');
  const { salt, hash } = hashPassword(ctx.body.password);
  ctx.db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?').run(salt, hash, id);
  ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(ctx.db, ctx.user.id, 'user.password_reset', id);
  return { ok: true };
});

route('PUT', '/api/admin/users/:id/targets', 'admin', (ctx) => {
  const id = Number(ctx.params.id);
  if (!ctx.db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(id)) throw bad('This user has no profile yet');
  let override = null;
  if (ctx.body.override) {
    const o = ctx.body.override;
    override = { kcal: Math.round(num(o.kcal, 800, 6000, 'kcal')), proteinG: Math.round(num(o.proteinG, 30, 400, 'proteinG')), carbsG: Math.round(num(o.carbsG, 0, 900, 'carbsG')), fatG: Math.round(num(o.fatG, 15, 300, 'fatG')) };
  }
  ctx.db.prepare('UPDATE profiles SET targets_override = ? WHERE user_id = ?').run(override ? JSON.stringify(override) : null, id);
  audit(ctx.db, ctx.user.id, 'targets.override', id, override);
  return { ok: true };
});

route('POST', '/api/admin/users/:id/plans/generate', 'admin', async (ctx) => {
  const id = Number(ctx.params.id);
  const planId = await makePendingPlanAI(ctx.db, id, str(ctx.body.note, 300, 'note') || 'Generated by admin');
  audit(ctx.db, ctx.user.id, 'plan.generated', id, { planId });
  return { ok: true, planId };
});

const loadPlan = (ctx) => {
  const p = planRow(ctx.db.prepare('SELECT * FROM plans WHERE id = ?').get(Number(ctx.params.id)));
  if (!p) throw notFound('Plan not found');
  return p;
};

route('GET', '/api/admin/plans/:id', 'admin', (ctx) => {
  const p = loadPlan(ctx);
  return { plan: { id: p.id, userId: p.user_id, version: p.version, status: p.status, startDate: p.start_date, note: p.note, ...p.data } };
});

route('PUT', '/api/admin/plans/:id', 'admin', (ctx) => {
  const p = loadPlan(ctx);
  const foodsById = new Map(loadFoods(ctx.db, { includeInactive: true }).map((f) => [f.id, f]));
  const data = normalizePlan({ ...p.data, days: ctx.body.days }, foodsById);
  ctx.db.prepare('UPDATE plans SET data = ?, note = COALESCE(?, note) WHERE id = ?').run(JSON.stringify(data), ctx.body.note ? str(ctx.body.note, 300, 'note') : null, p.id);
  audit(ctx.db, ctx.user.id, 'plan.edited', p.user_id, { planId: p.id });
  return { ok: true, summary: data.summary };
});

route('POST', '/api/admin/plans/:id/approve', 'admin', (ctx) => {
  const p = loadPlan(ctx);
  if (!['pending', 'archived'].includes(p.status)) throw bad(`A ${p.status} plan cannot be approved`);
  const start = ctx.body.startDate ? needDate(ctx.body.startDate, 'startDate') : todayUtc();
  ctx.db.exec('BEGIN');
  try {
    ctx.db.prepare("UPDATE plans SET status = 'archived', end_date = ? WHERE user_id = ? AND status = 'active'").run(addDays(start, -1), p.user_id);
    ctx.db.prepare("UPDATE plans SET status = 'active', start_date = ?, end_date = NULL, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?").run(start, ctx.user.id, p.id);
    ctx.db.exec('COMMIT');
  } catch (e) { ctx.db.exec('ROLLBACK'); throw e; }
  audit(ctx.db, ctx.user.id, 'plan.approved', p.user_id, { planId: p.id, start });
  return { ok: true };
});

route('POST', '/api/admin/plans/:id/reject', 'admin', (ctx) => {
  const p = loadPlan(ctx);
  if (p.status !== 'pending') throw bad('Only pending plans can be rejected');
  ctx.db.prepare("UPDATE plans SET status = 'rejected', note = COALESCE(?, note) WHERE id = ?").run(ctx.body.note ? str(ctx.body.note, 300, 'note') : null, p.id);
  audit(ctx.db, ctx.user.id, 'plan.rejected', p.user_id, { planId: p.id });
  return { ok: true };
});

// Old plans can be deleted for good. The live plan cannot (publish another one first).
// Note: days an archived plan covered lose their score once it is deleted.
route('DELETE', '/api/admin/plans/:id', 'admin', (ctx) => {
  const p = loadPlan(ctx);
  if (p.status === 'active') throw bad('This plan is live. Publish another plan first, then delete this one.');
  ctx.db.prepare('DELETE FROM plans WHERE id = ?').run(p.id);
  audit(ctx.db, ctx.user.id, 'plan.deleted', p.user_id, { planId: p.id, version: p.version, status: p.status });
  return { ok: true };
});

/**
 * Clean up old plans (diet and training) for one person or everyone. Deletes rejected drafts and
 * archived plans that ended more than `keepDays` ago, so recent scores and the leaderboard keep
 * their history. Live and pending plans are never touched.
 */
route('POST', '/api/admin/cleanup', 'admin', (ctx) => {
  const keepDays = Math.round(num(ctx.body.keepDays ?? 14, 0, 365, 'keepDays'));
  const today = isDate(ctx.body.today) ? ctx.body.today : todayUtc();
  const cutoff = addDays(today, -keepDays);
  const uid = ctx.body.userId === undefined || ctx.body.userId === null ? null : Number(ctx.body.userId);
  const where = `(status = 'rejected' OR (status = 'archived' AND end_date IS NOT NULL AND end_date < ?))${uid === null ? '' : ' AND user_id = ?'}`;
  const args = uid === null ? [cutoff] : [cutoff, uid];
  // Count first: on Cloudflare `changes` also counts index writes.
  const diet = ctx.db.prepare(`SELECT COUNT(*) n FROM plans WHERE ${where}`).get(...args).n;
  const training = ctx.db.prepare(`SELECT COUNT(*) n FROM workout_plans WHERE ${where}`).get(...args).n;
  ctx.db.prepare(`DELETE FROM plans WHERE ${where}`).run(...args);
  ctx.db.prepare(`DELETE FROM workout_plans WHERE ${where}`).run(...args);
  audit(ctx.db, ctx.user.id, 'plans.cleaned_up', uid, { diet, training, keepDays });
  return { ok: true, deleted: { diet: Number(diet), training: Number(training) } };
});

// Start everyone over: wipes every member's data (profile, plans, logs, training, photos,
// check-ins, coach chat, feed, competition history) but keeps the accounts, passwords, sign-in
// sessions and notification subscriptions, plus the food and exercise libraries and settings.
// Everyone stays signed in and lands in setup again on their next open. Needs the exact phrase.
const FRESH_START_TABLES = ['reactions', 'activity', 'competition_results', 'diet_checkins', 'day_overrides', 'set_logs', 'cardio_logs', 'checkins', 'body_assessments',
  'photos', 'body_metrics', 'water_logs', 'day_swaps', 'meal_swaps', 'logs', 'change_requests', 'coach_messages', 'jobs_run', 'workout_plans', 'plans', 'profiles'];
route('POST', '/api/admin/fresh-start', 'admin', (ctx) => {
  if (ctx.body.confirm !== 'START OVER') throw bad('Type START OVER to confirm');
  const counts = {};
  for (const t of FRESH_START_TABLES) {
    counts[t] = Number(ctx.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n); // count first (Cloudflare changes include index writes)
    ctx.db.prepare(`DELETE FROM ${t}`).run();
  }
  const today = isDate(ctx.body.today) ? ctx.body.today : todayUtc();
  setSetting(ctx.db, 'scoreResetDate', today);
  setSetting(ctx.db, 'freshStartAt', new Date().toISOString());
  audit(ctx.db, ctx.user.id, 'everyone.fresh_start', null, counts);
  return { ok: true, deleted: counts };
});

route('POST', '/api/admin/invites', 'admin', (ctx) => {
  const code = newInviteCode();
  const days = Math.round(num(ctx.body.days ?? 7, 1, 60, 'days'));
  const priv = ctx.body.private ? 1 : 0;
  ctx.db.prepare('INSERT INTO invites (code, note, private, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(code, str(ctx.body.note, 80, 'note'), priv, ctx.user.id, new Date(Date.now() + days * 86400000).toISOString());
  audit(ctx.db, ctx.user.id, 'invite.created', null, { code, private: Boolean(priv) });
  return { code };
});

route('GET', '/api/admin/invites', 'admin', (ctx) => ({
  invites: ctx.db.prepare('SELECT i.code, i.note, i.created_at, i.expires_at, u.name used_by FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 50').all(),
}));

const cleanFood = (b, existingId) => {
  const id = existingId ?? str(b.name, 60, 'name', true).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + crypto.randomBytes(2).toString('hex');
  const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r) => ['mainProtein', 'bfProtein', 'vegMain', 'carb', 'bfCarb', 'fruit', 'veg', 'fat', 'snack', 'boost'].includes(r));
  return {
    id, name: str(b.name, 80, 'name', true), cat: oneOf(b.cat ?? 'protein', ['protein', 'carb', 'fat', 'veg', 'fruit', 'dairy', 'legume', 'dish', 'sweet', 'snack', 'fastfood', 'meals', 'bakery', 'sweets', 'snacks', 'drinks', 'basics'], 'cat'),
    // Off-plan foods (eating out, treats) can be logged but never go into plans or swaps.
    offplan: Boolean(b.offplan),
    kcal: num(b.kcal, 0, 900, 'kcal'), p: num(b.p, 0, 100, 'p'), c: num(b.c, 0, 100, 'c'), f: num(b.f, 0, 100, 'f'),
    roles, tags: (Array.isArray(b.tags) ? b.tags : []).filter((t) => ALLERGEN_TAGS.includes(t) || t === 'pricey'), veg: Boolean(b.veg),
    step: num(b.step ?? 5, 1, 100, 'step'), max: num(b.max ?? 500, 1, 3000, 'max'),
  };
};

route('POST', '/api/admin/foods', 'admin', (ctx) => {
  const f = cleanFood(ctx.body);
  ctx.db.prepare('INSERT INTO foods (id,name,cat,kcal,p,c,f,roles,tags,veg,step,max,offplan,custom) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
    .run(f.id, f.name, f.cat, f.kcal, f.p, f.c, f.f, JSON.stringify(f.offplan ? [] : f.roles), JSON.stringify(f.tags), f.veg ? 1 : 0, f.step, f.max, f.offplan ? 1 : 0);
  touchCatalog(ctx.db);
  audit(ctx.db, ctx.user.id, 'food.created', null, { id: f.id, name: f.name });
  return { ok: true, id: f.id };
});

route('PUT', '/api/admin/foods/:id', 'admin', (ctx) => {
  const row = ctx.db.prepare('SELECT * FROM foods WHERE id = ?').get(ctx.params.id);
  if (!row) throw notFound('Food not found');
  const f = cleanFood({ ...rowToFood(row), ...ctx.body }, row.id);
  ctx.db.prepare('UPDATE foods SET name=?,cat=?,kcal=?,p=?,c=?,f=?,roles=?,tags=?,veg=?,step=?,max=?,edited=1 WHERE id = ?')
    .run(f.name, f.cat, f.kcal, f.p, f.c, f.f, JSON.stringify(f.roles), JSON.stringify(f.tags), f.veg ? 1 : 0, f.step, f.max, row.id);
  touchCatalog(ctx.db);
  audit(ctx.db, ctx.user.id, 'food.updated', null, { id: row.id });
  return { ok: true };
});

route('DELETE', '/api/admin/foods/:id', 'admin', (ctx) => {
  ctx.db.prepare('UPDATE foods SET active = 0 WHERE id = ?').run(ctx.params.id);
  touchCatalog(ctx.db);
  audit(ctx.db, ctx.user.id, 'food.deactivated', null, { id: ctx.params.id });
  return { ok: true };
});

route('GET', '/api/admin/requests', 'admin', (ctx) => ({
  requests: ctx.db.prepare("SELECT r.id, r.user_id, u.name, r.note, r.created_at FROM change_requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'open' ORDER BY r.id").all(),
}));

route('POST', '/api/admin/requests/:id/resolve', 'admin', (ctx) => {
  ctx.db.prepare("UPDATE change_requests SET status = 'done', admin_note = ? WHERE id = ?").run(str(ctx.body.note, 300, 'note'), Number(ctx.params.id));
  return { ok: true };
});

route('GET', '/api/admin/audit', 'admin', (ctx) => ({
  entries: ctx.db.prepare('SELECT a.id, a.at, a.action, a.detail, u.name actor, t.name target FROM audit a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users t ON t.id = a.target_user_id ORDER BY a.id DESC LIMIT 200').all(),
}));

// A consistent copy of the whole database, for the admin to download and keep.
// Full backup as JSON: every table, every row (photos as base64). Works the same locally and on
// Cloudflare.
route('GET', '/api/admin/backup', 'admin', (ctx) => {
  const tables = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map((r) => r.name);
  const dump = { app: 'fitcrew', version: 1, at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    dump.tables[t] = ctx.db.prepare(`SELECT * FROM "${t}"`).all().map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
      [k, v instanceof Uint8Array || v instanceof ArrayBuffer ? { $b64: Buffer.from(v).toString('base64') } : v])));
  }
  audit(ctx.db, ctx.user.id, 'backup.downloaded');
  return { __raw: Buffer.from(JSON.stringify(dump)), headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="fitcrew-backup-${todayUtc()}.json"` } };
});

// Crew (monthly competition, feed, recap) and training routes live in their own files.
const social = registerSocial({ route, bad, notFound, forbidden, str, needDate, isDate, audit, todayUtc, scoresBetween, attendance, weekStart, pushToUser });
dayChanged = social.dayChanged;
// Adaptive weekly check-in (src/adaptive.js maths, src/api-checkin.js routes).
registerCheckin({ route, bad, needDate, isDate, subjectId, audit, todayUtc, addDays, activePlan, savePendingPlan, makePendingPlan, targetsFor, effectiveTargets });
({ makePendingWorkoutPlan } = registerTrain({ route, bad, notFound, num, optNum, oneOf, str, needDate, isDate, subjectId, audit, addDays, todayUtc, dayChanged: (db, uid, date) => social.dayChanged(db, uid, date) }));

// ---------- dispatcher ----------
function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}

async function readBody(req, limit = 1_000_000) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Invalid JSON'); }
}

/**
 * Call a route in-process as `user` (used by the AI coach). Same validation, same audit, no
 * cookies. Admin-only routes are refused: the coach acts as the person, never as the admin.
 */
export async function callAs(db, user, method, path, body = {}) {
  const url = new URL(path, 'http://internal');
  const match = routes.map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m && x.r.method === method);
  if (!match) throw notFound(`Unknown endpoint ${method} ${url.pathname}`);
  const { r, m } = match;
  if (r.access === 'admin') throw forbidden('The coach cannot use admin actions');
  const ctx = { db, req: { headers: {} }, res: null, query: url.searchParams, cookies: {}, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), body: method === 'GET' ? {} : body, user, setCookie: null };
  return r.handler(ctx);
}
export { HttpError };

export function createApi(db) {
  return async function handle(req, res, url) {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const match = routes.map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m && x.r.method === req.method);
      if (!match) {
        if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed');
        throw notFound('Unknown endpoint');
      }
      if (req.method !== 'GET' && req.headers['x-fitcrew'] !== '1') throw forbidden('Missing X-FitCrew header');
      const { r, m } = match;
      const cookies = parseCookies(req.headers.cookie);
      const ctx = { db, req, res, query: url.searchParams, cookies, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), body: req.method === 'GET' ? {} : await readBody(req), user: null, setCookie: null };

      if (r.access !== 'public') {
        const tok = cookies.fc_session;
        const row = tok && db.prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(hashToken(tok));
        if (!row || row.expires_at < new Date().toISOString() || !row.active) throw new HttpError(401, 'Please sign in');
        ctx.user = row;
        if (r.access === 'admin' && row.role !== 'admin') throw forbidden('Admin only');
      }
      const result = await r.handler(ctx);
      if (result && result.__raw) {
        res.writeHead(200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...result.headers });
        return res.end(result.__raw);
      }
      send(200, result, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'Something went wrong on the server' });
    }
  };
}
