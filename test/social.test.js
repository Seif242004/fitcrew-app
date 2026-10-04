// Monthly competition, month close and champions, the crew feed with reactions, weekly recap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSetting } from '../src/db.js';
import { createServer } from '../server.js';
import { monthOf, prevMonthOf } from '../src/social.js';

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
    return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b) };
  };
  return { db, client, close: () => server.close() };
}

const today = new Date().toISOString().slice(0, 10);
const profile = (o = {}) => ({ sex: 'male', age: 27, heightCm: 178, weightKg: 82, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5, experience: 'intermediate', daysPerWeek: 4, equipment: 'gym', injuries: '', measurements: {}, prefs: { mealsPerDay: 4 }, ...o });

async function crew(app, names) {
  const admin = app.client();
  await admin.post('/api/setup', { name: 'Seif', email: 'seif@example.com', password: 'a-good-password' });
  const out = { admin };
  for (const [name, prof] of names) {
    const c = app.client();
    const { code } = (await admin.post('/api/admin/invites', {})).body;
    await c.post('/api/register', { code, name, email: `${name.toLowerCase()}@example.com`, password: `${name}-password-1` });
    await c.put('/api/profile', { profile: prof });
    c.id = (await c.get('/api/me')).body.user.id;
    out[name.toLowerCase()] = c;
  }
  return out;
}
const eatAll = async (c, date) => {
  const day = (await c.get(`/api/today?date=${date}`)).body;
  for (const m of day.meals) for (const it of m.items) await c.post('/api/log', { date, today: date, ref: it.key, status: 'eaten' });
};

test('month helpers', () => {
  assert.deepEqual(monthOf('2026-02-14'), { key: '2026-02', label: 'February 2026', name: 'February', from: '2026-02-01', to: '2026-02-28' });
  assert.equal(prevMonthOf('2026-01-03').key, '2025-12');
  assert.equal(monthOf('2028-02-10').to, '2028-02-29', 'leap year');
});

test('monthly competition: points add up over the month, prize, reset', async (t) => {
  const app = await boot(); t.after(app.close);
  const { admin, sam, lea } = await crew(app, [['Sam', profile()], ['Lea', profile()]]);
  await eatAll(sam, today);
  let g = (await lea.get(`/api/group?today=${today}`)).body;
  assert.equal(g.month.key, today.slice(0, 7));
  assert.ok(g.month.daysLeft >= 1 && g.month.daysLeft <= 31);
  assert.equal(g.board[0].name, 'Sam');
  assert.ok(g.board[0].points > 0 && g.board[0].points === g.board[0].today);
  assert.equal(g.board[1].points, 0);
  assert.equal(g.prize, null);
  assert.equal((await sam.put('/api/admin/competition', { prize: 'x' })).status, 403);
  assert.equal((await admin.put('/api/admin/competition', { prize: 'Dinner at Zooba' })).status, 200);
  g = (await lea.get(`/api/group?today=${today}`)).body;
  assert.equal(g.prize, 'Dinner at Zooba');
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  await admin.post('/api/admin/reset-scores', { today: tomorrow });
  g = (await lea.get(`/api/group?today=${today}`)).body;
  assert.ok(g.board.every((b) => b.points === 0 && b.streak === 0), 'nothing before the reset counts');
});

