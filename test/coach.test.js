import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../server.js';
import { coachTurn, runTool, searchFoods, norm } from '../src/coach.js';
import { loadFoods } from '../src/db.js';

const D = '2026-10-03';
const env = { FITCREW_AI_KEY: 'k', FITCREW_AI_BASE_URL: 'https://ai.example/v1', FITCREW_AI_MODEL: 'm' };
const profile = {
  sex: 'male', age: 25, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
  experience: 'beginner', daysPerWeek: 3, equipment: 'gym', injuries: '', measurements: {},
  prefs: { mealsPerDay: 4, trainTime: 'evening', likedIds: [], dislikedIds: [], allergies: [], vegetarian: false },
};

async function setup() {
  const db = openDb(':memory:');
  const server = createServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-FitCrew': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return res.json();
  };
  await call('POST', '/api/setup', { name: 'Seif', email: 's@example.com', password: 'a-good-password' });
  await call('PUT', '/api/profile', { profile });
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get();
  return { db, user, call, close: () => server.close() };
}

// A fake model that plays back a script of tool calls, then a final message.
function scripted(steps) {
  let i = 0; const seen = [];
  const f = async (url, init) => {
    seen.push(JSON.parse(init.body));
    const step = steps[i++];
    const message = typeof step === 'string'
      ? { role: 'assistant', content: step }
      : { role: 'assistant', content: null, tool_calls: step.map((s, k) => ({ id: `c${i}${k}`, type: 'function', function: { name: s[0], arguments: JSON.stringify(s[1]) } })) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
  };
  f.seen = seen;
  return f;
}

test('Arabic and English food search', () => {
  const db = openDb(':memory:');
  const foods = loadFoods(db);
  assert.equal(searchFoods(foods, 'توست')[0].id.startsWith('toast'), true);
  assert.equal(searchFoods(foods, 'عيش بلدى')[0].id, 'baladi-bread', 'alef/ya variants match');
  assert.equal(searchFoods(foods, 'tortilla')[0].id, 'tortilla');
  assert.equal(searchFoods(foods, 'كشرى')[0].id, 'koshari');
  assert.equal(norm('أحمد'), 'احمد');
});

test('coach logs food and swaps an item through real routes', async (t) => {
  const app = await setup(); t.after(app.close);
  const day = await runTool(app.db, app.user, D, 'get_day', {});
  const carbItem = day.meals.flatMap((m) => m.items).find((i) => ['basmati', 'white-rice', 'pasta', 'potato', 'baladi-bread', 'toast-brown', 'vermicelli-rice'].includes(i.foodId));
  assert.ok(carbItem, 'plan has a carb item');
  const model = scripted([
    [['get_day', {}]],
    [['search_foods', { query: 'توست أسمر' }], ['list_alternatives', { ref: carbItem.ref }]],
    [['log_food', { foodId: 'toast-brown', grams: 60 }], ['swap_item', { ref: carbItem.ref, foodId: 'tortilla', scope: 'always' }]],
    'Logged 2 slices of brown toast and your plan now uses tortillas.',
  ]);
  const out = await coachTurn({ db: app.db, user: app.user, text: 'كلت ٢ توست أسمر، وغير الرز لتورتيلا على طول', today: D, env, fetchImpl: model });
  assert.match(out.reply, /tortilla/);
  assert.equal(out.actions.filter((a) => a.result?.error).length, 0, JSON.stringify(out.actions.map((a) => a.result?.error).filter(Boolean)));
  const after = await runTool(app.db, app.user, D, 'get_day', {});
  assert.ok(after.otherFood.some((o) => o.name === 'Brown toast'), 'toast logged');
  assert.ok(after.meals.flatMap((m) => m.items).some((i) => i.foodId === 'tortilla'), 'plan swapped');
  // the model was given the tools and a system prompt with the person's targets
  assert.ok(model.seen[0].tools.some((x) => x.function.name === 'swap_item'));
  assert.match(model.seen[0].messages[0].content, /Daily targets: \d+ kcal/);
});

test('coach cannot use admin routes or bypass exclusions', async (t) => {
  const app = await setup(); t.after(app.close);
  await runTool(app.db, app.user, D, 'update_food_preferences', { excludeGroups: ['fish', 'seafood'] });
  const day = await runTool(app.db, app.user, D, 'get_day', {});
  assert.ok(!day.meals.flatMap((m) => m.items).some((i) => ['tilapia', 'salmon', 'shrimp', 'tuna-canned', 'sea-bream', 'mackerel'].includes(i.foodId)), 'plan rebuilt without fish');
  const ref = day.meals[0].items[0].ref;
  const r = await runTool(app.db, app.user, D, 'swap_item', { ref, foodId: 'shrimp', scope: 'today' });
  assert.ok(r.error, 'excluded food refused');
  const { callAs } = await import('../src/api.js');
  await assert.rejects(() => callAs(app.db, { ...app.user, role: 'user' }, 'GET', '/api/admin/users'), /admin/);
});

test('without an AI key the coach explains, and model failures do not crash', async (t) => {
  const app = await setup(); t.after(app.close);
  const off = await coachTurn({ db: app.db, user: app.user, text: 'hi', today: D, env: {} });
  assert.match(off.reply, /not switched on/);
  const broken = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(() => coachTurn({ db: app.db, user: app.user, text: 'hi', today: D, env, fetchImpl: broken }), /500/);
  const res = await app.call('POST', '/api/coach', { text: 'hello', today: D });
  assert.equal(res.messages.length, 2, 'user message and a reply are stored even when AI is off');
});

test('a retired model ID (NVIDIA "404 page not found") falls back to a working model and is remembered', async (t) => {
  const app = await setup(); t.after(app.close);
  const { getSetting } = await import('../src/db.js');
  const tried = [];
  const nvidia = async (url, init) => {
    const { model } = JSON.parse(init.body);
    tried.push(model);
    if (model === 'moonshotai/kimi-k2.5') return { ok: false, status: 404, text: async () => '404 page not found' };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'أهلا! أنا هنا.' } }] }) };
  };
  const out = await coachTurn({ db: app.db, user: app.user, text: 'hi', today: D, env: { ...env, FITCREW_AI_MODEL: 'moonshotai/kimi-k2.5' }, fetchImpl: nvidia });
  assert.equal(out.reply, 'أهلا! أنا هنا.');
  assert.deepEqual(tried, ['moonshotai/kimi-k2.5', 'openai/gpt-oss-20b']);
  assert.equal(getSetting(app.db, 'aiModelWorking'), 'openai/gpt-oss-20b');
  tried.length = 0;
  await coachTurn({ db: app.db, user: app.user, text: 'again', today: D, env: { ...env, FITCREW_AI_MODEL: 'moonshotai/kimi-k2.5' }, fetchImpl: nvidia });
  assert.deepEqual(tried, ['openai/gpt-oss-20b'], 'the working model is used first next time');
});

