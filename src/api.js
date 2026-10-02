// FitCrew JSON API. No framework: a small route table over node:http.
import crypto from 'node:crypto';
import { computeTargets, navyBodyFat, ACTIVITY } from './calc.js';
import { generatePlan, itemFor, totalsOf } from './plan.js';
import { ALLERGEN_TAGS } from './foods-seed.js';
import { loadFoods, rowToFood } from './db.js';
import { hashPassword, verifyPassword, newToken, hashToken, newInviteCode, checkPasswordStrength } from './auth.js';
import { dayScore, streak } from './adherence.js';
import { registerTrain, workoutState } from './api-train.js';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let makePendingWorkoutPlan; // assigned when the training routes are registered, below

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
    injuries: str(p.injuries, 500, 'injuries'),
    measurements: cleanMeasurements(p.measurements),
    hideFromLeaderboard: Boolean(p.hideFromLeaderboard),
  };
  const bf = optNum(p.bodyFatPct, 3, 60, 'bodyFatPct');
  if (bf !== undefined) out.bodyFatPct = bf;
  const pr = p.prefs ?? {};
  const ids = (a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && foodIds.has(x)))].slice(0, 100);
  out.prefs = {
    mealsPerDay: Math.round(num(pr.mealsPerDay ?? 3, 3, 5, 'mealsPerDay')),
    likedIds: ids(pr.likedIds),
    dislikedIds: ids(pr.dislikedIds),
    allergies: (Array.isArray(pr.allergies) ? pr.allergies : []).filter((a) => ALLERGEN_TAGS.includes(a)),
    vegetarian: Boolean(pr.vegetarian),
    note: str(pr.note, 500, 'note'),
  };
  return out;
}

function targetsFor(data) {
  let bf = data.bodyFatPct;
  let estimated = false;
  if (bf === undefined) {
    const m = data.measurements ?? {};
    if (m.neckCm && m.waistCm && (data.sex === 'male' || m.hipCm)) {
      const est = navyBodyFat({ sex: data.sex, heightCm: data.heightCm, neckCm: m.neckCm, waistCm: m.waistCm, hipCm: m.hipCm });
      if (est !== null) { bf = est; estimated = true; }
    }
  }
  const t = computeTargets({ ...data, bodyFatPct: bf });
  return { ...t, bodyFatPct: bf ?? null, bodyFatEstimated: estimated };
}

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
      return { name: str(m.name, 40, 'meal name', true), items, totals: totalsOf(items) };
    });
    return { day: di + 1, meals, totals: totalsOf(meals.flatMap((m) => m.items)) };
  });
  const avg = (k) => Math.round(days.reduce((a, d) => a + d.totals[k], 0) / days.length);
  return { ...data, days, summary: { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f') } };
}

const planRow = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);
const activePlan = (db, uid) => planRow(db.prepare("SELECT * FROM plans WHERE user_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(uid));
const planForDate = (db, uid, date) => planRow(db.prepare("SELECT * FROM plans WHERE user_id = ? AND status IN ('active','archived') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY version DESC LIMIT 1").get(uid, date, date));

function makePendingPlan(db, uid, note = null) {
  const prof = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  if (!prof) throw bad('This user has not completed their profile yet');
  const data = JSON.parse(prof.data);
  const t = effectiveTargets(prof);
  const plan = generatePlan({
    targets: { kcal: t.kcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG },
    prefs: data.prefs,
    foods: loadFoods(db),
  });
  db.prepare("UPDATE plans SET status = 'rejected' WHERE user_id = ? AND status = 'pending'").run(uid);
  const version = (db.prepare('SELECT MAX(version) v FROM plans WHERE user_id = ?').get(uid).v ?? 0) + 1;
  const r = db.prepare("INSERT INTO plans (user_id, version, status, data, note) VALUES (?, ?, 'pending', ?, ?)").run(uid, version, JSON.stringify(plan), note);
  return Number(r.lastInsertRowid);
}

// ---------- logs & scoring ----------
const sumLogs = (logs) => logs.filter((l) => l.status !== 'skipped').reduce((a, l) => ({ kcal: a.kcal + l.kcal, p: a.p + l.p, c: a.c + l.c, f: a.f + l.f }), { kcal: 0, p: 0, c: 0, f: 0 });
const r1 = (n) => Math.round(n * 10) / 10;
const roundMacros = (m) => ({ kcal: Math.round(m.kcal), p: r1(m.p), c: r1(m.c), f: r1(m.f) });

function scoreDay(db, uid, date, plan, targets) {
  const days = plan.data.days;
  const day = days[dayIndex(plan.start_date, date, days.length)];
  const itemsTotal = day.meals.reduce((a, m) => a + m.items.length, 0);
  const logs = db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date);
  const consumed = sumLogs(logs);
  const itemsDone = logs.filter((l) => !l.ref.startsWith('extra:') && l.status !== 'skipped').length;
  const s = dayScore({ targets: { kcal: targets.kcal, proteinG: targets.proteinG }, consumed, itemsTotal, itemsDone, loggedSameDay: logs.some((l) => l.logged_on === date), workout: workoutState(db, uid, date) });
  return { date, total: s.total, parts: s.parts, consumed: roundMacros(consumed) };
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
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: Boolean(u.active) });

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
  const prof = ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const pending = ctx.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'pending'").get(uid);
  return {
    user: publicUser(ctx.user),
    profile: prof ? JSON.parse(prof.data) : null,
    targets: effectiveTargets(prof),
    hasActivePlan: Boolean(activePlan(ctx.db, uid)),
    hasPendingPlan: Boolean(pending),
  };
});

