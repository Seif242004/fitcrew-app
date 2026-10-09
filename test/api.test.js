import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../src/db.js';
import { createServer } from '../server.js';

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body, { csrf = true } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(csrf && method !== 'GET' ? { 'X-FitCrew': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), call };
  };
  return { db, server, base, client, close: () => server.close() };
}

const profile = {
  sex: 'male', age: 25, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
  experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', injuries: '',
  measurements: { neckCm: 38, waistCm: 85 },
  prefs: { mealsPerDay: 4, likedIds: ['chicken-breast'], dislikedIds: ['broccoli'], allergies: [], vegetarian: false },
};

test('full flow: setup, invite, onboarding, approval, logging, group', async (t) => {
  const app = await boot();
  setSetting(app.db, 'aiAutoApprove', false); // these tests cover the manual admin flow
  t.after(app.close);
  const admin = app.client();
  const sam = app.client();
  const today = '2026-10-02';

  assert.equal((await admin.get('/api/status')).body.needsSetup, true);
  assert.equal((await admin.post('/api/setup', { name: 'Haged', email: 'haged@example.com', password: 'short' })).status, 400);
  assert.equal((await admin.post('/api/setup', { name: 'Haged', email: 'haged@example.com', password: 'a-good-password' })).status, 200);
  assert.equal((await admin.get('/api/status')).body.needsSetup, false);
  assert.equal((await app.client().post('/api/setup', { name: 'X', email: 'x@example.com', password: 'a-good-password' })).status, 403, 'setup only works once');

  // invite-only registration
  assert.equal((await sam.post('/api/register', { code: 'NOPE', name: 'Sam', email: 'sam@example.com', password: 'sam-password-1' })).status, 400);
  const { code } = (await admin.post('/api/admin/invites', { note: 'Sam' })).body;
  assert.equal((await sam.post('/api/register', { code, name: 'Sam', email: 'sam@example.com', password: 'sam-password-1' })).status, 200);
  assert.equal((await app.client().post('/api/register', { code, name: 'Eve', email: 'eve@example.com', password: 'eve-password-1' })).status, 400, 'invite codes are single use');

  // permissions
  assert.equal((await sam.get('/api/admin/users')).status, 403);
  assert.equal((await sam.get('/api/me?userId=1')).status, 403);
  assert.equal((await app.client().get('/api/me')).status, 401);
  assert.equal((await sam.call('POST', '/api/log/remove', { date: today, ref: 'x' }, { csrf: false })).status, 403, 'CSRF header required');

  // onboarding: minors rejected, then valid profile creates a pending plan
  assert.equal((await sam.put('/api/profile', { profile: { ...profile, age: 16 } })).status, 400);
  const saved = await sam.put('/api/profile', { profile });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.targets.bmrFormula, 'katch-mcardle', 'navy body fat estimate switches the formula');
  assert.ok(saved.body.pendingPlanId);
  assert.equal((await sam.get('/api/plan')).body.plan, null, 'unapproved plan is not visible');
  assert.equal((await sam.get(`/api/today?date=${today}`)).body.plan, null);

  // admin edits then approves
  const samId = (await sam.get('/api/me')).body.user.id;
  const draft = (await admin.get(`/api/admin/plans/${saved.body.pendingPlanId}`)).body.plan;
  assert.equal(draft.days.length, 1, 'one daily plan, varied by swaps');
  draft.days[0].meals[1].items[0].grams = 250;
  const edited = await admin.put(`/api/admin/plans/${draft.id}`, { days: draft.days });
  assert.equal(edited.status, 200);
  assert.equal((await admin.put(`/api/admin/plans/${draft.id}`, { days: [{ meals: [{ name: 'x', items: [{ foodId: 'nope', grams: 1 }] }] }] })).status, 400);
  assert.equal((await admin.post(`/api/admin/plans/${draft.id}/approve`, { startDate: today })).status, 200);

  // today's checklist
  const day = (await sam.get(`/api/today?date=${today}`)).body;
  assert.equal(day.dayIdx, 0);
  assert.equal(day.meals.length, 4);
  assert.equal(day.meals[1].items[0].grams, 250, 'admin edit is what the user sees');
  assert.equal(day.consumed.kcal, 0);

  // log: eat everything as planned
  for (const m of day.meals) for (const it of m.items) {
    assert.equal((await sam.post('/api/log', { date: today, today, ref: it.key, status: 'eaten' })).status, 200);
  }
  const after = (await sam.get(`/api/today?date=${today}`)).body;
  assert.ok(after.consumed.kcal > 2000, `consumed ${after.consumed.kcal}`);
  assert.ok(after.score.total >= 90, `score ${after.score.total}`);

  // adjust, swap, skip, extra, undo
  const first = after.meals[0].items[0];
  await sam.post('/api/log', { date: today, today, ref: first.key, status: 'adjusted', grams: first.grams / 2 });
  await sam.post('/api/log', { date: today, today, ref: after.meals[2].items[0].key, status: 'swapped', foodId: 'salmon', grams: 100 });
  await sam.post('/api/log', { date: today, today, ref: after.meals[3].items[0].key, status: 'skipped' });
  const ex = await sam.post('/api/log/extra', { date: today, today, name: 'Koshari', kcal: 500, p: 15, c: 90, f: 8 });
  assert.equal(ex.status, 200);
  const mixed = (await sam.get(`/api/today?date=${today}`)).body;
  assert.equal(mixed.extras.length, 1);
  assert.equal(mixed.meals[0].items[0].log.status, 'adjusted');
  assert.equal(mixed.meals[2].items[0].log.name, 'Salmon, cooked');
  assert.equal((await sam.post('/api/log', { date: today, today, ref: '3-0-0', status: 'eaten' })).status, 400, 'item from another day is rejected');
  await sam.post('/api/log/remove', { date: today, ref: ex.body.ref });
  assert.equal((await sam.get(`/api/today?date=${today}`)).body.extras.length, 0);

  // body metrics
  assert.equal((await sam.post('/api/metrics', { date: today, weightKg: 79.4 })).status, 200);
  assert.equal((await sam.post('/api/metrics', { date: today, measurements: { waistCm: 84 } })).status, 200);
  assert.equal((await sam.post('/api/metrics', { date: today, weightKg: 79.2 })).status, 200);
  assert.equal((await sam.post('/api/metrics', {})).status, 400);
  const mrow = (await sam.get('/api/metrics')).body.metrics[0];
  assert.equal(mrow.weightKg, 79.2);
  assert.equal(mrow.measurements.waistCm, 84, 'a later weigh-in keeps the measurements');

  // admin can fix another user's log and it is audited
  assert.equal((await admin.post('/api/log', { userId: samId, date: today, today, ref: first.key, status: 'eaten' })).status, 200);
  const audit = (await admin.get('/api/admin/audit')).body.entries;
  assert.ok(audit.some((e) => e.action === 'log.edited_by_admin' && e.target === 'Sam'));
  assert.ok(audit.some((e) => e.action === 'plan.approved'));

  // change request flow
  assert.equal((await sam.post('/api/plan/request-change', { note: 'No more tuna please' })).status, 200);
  const reqs = (await admin.get('/api/admin/requests')).body.requests;
  assert.equal(reqs.length, 1);
  await admin.post(`/api/admin/requests/${reqs[0].id}/resolve`, { note: 'done' });
  assert.equal((await admin.get('/api/admin/requests')).body.requests.length, 0);

  // group leaderboard hides opted-out users from other users but not from the admin
  await admin.put('/api/profile', { profile: { ...profile, sex: 'male' } });
  const board = (await sam.get(`/api/group?today=${today}`)).body.board;
  assert.ok(board.some((b) => b.name === 'Sam' && b.isMe));
  await sam.put('/api/profile', { profile: { ...profile, hideFromLeaderboard: true } });
  assert.ok((await admin.get(`/api/group?today=${today}`)).body.board.some((b) => b.name === 'Sam' && b.hidden));

  // targets override and user management
  assert.equal((await admin.put(`/api/admin/users/${samId}/targets`, { override: { kcal: 2400, proteinG: 180, carbsG: 270, fatG: 70 } })).status, 200);
  assert.equal((await sam.get('/api/me')).body.targets.kcal, 2400);
  assert.equal((await admin.put('/api/admin/users/1', { role: 'user' })).status, 400, 'admin cannot demote themselves');
  assert.equal((await admin.put(`/api/admin/users/${samId}`, { active: false })).status, 200);
  assert.equal((await sam.get('/api/me')).status, 401, 'deactivated users are signed out');
});

