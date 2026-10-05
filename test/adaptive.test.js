// Adaptive weekly check-in: the maths and every guard (src/adaptive.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyCheckin, weightTrend, checkinWeek, checkinOpenOn, goalRate, RULES } from '../src/adaptive.js';

const WEEK = '2026-10-09'; // a Friday
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** 21 days of intake before the Friday, and weekly weigh-ins changing by `rate` kg a week. */
function scenario({ kcal = 2200, intake = kcal, rate = -0.5, days = 21, startKg = 85, targets = {}, profile = {}, lastWeighIn = 0 } = {}) {
  const t = { kcal, tdee: 2750, tdeeFormula: 2750, tdeeAdjust: 0, ...targets };
  const p = { goal: 'cut', weeklyRateKg: 0.5, weightKg: startKg, sex: 'male', ...profile };
  const log = Array.from({ length: days }, (_, i) => ({ date: addDays(WEEK, -1 - i), kcal: intake }));
  const weighIns = [-28, -21, -14, -7, lastWeighIn].map((d) => ({ date: addDays(WEEK, d), kg: Math.round((startKg + (rate * (d + 28)) / 7) * 10) / 10 }));
  return { week: WEEK, targets: t, profile: p, intake: log, weighIns };
}

test('check-in week is the latest Friday; check-ins open Friday to Sunday', () => {
  assert.equal(checkinWeek('2026-10-09'), '2026-10-09'); // Friday
  assert.equal(checkinWeek('2026-10-10'), '2026-10-09'); // Saturday
  assert.equal(checkinWeek('2026-10-11'), '2026-10-09'); // Sunday
  assert.equal(checkinWeek('2026-10-15'), '2026-10-09'); // Thursday
  assert.deepEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-15'].map(checkinOpenOn), [true, true, true, false, false]);
});

test('weight trend: least-squares weekly rate and EMA trend weight', () => {
  const w = [0, 7, 14, 21].map((d) => ({ date: addDays('2026-09-11', d), kg: 90 - d / 14 })); // -0.5 kg a week
  const t = weightTrend(w, '2026-10-02');
  assert.equal(t.ratePerWeek, -0.5);
  assert.equal(t.count, 4);
  assert.equal(t.spanDays, 21);
  assert.ok(t.trendKg > 88.5 && t.trendKg < 90, `trend ${t.trendKg}`);
  // Noisy daily-style weights still give the underlying rate.
  const noisy = [0, 3, 7, 10, 14, 17, 21].map((d, i) => ({ date: addDays('2026-09-11', d), kg: 90 - (0.3 * d) / 7 + (i % 2 ? 0.6 : -0.6) }));
  assert.ok(Math.abs(weightTrend(noisy, '2026-10-02').ratePerWeek + 0.3) < 0.15);
});

test('goal rate uses the same caps as the calculator', () => {
  assert.equal(goalRate({ goal: 'cut', weeklyRateKg: 2, weightKg: 70 }), -0.7); // 1% of body weight
  assert.equal(goalRate({ goal: 'bulk', weeklyRateKg: 1, weightKg: 70 }), 0.35); // 0.5%
  assert.equal(goalRate({ goal: 'maintain', weeklyRateKg: 0.5, weightKg: 70 }), 0);
});

test('on pace and eating the plan: on track, no change', () => {
  const r = weeklyCheckin(scenario({ rate: -0.5 }));
  assert.equal(r.kind, 'on_track');
  assert.equal(r.kcal.to, r.kcal.from);
  assert.match(r.text, /on track/);
});

test('losing slower than the goal: eat less, at most 150 kcal a week', () => {
  const r = weeklyCheckin(scenario({ rate: -0.1 }));
  assert.equal(r.kind, 'proposed');
  assert.equal(r.kcal.from - r.kcal.to, RULES.maxStep);
  assert.ok(r.maintenance.measured < r.maintenance.current);
  assert.match(r.text, /losing 0.1 kg a week.*150 kcal less/);
});