test('auth errors are not retried on other models', async (t) => {
  const app = await setup(); t.after(app.close);
  let n = 0;
  const denied = async () => { n++; return { ok: false, status: 401, text: async () => 'Unauthorized' }; };
  await assert.rejects(() => coachTurn({ db: app.db, user: app.user, text: 'hi', today: D, env, fetchImpl: denied }), /401/);
  assert.equal(n, 1);
});

test('an overloaded model hands over to the next one instead of making the person wait', async (t) => {
  const app = await setup(); t.after(app.close);
  const tried = [];
  const f = async (url, init) => {
    const { model } = JSON.parse(init.body); tried.push(model);
    if (model === 'slow/model') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }) };
  };
  const out = await coachTurn({ db: app.db, user: app.user, text: 'hi', today: D, env: { ...env, FITCREW_AI_MODEL: 'slow/model' }, fetchImpl: f });
  assert.equal(out.reply, 'ok');
  assert.deepEqual(tried, ['slow/model', 'openai/gpt-oss-20b']);
  const { getSetting } = await import('../src/db.js');
  assert.equal(getSetting(app.db, 'aiLastError'), null, 'error banner clears once a model answers');
});

test('coach action labels for amount and whole-meal changes', async () => {
  const { actionLabel } = await import('../src/coach.js');
  const foods = new Map();
  assert.equal(actionLabel({ tool: 'ate_amount', args: { ref: '0-0-0' }, result: { ok: true } }, foods), 'Logged a different amount');
  assert.equal(actionLabel({ tool: 'swap_meal', args: { scope: 'today' }, result: { ok: true, title: 'Chicken wrap' } }, foods), 'Meal changed to Chicken wrap (today)');
  assert.equal(actionLabel({ tool: 'swap_meal', args: { scope: 'reset' }, result: { ok: true } }, foods), 'Put the planned meal back');
});