test('login: wrong password fails, correct works, and repeated failures are throttled', async (t) => {
  const app = await boot();
  setSetting(app.db, 'aiAutoApprove', false); // these tests cover the manual admin flow
  t.after(app.close);
  const c = app.client();
  await c.post('/api/setup', { name: 'Admin', email: 'a@example.com', password: 'correct-horse-1' });
  const d = app.client();
  assert.equal((await d.post('/api/login', { email: 'a@example.com', password: 'wrong' })).status, 401);
  assert.equal((await d.post('/api/login', { email: 'a@example.com', password: 'correct-horse-1' })).status, 200);
  assert.equal((await d.get('/api/me')).body.user.role, 'admin');
  const e = app.client();
  for (let i = 0; i < 8; i++) await e.post('/api/login', { email: 'a@example.com', password: 'nope' });
  assert.equal((await e.post('/api/login', { email: 'a@example.com', password: 'correct-horse-1' })).status, 429);
});

test('static files and shared calculator are served, path traversal is blocked', async (t) => {
  const app = await boot();
  setSetting(app.db, 'aiAutoApprove', false); // these tests cover the manual admin flow
  t.after(app.close);
  assert.equal((await fetch(`${app.base}/shared/calc.js`)).status, 200);
  assert.equal((await fetch(`${app.base}/shared/api.js`)).status, 404);
  const trav = await fetch(`${app.base}/..%2fserver.js`);
  assert.notEqual(trav.status, 200);
});

