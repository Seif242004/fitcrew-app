// Gym check-ins (attendance photos, approved at once), plan clean-up, exercise swaps and the
// coach's training tools. The AI is a local mock speaking the OpenAI chat format.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { openDb, setSetting } from '../src/db.js';
import { createServer } from '../server.js';
import { runTool } from '../src/coach.js';

// ---------------------------------------------------------------- mock image AI
const ai = { gym: { gym: true, screenshot: false, confidence: 0.92, reason: 'Dumbbell rack and benches' }, body: { usable: true, bodyFatPct: 20, low: 18, high: 23, confidence: 0.5, focus: ['shoulders'], notes: 'Even build.' }, calls: [] };
const mock = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = JSON.parse(raw || '{}');
  ai.calls.push(body);
  const system = body.messages?.[0]?.content ?? '';
  const parts = body.messages?.[1]?.content;
  const reply = /gym attendance/.test(system) ? ai.gym : /physique coach/.test(system) ? ai.body : { menus: [] };
  assert.ok(!/gym attendance|physique/.test(system) || (Array.isArray(parts) && parts.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg;base64,'))), 'images go as image_url parts');
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`` } }] }));
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
process.env.FITCREW_AI_KEY = 'test-key';
process.env.FITCREW_AI_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;

async function boot() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-FitCrew': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: async (p) => (await fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} })).status };
  };
  return { db, client, close: () => server.close() };
}

