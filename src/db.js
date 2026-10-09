import { FOODS } from './foods-seed.js';
import { OFFPLAN_FOODS } from './offplan-foods.js';
// Diet foods (plans, swaps) and off-plan foods (logging only) share the foods table; `offplan` tells them apart.
const ALL_FOODS = [...FOODS, ...OFFPLAN_FOODS];
import { EXERCISES } from './workout.js';
import { rebuildAllRecords } from './records.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  private INTEGER NOT NULL DEFAULT 0, -- admin-only: invisible to every other member everywhere
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Profile pictures: one small square JPEG per person (users.avatar_at says it exists and busts caches).
CREATE TABLE IF NOT EXISTS avatars (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  image BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  note TEXT,
  private INTEGER NOT NULL DEFAULT 0, -- the account it creates starts private
  created_by INTEGER REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  targets TEXT NOT NULL,
  targets_override TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cat TEXT NOT NULL,
  kcal REAL NOT NULL, p REAL NOT NULL, c REAL NOT NULL, f REAL NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  veg INTEGER NOT NULL DEFAULT 0,
  step REAL NOT NULL DEFAULT 5,
  max REAL NOT NULL DEFAULT 500,
  unit TEXT,
  custom INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','archived','rejected')),
  data TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS plans_user ON plans(user_id, status);
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('eaten','adjusted','swapped','skipped')),
  food_id TEXT,
  name TEXT,
  grams REAL NOT NULL DEFAULT 0,
  kcal REAL NOT NULL DEFAULT 0, p REAL NOT NULL DEFAULT 0, c REAL NOT NULL DEFAULT 0, f REAL NOT NULL DEFAULT 0,
  logged_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, date, ref)
);
CREATE TABLE IF NOT EXISTS body_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight_kg REAL,
  measurements TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  UNIQUE (user_id, date)
);
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  muscle TEXT NOT NULL,
  equip TEXT NOT NULL,
  pattern TEXT NOT NULL,
  inc REAL NOT NULL DEFAULT 2.5,
  timed INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  custom INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS workout_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','archived','rejected')),
  data TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS wplans_user ON workout_plans(user_id, status);
CREATE TABLE IF NOT EXISTS set_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  set_no INTEGER NOT NULL,
  weight_kg REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL,
  rpe REAL,
  logged_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, date, exercise_id, set_no)
);
CREATE INDEX IF NOT EXISTS sets_user_ex ON set_logs(user_id, exercise_id, date);
-- Personal records, one row per person and exercise (records.js): keeps the Train screens from
-- re-reading all of a person's sets.
CREATE TABLE IF NOT EXISTS set_records (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  best_date TEXT NOT NULL,
  best_weight REAL NOT NULL,
  best_reps INTEGER NOT NULL,
  best_score REAL NOT NULL,
  max_e1rm REAL NOT NULL,
  PRIMARY KEY (user_id, exercise_id)
);
CREATE TABLE IF NOT EXISTS cardio_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes REAL NOT NULL,
  distance_km REAL,
  avg_hr INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS cardio_user ON cardio_logs(user_id, date);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  pose TEXT NOT NULL,
  image BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS photos_user ON photos(user_id, date);
CREATE TABLE IF NOT EXISTS coach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','event')),
  kind TEXT NOT NULL DEFAULT 'chat',
  content TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS coach_user ON coach_messages(user_id, id);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS day_swaps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ref TEXT NOT NULL,
  food_id TEXT NOT NULL,
  grams REAL NOT NULL,
  PRIMARY KEY (user_id, date, ref)
);
-- "Just today" whole-meal swaps: the meal's items for one date (JSON, plan item shape).
CREATE TABLE IF NOT EXISTS meal_swaps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal_idx INTEGER NOT NULL,
  tpl TEXT,
  title TEXT,
  items TEXT NOT NULL,
  PRIMARY KEY (user_id, date, meal_idx)
);
CREATE TABLE IF NOT EXISTS water_logs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ml INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs_run (
  job TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job, user_id, day)
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  image BLOB,
  hash TEXT,
  ahash TEXT,
  verdict TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS checkins_status ON checkins(status, date);
CREATE TABLE IF NOT EXISTS body_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  body_fat_pct REAL,
  data TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS assess_user ON body_assessments(user_id, id);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS activity_time ON activity(created_at);
