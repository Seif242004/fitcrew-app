// Coach picks: the AI chooses the split from every split that fits the person's days; the rules
// decide when the AI is off or answers something invalid. The review checks the result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSplit, splitPrompt } from '../src/split-ai.js';
import { chooseSplit, splitsFor, generateWorkoutPlan } from '../src/workout.js';
import { workoutPlanIssues } from '../src/review.js';

const env = { FITCREW_AI_KEY: 'k', FITCREW_AI_BASE_URL: 'https://ai.example/v1', FITCREW_AI_MODEL: 'm' };
const answer = (obj) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });

test('rules: every kind of person gets a split that runs on their days', () => {
  for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const experience of ['beginner', 'intermediate', 'advanced'])
    for (const intensity of ['light', 'moderate', 'hard']) for (const focus of [[], ['arms'], ['legs']]) {
      const c = chooseSplit({ daysPerWeek, experience, intensity, focus });
      assert.ok(splitsFor(daysPerWeek).includes(c.split), `${daysPerWeek} days -> ${c.split}`);
      assert.ok(c.reason.length > 20);
    }
});

test('rules: beginners and light weeks train full body; arm focus gets the Arnold split; hard 4-day weeks go anterior / posterior', () => {
  assert.equal(chooseSplit({ daysPerWeek: 3, experience: 'beginner' }).split, 'fullbody');
  assert.equal(chooseSplit({ daysPerWeek: 3, experience: 'advanced', intensity: 'light' }).split, 'fullbody');
  assert.equal(chooseSplit({ daysPerWeek: 3, experience: 'intermediate', focus: ['arms'] }).split, 'arnold');
  assert.equal(chooseSplit({ daysPerWeek: 3, experience: 'intermediate' }).split, 'ppl');
  assert.equal(chooseSplit({ daysPerWeek: 4, experience: 'advanced', intensity: 'hard' }).split, 'antpost');
  assert.equal(chooseSplit({ daysPerWeek: 4, experience: 'advanced', intensity: 'hard', focus: ['glutes'] }).split, 'upperlower');
  assert.equal(chooseSplit({ daysPerWeek: 5, experience: 'intermediate' }).split, 'ulppl');
  assert.equal(chooseSplit({ daysPerWeek: 6, experience: 'advanced', focus: ['shoulders'] }).split, 'arnold');
});

test('the AI picks among the valid splits, with a reason; invalid answers fall back to the rules', async () => {
  const profile = { daysPerWeek: 3, experience: 'intermediate', intensity: 'hard', goal: 'bulk', focus: ['chest'] };
  const ai = await pickSplit({ profile, env, fetchImpl: answer({ split: 'arnold', reason: 'Chest and back together lets you push chest volume hard.' }) });
  assert.deepEqual([ai.split, ai.by], ['arnold', 'ai']);
  assert.match(ai.reason, /Chest/);
  const bad = await pickSplit({ profile, env, fetchImpl: answer({ split: 'upperlower', reason: 'x' }) });
  assert.equal(bad.by, 'rules', 'upper / lower does not run on 3 days');
  assert.equal(bad.split, chooseSplit(profile).split);
  const down = await pickSplit({ profile, env, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(down.by, 'rules');
  const off = await pickSplit({ profile, env: {} });
  assert.equal(off.by, 'rules');
  const msgs = splitPrompt({ ...profile, injuries: 'left knee' }, splitsFor(3));
  assert.match(msgs[1].content, /arnold: Arnold split/);
  assert.match(msgs[1].content, /left knee/);
  assert.ok(!/upperlower/.test(msgs[1].content), 'only splits that fit the days are offered');
});

test('the review checks the picked split and the volume', () => {
  const profile = { daysPerWeek: 4, experience: 'intermediate', intensity: 'moderate' };
  const plan = generateWorkoutPlan({ profile: { ...profile, chosenSplit: 'antpost' } });
  assert.equal(plan.split, 'Anterior / posterior');
  plan.splitChoice = { id: 'antpost' };
  assert.deepEqual(workoutPlanIssues(plan, profile), []);
  plan.splitChoice = { id: 'arnold' };
  assert.ok(workoutPlanIssues(plan, profile).some((i) => /Arnold split does not run on 4/.test(i)));
  plan.splitChoice = { id: 'antpost' };
  plan.days[0].exercises.forEach((e) => { e.sets = 6; });
  assert.ok(workoutPlanIssues(plan, profile).some((i) => /too much/.test(i)));
  assert.ok(workoutPlanIssues(plan, { ...profile, daysPerWeek: 3 }).some((i) => /3 were asked/.test(i)));
});