route('PUT', '/api/profile', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const foodIds = new Set(loadFoods(ctx.db).map((f) => f.id));
  const data = cleanProfile(ctx.body.profile, foodIds);
  const targets = targetsFor(data);
  const existing = ctx.db.prepare('SELECT 1 FROM profiles WHERE user_id = ?').get(uid);
  if (existing) {
    ctx.db.prepare("UPDATE profiles SET data = ?, targets = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(JSON.stringify(data), JSON.stringify(targets), uid);
  } else {
    ctx.db.prepare('INSERT INTO profiles (user_id, data, targets) VALUES (?, ?, ?)').run(uid, JSON.stringify(data), JSON.stringify(targets));
  }
  // Onboarding triggers a first draft for the admin to review. Later edits do not auto-replace plans.
  let planId = null;
  if (!existing && !activePlan(ctx.db, uid)) planId = makePendingPlan(ctx.db, uid, 'Auto-generated after onboarding');
  if (!existing && !ctx.db.prepare("SELECT 1 FROM workout_plans WHERE user_id = ? AND status IN ('active','pending')").get(uid)) makePendingWorkoutPlan(ctx.db, uid, 'Auto-generated after onboarding');
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'profile.edited_by_admin', uid, data);
  return { ok: true, targets: effectiveTargets(ctx.db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid)), pendingPlanId: planId };
});

route('GET', '/api/foods', 'user', (ctx) => {
  const q = (ctx.query.get('q') ?? '').toLowerCase();
  const foods = loadFoods(ctx.db).filter((f) => !q || f.name.toLowerCase().includes(q));
  return { foods: foods.slice(0, 200) };
});

route('GET', '/api/plan', 'user', (ctx) => {
  const uid = subjectId(ctx);
  const plan = activePlan(ctx.db, uid);
  const pending = ctx.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'pending'").get(uid);
  return { plan: plan && { id: plan.id, version: plan.version, startDate: plan.start_date, ...plan.data }, hasPending: Boolean(pending) };
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
  const days = plan.data.days;
  const idx = dayIndex(plan.start_date, date, days.length);
  const logs = ctx.db.prepare('SELECT * FROM logs WHERE user_id = ? AND date = ?').all(uid, date);
  const byRef = new Map(logs.map((l) => [l.ref, l]));
  const meals = days[idx].meals.map((m, mi) => ({
    name: m.name,
    items: m.items.map((it, ii) => {
      const key = `${idx}-${mi}-${ii}`;
      const l = byRef.get(key);
      return { key, ...it, log: l ? { status: l.status, foodId: l.food_id, name: l.name, grams: l.grams, kcal: l.kcal, p: l.p, c: l.c, f: l.f } : null };
    }),
  }));
  const extras = logs.filter((l) => l.ref.startsWith('extra:')).map((l) => ({ ref: l.ref, name: l.name, grams: l.grams, kcal: Math.round(l.kcal), p: r1(l.p), c: r1(l.c), f: r1(l.f) }));
  return {
    date, dayIdx: idx, planId: plan.id, targets, meals, extras,
    consumed: roundMacros(sumLogs(logs)),
    score: scoreDay(ctx.db, uid, date, plan, targets),
  };
});