CREATE TABLE IF NOT EXISTS reactions (
  activity_id INTEGER NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  PRIMARY KEY (activity_id, user_id, kind)
);
-- One-tap rest / training day switch (api-train.js sessionFor): kind 'rest' turns a planned
-- session day into a rest day; kind 'train' turns a rest day into a training day doing the
-- session planned on that weekday (pulled forward from later in the week).
CREATE TABLE IF NOT EXISTS day_overrides (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rest','train')),
  weekday INTEGER,
  PRIMARY KEY (user_id, date)
);
-- Adaptive weekly check-in (adaptive.js): one row per person per check-in Friday.
-- status: open (waiting for an answer) | accepted | kept | dismissed. data: the check-in numbers.
CREATE TABLE IF NOT EXISTS diet_checkins (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  data TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  PRIMARY KEY (user_id, week)
);
CREATE TABLE IF NOT EXISTS competition_results (
  month TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  prize TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id INTEGER,
  detail TEXT,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Local / Node: open a SQLite file. node:sqlite, fs and path are loaded lazily so this module
 * also runs on Cloudflare, where the database is a Durable Object's SQLite (see worker/).
 */
export function openDb(file = process.env.FITCREW_DB ?? 'data/fitcrew.db') {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  if (file !== ':memory:') {
    const { mkdirSync } = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return initDb(db);
}

// Bump when seed data changes; seeding then runs once instead of on every start (on Cloudflare
// every cold start would otherwise rewrite ~200 rows).
const SEED_VERSION = `${ALL_FOODS.reduce((a, f) => a + f.roles.join().length, 0)}:${ALL_FOODS.length}:${ALL_FOODS.reduce((a, f) => a + f.kcal + f.p + (f.portion?.[1] ?? 0) + (f.raw ?? 0) + (f.unit?.g ?? 0), 0).toFixed(1)}:${EXERCISES.length}:${EXERCISES.reduce((a, e) => a + e.name.length + e.notes.length + (e.video ?? '').length, 0)}`;

/** Schema, migrations and seed data on any SQLite with prepare/exec (node:sqlite or the DO adapter). */
export function initDb(db) {
  db.exec(SCHEMA);
  migrate(db);
  // Existing databases: build the personal-records table once from the sets already logged.
  if (!getSetting(db, 'setRecordsBuilt')) { rebuildAllRecords(db); setSetting(db, 'setRecordsBuilt', true); }
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'seedVersion'").get()?.value;
  if (seeded !== JSON.stringify(SEED_VERSION)) {
    seedFoods(db);
    seedExercises(db);
    setSetting(db, 'seedVersion', SEED_VERSION);
    touchCatalog(db);
  }
  return db;
}

// Seeded exercises are upserted (names, cues and demo videos improve over time) unless the admin
// made the exercise or edited it by hand.
function seedExercises(db) {
  const up = db.prepare(`INSERT INTO exercises (id,name,muscle,equip,pattern,inc,timed,notes,video,custom) VALUES (?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, muscle=excluded.muscle, equip=excluded.equip, pattern=excluded.pattern, inc=excluded.inc,
      timed=excluded.timed, notes=excluded.notes, video=excluded.video
    WHERE exercises.custom = 0 AND exercises.edited = 0`);
  for (const e of EXERCISES) up.run(e.id, e.name, e.muscle, e.equip, e.pattern, e.inc, e.timed ? 1 : 0, e.notes, e.video ?? '');
}

// ---------------------------------------------------------------- catalogue cache
// The food (635 rows) and exercise (95 rows) libraries change only when the admin edits them or a
// seed upgrade runs, but nearly every request used to re-read them whole (Cloudflare bills every
// row a query scans as rows_read). They are now read once per database and kept in memory;
// every write to those tables calls touchCatalog() so the next read reloads them. The cached
// objects are frozen so a caller cannot change the shared copy by accident.
const catalog = new WeakMap(); // db -> { foods, exercises, offplanIds }
export const touchCatalog = (db) => { catalog.delete(db); };
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const cached = (db) => { let c = catalog.get(db); if (!c) catalog.set(db, c = {}); return c; };

export function loadExercises(db, { includeInactive = false } = {}) {
  const c = cached(db);
  c.exercises ??= db.prepare('SELECT * FROM exercises ORDER BY name').all()
    .map((r) => deepFreeze({ id: r.id, name: r.name, muscle: r.muscle, equip: r.equip, pattern: r.pattern, inc: r.inc, timed: Boolean(r.timed), notes: r.notes, video: r.video ?? '', custom: Boolean(r.custom) }));
  c.inactiveEx ??= new Set(db.prepare('SELECT id FROM exercises WHERE active = 0').all().map((r) => r.id));
  return includeInactive ? c.exercises.slice() : c.exercises.filter((e) => !c.inactiveEx.has(e.id));
}

/** Additive column migrations for databases created by older versions. */
function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(foods)').all().map((c) => c.name));
  const add = (col, def) => { if (!cols.has(col)) db.exec(`ALTER TABLE foods ADD COLUMN ${col} ${def}`); };
  add('ar', "TEXT NOT NULL DEFAULT ''");
  add('portion', 'TEXT');
  add('est', 'INTEGER NOT NULL DEFAULT 0');
  add('edited', 'INTEGER NOT NULL DEFAULT 0'); // set when the admin changes a seeded food
  add('raw', 'REAL'); // cooked weight / dry weight
  add('offplan', 'INTEGER NOT NULL DEFAULT 0'); // off-plan food (pizza, sweets): logging only, never in plans
  const ecols = new Set(db.prepare('PRAGMA table_info(exercises)').all().map((c) => c.name));
  if (!ecols.has('video')) db.exec("ALTER TABLE exercises ADD COLUMN video TEXT NOT NULL DEFAULT ''");
  if (!ecols.has('edited')) db.exec('ALTER TABLE exercises ADD COLUMN edited INTEGER NOT NULL DEFAULT 0');
  // Private members (admin-only visibility) and private invites.
  const ucols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!ucols.has('private')) db.exec('ALTER TABLE users ADD COLUMN private INTEGER NOT NULL DEFAULT 0');
  if (!ucols.has('avatar_at')) db.exec('ALTER TABLE users ADD COLUMN avatar_at TEXT'); // profile picture version
  // How a log was entered ("3 eggs", "1½ cups"), so it reads back the way the person said it.
  const lcols = new Set(db.prepare('PRAGMA table_info(logs)').all().map((c) => c.name));
  if (!lcols.has('amount')) db.exec('ALTER TABLE logs ADD COLUMN amount TEXT');
  // Which meal an extra food or drink belongs to (index into the day's meals); NULL = not placed.
  // Plan items carry their meal in the ref ("day-meal-item"), so only extras use it.
  if (!lcols.has('meal')) db.exec('ALTER TABLE logs ADD COLUMN meal INTEGER');
  const icols = new Set(db.prepare('PRAGMA table_info(invites)').all().map((c) => c.name));
  if (!icols.has('private')) db.exec('ALTER TABLE invites ADD COLUMN private INTEGER NOT NULL DEFAULT 0');
}