test('losing much faster than the goal: eat more', () => {
  const r = weeklyCheckin(scenario({ rate: -1.0 }));
  assert.equal(r.kind, 'proposed');
  assert.equal(r.kcal.to - r.kcal.from, 150);
  assert.match(r.text, /faster than your goal.*more a day/);
});

test('gaining on a cut: eat less, with the right words', () => {
  const r = weeklyCheckin(scenario({ rate: 0.3 }));
  assert.equal(r.kind, 'proposed');
  assert.ok(r.kcal.to < r.kcal.from);
  assert.match(r.text, /went up 0.3 kg a week/);
});

test('bulking too fast and maintaining with drift', () => {
  const bulk = weeklyCheckin(scenario({ kcal: 3000, rate: 0.6, targets: { tdee: 2725, tdeeFormula: 2725 }, profile: { goal: 'bulk', weeklyRateKg: 0.25 } }));
  assert.equal(bulk.kind, 'proposed');
  assert.ok(bulk.kcal.to < bulk.kcal.from);
  assert.match(bulk.text, /lean/);
  const keep = weeklyCheckin(scenario({ kcal: 2600, rate: 0.3, targets: { tdee: 2600, tdeeFormula: 2600 }, profile: { goal: 'maintain' } }));
  assert.equal(keep.kind, 'proposed');
  assert.match(keep.text, /drifting up/);
});

test('guards: no weigh-in this week, not enough logged days or weigh-ins', () => {
  assert.equal(weeklyCheckin(scenario({ lastWeighIn: -5 })).kind, 'needs_weight');
  const few = weeklyCheckin(scenario({ days: 6 }));
  assert.equal(few.kind, 'learning');
  assert.match(few.text, /4 more fully logged days/);
  // Half-logged days (under 50% of the target) do not count as logged.
  const partial = scenario();
  partial.intake = partial.intake.map((d, i) => (i % 2 ? { ...d, kcal: 600 } : d));
  assert.equal(weeklyCheckin(partial).days, 11);
  const two = scenario(); two.weighIns = two.weighIns.slice(-2);
  assert.equal(weeklyCheckin(two).kind, 'learning');
  // Logs from before the plan started are ignored.
  assert.equal(weeklyCheckin({ ...scenario(), since: addDays(WEEK, -8) }).kind, 'learning');
});

test('guards: eating well off the plan holds the target and says why', () => {
  const under = weeklyCheckin(scenario({ intake: 1700, rate: -0.1 }));
  assert.equal(under.kind, 'hold');
  assert.equal(under.hold, 'under');
  assert.match(under.text, /Eat your full plan/);
  const over = weeklyCheckin(scenario({ intake: 2700, rate: 0.2 }));
  assert.equal(over.hold, 'over');
  // Numbers that cannot be right (likely missed logging) change nothing.
  const odd = weeklyCheckin(scenario({ rate: 2.5 }));
  assert.equal(odd.kind, 'hold');
  assert.equal(odd.hold, 'unclear');
});

test('guards: never below the safety floor', () => {
  const r = weeklyCheckin(scenario({ kcal: 1500, rate: -0.1, targets: { tdee: 2000, tdeeFormula: 2000 } }));
  assert.equal(r.kind, 'hold');
  assert.equal(r.hold, 'floor');
  assert.match(r.text, /safe minimum/);
  // Close to the floor: the step stops at the floor.
  const near = weeklyCheckin(scenario({ kcal: 1580, rate: -0.1, targets: { tdee: 2130, tdeeFormula: 2130 } }));
  assert.ok(near.kind === 'proposed' ? near.kcal.to >= 1500 : near.kind === 'hold');
});

test('learned maintenance never leaves 25% of the formula', () => {
  // Measured maintenance far above the formula: the estimate is clamped, so the step is small or capped.
  const r = weeklyCheckin(scenario({ rate: -1.2, targets: { tdee: 3400, tdeeFormula: 2750, tdeeAdjust: 650 } }));
  assert.ok(r.maintenance === undefined || r.maintenance.next <= 2750 * 1.25 + 1);
});
