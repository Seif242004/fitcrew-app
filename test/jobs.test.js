import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createServer } from '../server.js';
import { encrypt, decryptForTest, vapidKeys, pushToUser } from '../src/push.js';
import { runDueJobs, localClock } from '../src/jobs.js';

test('push payload encryption round-trips like a browser would decrypt it', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const body = encrypt('{"title":"hi","body":"مرحبا"}', ua.getPublicKey().toString('base64url'), auth);
  assert.equal(decryptForTest(body, ua, auth), '{"title":"hi","body":"مرحبا"}');
});

test('push sends VAPID-signed requests and drops dead subscriptions', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (email, name, pass_salt, pass_hash) VALUES ('a@b.c', 'A', 'x', 'y')").run();
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  for (const ep of ['https://push.example/live', 'https://push.example/gone']) {
    db.prepare('INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, 1, ?, ?)').run(ep, ua.getPublicKey().toString('base64url'), crypto.randomBytes(16).toString('base64url'));
  }
  const seen = [];
  const r = await pushToUser(db, 1, { title: 't' }, { fetchImpl: async (url, init) => { seen.push(init); return { ok: !url.endsWith('gone'), status: url.endsWith('gone') ? 410 : 201 }; } });
  assert.equal(r.sent, 1);
  assert.match(seen[0].headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapidKeys(db).publicKey}$`));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subs').get().n, 1, 'dead subscription removed');
});

test('local clock in Cairo', () => {
  const c = localClock(new Date('2026-10-02T05:30:00Z'), 'Africa/Cairo');
  assert.equal(c.date, '2026-10-02');
  assert.equal(c.weekday, 5);
  assert.ok(c.minutes === 8 * 60 + 30 || c.minutes === 7 * 60 + 30, 'UTC+3 or UTC+2 depending on DST rules');
});

test('daily check-ins: once per day, right time, real content', async (t) => {
  const db = openDb(':memory:');
  const server = createServer(db); await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`; let cookie = '';
  const call = async (m, p, b) => { const res = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const s = res.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return res.json(); };
  await call('POST', '/api/setup', { name: 'Seif Tamer', email: 's@e.com', password: 'a-good-password' });
  await call('PUT', '/api/profile', { profile: { sex: 'male', age: 25, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5, experience: 'beginner', daysPerWeek: 3, equipment: 'gym', injuries: '', measurements: {}, prefs: { mealsPerDay: 4 } } });
  const pushes = []; const push = async (_db, uid, msg) => { pushes.push(msg); return { sent: 1 }; };
  // 08:10 Cairo on 2026-10-03 (UTC+3 in October)
  const morning = new Date('2026-10-03T05:10:00Z');
  const sent = await runDueJobs(db, morning, { push });
  assert.deepEqual(sent.map((s) => s.job), ['morning']);
  assert.match(pushes[0].title, /Good morning Seif/);
  assert.equal((await runDueJobs(db, morning, { push })).length, 0, 'never twice a day');
  const msgs = (await call('GET', '/api/coach')).messages;
  assert.match(msgs[0].content, /Today is [\d,]+ kcal with \d+ g protein over 4 meals/);
  // 21:05: evening recap names what is missing and suggests a fix
  const eve = await runDueJobs(db, new Date('2026-10-03T18:05:00Z'), { push });
  assert.deepEqual(eve.map((s) => s.job), ['evening']);
  const last = (await call('GET', '/api/coach')).messages.at(-1).content;
  assert.match(last, /Not logged: breakfast, lunch, pre-workout snack, post-workout dinner/);
  assert.match(last, /g protein to go; about .+ covers it/);
  // 03:00 next day: too late for yesterday's jobs, too early for today's
  assert.equal((await runDueJobs(db, new Date('2026-10-04T00:00:00Z'), { push })).length, 0);
});
