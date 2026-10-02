import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FOODS } from './foods-seed.js';
import { EXERCISES } from './workout.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  note TEXT,
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
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id INTEGER,
  detail TEXT,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export function openDb(file = process.env.FITCREW_DB ?? 'data/fitcrew.db') {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  seedFoods(db);
  seedExercises(db);
  return db;
}

function seedExercises(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO exercises (id,name,muscle,equip,pattern,inc,timed,notes,custom) VALUES (?,?,?,?,?,?,?,?,0)');
  for (const e of EXERCISES) ins.run(e.id, e.name, e.muscle, e.equip, e.pattern, e.inc, e.timed ? 1 : 0, e.notes);
}

export const loadExercises = (db, { includeInactive = false } = {}) =>
  db.prepare(`SELECT * FROM exercises ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`).all()
    .map((r) => ({ id: r.id, name: r.name, muscle: r.muscle, equip: r.equip, pattern: r.pattern, inc: r.inc, timed: Boolean(r.timed), notes: r.notes, custom: Boolean(r.custom) }));

function seedFoods(db) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO foods (id,name,cat,kcal,p,c,f,roles,tags,veg,step,max,unit,custom) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)',
  );
  for (const f of FOODS) {
    ins.run(f.id, f.name, f.cat, f.kcal, f.p, f.c, f.f, JSON.stringify(f.roles), JSON.stringify(f.tags), f.veg ? 1 : 0, f.step, f.max, f.unit ? JSON.stringify(f.unit) : null);
  }
}

export function rowToFood(r) {
  return {
    id: r.id, name: r.name, cat: r.cat, kcal: r.kcal, p: r.p, c: r.c, f: r.f,
    roles: JSON.parse(r.roles), tags: JSON.parse(r.tags), veg: Boolean(r.veg),
    step: r.step, max: r.max, unit: r.unit ? JSON.parse(r.unit) : null, custom: Boolean(r.custom),
  };
}

export const loadFoods = (db, { includeInactive = false } = {}) =>
  db.prepare(`SELECT * FROM foods ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`).all().map(rowToFood);