// Seeded foods are upserted so corrections reach existing databases, except foods the admin
// created (custom) or edited by hand (edited), which are never overwritten.
function seedFoods(db) {
  const up = db.prepare(`INSERT INTO foods (id,name,ar,cat,kcal,p,c,f,roles,tags,veg,step,max,unit,portion,est,raw,offplan,custom)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, ar=excluded.ar, cat=excluded.cat, kcal=excluded.kcal, p=excluded.p, c=excluded.c, f=excluded.f,
      roles=excluded.roles, tags=excluded.tags, veg=excluded.veg, step=excluded.step, max=excluded.max, unit=excluded.unit, portion=excluded.portion, est=excluded.est, raw=excluded.raw, offplan=excluded.offplan
    WHERE foods.custom = 0 AND foods.edited = 0`);
  db.exec('BEGIN');
  try {
    for (const f of ALL_FOODS) {
      up.run(f.id, f.name, f.ar ?? '', f.cat, f.kcal, f.p, f.c, f.f, JSON.stringify(f.roles), JSON.stringify(f.tags), f.veg ? 1 : 0, f.step, f.max,
        f.unit ? JSON.stringify(f.unit) : null, f.portion ? JSON.stringify(f.portion) : null, f.est ? 1 : 0, f.raw ?? null, f.offplan ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const getSetting = (db, key, fallback = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
};
export const setSetting = (db, key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));

export function rowToFood(r) {
  return {
    id: r.id, name: r.name, cat: r.cat, kcal: r.kcal, p: r.p, c: r.c, f: r.f,
    roles: JSON.parse(r.roles), tags: JSON.parse(r.tags), veg: Boolean(r.veg),
    step: r.step, max: r.max, unit: r.unit ? JSON.parse(r.unit) : null, custom: Boolean(r.custom),
    ar: r.ar ?? '', portion: r.portion ? JSON.parse(r.portion) : null, est: Boolean(r.est), raw: r.raw ?? null, offplan: Boolean(r.offplan),
  };
}

/**
 * Foods for plans and swaps by default: active diet foods only. Off-plan foods (pizza, sweets)
 * are never returned unless asked for, so nothing that builds or changes a plan can pick them.
 *   offplan: true          also include off-plan foods (food search and logging)
 *   includeInactive: true  everything, for looking up foods by id (old logs, old plans)
 */
export function loadFoods(db, { includeInactive = false, offplan = false } = {}) {
  const c = cached(db);
  if (!c.foods) {
    const rows = db.prepare('SELECT * FROM foods ORDER BY name').all();
    c.foods = rows.map((r) => deepFreeze(rowToFood(r)));
    c.inactiveFoods = new Set(rows.filter((r) => !r.active).map((r) => r.id));
  }
  if (includeInactive) return c.foods.slice();
  return c.foods.filter((f) => !c.inactiveFoods.has(f.id) && (offplan || !f.offplan));
}

/** Ids of the off-plan (logging-only) foods, from the cached library. */
export function offplanIds(db) {
  const c = cached(db);
  return c.offplanIds ??= new Set(loadFoods(db, { includeInactive: true }).filter((f) => f.offplan).map((f) => f.id));
}