const STATUSES = ['eaten', 'adjusted', 'swapped', 'skipped'];
function upsertLog(db, uid, { date, ref, status, foodId, name, grams, macros, loggedOn }) {
  db.prepare(`INSERT INTO logs (user_id, date, ref, status, food_id, name, grams, kcal, p, c, f, logged_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, date, ref) DO UPDATE SET status = excluded.status, food_id = excluded.food_id, name = excluded.name,
      grams = excluded.grams, kcal = excluded.kcal, p = excluded.p, c = excluded.c, f = excluded.f, logged_on = excluded.logged_on`)
    .run(uid, date, ref, status, foodId ?? null, name ?? null, grams, macros.kcal, macros.p, macros.c, macros.f, loggedOn);
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
  const idx = dayIndex(plan.start_date, date, plan.data.days.length);
  const item = plan.data.days[idx]?.meals[Number(m[2])]?.items[Number(m[3])];
  if (Number(m[1]) !== idx || !item) throw bad('That item is not part of the plan for this day');

  let macros = { kcal: 0, p: 0, c: 0, f: 0 };
  let grams = 0; let foodId = item.foodId; let name = item.name;
  if (status === 'eaten') { grams = item.grams; macros = item; }
  if (status === 'adjusted') {
    grams = num(ctx.body.grams, 0, 2000, 'grams');
    const food = loadFoods(ctx.db).find((f) => f.id === item.foodId);
    macros = itemFor(food, grams);
  }
  if (status === 'swapped') {
    grams = num(ctx.body.grams, 1, 2000, 'grams');
    const food = loadFoods(ctx.db).find((f) => f.id === ctx.body.foodId);
    if (!food) throw bad('Unknown food');
    macros = itemFor(food, grams); foodId = food.id; name = food.name;
  }
  upsertLog(ctx.db, uid, { date, ref, status, foodId, name, grams, macros, loggedOn });
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.edited_by_admin', uid, { date, ref, status });
  return { ok: true };
});

route('POST', '/api/log/extra', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  const date = needDate(ctx.body.date);
  const loggedOn = isDate(ctx.body.today) ? ctx.body.today : date;
  let macros; let name; let foodId = null; let grams = 0;
  if (ctx.body.foodId) {
    const food = loadFoods(ctx.db).find((f) => f.id === ctx.body.foodId);
    if (!food) throw bad('Unknown food');
    grams = num(ctx.body.grams, 1, 3000, 'grams');
    macros = itemFor(food, grams); name = food.name; foodId = food.id;
  } else {
    name = str(ctx.body.name, 80, 'name', true);
    macros = { kcal: num(ctx.body.kcal, 0, 5000, 'kcal'), p: num(ctx.body.p ?? 0, 0, 500, 'p'), c: num(ctx.body.c ?? 0, 0, 800, 'c'), f: num(ctx.body.f ?? 0, 0, 500, 'f') };
  }
  const ref = `extra:${crypto.randomBytes(4).toString('hex')}`;
  upsertLog(ctx.db, uid, { date, ref, status: 'eaten', foodId, name, grams, macros, loggedOn });
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.extra_added_by_admin', uid, { date, name });
  return { ok: true, ref };
});