test('plans made by an older engine are rebuilt once, unless a person approved them or the day is in progress', async (t) => {
  const app = await boot();
  t.after(app.close);
  const admin = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'haged@example.com', password: 'a-good-password' });
  const { code } = (await admin.post('/api/admin/invites', { note: 'Sam' })).body;
  const sam = app.client();
  await sam.post('/api/register', { code, name: 'Sam', email: 'sam@example.com', password: 'sam-password-1' });
  await sam.put('/api/profile', { profile });
  const uid = (await sam.get('/api/me')).body.user.id;
  const v1 = app.db.prepare("SELECT id, version FROM plans WHERE user_id = ? AND status = 'active'").get(uid);
  assert.ok(v1, 'first plan is live');
  // Simulate an old-engine profile (no engine marker, protein on total body weight).
  const old = JSON.parse(app.db.prepare('SELECT targets FROM profiles WHERE user_id = ?').get(uid).targets);
  delete old.engine; old.proteinG = 176;
  app.db.prepare('UPDATE profiles SET targets = ? WHERE user_id = ?').run(JSON.stringify(old), uid);
  await sam.get('/api/me');
  const v2 = app.db.prepare("SELECT id, version, note FROM plans WHERE user_id = ? AND status = 'active'").get(uid);
  assert.notEqual(v2.id, v1.id, 'a new plan replaced the old one');
  assert.equal(JSON.parse(app.db.prepare('SELECT targets FROM profiles WHERE user_id = ?').get(uid).targets).engine, 4);
  await sam.get('/api/me');
  assert.equal(app.db.prepare("SELECT id FROM plans WHERE user_id = ? AND status = 'active'").get(uid).id, v2.id, 'only once');
});

test('profile pictures: upload, crew can see, private members hidden, remove', async (t) => {
  const app = await boot();
  t.after(app.close);
  const admin = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'haged@example.com', password: 'a-good-password' });
  const join = async (name, extra = {}) => {
    const { code } = (await admin.post('/api/admin/invites', { note: name, ...extra })).body;
    const c = app.client();
    await c.post('/api/register', { code, name, email: `${name.toLowerCase()}@example.com`, password: 'a-good-password-1' });
    return c;
  };
  const sam = await join('Sam'); const lea = await join('Lea');
  // A tiny but valid JPEG header + padding (the server checks the magic bytes and size).
  const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800, 1)]).toString('base64')}`;
  assert.equal((await sam.put('/api/me/avatar', { image: 'data:image/png;base64,AAAA' })).status, 400);
  const up = await sam.put('/api/me/avatar', { image: jpeg });
  assert.equal(up.status, 200);
  assert.match(up.body.avatar, /^\/api\/avatar\/\d+\?v=/);
  assert.equal((await sam.get('/api/me')).body.user.avatar, up.body.avatar);
  const samId = (await sam.get('/api/me')).body.user.id;
  assert.equal((await lea.get(`/api/avatar/${samId}`)).status, 200, 'the crew can load it');
  assert.equal((await app.client().get(`/api/avatar/${samId}`)).status, 401, 'not without signing in');
  // A private member's picture is only for them and admins.
  app.db.prepare('UPDATE users SET private = 1 WHERE id = ?').run(samId);
  assert.equal((await lea.get(`/api/avatar/${samId}`)).status, 404);
  assert.equal((await admin.get(`/api/avatar/${samId}`)).status, 200);
  assert.equal((await sam.get(`/api/avatar/${samId}`)).status, 200);
  // Removing it.
  assert.equal((await sam.call('DELETE', '/api/me/avatar')).status, 200);
  assert.equal((await sam.get('/api/me')).body.user.avatar, null);
  assert.equal((await admin.get(`/api/avatar/${samId}`)).status, 404);
});

test('metrics ?limit returns only the newest rows, oldest first', async (t) => {
  const app = await boot();
  t.after(app.close);
  const admin = app.client();
  await admin.post('/api/setup', { name: 'Haged', email: 'haged@example.com', password: 'a-good-password' });
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) await admin.post('/api/metrics', { date: d, weightKg: 80 });
  assert.equal((await admin.get('/api/metrics')).body.metrics.length, 3);
  assert.deepEqual((await admin.get('/api/metrics?limit=2')).body.metrics.map((m) => m.date), ['2026-10-02', '2026-10-03']);
});
