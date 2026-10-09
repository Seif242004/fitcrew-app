import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, loadFoods, loadExercises, offplanIds, touchCatalog } from '../src/db.js';

// Cloudflare bills rows_read per row scanned, so the food / exercise libraries must be read once
// per database, not once per request.
const counting = (db) => {
  const seen = [];
  const real = db.prepare.bind(db);
  db.prepare = (sql) => { seen.push(sql); return real(sql); };
  return seen;
};

test('food and exercise libraries are read from SQLite once, then served from memory', () => {
  const db = openDb(':memory:');
  const seen = counting(db);
  for (let i = 0; i < 5; i++) { loadFoods(db); loadFoods(db, { offplan: true }); loadFoods(db, { includeInactive: true }); loadExercises(db); offplanIds(db); }
  assert.equal(seen.filter((s) => /FROM foods/.test(s)).length, 1);
  assert.equal(seen.filter((s) => /FROM exercises/.test(s)).length, 2); // all rows + the inactive ids
});

test('filters match the old SQL: diet foods by default, off-plan on request, inactive only when asked', () => {
  const db = openDb(':memory:');
  const diet = loadFoods(db);
  assert.ok(diet.length > 100 && diet.every((f) => !f.offplan));
  assert.ok(loadFoods(db, { offplan: true }).length > diet.length);
  const id = diet[0].id;
  db.prepare('UPDATE foods SET active = 0 WHERE id = ?').run(id);
  touchCatalog(db);
  assert.ok(!loadFoods(db).some((f) => f.id === id));
  assert.ok(loadFoods(db, { includeInactive: true }).some((f) => f.id === id));
  const names = loadFoods(db).map((f) => f.name);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'ordered by name like ORDER BY name');
  assert.ok(offplanIds(db).size > 0 && !offplanIds(db).has(diet[1].id));
});

test('cached rows are frozen so callers cannot corrupt the shared copy', () => {
  const db = openDb(':memory:');
  const f = loadFoods(db)[0];
  assert.throws(() => { f.kcal = 1; });
  assert.throws(() => { f.roles.push('x'); });
  assert.ok(Object.isFrozen(loadExercises(db)[0]));
});

test('admin food and exercise edits show up immediately', async () => {
  const { createServer } = await import('../server.js');
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try {
    await call('POST', '/api/setup', { name: 'Admin', email: 'a@example.com', password: 'a-good-password' });
    const food = loadFoods(db)[0];
    assert.equal((await call('PUT', `/api/admin/foods/${food.id}`, { kcal: 123 })).status, 200);
    assert.equal(loadFoods(db).find((f) => f.id === food.id).kcal, 123);
    assert.equal((await call('DELETE', `/api/admin/foods/${food.id}`)).status, 200);
    assert.ok(!loadFoods(db).some((f) => f.id === food.id));
    const ex = loadExercises(db)[0];
    assert.equal((await call('DELETE', `/api/admin/exercises/${ex.id}`)).status, 200);
    assert.ok(!loadExercises(db).some((e) => e.id === ex.id));
    assert.ok(loadExercises(db, { includeInactive: true }).some((e) => e.id === ex.id));
  } finally { server.close(); }
});