test('a new month closes the last one: champion stored once, posted in the feed, trophy counted', async (t) => {
  const app = await boot(); t.after(app.close);
  const { sam, lea } = await crew(app, [['Sam', profile()], ['Lea', profile()]]);
  const last = prevMonthOf(today);
  app.db.prepare('UPDATE plans SET start_date = ?').run(last.from);
  app.db.prepare('UPDATE workout_plans SET start_date = ?').run(last.from);
  await eatAll(lea, last.to);
  await eatAll(lea, last.from);
  await eatAll(sam, last.to);
  const g = (await sam.get(`/api/group?today=${today}`)).body;
  assert.equal(g.champions[0].name, 'Lea');
  assert.equal(g.champions[0].month, last.key);
  assert.ok(g.champions[0].points > 0);
  assert.equal(g.board.find((b) => b.name === 'Lea').trophies, 1);
  await sam.get(`/api/group?today=${today}`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM competition_results').get().n, 1, 'closed only once');
  const feed = (await sam.get(`/api/feed?today=${today}`)).body.items;
  assert.ok(feed.some((i) => i.kind === 'champion' && i.name === 'Lea' && i.text.includes(last.name)));
});

test('feed: check-ins, PRs and 70+ days are posted; reactions toggle; hidden members stay hidden', async (t) => {
  const app = await boot(); t.after(app.close);
  setSetting(app.db, 'timezone', 'UTC');
  const { admin, sam, lea, kim } = await crew(app, [['Sam', profile()], ['Lea', profile()], ['Kim', profile({ hideFromLeaderboard: true })]]);
  await admin.post(`/api/admin/users/${sam.id}/checkins`, { date: today });
  await admin.post(`/api/admin/users/${kim.id}/checkins`, { date: today });
  await sam.post('/api/train/set', { date: today, today, exerciseId: 'leg-press', setNo: 1, weightKg: 100, reps: 10 });
  await sam.post('/api/train/set', { date: today, today, exerciseId: 'leg-press', setNo: 2, weightKg: 120, reps: 10 });
  let feed = (await lea.get(`/api/feed?today=${today}`)).body.items;
  assert.ok(feed.some((i) => i.name === 'Sam' && i.text === 'checked in at the gym'));
  assert.ok(feed.some((i) => i.kind === 'pr' && /Leg press machine \(quads\): 120 kg × 10/.test(i.text)));
  assert.ok(!feed.some((i) => i.name === 'Kim'), 'hidden members are not in other people\'s feed');
  assert.ok((await kim.get(`/api/feed?today=${today}`)).body.items.some((i) => i.isMe), 'but they see their own');
  // revoking the check-in takes the post down
  const ci = (await admin.get(`/api/admin/checkins?today=${today}`)).body.recent.find((c) => c.name === 'Sam');
  await admin.post(`/api/admin/checkins/${ci.id}/review`, { status: 'rejected' });
  feed = (await lea.get(`/api/feed?today=${today}`)).body.items;
  assert.ok(!feed.some((i) => i.name === 'Sam' && i.kind === 'checkin'));
  // reactions
  const pr = feed.find((i) => i.kind === 'pr');
  assert.equal((await lea.post(`/api/feed/${pr.id}/react`, { kind: 'fire' })).body.on, true);
  let item = (await sam.get(`/api/feed?today=${today}`)).body.items.find((i) => i.id === pr.id);
  assert.equal(item.reactions.find((r) => r.kind === 'fire').count, 1);
  assert.equal((await lea.post(`/api/feed/${pr.id}/react`, { kind: 'fire' })).body.on, false, 'second tap removes it');
  assert.equal((await lea.post(`/api/feed/${pr.id}/react`, { kind: 'poop' })).status, 400);
  item = (await sam.get(`/api/feed?today=${today}`)).body.items.find((i) => i.id === pr.id);
  assert.equal(item.reactions.find((r) => r.kind === 'fire').count, 0);
  // a 70+ day is posted once
  await eatAll(lea, today);
  const score = (await lea.get(`/api/adherence?days=1&today=${today}`)).body.scores[0].total;
  feed = (await sam.get(`/api/feed?today=${today}`)).body.items;
  if (score >= 70) assert.equal(feed.filter((i) => i.name === 'Lea' && i.kind === 'day').length, 1);
  else assert.ok(!feed.some((i) => i.name === 'Lea' && i.kind === 'day'));
});

test('weekly recap: points, rank, gym, best lift and one tip', async (t) => {
  const app = await boot(); t.after(app.close);
  const { sam, lea } = await crew(app, [['Sam', profile()], ['Lea', profile()]]);
  await eatAll(sam, today);
  await sam.post('/api/train/set', { date: today, today, exerciseId: 'leg-press', setNo: 1, weightKg: 140, reps: 8 });
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  const friday = d.toISOString().slice(0, 10);
  const r = (await sam.get(`/api/recap?today=${friday}`)).body.recap;
  assert.ok(r.points > 0);
  assert.equal(r.rank, 1);
  assert.equal(r.of, 2);
  assert.equal(r.bestLift.weightKg, 140);
  assert.ok(r.tip.length > 20);
  assert.equal((await lea.get(`/api/recap?today=${friday}`)).body.recap, null, 'nothing logged, no recap');
});

test('private members: invisible to everyone but admins, never compete, cannot react', async (t) => {
  const app = await boot(); t.after(app.close);
  setSetting(app.db, 'timezone', 'UTC');
  const { admin, sam } = await crew(app, [['Sam', profile()]]);
  // A private invite makes the account private from the first second.
  const { code } = (await admin.post('/api/admin/invites', { private: true, note: 'Nour' })).body;
  const nour = app.client();
  await nour.post('/api/register', { code, name: 'Nour', email: 'nour@example.com', password: 'Nour-password-1' });
  await nour.put('/api/profile', { profile: profile({ sex: 'female' }) });
  const me = (await nour.get('/api/me')).body.user;
  assert.equal(me.private, true);
  await eatAll(nour, today);
  await admin.post(`/api/admin/users/${me.id}/checkins`, { date: today });
  // Other members: no trace on the board, in the feed or in the coach's view.
  const g = (await sam.get(`/api/group?today=${today}`)).body;
  assert.ok(!g.board.some((b) => b.name === 'Nour'));
  assert.ok(!(await sam.get(`/api/feed?today=${today}`)).body.items.some((i) => i.name === 'Nour'));
  // The private member does not see themselves on the board either, but gets their own month.
  const gn = (await nour.get(`/api/group?today=${today}`)).body;
  assert.ok(!gn.board.some((b) => b.isMe));
  assert.ok(gn.private.points > 0);
  // Admins see them, marked private, ranked after everyone competing.
  const ga = (await admin.get(`/api/group?today=${today}`)).body;
  assert.equal(ga.board.at(-1).name, 'Nour');
  assert.equal(ga.board.at(-1).private, true);
  // Reacting would reveal the name.
  const post = (await nour.get(`/api/feed?today=${today}`)).body.items[0];
  const samPost = (await sam.post('/api/train/set', { date: today, today, exerciseId: 'leg-press', setNo: 1, weightKg: 50, reps: 10 }), (await admin.post(`/api/admin/users/${sam.id}/checkins`, { date: today }), (await nour.get(`/api/feed?today=${today}`)).body.items.find((i) => i.name === 'Sam')));
  assert.equal((await nour.post(`/api/feed/${samPost.id}/react`, { kind: 'fire' })).status, 403);
  assert.equal((await sam.post(`/api/feed/${post.id}/react`, { kind: 'fire' })).status, 404, 'others cannot even find their posts');
  // They never win a month.
  const r = (await nour.get(`/api/recap?today=${today}`)).body.recap;
  if (r) assert.equal(r.rank, null);
  // Making an existing member private (and back) through the admin route.
  assert.equal((await admin.put(`/api/admin/users/${sam.id}`, { private: true })).status, 200);
  assert.ok(!(await nour.get(`/api/group?today=${today}`)).body.board.some((b) => b.name === 'Sam'));
  await admin.put(`/api/admin/users/${sam.id}`, { private: false });
  assert.ok((await nour.get(`/api/group?today=${today}`)).body.board.some((b) => b.name === 'Sam'));
});

test('start everyone over: data gone, accounts and sign-ins kept, setup works again', async (t) => {
  const app = await boot(); t.after(app.close);
  const { admin, sam } = await crew(app, [['Sam', profile()]]);
  await eatAll(sam, today);
  await sam.post('/api/train/set', { date: today, today, exerciseId: 'leg-press', setNo: 1, weightKg: 50, reps: 10 });
  assert.equal((await sam.post('/api/admin/fresh-start', { confirm: 'START OVER' })).status, 403);
  assert.equal((await admin.post('/api/admin/fresh-start', { confirm: 'start' })).status, 400);
  const r = await admin.post('/api/admin/fresh-start', { confirm: 'START OVER', today });
  assert.equal(r.status, 200);
  assert.ok(r.body.deleted.logs > 0 && r.body.deleted.profiles >= 1);
  for (const tb of ['profiles', 'plans', 'workout_plans', 'logs', 'set_logs', 'activity']) assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM ${tb}`).get().n, 0, tb);
  // Still signed in (same cookie), no profile, so the app sends them to setup.
  const me = (await sam.get('/api/me')).body;
  assert.equal(me.user.name, 'Sam');
  assert.equal(me.profile, null);
  assert.ok(me.freshStartAt);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
  assert.ok(app.db.prepare('SELECT COUNT(*) n FROM foods').get().n > 50, 'libraries kept');
  // Setting up again gives a full new plan.
  await sam.put('/api/profile', { profile: profile() });
  assert.ok((await sam.get(`/api/today?date=${today}`)).body.meals.length >= 3);
  assert.ok((await sam.get('/api/workout-plan')).body.plan || (await sam.get('/api/workout-plan')).body.hasPending);
  const g = (await sam.get(`/api/group?today=${today}`)).body;
  assert.ok(g.board.every((b) => b.points === 0 || b.isMe));
});