route('POST', '/api/log/remove', 'user', (ctx) => {
  const uid = subjectId(ctx, ctx.body);
  ctx.db.prepare('DELETE FROM logs WHERE user_id = ? AND date = ? AND ref = ?').run(uid, needDate(ctx.body.date), str(ctx.body.ref, 30, 'ref', true));
  if (uid !== ctx.user.id) audit(ctx.db, ctx.user.id, 'log.removed_by_admin', uid, { date: ctx.body.date, ref: ctx.body.ref });
  return { ok: true };
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

route('GET', '/api/group', 'user', (ctx) => {
  const today = needDate(ctx.query.get('today') ?? todayUtc(), 'today');
  const users = ctx.db.prepare('SELECT u.id, u.name, p.data FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.active = 1').all();
  const board = [];
  for (const u of users) {
    const hidden = Boolean(JSON.parse(u.data).hideFromLeaderboard);
    if (hidden && u.id !== ctx.user.id && ctx.user.role !== 'admin') continue;
    const scores = scoresBetween(ctx.db, u.id, addDays(today, -13), today);
    const done = scores.filter((s) => s.date < today && s.date >= addDays(today, -7));
    const avg7 = done.length ? Math.round(done.reduce((a, s) => a + s.total, 0) / done.length) : null;
    board.push({ name: u.name, avg7, days: done.length, streak: streak(scores, today), today: scores.find((s) => s.date === today)?.total ?? null, isMe: u.id === ctx.user.id, hidden });
  }
  board.sort((a, b) => (b.avg7 ?? -1) - (a.avg7 ?? -1));
  return { board };
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
  };
});

route('PUT', '/api/admin/users/:id', 'admin', (ctx) => {
  const id = Number(ctx.params.id);
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw notFound('User not found');
  const name = ctx.body.name === undefined ? u.name : str(ctx.body.name, 60, 'name', true);
  const role = ctx.body.role === undefined ? u.role : oneOf(ctx.body.role, ['admin', 'user'], 'role');
  const active = ctx.body.active === undefined ? u.active : ctx.body.active ? 1 : 0;
  if (id === ctx.user.id && (role !== 'admin' || !active)) throw bad('You cannot remove your own admin access or deactivate yourself');
  ctx.db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, id);
  if (!active) ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit(ctx.db, ctx.user.id, 'user.updated', id, { name, role, active });
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

route('POST', '/api/admin/users/:id/plans/generate', 'admin', (ctx) => {
  const id = Number(ctx.params.id);
  const planId = makePendingPlan(ctx.db, id, str(ctx.body.note, 300, 'note') || 'Generated by admin');
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

route('POST', '/api/admin/invites', 'admin', (ctx) => {
  const code = newInviteCode();
  const days = Math.round(num(ctx.body.days ?? 7, 1, 60, 'days'));
  ctx.db.prepare('INSERT INTO invites (code, note, created_by, expires_at) VALUES (?, ?, ?, ?)').run(code, str(ctx.body.note, 80, 'note'), ctx.user.id, new Date(Date.now() + days * 86400000).toISOString());
  audit(ctx.db, ctx.user.id, 'invite.created', null, { code });
  return { code };
});

route('GET', '/api/admin/invites', 'admin', (ctx) => ({
  invites: ctx.db.prepare('SELECT i.code, i.note, i.created_at, i.expires_at, u.name used_by FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 50').all(),
}));

const cleanFood = (b, existingId) => {
  const id = existingId ?? str(b.name, 60, 'name', true).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + crypto.randomBytes(2).toString('hex');
  const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r) => ['mainProtein', 'bfProtein', 'vegMain', 'carb', 'bfCarb', 'fruit', 'veg', 'fat', 'snack', 'boost'].includes(r));
  return {
    id, name: str(b.name, 80, 'name', true), cat: oneOf(b.cat ?? 'protein', ['protein', 'carb', 'fat', 'veg', 'fruit', 'dairy'], 'cat'),
    kcal: num(b.kcal, 0, 900, 'kcal'), p: num(b.p, 0, 100, 'p'), c: num(b.c, 0, 100, 'c'), f: num(b.f, 0, 100, 'f'),
    roles, tags: (Array.isArray(b.tags) ? b.tags : []).filter((t) => ALLERGEN_TAGS.includes(t)), veg: Boolean(b.veg),
    step: num(b.step ?? 5, 1, 100, 'step'), max: num(b.max ?? 500, 1, 3000, 'max'),
  };
};

route('POST', '/api/admin/foods', 'admin', (ctx) => {
  const f = cleanFood(ctx.body);
  ctx.db.prepare('INSERT INTO foods (id,name,cat,kcal,p,c,f,roles,tags,veg,step,max,custom) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)')
    .run(f.id, f.name, f.cat, f.kcal, f.p, f.c, f.f, JSON.stringify(f.roles), JSON.stringify(f.tags), f.veg ? 1 : 0, f.step, f.max);
  audit(ctx.db, ctx.user.id, 'food.created', null, { id: f.id, name: f.name });
  return { ok: true, id: f.id };
});

route('PUT', '/api/admin/foods/:id', 'admin', (ctx) => {
  const row = ctx.db.prepare('SELECT * FROM foods WHERE id = ?').get(ctx.params.id);
  if (!row) throw notFound('Food not found');
  const f = cleanFood({ ...rowToFood(row), ...ctx.body }, row.id);
  ctx.db.prepare('UPDATE foods SET name=?,cat=?,kcal=?,p=?,c=?,f=?,roles=?,tags=?,veg=?,step=?,max=? WHERE id = ?')
    .run(f.name, f.cat, f.kcal, f.p, f.c, f.f, JSON.stringify(f.roles), JSON.stringify(f.tags), f.veg ? 1 : 0, f.step, f.max, row.id);
  audit(ctx.db, ctx.user.id, 'food.updated', null, { id: row.id });
  return { ok: true };
});

route('DELETE', '/api/admin/foods/:id', 'admin', (ctx) => {
  ctx.db.prepare('UPDATE foods SET active = 0 WHERE id = ?').run(ctx.params.id);
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
route('GET', '/api/admin/backup', 'admin', async (ctx) => {
  const file = path.join(os.tmpdir(), `fitcrew-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
  ctx.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  try {
    const buf = await readFile(file);
    audit(ctx.db, ctx.user.id, 'backup.downloaded');
    return { __raw: buf, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="fitcrew-${todayUtc()}.db"` } };
  } finally { await rm(file, { force: true }); }
});

// Training routes live in their own file.
({ makePendingWorkoutPlan } = registerTrain({ route, bad, notFound, num, optNum, oneOf, str, needDate, isDate, subjectId, audit, addDays, todayUtc }));

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