const jpeg = (seed) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.createHash('sha512').update(String(seed)).digest(), Buffer.alloc(3000, seed.length)]).toString('base64')}`;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const profile = (o = {}) => ({ sex: 'male', age: 27, heightCm: 178, weightKg: 82, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5, experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', injuries: '', measurements: { neckCm: 39, waistCm: 88 }, prefs: { mealsPerDay: 4 }, ...o });

async function crew(app, names) {
  const admin = app.client();
  await admin.post('/api/setup', { name: 'Seif', email: 'seif@example.com', password: 'a-good-password' });
  const out = { admin };
  for (const [name, prof] of names) {
    const c = app.client();
    const { code } = (await admin.post('/api/admin/invites', {})).body;
    await c.post('/api/register', { code, name, email: `${name.toLowerCase()}@example.com`, password: `${name}-password-1` });
    if (prof) assert.equal((await c.put('/api/profile', { profile: prof })).status, 200);
    c.id = (await c.get('/api/me')).body.user.id;
    out[name.toLowerCase()] = c;
  }
  return out;
}

test('check-ins: approved at once, repeats flagged to the admin, admin can revoke', async (t) => {
  const app = await boot(); t.after(app.close);
  setSetting(app.db, 'timezone', 'UTC'); // the test's "today" is a UTC date
  const { admin, sam, lea, omar } = await crew(app, [['Sam', profile()], ['Lea', profile()], ['Omar', profile()]]);

  // only today, only JPEG
  assert.equal((await sam.post('/api/checkins', { date: twoDaysAgo, today: twoDaysAgo, image: jpeg('a') })).status, 400, 'no back-dated check-ins');
  assert.equal((await sam.post('/api/checkins', { date: today, today, image: 'data:image/png;base64,AAAA' })).status, 400);

  // approved straight away; the photo never goes to any AI
  const before = ai.calls.length;
  const s1 = await sam.post('/api/checkins', { date: today, today, image: jpeg('sam-1') });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.status, 'approved');
  assert.equal(ai.calls.length, before, 'no AI call for check-ins');
  assert.equal((await sam.get(`/api/train?date=${today}`)).body.checkin.status, 'approved');
  assert.equal((await sam.post('/api/checkins', { date: today, today, image: jpeg('sam-2') })).status, 400, 'one check-in a day');
  assert.equal((await sam.get('/api/admin/checkins')).status, 403);
  const queue = (await admin.get(`/api/admin/checkins?today=${today}`)).body;
  assert.equal(queue.pending.length, 0, 'nothing waits for the admin');
  assert.ok(queue.recent.some((c) => c.name === 'Sam' && c.status === 'approved'));

  // re-using an earlier photo is still approved but flagged for the admin
  await lea.post('/api/checkins', { date: today, today, image: jpeg('lea-1') });
  app.db.prepare("UPDATE checkins SET date = ? WHERE user_id = ?").run(yesterday, lea.id);
  const reuse = await lea.post('/api/checkins', { date: today, today, image: jpeg('lea-1') });
  assert.equal(reuse.body.status, 'approved');
  assert.match(reuse.body.reason, /Looks the same/);
  const flagged = (await admin.get(`/api/admin/checkins?today=${today}`)).body.recent.find((c) => c.id === reuse.body.id);
  assert.equal(flagged.verdict.flag, true);
  // a near-identical picture (average hash within 5 bits) is flagged too
  app.db.prepare('UPDATE checkins SET ahash = ? WHERE user_id = ? AND date = ?').run('f0f0f0f0f0f0f0f0', omar.id, yesterday);
  app.db.prepare("INSERT INTO checkins (user_id, date, status, hash, ahash, verdict) VALUES (?, ?, 'approved', 'x', 'f0f0f0f0f0f0f0f0', '{}')").run(omar.id, yesterday);
  const near = await omar.post('/api/checkins', { date: today, today, image: jpeg('omar-new'), ahash: 'f0f0f0f0f0f0f0f1' });
  assert.equal(near.body.status, 'approved');
  assert.match(near.body.reason, /Looks the same/);

  // admin revokes a fake one: points go, and it can be approved again
  assert.equal((await admin.post(`/api/admin/checkins/${reuse.body.id}/review`, { status: 'rejected', reason: 'Old photo' })).status, 200);
  assert.equal((await lea.get(`/api/train?date=${today}`)).body.checkin.status, 'rejected');
  assert.equal((await admin.post(`/api/admin/checkins/${reuse.body.id}/review`, { status: 'approved' })).status, 200);
  assert.equal((await lea.get(`/api/train?date=${today}`)).body.checkin.status, 'approved');
  // and marks attendance without a photo
  assert.equal((await admin.post(`/api/admin/users/${omar.id}/checkins`, { date: twoDaysAgo })).status, 200);
  assert.equal((await omar.get(`/api/checkins?days=7&today=${today}`)).body.checkins.find((c) => c.date === twoDaysAgo).status, 'approved');

  // photos are private: owner and admin only
  assert.equal(await sam.raw(`/api/checkins/${s1.body.id}/photo`), 200);
  assert.equal(await lea.raw(`/api/checkins/${s1.body.id}/photo`), 404);
  assert.equal(await admin.raw(`/api/checkins/${s1.body.id}/photo`), 200);

  // the leaderboard shows gym attendance
  const board = (await sam.get(`/api/group?today=${today}`)).body.board;
  assert.ok(board.every((b) => typeof b.gym.planned === 'number' && typeof b.gym.attended === 'number'));
  assert.equal(board.find((b) => b.name === 'Sam').trainedToday, true);
});

test('photo AI is gone: no assessment routes, no opt-in, old photo estimates ignored', async (t) => {
  const app = await boot(); t.after(app.close);
  const { admin, sam, kim } = await crew(app, [['Sam', profile({ aiPhotos: true })], ['Kim', profile({ bodyFatPct: 15 })]]);
  const imgs = [jpeg('front')];
  assert.equal((await sam.post('/api/body/assess', { images: imgs })).status, 404);
  assert.equal((await sam.get('/api/body/assessments')).status, 404);
  assert.equal((await sam.post('/api/profile/ai-photos', { on: true })).status, 404);
  assert.equal((await admin.post('/api/admin/ai-vision-test', {})).status, 404);
  assert.equal((await sam.get('/api/me')).body.profile.aiPhotos, undefined, 'the opt-in is not stored');
  // a typed body fat still counts
  assert.equal((await kim.get('/api/me')).body.targets.bodyFatPct, 15);
  // a legacy photo estimate is dropped: back to the tape-measure estimate
  const row = app.db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(sam.id);
  const legacy = { ...JSON.parse(row.data), bodyFatPct: 31, bodyFatSource: 'photos' };
  assert.equal((await sam.put('/api/profile', { profile: legacy })).status, 200);
  const t2 = (await sam.get('/api/me')).body.targets;
  assert.notEqual(t2.bodyFatPct, 31);
  assert.equal(t2.bodyFatSource, 'tape');
  // the admin settings no longer mention an image model
  const st = (await admin.get('/api/admin/settings')).body;
  assert.equal(st.aiVisionModel, undefined);
});

test('admin deletes old plans; clean-up keeps live, pending and recent ones; drafts do not pile up', async (t) => {
  const app = await boot(); t.after(app.close);
  setSetting(app.db, 'aiAutoApprove', false);
  const { admin, sam } = await crew(app, [['Sam', profile()]]);
  for (let i = 0; i < 3; i++) await admin.post(`/api/admin/users/${sam.id}/workout-plans/generate`, {});
  let d = (await admin.get(`/api/admin/users/${sam.id}?today=${today}`)).body;
  assert.equal(d.workoutPlans.filter((p) => p.status === 'pending').length, 1, 'a new draft replaces the old one');
  assert.equal(d.workoutPlans.length, 1);

  const w1 = d.workoutPlans[0].id;
  await admin.post(`/api/admin/workout-plans/${w1}/approve`, { startDate: yesterday });
  const p1 = d.plans.find((p) => p.status === 'pending').id;
  await admin.post(`/api/admin/plans/${p1}/approve`, { startDate: yesterday });
  const w2 = (await admin.post(`/api/admin/users/${sam.id}/workout-plans/generate`, {})).body.planId;
  await admin.post(`/api/admin/workout-plans/${w2}/approve`, { startDate: today });

  assert.equal((await admin.del(`/api/admin/workout-plans/${w2}`)).status, 400, 'the live plan cannot be deleted');
  assert.equal((await sam.del(`/api/admin/workout-plans/${w1}`)).status, 403);
  assert.equal((await admin.del(`/api/admin/workout-plans/${w1}`)).status, 200);
  assert.equal((await admin.del(`/api/admin/plans/${p1}`)).status, 400, 'live diet plan');

  // archived diet plans that ended before the cut-off go; the live one stays
  const p2 = (await admin.post(`/api/admin/users/${sam.id}/plans/generate`, {})).body.planId;
  await admin.post(`/api/admin/plans/${p2}/approve`, { startDate: today });
  const kept = await admin.post('/api/admin/cleanup', { today, keepDays: 14 });
  assert.deepEqual(kept.body.deleted, { diet: 0, training: 0 }, 'recent history is kept');
  const all = await admin.post('/api/admin/cleanup', { today, keepDays: 0, userId: sam.id });
  assert.equal(all.body.deleted.diet, 1);
  d = (await admin.get(`/api/admin/users/${sam.id}?today=${today}`)).body;
  assert.deepEqual(d.plans.map((p) => p.status), ['active']);
  assert.deepEqual(d.workoutPlans.map((p) => p.status), ['active']);
  assert.ok((await admin.get('/api/admin/audit')).body.entries.some((e) => e.action === 'plans.cleaned_up'));
});

test('members swap exercises like-for-like and change training days; the coach can do the same', async (t) => {
  const app = await boot(); t.after(app.close);
  const { sam } = await crew(app, [['Sam', profile()]]);
  const plan = (await sam.get('/api/workout-plan')).body.plan;
  assert.ok(plan, 'auto-approved training plan');
  assert.equal(plan.splitChoice.id, 'upperlower');
  assert.ok(plan.splitChoice.reason.length > 20, 'the plan says why this split');
  assert.equal(plan.split, 'Upper / lower');
  assert.ok(plan.days[0].exercises.every((e) => /^https:\/\/www\.youtube\.com\//.test(e.video)));
  const first = plan.days[0].exercises[0];
  const alts = (await sam.get(`/api/exercises/${first.exerciseId}/alternatives`)).body.options;
  assert.ok(alts.length >= 1);
  const to = alts.find((a) => !plan.days[0].exercises.some((e) => e.exerciseId === a.id));
  assert.equal((await sam.post('/api/workout-plan/swap', { exerciseId: first.exerciseId, toId: to.id, weekday: plan.days[0].weekday })).status, 200);
  assert.equal((await sam.get('/api/workout-plan')).body.plan.days[0].exercises[0].exerciseId, to.id);
  assert.equal((await sam.post('/api/workout-plan/swap', { exerciseId: to.id, toId: 'leg-press' })).status, 400, 'a leg press is no swap for a press');

  assert.equal((await sam.post('/api/profile/training', { split: 'arnold', trainDays: [6, 1, 3, 4] })).status, 400, 'Arnold is 3 or 6 days');
  const arn = await sam.post('/api/profile/training', { split: 'arnold', trainDays: [6, 1, 3] });
  assert.equal(arn.status, 200);
  assert.equal((await sam.get('/api/workout-plan')).body.plan.split, 'Arnold split');
  assert.equal((await sam.put('/api/profile', { profile: profile({ split: 'antpost', daysPerWeek: 3 }) })).status, 400);
  const ch = await sam.post('/api/profile/training', { split: 'auto', trainDays: [6, 0, 1, 3, 4] });
  assert.equal(ch.status, 200);
  assert.equal(ch.body.status, 'active');
  const p5 = (await sam.get('/api/workout-plan')).body.plan;
  assert.deepEqual(p5.days.map((d) => d.weekday), [6, 0, 1, 3, 4]);
  assert.equal(p5.split, 'Upper / lower / push / pull / legs');

  // coach tools, acting as Sam (a userId in the arguments is ignored)
  const user = app.db.prepare('SELECT * FROM users WHERE id = ?').get(sam.id);
  const sat = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); })(); // next Saturday (or today)
  const w = await runTool(app.db, user, sat, 'get_workout', {});
  assert.ok(w.session && w.exercises.length >= 5, 'Saturday has a session');
  const ex = w.exercises[0];
  const logged = await runTool(app.db, user, sat, 'log_sets', { exerciseId: ex.exerciseId, sets: [{ weightKg: 40, reps: 10 }, { weightKg: 40, reps: 9 }], userId: 1 });
  assert.deepEqual(logged.logged.map((x) => x.setNo), [1, 2]);
  const done = await runTool(app.db, user, sat, 'complete_exercise', { exerciseId: ex.exerciseId, weightKg: 40, reps: 9 });
  assert.equal(done.added, ex.plan.sets - 2);
  assert.ok((await runTool(app.db, user, sat, 'get_training_plan', {})).days.length === 5);
  assert.ok(Array.isArray((await runTool(app.db, user, sat, 'get_leaderboard', {})).board));
  assert.ok((await runTool(app.db, user, sat, 'get_profile', {})).profile.trainDays);
  assert.ok('attendance' in (await runTool(app.db, user, sat, 'get_attendance', { days: 14 })));
  assert.ok(Array.isArray((await runTool(app.db, user, sat, 'get_body', {})).photos));
  assert.ok((await runTool(app.db, user, sat, 'get_plan', {})).days.length >= 1);
  const adminRoute = await runTool(app.db, user, sat, 'ask_admin', { message: 'test' });
  assert.equal(adminRoute.sentToAdmin, true);
});

test('admin editor keeps RIR, tempo, notes, warm-up and cardio; validates tempo', async (t) => {
  const app = await boot(); t.after(app.close);
  const { admin, sam } = await crew(app, [['Sam', profile()]]);
  const id = (await admin.get(`/api/admin/users/${sam.id}?today=${today}`)).body.workoutPlans[0].id;
  const plan = (await admin.get(`/api/admin/workout-plans/${id}`)).body.plan;
  const body = { cardio: { kind: 'Walk', label: 'Stairs walk', minutes: 30, note: 'Easy pace' }, days: plan.days.map((d) => ({ ...d })) };
  body.days[0].exercises[0] = { ...body.days[0].exercises[0], rir: 2, tempo: '3010', note: 'Pause at the chest' };
  assert.equal((await admin.put(`/api/admin/workout-plans/${id}`, body)).status, 200);
  const saved = (await admin.get(`/api/admin/workout-plans/${id}`)).body.plan;
  assert.equal(saved.days[0].exercises[0].tempo, '3-0-1-0');
  assert.equal(saved.days[0].exercises[0].rir, 2);
  assert.equal(saved.days[0].exercises[0].note, 'Pause at the chest');
  assert.ok(saved.days[0].warmup.length >= 2, 'warm-up survives an edit');
  assert.equal(saved.cardio.minutes, 30);
  body.days[0].exercises[0].tempo = 'slow';
  assert.equal((await admin.put(`/api/admin/workout-plans/${id}`, body)).status, 400);
});

test.after(() => mock.close());
