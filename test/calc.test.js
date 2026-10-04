import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bmrMifflin, bmrKatch, navyBodyFat, bmr, tdee, calorieTarget, macros, computeTargets,
} from '../src/calc.js';

const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} not within ${eps} of ${b}`);

test('Mifflin-St Jeor, male', () => {
  near(bmrMifflin({ sex: 'male', weightKg: 80, heightCm: 180, age: 25 }), 1805);
});

test('Mifflin-St Jeor, female', () => {
  near(bmrMifflin({ sex: 'female', weightKg: 60, heightCm: 165, age: 30 }), 1320.25);
});

test('Katch-McArdle uses lean mass', () => {
  near(bmrKatch({ weightKg: 80, bodyFatPct: 25 }), 370 + 21.6 * 60);
});

test('bmr() switches formula when body fat is known', () => {
  const base = { sex: 'male', weightKg: 80, heightCm: 180, age: 25 };
  assert.equal(bmr(base).formula, 'mifflin-st-jeor');
  assert.equal(bmr({ ...base, bodyFatPct: 20 }).formula, 'katch-mcardle');
});

test('Navy body fat, male', () => {
  const bf = navyBodyFat({ sex: 'male', heightCm: 180, neckCm: 38, waistCm: 85 });
  assert.ok(bf >= 15 && bf <= 17, `got ${bf}`);
});

test('Navy body fat rejects impossible measurements', () => {
  assert.equal(navyBodyFat({ sex: 'male', heightCm: 180, neckCm: 40, waistCm: 38 }), null);
  assert.equal(navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 32, waistCm: 70 }), null); // no hip
});

test('TDEE applies the activity factor', () => {
  near(tdee(1800, 'moderate'), 2790, 0.01);
  assert.throws(() => tdee(1800, 'couch'));
});

test('cut: 0.5 kg/week is about a 550 kcal deficit', () => {
  const { kcal, warnings } = calorieTarget({ tdeeValue: 2800, goal: 'cut', weeklyRateKg: 0.5, weightKg: 85, sex: 'male' });
  near(kcal, 2800 - 550, 1);
  assert.equal(warnings.length, 0);
});

test('cut: loss rate is capped at 1% of body weight per week', () => {
  const { kcal, warnings } = calorieTarget({ tdeeValue: 4000, goal: 'cut', weeklyRateKg: 2, weightKg: 80, sex: 'male' });
  near(kcal, 4000 - (0.8 * 7700) / 7, 1);
  assert.equal(warnings.length, 1);
});

test('cut: deficit is capped at 25% of maintenance', () => {
  const { kcal, warnings } = calorieTarget({ tdeeValue: 2800, goal: 'cut', weeklyRateKg: 2, weightKg: 80, sex: 'male' });
  assert.equal(kcal, 2100);
  assert.ok(warnings.some((w) => w.includes('25%')));
});

test('heavy beginners get protein on reference weight and real carbs', () => {
  // 110 kg, 175 cm: dosing on total weight used to give 242 g protein and 0 g carbs.
  const t = computeTargets({ sex: 'male', weightKg: 110, heightCm: 175, age: 30, activityLevel: 'sedentary', goal: 'cut', weeklyRateKg: 0.75 });
  assert.ok(t.proteinG <= 160 && t.proteinG >= 130, `protein ${t.proteinG}`);
  assert.ok(t.carbsG * 4 >= t.kcal * 0.25 - 4, `carbs ${t.carbsG}`);
  near(t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9, t.kcal, 15);
});

test('calorie floor kicks in and warns', () => {
  const { kcal, warnings } = calorieTarget({ tdeeValue: 1500, goal: 'cut', weeklyRateKg: 0.5, weightKg: 60, sex: 'female' });
  assert.equal(kcal, 1200);
  assert.ok(warnings.some((w) => w.includes('floor')));
});

test('bulk: gain rate is capped at 0.5% of body weight per week', () => {
  const { warnings } = calorieTarget({ tdeeValue: 2800, goal: 'bulk', weeklyRateKg: 1, weightKg: 80, sex: 'male' });
  assert.equal(warnings.length, 1);
});

test('maintain ignores any rate', () => {
  const { kcal } = calorieTarget({ tdeeValue: 2500, goal: 'maintain', weeklyRateKg: 1, weightKg: 80, sex: 'male' });
  assert.equal(kcal, 2500);
});

test('macros add back up to the calorie target', () => {
  const m = macros({ kcal: 2300, weightKg: 80, goal: 'cut' });
  assert.equal(m.proteinG, 160);
  const total = m.proteinG * 4 + m.fatG * 9 + m.carbsG * 4;
  near(total, 2300, 15);
  assert.ok(m.fatG >= 64);
});

test('computeTargets end to end', () => {
  const t = computeTargets({
    sex: 'male', weightKg: 80, heightCm: 180, age: 25,
    activityLevel: 'moderate', goal: 'cut', weeklyRateKg: 0.5,
  });
  assert.equal(t.bmr, 1805);
  assert.equal(t.bmrFormula, 'mifflin-st-jeor');
  assert.equal(t.tdee, 2798);
  assert.equal(t.kcal, 2248);
  assert.equal(t.proteinG, 160);
  assert.ok(t.carbsG > 0);
});
