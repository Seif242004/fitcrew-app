import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initDb, setSetting } from '../src/db.js';
import { getRecord, noteSet, refreshRecord, rebuildAllRecords, setScore } from '../src/records.js';
import { e1rm } from '../src/workout.js';

// Cloudflare bills rows_read per row scanned, so personal records are stored per exercise
// instead of being recomputed from the whole set history.
const addUser = (db) => db.prepare("INSERT INTO users (email, name, pass_salt, pass_hash) VALUES (?, 'U', 's', 'h')").run(`u${Math.random()}@x.com`).lastInsertRowid;
const addSet = (db, uid, date, ex, n, w, r) => db.prepare('INSERT INTO set_logs (user_id, date, exercise_id, set_no, weight_kg, reps, logged_on) VALUES (?,?,?,?,?,?,?)').run(uid, date, ex, n, w, r, date);

// The old definition, straight from the whole history.
function oldRecord(db, uid, ex) {
  let best = null; let max = 0;
  for (const r of db.prepare('SELECT date, weight_kg, reps FROM set_logs WHERE user_id = ? AND exercise_id = ? ORDER BY date DESC').all(uid, ex)) {
    max = Math.max(max, e1rm(r.weight_kg, r.reps));
    const score = setScore(r.weight_kg, r.reps);
    if (!best || score > best.score) best = { date: r.date, weight: r.weight_kg, reps: r.reps, score };
  }
  return best && { ...best, max };
}
const sameAsOld = (db, uid, ex) => {
  const o = oldRecord(db, uid, ex); const n = getRecord(db, uid, ex);
  if (!o) return assert.equal(n, undefined);
  assert.deepEqual([n.best_date, n.best_weight, n.best_reps, n.max_e1rm], [o.date, o.weight, o.reps, o.max]);
};

test('incremental records match the full-history answer, including bodyweight sets and removals', () => {
  const db = openDb(':memory:'); const uid = addUser(db);
  let seed = 7; const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  for (let day = 1; day <= 40; day++) for (let s = 1; s <= 3; s++) {
    const w = rnd(4) === 0 ? 0 : 20 + rnd(12) * 2.5; const reps = 3 + rnd(12);
    addSet(db, uid, `2026-09-${String(day).padStart(2, '0')}`, 'bench', day * 10 + s, w, reps);
    noteSet(db, uid, 'bench', { date: `2026-09-${String(day).padStart(2, '0')}`, weightKg: w, reps });
  }
  sameAsOld(db, uid, 'bench');
  db.prepare("DELETE FROM set_logs WHERE user_id = ? AND exercise_id = 'bench' AND date = (SELECT date FROM set_records WHERE user_id = ?)").run(uid, uid);
  refreshRecord(db, uid, 'bench');
  sameAsOld(db, uid, 'bench');
  db.prepare('DELETE FROM set_logs WHERE user_id = ?').run(uid);
  refreshRecord(db, uid, 'bench');
  assert.equal(getRecord(db, uid, 'bench'), undefined, 'no sets, no record');
});

test('an existing database gets its records built once on start', () => {
  const db = openDb(':memory:'); const uid = addUser(db);
  addSet(db, uid, '2026-09-01', 'squat', 1, 100, 5); addSet(db, uid, '2026-09-08', 'squat', 1, 110, 3); addSet(db, uid, '2026-09-08', 'pushup', 1, 0, 30);
  db.prepare('DELETE FROM set_records').run(); setSetting(db, 'setRecordsBuilt', false);
  initDb(db);
  sameAsOld(db, uid, 'squat'); sameAsOld(db, uid, 'pushup');
  assert.equal(getRecord(db, uid, 'pushup').max_e1rm, 0, 'bodyweight sets never set the weighted max');
  rebuildAllRecords(db); sameAsOld(db, uid, 'squat');
});

test('the history screen and PR flag work end to end from the records table', async () => {
  const { createServer } = await import('../server.js');
  const db = openDb(':memory:'); const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`; let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try {
    await call('POST', '/api/setup', { name: 'Admin', email: 'a@example.com', password: 'a-good-password' });
    const ex = db.prepare("SELECT id FROM exercises WHERE timed = 0 LIMIT 1").get().id;
    const log = (date, w, reps, n = 1) => call('POST', '/api/train/set', { date, today: date, exerciseId: ex, setNo: n, weightKg: w, reps });
    assert.equal((await log('2026-10-01', 50, 8)).body.pr, false, 'first ever set is not a PR');
    assert.equal((await log('2026-10-03', 60, 8)).body.pr, true);
    assert.equal((await log('2026-10-05', 55, 8)).body.pr, false);
    let h = (await call('GET', '/api/train/history?today=2026-10-06')).body;
    assert.deepEqual([h.records[0].weightKg, h.records[0].reps, h.records[0].date], [60, 8, '2026-10-03']);
    assert.equal(h.sessions.length, 3);
    // remove the record-holder: the next best takes over; re-saving a set rebuilds too
    await call('POST', '/api/train/set/remove', { date: '2026-10-03', exerciseId: ex, setNo: 1 });
    h = (await call('GET', '/api/train/history?today=2026-10-06')).body;
    assert.equal(h.records[0].weightKg, 55);
    await log('2026-10-05', 40, 8);
    h = (await call('GET', '/api/train/history?today=2026-10-06')).body;
    assert.equal(h.records[0].weightKg, 50);
    await call('POST', '/api/train/exercise/clear', { date: '2026-10-01', exerciseId: ex });
    h = (await call('GET', '/api/train/history?today=2026-10-06')).body;
    assert.equal(h.records[0].weightKg, 40);
  } finally { server.close(); }
});
