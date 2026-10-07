import test from 'node:test';
import assert from 'node:assert/strict';
import { dayScore, streak } from '../src/adherence.js';

const targets = { kcal: 2200, proteinG: 170 };
const base = { targets, itemsTotal: 10, loggedSameDay: true };

test('perfect day scores 100 with a checked-in, fully ticked workout', () => {
  const s = dayScore({ ...base, consumed: { kcal: 2200, p: 170 }, itemsDone: 10, workout: { planned: true, done: true, completion: 1, checkin: 'approved' } });
  assert.equal(s.total, 100);
});

test('training points: the gym check-in earns all 30; logging sets earns nothing', () => {
  const day = { ...base, consumed: { kcal: 2200, p: 170 }, itemsDone: 10 };
  assert.equal(dayScore({ ...day, workout: { planned: true, completion: 0, checkin: 'approved' } }).parts.workout, 30, 'attended, nothing ticked (CrossFit, a class)');
  assert.equal(dayScore({ ...day, workout: { planned: true, completion: 1, checkin: null } }).parts.workout, 0, 'all sets, no check-in');
  assert.equal(dayScore({ ...day, workout: { planned: true, completion: 0.5, checkin: 'approved' } }).parts.workout, 30);
  assert.equal(dayScore({ ...day, workout: { planned: true, completion: 1, checkin: 'pending' } }).parts.workout, 0, 'a pending check-in counts once approved');
  const restGym = dayScore({ ...day, workout: { planned: false, checkin: 'approved' } });
  assert.deepEqual([restGym.parts.workout, restGym.parts.bonus], [20, 10], 'trained on a rest day: 20 for the rest day + 10 for the gym');
});

test('rest days earn 20 only within the plan\'s rest days for the week', () => {
  const day = { ...base, consumed: { kcal: 2200, p: 170 }, itemsDone: 10 };
  assert.equal(dayScore({ ...day, workout: { planned: false, checkin: null, restCounts: true } }).parts.workout, 20, 'resting is worth less than training');
  assert.equal(dayScore({ ...day, workout: { planned: false, checkin: null, restCounts: false } }).parts.workout, 0, 'an extra rest day');
  assert.equal(dayScore({ ...day, workout: { planned: false, checkin: 'approved', restCounts: false } }).parts.workout, 30, 'a check-in always counts');
});

test('perfect day scores 100 when workouts are not attached yet', () => {
  const s = dayScore({ ...base, consumed: { kcal: 2150, p: 165 }, itemsDone: 10 });
  assert.equal(s.total, 100);
});

test('missing the planned workout costs 30 points', () => {
  const s = dayScore({ ...base, consumed: { kcal: 2200, p: 170 }, itemsDone: 10, workout: { planned: true, done: false } });
  assert.equal(s.total, 70);
});

test('nothing logged scores zero, even on a rest day', () => {
  const s = dayScore({ ...base, loggedSameDay: false, consumed: { kcal: 0, p: 0 }, itemsDone: 0, workout: { planned: false, done: false } });
  assert.equal(s.total, 0);
});

test('+/-10% calories is still full marks, 30% off is zero for that part', () => {
  const ok = dayScore({ ...base, consumed: { kcal: 2420, p: 170 }, itemsDone: 10 });
  assert.equal(ok.parts.calories, 20);
  const far = dayScore({ ...base, consumed: { kcal: 2860, p: 170 }, itemsDone: 10 });
  assert.equal(far.parts.calories, 0);
});

test('eating more protein than target is never penalised', () => {
  const s = dayScore({ ...base, consumed: { kcal: 2200, p: 230 }, itemsDone: 10 });
  assert.equal(s.parts.protein, 20);
});

test('logging late loses the 10 same-day points', () => {
  const s = dayScore({ ...base, loggedSameDay: false, consumed: { kcal: 2200, p: 170 }, itemsDone: 10 });
  assert.equal(s.parts.logging, 0);
});

test('streak counts back from today when today qualifies', () => {
  const scores = [
    { date: '2026-10-02', total: 80 }, { date: '2026-10-01', total: 90 }, { date: '2026-09-30', total: 75 },
    { date: '2026-09-29', total: 40 }, { date: '2026-09-28', total: 95 },
  ];
  assert.equal(streak(scores, '2026-10-02'), 3);
});

test('an unfinished today does not break the streak', () => {
  const scores = [{ date: '2026-10-02', total: 20 }, { date: '2026-10-01', total: 90 }, { date: '2026-09-30', total: 75 }];
  assert.equal(streak(scores, '2026-10-02'), 2);
});
