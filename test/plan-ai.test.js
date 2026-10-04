import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlanSmart, extractJson, aiConfig } from '../src/plan-ai.js';

const targets = { kcal: 2200, proteinG: 176, carbsG: 200, fatG: 75 };
const env = { FITCREW_AI_KEY: 'test-key', FITCREW_AI_BASE_URL: 'https://ai.example/v1', FITCREW_AI_MODEL: 'm' };
const day = { meals: [
  { title: 'Ful breakfast', foodIds: ['ful-medames', 'eggs', 'baladi-bread', 'tomato'] },
  { title: 'Chicken and rice', foodIds: ['chicken-breast', 'white-rice', 'broccoli', 'olive-oil'] },
  { title: 'Beef and potatoes', foodIds: ['beef-lean', 'potato', 'salad-greens', 'tahini'] },
] };
// Fake OpenAI-compatible endpoint returning `content` as the assistant message.
const fakeFetch = (content, status = 200) => async (url, init) => {
  fakeFetch.last = { url, init };
  return { ok: status < 400, status, json: async () => ({ choices: [{ message: { content } }] }) };
};

test('no key means no AI and no network call', async () => {
  assert.equal(aiConfig({}), null);
  let called = false;
  const plan = await generatePlanSmart({ targets, prefs: { mealsPerDay: 3 }, days: 2, env: {}, fetchImpl: () => { called = true; } });
  assert.equal(called, false);
  assert.equal(plan.source, 'templates');
});

test('a valid AI reply (even wrapped in prose/fences) becomes the plan', async () => {
  const reply = 'Sure!\n```json\n' + JSON.stringify({ days: [day, day] }) + '\n```';
  const plan = await generatePlanSmart({ targets, prefs: { mealsPerDay: 3 }, days: 2, env, fetchImpl: fakeFetch(reply) });
  assert.equal(plan.source, 'ai');
  assert.equal(plan.days[0].meals[1].title, 'Chicken and rice');
  assert.equal(fakeFetch.last.url, 'https://ai.example/v1/chat/completions');
  assert.equal(fakeFetch.last.init.headers.authorization, 'Bearer test-key');
});

test('garbage or HTTP errors fall back to templates without throwing', async () => {
  for (const f of [fakeFetch('not json at all'), fakeFetch('{}', 500), async () => { throw new Error('network down'); }]) {
    const plan = await generatePlanSmart({ targets, prefs: { mealsPerDay: 3 }, days: 2, env, fetchImpl: f });
    assert.equal(plan.source, 'templates');
    assert.equal(plan.days.length, 2);
    assert.ok(plan.aiNote);
  }
});

test('AI menus with invented foods are replaced by templates', async () => {
  const bad = { meals: [day.meals[0], day.meals[1], { foodIds: ['pizza', 'cola'] }] };
  const plan = await generatePlanSmart({ targets, prefs: { mealsPerDay: 3 }, days: 2, env, fetchImpl: fakeFetch(JSON.stringify({ days: [bad, day] })) });
  assert.equal(plan.source, 'ai+templates');
});

test('extractJson strips think blocks', () => {
  assert.deepEqual(extractJson('<think>{"x":1}</think>{"days":[]}'), { days: [] });
  assert.equal(extractJson(null), null);
});
